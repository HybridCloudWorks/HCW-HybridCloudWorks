/**
 * The scenario's answer (#613, Phase 2): one stacked bar per provider — the
 * base bill and then each extra as its own segment, so a reader sees *what*
 * DR costs and not only that it costs — with the monthly and yearly totals,
 * the cheapest marked, and the others' distance from it.
 *
 * PLAIN FLEX, NO CHART LIBRARY. A bar is a row of divs whose widths are
 * percentages of the widest gross bill on the page, so the three bars share
 * one scale. A commitment is negative money; it is drawn as a dashed outline
 * at the end of the gross bar, the width of what it takes off, and the total
 * beside the bar is the net figure.
 *
 * TWO READINGS OF THE SAME NUMBERS. Each bar is `role="img"` with an
 * aria-label that reads the stack out, and "Show breakdown" reveals a real
 * <table> of every line item (ScenarioBreakdown.jsx).
 *
 * A SECOND REGION (Phase 3). `compare`, when set, is the same scenario priced
 * in another region — see CompareRegion.jsx — and each provider's row gains a
 * line "US West: $X (+N%)" under its total, with "Cheapest in US West" under
 * the list. `actions` is a slot for the controls that belong beside "Show
 * breakdown": the compare select and the Explain button. Both are the page's
 * business; an article embed passes neither.
 */
