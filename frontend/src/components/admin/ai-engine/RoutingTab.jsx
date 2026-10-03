/**
 * Routing — which provider and model serve each AI task (ADR 0033 §4).
 *
 * The router had one global order of preference and a per-feature on/off;
 * the model pinned on a provider card applied to every purpose. This tab
 * adds a route per task: a primary provider, the model it should use, and a
 * fallback chain, read by the router ahead of the global order. A task with
 * no route follows the order of preference exactly as before — that is
 * "Simple mode", and it is the default for every task.
 *
 * Every row saves itself the moment it changes (optimistic, then reconciled
 * with what the API stored), and the API drops the router's cache on each
 * write so the next call uses it. The catalogue, the provider list and the
 * routes all come from the API; nothing here is a copy.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Plus, Route as RouteIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import EmptyState from '@/components/admin/shared/EmptyState';
import { aiEngine } from '@/lib/aiEngine';

export const DEFAULT_ORDER_VALUE = '__default__';
export const AUTO_MODEL_VALUE = '__auto__';

const PROVIDER_LABELS = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Claude (Anthropic)',
  nvidia: 'NVIDIA',
};

/** A provider's display name: the card's, else a known label, else the id. */
export function providerLabel(id, providers = []) {
  return providers.find((p) => p.id === id)?.name || PROVIDER_LABELS[id] || id;
}

/**
 * What a task will do, in one sentence, from its route and the global
 * order: the sentence the Simple view shows and the Advanced view confirms.
 */
export function describeRoute(route, { providers = [], order = [] } = {}) {
  if (!route) {
    const [first] = order;
    return first
      ? `Default order: ${providerLabel(first, providers)} first, then the rest in order.`
      : 'Default order of preference.';
  }
  const steps = [route.provider, ...(route.fallbacks || []).map((f) => f.provider)];
  const named = steps.map((id) => providerLabel(id, providers)).join(' → ');
  const model = route.model ? ` (${route.model})` : '';
  return `${named}${model}, then the rest of the default order.`;
}

/** The route with one step changed; `null` when the primary is cleared. */
export function updateRoute(route, change) {
  const base = route || { provider: '', model: null, fallbacks: [] };
  switch (change.type) {
    case 'primary':
      if (change.provider === DEFAULT_ORDER_VALUE) return null;
      return {
        ...base,
        provider: change.provider,
        // A model belongs to a provider; switching providers clears it.
        model: base.provider === change.provider ? base.model : null,
        fallbacks: (base.fallbacks || []).filter((f) => f.provider !== change.provider),
      };
    case 'model':
      return { ...base, model: change.model === AUTO_MODEL_VALUE ? null : change.model };
    case 'addFallback':
      return {
        ...base,
        fallbacks: [...(base.fallbacks || []), { provider: change.provider, model: null }],
      };
    case 'fallbackProvider':
      return {
        ...base,
        fallbacks: base.fallbacks.map((f, i) =>
          i === change.index ? { provider: change.provider, model: null } : f
        ),
      };
    case 'fallbackModel':
      return {
        ...base,
        fallbacks: base.fallbacks.map((f, i) =>
          i === change.index
            ? { ...f, model: change.model === AUTO_MODEL_VALUE ? null : change.model }
            : f
        ),
      };
    case 'removeFallback':
      return { ...base, fallbacks: base.fallbacks.filter((_, i) => i !== change.index) };
    default:
      return base;
  }
}

function ModelSelect({ id, label, provider, value, providers, disabled, onChange }) {
  const models = providers.find((p) => p.id === provider)?.models || [];
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        className="h-7 min-w-38 rounded-md border border-border bg-transparent px-2 text-xs"
        value={value || AUTO_MODEL_VALUE}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value={AUTO_MODEL_VALUE}>Auto (purpose table or card pin)</option>
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        {value && !models.includes(value) && <option value={value}>{value}</option>}
      </select>
    </div>
  );
}

