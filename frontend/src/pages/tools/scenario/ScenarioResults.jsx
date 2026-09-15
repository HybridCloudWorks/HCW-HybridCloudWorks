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
 * <table> of every line item — the quantity, the factor, the unit price and
 * the product — which is what "the maths is visible" means here.
 */
import React, { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PRICING_PROVIDERS, formatPrice } from '@/lib/cloudPricing';
import {
  extraById,
  formatCost,
  formatDelta,
  formatQuantity,
  serviceMeta,
} from '@/lib/pricingScenarios';
import { REDUCTION_CLASS, SEGMENT_CLASS, segmentClass } from './styles';

const providerLabel = (id) => PRICING_PROVIDERS.find((p) => p.id === id)?.label ?? id;

/** Explains the badge, as Phase 1's table does: it is not a live number. */
const CATALOGUE_TITLE =
  'Catalogue price: at least one line of this total is priced from the site’s own catalogue figure because the provider’s price list could not be read on the last refresh — a fallback, not a live price.';

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

function ProviderRow({ p, cheapest, maxGross }) {
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
          <span className="text-sm tabular-nums">
            <span className="text-lg font-semibold text-slate-950 dark:text-white">
              {formatCost(p.total)}
            </span>
            <span className="text-slate-600 dark:text-slate-400">
              {' '}
              / month · {formatCost(p.yearly)} / year
            </span>
            {p.deltaFromCheapest > 0 ? (
              <span className="ml-2 font-medium text-amber-700 dark:text-amber-400" data-delta>
                {formatDelta(p.deltaFromCheapest)} vs cheapest
              </span>
            ) : null}
          </span>
        )}
      </div>
      {p.total === null ? (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          No price for that service on {label} in this region, so there is no total to compare.
        </p>
      ) : (
        <Bar p={p} maxGross={maxGross} />
      )}
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

function LineRow({ provider, item, line }) {
  const unit = serviceMeta(line.serviceId).shortUnit;
  const factor = line.factor === 1 ? '' : ` × ${line.factor}`;
  return (
    <tr data-line={`${provider}:${line.serviceId}`}>
      <td className="p-2">{item}</td>
      <td className="p-2">{line.label}</td>
      <td className="p-2 text-right tabular-nums whitespace-nowrap">
        {formatQuantity(line.quantity)} {unit}
        {factor}
      </td>
      <td className="p-2 text-right tabular-nums whitespace-nowrap">
        {line.unitPrice === null ? '—' : formatPrice(line.unitPrice)}
        {line.source === 'baseline' ? ' (catalogue)' : ''}
      </td>
      <td className="p-2 text-right tabular-nums whitespace-nowrap">
        {line.cost === null ? 'unavailable' : formatCost(line.cost)}
      </td>
    </tr>
  );
}

function Breakdown({ providers, id }) {
  return (
    <div
      id={id}
      className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700"
    >
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          Every line of the scenario, per provider: the quantity and factor, the unit price it was
          multiplied by, and the product.
        </caption>
        <thead>
          <tr className="text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
            <th scope="col" className="p-2">
              Item
            </th>
            <th scope="col" className="p-2">
              Line
            </th>
            <th scope="col" className="p-2 text-right">
              Quantity
            </th>
            <th scope="col" className="p-2 text-right">
              Unit price
            </th>
            <th scope="col" className="p-2 text-right">
              Cost / month
            </th>
          </tr>
        </thead>
        {providers.map((p) => (
          <tbody key={p.provider} data-breakdown={p.provider}>
            <tr>
              <th
                scope="rowgroup"
                colSpan={5}
                className="border-t border-slate-200 bg-slate-50 p-2 text-sm font-bold text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                {providerLabel(p.provider)}
                {p.total === null
                  ? ` — unavailable: ${p.unavailable.map((id) => serviceMeta(id).label).join(', ')}`
                  : ''}
              </th>
            </tr>
            {p.base.lines.map((line) => (
              <LineRow
                key={`base:${line.serviceId}`}
                provider={p.provider}
                item="Base"
                line={line}
              />
            ))}
            {p.segments.map((s) =>
              s.lines.map((line, index) => (
                <LineRow
                  key={`${s.extraId}:${index}`}
                  provider={p.provider}
                  item={s.label}
                  line={line}
                />
              ))
            )}
            <tr className="font-semibold">
              <td className="p-2" colSpan={4}>
                Total
              </td>
              <td className="p-2 text-right tabular-nums">
                {p.total === null ? 'unavailable' : formatCost(p.total)}
              </td>
            </tr>
          </tbody>
        ))}
      </table>
    </div>
  );
}

function Status({ loading, error }) {
  let text = 'Nothing to price until the first refresh.';
  if (loading) text = 'Loading prices for this scenario…';
  else if (error) text = 'No prices to build the scenario from until they load.';
  return (
    <p
      className="flex items-center gap-2 p-4 text-sm text-slate-600 dark:text-slate-400"
      data-testid="scenario-status"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {text}
    </p>
  );
}

/**
 * @param {object} props
 * @param {ReturnType<typeof import('@/lib/pricingScenarios').computeScenario>|null} props.result
 *   null before any data has arrived
 */
export function ScenarioResults({ result, loading, error }) {
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
          />
        ))}
      </ul>
      <div>
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
      </div>
      {open ? <Breakdown providers={result.providers} id={breakdownId} /> : null}
    </div>
  );
}