import React, { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { providerLabel } from '@/lib/cloudPricing';
import {
  extraById,
  formatCost,
  formatDelta,
  formatSignedDelta,
  serviceMeta,
} from '@/lib/pricingScenarios';
import { ScenarioBreakdown } from './ScenarioBreakdown';
import { REDUCTION_CLASS, SEGMENT_CLASS, segmentClass } from './styles';

/** Explains the badge, as Phase 1's table does: it is not a live number. */
const CATALOGUE_TITLE =
  'Catalogue price: at least one line of this total is priced from the site’s own catalogue figure because the provider’s price list could not be read on the last refresh — a fallback, not a live price.';

const MUTED = 'text-slate-600 dark:text-slate-400';

/** The gross bill: base plus every positive segment; what the bar's fill is scaled by. */
const grossOf = (p) =>
  p.total === null ? 0 : p.base.total + p.segments.reduce((sum, s) => sum + Math.max(0, s.cost), 0);

function describeBar(p) {
  const parts = [`base ${formatCost(p.base.total)}`];
  for (const s of p.segments) parts.push(`${s.label} ${formatCost(s.cost)}`);
  return `${providerLabel(p.provider)}: ${formatCost(p.total)} a month, ${formatCost(
    p.yearly
  )} a year; ${parts.join('; ')}.`;
}

function Bar({ p, maxGross }) {
  const gross = grossOf(p);
  // Of the page's widest gross bill, so the three bars share one scale.
  const width = (cost) => `${maxGross > 0 ? (Math.abs(cost) / maxGross) * 100 : 0}%`;
  // Of this provider's own gross bill: the segments inside the filled part.
  const share = (cost) => `${gross > 0 ? (cost / gross) * 100 : 0}%`;
  const reductions = p.segments.filter((s) => s.cost < 0);
  return (
    <div role="img" aria-label={describeBar(p)} className="flex h-6 w-full">
      <div className="flex h-full overflow-hidden rounded-l-sm" style={{ width: width(gross) }}>
        <div className={`h-full ${SEGMENT_CLASS.base}`} style={{ width: share(p.base.total) }} />
        {p.segments
          .filter((s) => s.cost > 0)
          .map((s) => (
            <div
              key={s.extraId}
              className={`h-full ${segmentClass(s.extraId)}`}
              style={{ width: share(s.cost) }}
              data-segment={s.extraId}
            />
          ))}
      </div>
      {reductions.map((s) => (
        <div
          key={s.extraId}
          className={`h-full rounded-r-sm ${REDUCTION_CLASS}`}
          style={{ width: width(s.cost), marginLeft: `-${width(s.cost)}` }}
          data-segment={s.extraId}
        />
      ))}
    </div>
  );
}

/** "US West: $782.10 (+10%)" — the same provider's total in the compare region. */
function CompareLine({ compare, provider }) {
  if (!compare || compare.status !== 'ready') return null;
  const other = compare.providers[provider];
  let text = 'unavailable';
  if (other && other.total !== null) {
    text = formatCost(other.total);
    if (other.delta !== null) text += ` (${formatSignedDelta(other.delta)})`;
  }
  return (
    <p className={`text-xs tabular-nums ${MUTED}`} data-compare={provider}>
      {compare.label}: {text}
    </p>
  );
}

function Total({ p }) {
  return (
    <span className="text-sm tabular-nums">
      <span className="text-lg font-semibold text-slate-950 dark:text-white">
        {formatCost(p.total)}
      </span>
      <span className={MUTED}> / month · {formatCost(p.yearly)} / year</span>
      {p.deltaFromCheapest > 0 ? (
        <span className="ml-2 font-medium text-amber-700 dark:text-amber-400" data-delta>
          {formatDelta(p.deltaFromCheapest)} vs cheapest
        </span>
      ) : null}
    </span>
  );
}

function ProviderRow({ p, cheapest, maxGross, compare }) {
  const label = providerLabel(p.provider);
  return (
    <li
      className={`flex flex-col gap-1 rounded-lg p-3 ${cheapest ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}
      data-scenario-provider={p.provider}
      data-cheapest={cheapest ? 'true' : undefined}
      data-total={p.total === null ? 'unavailable' : 'priced'}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-bold text-slate-950 dark:text-white">
          {label}
          {cheapest ? (
            <Badge className="ml-2 align-middle bg-emerald-600 text-white hover:bg-emerald-600">
              cheapest
            </Badge>
          ) : null}
          {p.catalogue.length > 0 && p.total !== null ? (
            <Badge
              variant="outline"
              title={CATALOGUE_TITLE}
              className="ml-2 align-middle font-medium"
            >
              catalogue price
            </Badge>
          ) : null}
        </span>
        {p.total === null ? (
          <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
            unavailable: {p.unavailable.map((id) => serviceMeta(id).label).join(', ')}
          </span>
        ) : (
          <Total p={p} />
        )}
      </div>
      {p.total === null ? (
        <p className={`text-xs ${MUTED}`}>
          No price for that service on {label} in this region, so there is no total to compare.
        </p>
      ) : (
        <Bar p={p} maxGross={maxGross} />
      )}
      <CompareLine compare={compare} provider={p.provider} />
    </li>
  );
}

function Legend({ extras }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
      <li className="flex items-center gap-1.5">
        <span
          className={`inline-block h-3 w-3 rounded-sm ${SEGMENT_CLASS.base}`}
          aria-hidden="true"
        />{' '}
        Base
      </li>
      {extras.map((id) => (
        <li key={id} className="flex items-center gap-1.5">
          <span
            className={`inline-block h-3 w-3 rounded-sm ${segmentClass(id)}`}
            aria-hidden="true"
          />
          {extraById(id)?.label ?? id}
          {SEGMENT_CLASS[id] ? '' : ' (reduction)'}
        </li>
      ))}
    </ul>
  );
}

/** The one line under the list about the compare region: loading, failed, or who wins there. */
function CompareSummary({ compare }) {
  if (!compare) return null;
  let text;
  if (compare.status === 'loading') text = `Loading ${compare.label} prices…`;
  else if (compare.status === 'error')
    text = `${compare.label} prices could not be loaded: ${compare.error?.message ?? 'unknown error'}`;
  else if (compare.cheapest.length === 0) text = `Nothing is priced in ${compare.label}.`;
  else text = `Cheapest in ${compare.label}: ${compare.cheapest.map(providerLabel).join(', ')}`;
  return (
    <p
      className={`flex items-center gap-2 text-sm ${compare.status === 'error' ? 'text-destructive' : MUTED}`}
      data-testid="compare-summary"
      data-status={compare.status}
    >
      {compare.status === 'loading' ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : null}
      {text}
    </p>
  );
}

function Status({ loading, error }) {
  let text = 'Nothing to price until the first refresh.';
  if (loading) text = 'Loading prices for this scenario…';
  else if (error) text = 'No prices to build the scenario from until they load.';
  return (
    <p className={`flex items-center gap-2 p-4 text-sm ${MUTED}`} data-testid="scenario-status">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {text}
    </p>
  );
}

/**
 * @param {object} props
 * @param {ReturnType<typeof import('@/lib/pricingScenarios').computeScenario>|null} props.result
 *   null before any data has arrived
 * @param {object|null} [props.compare]  see CompareRegion.jsx's useCompareRegion
 * @param {React.ReactNode} [props.actions]  controls rendered beside "Show breakdown"
 */
export function ScenarioResults({ result, loading, error, compare = null, actions = null }) {
  const [open, setOpen] = useState(false);
  const breakdownId = useId();
  if (!result) return <Status loading={loading} error={error} />;

  const maxGross = Math.max(0, ...result.providers.map(grossOf));
  return (
    <div className="flex flex-col gap-3" data-testid="scenario-results">
      <Legend extras={result.extras} />
      <ul className="flex flex-col gap-1">
        {result.providers.map((p) => (
          <ProviderRow
            key={p.provider}
            p={p}
            cheapest={result.cheapest.includes(p.provider)}
            maxGross={maxGross}
            compare={compare}
          />
        ))}
      </ul>
      <CompareSummary compare={compare} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={breakdownId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide breakdown' : 'Show breakdown'}
        </Button>
        {actions}
      </div>
      {open ? <ScenarioBreakdown providers={result.providers} id={breakdownId} /> : null}
    </div>
  );
}
