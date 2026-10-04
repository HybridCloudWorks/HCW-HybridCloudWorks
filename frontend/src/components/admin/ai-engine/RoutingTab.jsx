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
 * The rules are in routingModel.js, the editor in RouteEditor.jsx and the
 * reads and writes in useRoutingTable.js (PR #841); this file renders. The
 * catalogue, the provider list and the routes all come from the API; nothing
 * here is a copy.
 */
import React, { useMemo, useState } from 'react';
import { Loader2, Route as RouteIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import EmptyState from '@/components/admin/shared/EmptyState';
import RouteEditor from './RouteEditor';
import useRoutingTable from './useRoutingTable';
import { describeRoute, routingSummary, runningOrder, sortByOrder } from './routingModel';

export {
  AUTO_MODEL_VALUE,
  DEFAULT_ORDER_VALUE,
  describeRoute,
  providerLabel,
  updateRoute,
} from './routingModel';

const MODES = [
  { id: false, label: 'Simple' },
  { id: true, label: 'Advanced' },
];

/** The Simple / Advanced switch. */
function ModeToggle({ advanced, onChange }) {
  return (
    <div
      role="group"
      aria-label="Routing mode"
      className="flex rounded-md border border-border p-0.5 text-xs"
    >
      {MODES.map(({ id, label }) => (
        <button
          key={label}
          type="button"
          aria-pressed={advanced === id}
          onClick={() => onChange(id)}
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
  );
}

/** One task: its name and purpose, whether it has its own route, the sentence, and (Advanced) the editor. */
function TaskRow({
  feature,
  entry,
  route,
  providers,
  order,
  advanced,
  maxFallbacks,
  busy,
  onChange,
}) {
  return (
    <div className="border-b border-border/60 py-3 last:border-b-0" data-feature={feature}>
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
          providers={sortByOrder(providers)}
          maxFallbacks={maxFallbacks}
          busy={busy}
          onChange={onChange}
        />
      )}
    </div>
  );
}

/** The table of tasks, read-only in Simple mode and editable in Advanced. */
function RoutingCard({ state, features, providers, order, advanced, busy, onChange }) {
  return (
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
        {features.map((feature) => (
          <TaskRow
            key={feature}
            feature={feature}
            entry={state.catalogue[feature] || { label: feature }}
            route={state.routes[feature] || null}
            providers={providers}
            order={order}
            advanced={advanced}
            maxFallbacks={state.maxFallbacks}
            busy={busy === feature}
            onChange={(spec) => onChange(feature, spec)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

/** Loading, an empty catalogue, or the table. */
function RoutingBody({ state, features, onRetry, ...rest }) {
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading settings…
      </div>
    );
  }
  if (features.length === 0) {
    return (
      <EmptyState
        title="No AI tasks to route"
        description="The API sent an empty catalogue; every task is listed in functions/src/lib/ai/ai-config.js."
        onRetry={onRetry}
      />
    );
  }
  return <RoutingCard state={state} features={features} {...rest} />;
}

/**
 * @param {{ providers: Array<{id: string, name?: string, enabled?: boolean, status?: string, models?: string[], order?: number}> }} props
 */
export default function RoutingTab({ providers = [] }) {
  const { state, busy, retry, change } = useRoutingTable();
  const [advanced, setAdvanced] = useState(false);
  // The running global order, for the sentence a routeless task gets.
  const order = useMemo(() => runningOrder(providers), [providers]);

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
  const summary = routingSummary({
    status: state.status,
    routedCount: Object.keys(state.routes).length,
    featureCount: features.length,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <RouteIcon className="h-5 w-5 text-primary" aria-hidden="true" /> Routing by task
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{summary}</p>
        </div>
        <ModeToggle advanced={advanced} onChange={setAdvanced} />
      </div>

      <RoutingBody
        state={state}
        features={features}
        providers={providers}
        order={order}
        advanced={advanced}
        busy={busy}
        onChange={change}
        onRetry={retry}
      />
    </div>
  );
}
