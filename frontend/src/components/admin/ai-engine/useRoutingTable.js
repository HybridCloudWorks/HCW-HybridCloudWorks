/**
 * The routing table's reads and writes (ADR 0033 §4; split out of
 * RoutingTab.jsx in PR #841). Every change saves itself the moment it is made:
 * optimistic, then reconciled with what the API stored, and put back with a
 * toast when the save fails. The API drops the router's cache on each write.
 */
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { aiEngine } from '@/lib/aiEngine';
import { updateRoute, withRoute } from './routingModel';

const INITIAL = { status: 'loading', routes: {}, catalogue: {}, maxFallbacks: 3 };

/**
 * @returns {{
 *   state: { status: 'loading'|'ready'|'error', routes: object, catalogue: object, maxFallbacks: number, error?: string },
 *   busy: string|null,
 *   retry: () => void,
 *   change: (feature: string, spec: object) => Promise<void>,
 * }} `busy` is the feature whose save is in flight.
 */
export default function useRoutingTable() {
  const { toast } = useToast();
  const [state, setState] = useState(INITIAL);
  const [busy, setBusy] = useState(null);

  // The read sets state only from its callbacks, so the mount effect itself
  // sets nothing; `retry` resets to loading first, from a click.
  const load = useCallback(() => {
    aiEngine
      .getAiRouting()
      .then(({ routes, catalogue, maxFallbacks }) =>
        setState({ status: 'ready', routes, catalogue, maxFallbacks })
      )
      .catch((err) =>
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: err?.message || 'Could not load the routing table.',
        }))
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const retry = () => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    load();
  };

  const setRoute = (feature, route) =>
    setState((prev) => ({ ...prev, routes: withRoute(prev.routes, feature, route) }));

  const change = async (feature, spec) => {
    const previous = state.routes[feature] || null;
    const next = updateRoute(previous, spec);
    if (next && !next.provider) return;
    setBusy(feature);
    setRoute(feature, next);
    try {
      const saved = await aiEngine.setAiRoute(feature, next);
      setState((prev) => ({ ...prev, routes: saved }));
    } catch (err) {
      setRoute(feature, previous);
      toast({
        title: 'Could not save the route',
        description: err?.message || 'The previous route has been put back.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  return { state, busy, retry, change };
}
