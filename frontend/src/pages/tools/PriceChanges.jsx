/**
 * "Price changes" on /tools/comparison (#613, Phase 3): what moved in the
 * region's cached list prices over the last 7 or 30 days, one row per
 * provider and service that changed — "AWS · Virtual machine $0.192 → $0.201
 * /hour +4.7%" — from `GET public/cloud-tools/price-changes?region=`.
 *
 * The region is the page's `?region=`, so this card and the table above it
 * never describe two different places. The range is local state: it is a
 * way of reading the same answer, not part of what the URL names.
 *
 * PRE-RENDER. With no data the card renders its heading, the two range
 * buttons and a "Loading price changes…" line, and the first client render
 * produces the same — so nothing that depends on the data, the clock or the
 * locale is on the page until data is (see ComparisonPage.jsx).
 */
import React, { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchPriceChanges } from '@/lib/publicApi';
import { formatLocalDateTime, formatPrice, providerLabel } from '@/lib/cloudPricing';

const WINDOWS = Object.freeze([
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
]);

const MUTED = 'text-slate-600 dark:text-slate-400';

/** "+4.7%" / "−2.1%": the server's deltaPct is already a percentage. */
export function formatDeltaPct(deltaPct) {
  const n = Number(deltaPct);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n).toFixed(1);
  if (n > 0) return `+${abs}%`;
  if (n < 0) return `−${abs}%`;
  return '0.0%';
}

function WindowToggle({ range, onChange }) {
  return (
    <div role="group" aria-label="Window" className="inline-flex rounded-md border border-input">
      {WINDOWS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={range === option.id}
          onClick={() => onChange(option.id)}
          className={`px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md ${
            range === option.id
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
              : 'hover:bg-accent/60'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ChangeRow({ item }) {
  const up = Number(item.deltaPct) > 0;
  const tone = up ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400';
  return (
    <li
      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-slate-200 py-2 first:border-t-0 dark:border-slate-700"
      data-change={`${item.provider}:${item.serviceId}`}
      data-direction={up ? 'up' : 'down'}
    >
      <span className="min-w-56 text-sm font-medium text-slate-950 dark:text-white">
        {providerLabel(item.provider)} · {item.label}
        {item.sku ? (
          <span className={`block text-[11px] font-normal ${MUTED}`}>{item.sku}</span>
        ) : null}
      </span>
      <span className="text-sm tabular-nums">
        {formatPrice(item.from)} → {formatPrice(item.to)}
        <span className={MUTED}> /{item.unit}</span>
      </span>
      <span className={`text-sm font-semibold tabular-nums ${tone}`}>
        <span aria-hidden="true">{up ? '↑' : '↓'}</span> {formatDeltaPct(item.deltaPct)}
      </span>
    </li>
  );
}

function Body({ changes, range, loading, error, onRetry }) {
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <p className="min-w-0 flex-1 break-words">
          Price changes could not be loaded: {error.message}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Try again
        </Button>
      </div>
    );
  }
  if (!changes) {
    return (
      <p className={`flex items-center gap-2 text-sm ${MUTED}`} data-testid="price-changes-status">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {loading ? 'Loading price changes…' : 'No price history for this region.'}
      </p>
    );
  }
  if (!changes.asOf) {
    return (
      <p className={`text-sm ${MUTED}`} data-testid="price-changes-status">
        No history yet: changes appear once the daily refresh has recorded more than one day.
      </p>
    );
  }
  const days = WINDOWS.find((w) => w.id === range)?.days;
  const items = changes.windows?.[range]?.items ?? [];
  if (items.length === 0) {
    return (
      <p className={`text-sm ${MUTED}`} data-testid="price-changes-status">
        No changes in the last {days} days.
      </p>
    );
  }
  return (
    <ul className="flex flex-col" data-testid="price-changes-list">
      {items.map((item) => (
        <ChangeRow key={`${item.provider}:${item.serviceId}`} item={item} />
      ))}
    </ul>
  );
}

function AsOf({ changes, range }) {
  if (!changes?.asOf) return null;
  const sampleDay = changes.windows?.[range]?.sampleDay;
  return (
    <p className={`text-xs ${MUTED}`} data-testid="price-changes-as-of">
      Compared with the sample of {sampleDay || 'the window start'}; as of{' '}
      {formatLocalDateTime(changes.asOf)}.
    </p>
  );
}

export function PriceChanges({ region }) {
  const [range, setRange] = useState('7d');
  const [attempt, setAttempt] = useState(0);
  const { data, loading, error } = usePublicData(
    () => fetchPriceChanges(region),
    `price-changes:${region}:${attempt}`
  );
  // The payload names its region; a previous region's answer, kept on screen
  // by the hook while the next loads, is not this region's.
  const changes = data && data.region === region ? data : null;

  return (
    <Card data-testid="price-changes">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-xl">Price changes</CardTitle>
          <CardDescription>
            List prices that moved in this region, against the daily sample from a week or a month
            ago. Nothing here is a bill either.
          </CardDescription>
        </div>
        <WindowToggle range={range} onChange={setRange} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Body
          changes={changes}
          range={range}
          loading={loading}
          error={error}
          onRetry={() => setAttempt((n) => n + 1)}
        />
        <AsOf changes={changes} range={range} />
      </CardContent>
    </Card>
  );
}