function RouteEditor({ feature, entry, route, providers, maxFallbacks, busy, onChange }) {
  const providerIds = providers.map((p) => p.id);
  const used = new Set([route?.provider, ...(route?.fallbacks || []).map((f) => f.provider)]);
  const unavailable = (id) => {
    const p = providers.find((x) => x.id === id);
    return p && (p.enabled === false || p.status === 'unavailable');
  };
  const primaryId = `route-${feature}-primary`;
  return (
    <div className="space-y-2 border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={primaryId} className="text-xs text-muted-foreground">
          Primary
        </label>
        <select
          id={primaryId}
          className="h-7 min-w-38 rounded-md border border-border bg-transparent px-2 text-xs"
          value={route?.provider || DEFAULT_ORDER_VALUE}
          disabled={busy}
          onChange={(e) => onChange({ type: 'primary', provider: e.target.value })}
        >
          <option value={DEFAULT_ORDER_VALUE}>Use default order</option>
          {providerIds.map((id) => (
            <option key={id} value={id}>
              {providerLabel(id, providers)}
              {unavailable(id) ? ' (off or no key)' : ''}
            </option>
          ))}
        </select>
        {route && (
          <ModelSelect
            id={`route-${feature}-model`}
            label="Model"
            provider={route.provider}
            value={route.model}
            providers={providers}
            disabled={busy}
            onChange={(model) => onChange({ type: 'model', model })}
          />
        )}
        {busy && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Saving" />
        )}
      </div>
      {route && (
        <div className="space-y-1.5 pl-2">
          {(route.fallbacks || []).map((fallback, index) => (
            <div
              key={`${fallback.provider}-${index}`}
              className="flex flex-wrap items-center gap-2"
            >
              <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              <label
                htmlFor={`route-${feature}-fallback-${index}`}
                className="text-xs text-muted-foreground"
              >
                Fallback {index + 1}
              </label>
              <select
                id={`route-${feature}-fallback-${index}`}
                className="h-7 min-w-38 rounded-md border border-border bg-transparent px-2 text-xs"
                value={fallback.provider}
                disabled={busy}
                onChange={(e) =>
                  onChange({ type: 'fallbackProvider', index, provider: e.target.value })
                }
              >
                {providerIds
                  .filter((id) => id === fallback.provider || !used.has(id))
                  .map((id) => (
                    <option key={id} value={id}>
                      {providerLabel(id, providers)}
                      {unavailable(id) ? ' (off or no key)' : ''}
                    </option>
                  ))}
              </select>
              <ModelSelect
                id={`route-${feature}-fallback-${index}-model`}
                label="Model"
                provider={fallback.provider}
                value={fallback.model}
                providers={providers}
                disabled={busy}
                onChange={(model) => onChange({ type: 'fallbackModel', index, model })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                disabled={busy}
                aria-label={`Remove fallback ${index + 1} for ${entry.label}`}
                onClick={() => onChange({ type: 'removeFallback', index })}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
          {(route.fallbacks || []).length < maxFallbacks &&
            providerIds.some((id) => !used.has(id)) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={busy}
                onClick={() =>
                  onChange({
                    type: 'addFallback',
                    provider: providerIds.find((id) => !used.has(id)),
                  })
                }
              >
                <Plus className="h-3 w-3" /> Add fallback
              </Button>
            )}
        </div>
      )}
    </div>
  );
}

/**
 * @param {{ providers: Array<{id: string, name?: string, enabled?: boolean, status?: string, models?: string[], order?: number}> }} props
 */
export default function RoutingTab({ providers = [] }) {
  const { toast } = useToast();
  const [state, setState] = useState({
    status: 'loading',
    routes: {},
    catalogue: {},
    maxFallbacks: 3,
  });
  const [advanced, setAdvanced] = useState(false);
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

  // The running global order: enabled providers with a key, as the Services
  // tab sorts them. Used for the sentence a routeless task gets.
  const order = useMemo(
    () =>
      [...providers]
        .filter((p) => p.enabled && p.status !== 'unavailable')
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
        .map((p) => p.id),
    [providers]
  );
  const routable = useMemo(
    () => [...providers].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    [providers]
  );

  const change = async (feature, changeSpec) => {
    const previous = state.routes[feature] || null;
    const next = updateRoute(previous, changeSpec);
    if (next && !next.provider) return;
    setBusy(feature);
    setState((prev) => {
      const routes = { ...prev.routes };
      if (next) routes[feature] = next;
      else delete routes[feature];
      return { ...prev, routes };
    });
    try {
      const saved = await aiEngine.setAiRoute(feature, next);
      setState((prev) => ({ ...prev, routes: saved }));
    } catch (err) {
      setState((prev) => {
        const routes = { ...prev.routes };
        if (previous) routes[feature] = previous;
        else delete routes[feature];
        return { ...prev, routes };
      });
      toast({
        title: 'Could not save the route',
        description: err?.message || 'The previous route has been put back.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  if (state.status === 'error') {
    return (
      <EmptyState
        variant="error"
        title="The routing table could not be read"
        description={state.error}
        onRetry={retry}
      />
    );
  }

  const features = Object.keys(state.catalogue);
  const routedCount = Object.keys(state.routes).length;

  let summary = `${routedCount} of ${features.length} tasks have their own route; the rest follow the order of preference.`;
  if (state.status === 'loading') summary = 'Reading the routing table…';
  else if (routedCount === 0) {
    summary =
      'Every task follows the order of preference on AI Services. Assign a provider and model to a task here when one of them should be served differently.';
  }

  let body;
  if (state.status === 'loading') {
    body = (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading settings…
      </div>
    );
  } else if (features.length === 0) {
    body = (
      <EmptyState
        title="No AI tasks to route"
        description="The API sent an empty catalogue; every task is listed in functions/src/lib/ai/ai-config.js."
        onRetry={retry}
      />
    );
  } else {
    body = (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {advanced ? 'Provider, model and fallbacks per task' : 'What serves each task'}
          </CardTitle>
          <CardDescription>
            {advanced
              ? 'A routed provider that has no key, is switched off, or is placed off for the task is skipped for the next step; a route can never add a provider the Services tab does not allow. A model named here wins over the provider card’s pin.'
              : 'Read-only summary. Switch to Advanced to change a task’s route.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {features.map((feature) => {
            const entry = state.catalogue[feature] || { label: feature };
            const route = state.routes[feature] || null;
            return (
              <div
                key={feature}
                className="border-b border-border/60 py-3 last:border-b-0"
                data-feature={feature}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{entry.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{entry.description}</div>
                    {entry.route && (
                      <div className="mt-0.5 text-xs text-muted-foreground/70">{entry.route}</div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
                      route
                        ? 'border-primary/40 bg-primary/5 text-primary'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    {route ? 'Own route' : 'Default order'}
                  </span>
                </div>
                <p className="mt-1.5 text-xs" data-testid={`route-summary-${feature}`}>
                  {describeRoute(route, { providers, order })}
                </p>
                {advanced && (
                  <RouteEditor
                    feature={feature}
                    entry={entry}
                    route={route}
                    providers={routable}
                    maxFallbacks={state.maxFallbacks}
                    busy={busy === feature}
                    onChange={(spec) => change(feature, spec)}
                  />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <RouteIcon className="h-5 w-5 text-primary" aria-hidden="true" /> Routing by task
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{summary}</p>
        </div>
        <div
          role="group"
          aria-label="Routing mode"
          className="flex rounded-md border border-border p-0.5 text-xs"
        >
          {[
            { id: false, label: 'Simple' },
            { id: true, label: 'Advanced' },
          ].map(({ id, label }) => (
            <button
              key={label}
              type="button"
              aria-pressed={advanced === id}
              onClick={() => setAdvanced(id)}
              className={`rounded px-3 py-1 font-medium transition-colors ${
                advanced === id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {body}
    </div>
  );
}
