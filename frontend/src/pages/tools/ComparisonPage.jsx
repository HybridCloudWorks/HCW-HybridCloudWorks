/**
 * `/tools/comparison` — list prices for one service shape on AWS, Azure and
 * Google Cloud, side by side (#613, Phase 1).
 *
 * WHAT IT IS AND IS NOT. Every row is a like-for-like benchmark — a 4 vCPU
 * / 16 GiB VM, a million serverless requests, a GB-month of hot object
 * storage — priced from each provider's public price list and cached
 * server-side once a day. It is a list price, not a bill: no reservations,
 * no committed use, no free tier, no egress beyond the CDN row. The scenario
 * card above the table (Phase 2, pages/tools/scenario/) turns these same
 * rates into a monthly estimate for one shape, with extras itemised.
 *
 * THE REGION IS IN THE URL. `?region=` drives the fetch, so a comparison for
 * Western Europe is a link someone can send rather than a selection they
 * have to describe. The list of regions comes from the API; the page ships
 * only the default, which is the one the API assumes when none is asked for.
 *
 * PRE-RENDER AND HYDRATION. This route is built to a static file and hydrated
 * in the browser (see scripts/prerender-entry.jsx). There is no API at build
 * time, so the static page carries the heading, the intro, the region control
 * and the table's header with a single "Loading prices…" row — and the first
 * client render, before its fetch resolves, produces exactly that markup,
 * which is what lets React adopt the server HTML instead of discarding it.
 * Nothing that depends on data, the clock or the locale renders until data
 * has arrived, for the same reason.
 *
 * The region control is a native <select> rather than the Radix one in
 * components/ui/select.jsx: it works in the pre-rendered HTML before any
 * script has run, needs no portal, and is the control a phone already knows
 * how to open. It borrows that component's trigger styling so the two look
 * alike.
 */
import React, { useCallback, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchCloudPricing } from '@/lib/publicApi';
import {
  DEFAULT_PRICING_REGION,
  PRICING_PROVIDERS,
  asOfLine,
  cheapestProviders,
  formatPrice,
  rowsByProvider,
} from '@/lib/cloudPricing';
import { pricingPageFor } from './pricingPages';
import { ScenarioSection } from './scenario/ScenarioSection';

const PAGE_TITLE = 'Cloud pricing comparison';

/** Explains the badge to a reader who hovers it: it is not a live number. */
const CATALOGUE_TITLE =
  'Catalogue price: the provider’s price list could not be read on the last refresh, so this is the site’s own catalogue figure for the same shape — a fallback, not a live price.';

const UNAVAILABLE_TITLE =
  'Unavailable: neither a live price nor a catalogue figure exists for this provider and service in this region.';

/** Browser-only. Never reached at pre-render, where there is no data. */
const formatLocalDateTime = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? String(iso)
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/** The native select, styled like SelectTrigger so the page has one look. */
function RegionSelect({ region, regions, disabled, onChange }) {
  // Before data arrives the only regions the page knows are the default and
  // the one it was asked for. Both are offered so that a URL naming a region
  // the API refuses (a 400, so no list ever arrives) still has a way back.
  const fallback = [DEFAULT_PRICING_REGION, region]
    .filter((id, index, all) => all.indexOf(id) === index)
    .map((id) => ({ id, label: id }));
  const options = regions.length > 0 ? regions : fallback;
  return (
    <div className="flex items-center gap-3">
      <label htmlFor="pricing-region" className="text-sm font-medium">
        Region
      </label>
      <select
        id="pricing-region"
        value={region}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-48 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const AS_OF_TONE = {
  never: 'text-slate-600 dark:text-slate-400',
  stale: 'text-amber-700 dark:text-amber-400',
  fresh: 'text-slate-600 dark:text-slate-400',
};

function AsOfLine({ pricing }) {
  if (!pricing) return null;
  const line = asOfLine(pricing, formatLocalDateTime);
  return (
    <p className={`text-sm ${AS_OF_TONE[line.tone]}`} data-testid="as-of" data-tone={line.tone}>
      {line.text}
    </p>
  );
}

function ErrorPanel({ message, onRetry }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 break-words">Prices could not be loaded: {message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="mr-2 h-3.5 w-3.5" /> Try again
      </Button>
    </div>
  );
}

/** One full-width row carrying the table's state when it has no services. */
function StatusRow({ children, loading }) {
  return (
    <tr>
      <td
        colSpan={PRICING_PROVIDERS.length + 1}
        className="p-6 text-center text-sm text-slate-600 dark:text-slate-400"
      >
        <span className="inline-flex items-center gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {children}
        </span>
      </td>
    </tr>
  );
}

function PriceCell({ provider, service, row, cheapest }) {
  const href = pricingPageFor(provider.id, service.serviceId);
  const price = row ? formatPrice(row.pricePerUnit, row.currency) : null;
  const linkClass = 'block rounded-md p-3 -m-3 hover:bg-accent/60 focus-visible:bg-accent/60';
  const label = `${provider.label} pricing for ${service.label}`;

  let body;
  if (!row || price === null) {
    body = (
      <Badge variant="outline" title={UNAVAILABLE_TITLE} className="font-medium">
        unavailable
      </Badge>
    );
  } else {
    body = (
      <>
        <span className="block text-base font-semibold tabular-nums text-slate-950 dark:text-white">
          {price}
        </span>
        <span className="block text-[11px] text-slate-600 dark:text-slate-400">
          {row.sku || '—'}
        </span>
        {row.source === 'baseline' ? (
          <Badge variant="outline" title={CATALOGUE_TITLE} className="mt-1 font-medium">
            catalogue price
          </Badge>
        ) : null}
      </>
    );
  }

  return (
    <td
      className={`align-top p-3 border-t border-slate-200 dark:border-slate-700 ${
        cheapest ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''
      }`}
      data-provider={provider.id}
      data-cheapest={cheapest ? 'true' : undefined}
      data-source={row ? row.source : 'unavailable'}
    >
      <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass} title={label}>
        {body}
      </a>
    </td>
  );
}

function ServiceRow({ service }) {
  const byProvider = rowsByProvider(service.rows);
  const cheapest = cheapestProviders(service.rows);
  return (
    <tr data-service={service.serviceId}>
      <th
        scope="row"
        className="sticky left-0 z-10 bg-background align-top p-3 border-t border-slate-200 dark:border-slate-700"
      >
        <span className="block text-sm font-bold text-slate-950 dark:text-white">
          {service.label}
        </span>
        <span className="block text-[11px] font-normal text-slate-600 dark:text-slate-400">
          per {service.unit}
          {service.sku ? ` · ${service.sku}` : ''}
        </span>
      </th>
      {PRICING_PROVIDERS.map((provider) => (
        <PriceCell
          key={provider.id}
          provider={provider}
          service={service}
          row={byProvider.get(provider.id) ?? null}
          cheapest={cheapest.has(provider.id)}
        />
      ))}
    </tr>
  );
}

function PricingTable({ services, loading, error }) {
  let status = null;
  if (services.length === 0) {
    if (loading) status = <StatusRow loading>Loading prices…</StatusRow>;
    else if (error) status = <StatusRow>Prices could not be loaded.</StatusRow>;
    else status = <StatusRow>Nothing to compare until the first refresh.</StatusRow>;
  }
  return (
    <div
      role="region"
      aria-labelledby="pricing-heading"
      className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"
    >
      <table className="w-full min-w-[48rem] border-collapse text-left">
        <caption className="sr-only">
          List prices for eight service shapes, one row each, with a column per provider. The
          cheapest provider on a row is highlighted; a catalogue price is a fallback figure, not a
          live one.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 bg-background p-3 text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 w-56"
            >
              Service
            </th>
            {PRICING_PROVIDERS.map((provider) => (
              <th
                key={provider.id}
                scope="col"
                className="p-3 text-sm font-bold text-slate-950 dark:text-white min-w-40"
              >
                {provider.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {status}
          {services.map((service) => (
            <ServiceRow key={service.serviceId} service={service} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ComparisonPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const region = searchParams.get('region')?.trim() || DEFAULT_PRICING_REGION;
  // "Try again" bumps this into the fetch key. A failed request is never
  // cached (lib/publicApi.js), so a new key is a real retry, and it is the
  // only way to ask usePublicData for another read.
  const [attempt, setAttempt] = useState(0);

  const { data, loading, error } = usePublicData(
    () => fetchCloudPricing(region),
    `cloud-pricing:${region}:${attempt}`
  );

  const setRegion = useCallback(
    (next) => {
      const params = new URLSearchParams(searchParams);
      if (next && next !== DEFAULT_PRICING_REGION) params.set('region', next);
      else params.delete('region');
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const pricing = data ?? null;
  const services = Array.isArray(pricing?.services) ? pricing.services : [];
  const regions = Array.isArray(pricing?.regions) ? pricing.regions : [];

  return (
    <>
      <Helmet>
        <title>{`${PAGE_TITLE} | Hybrid Cloud Works`}</title>
        <meta
          name="description"
          content="List prices for the same service shape on AWS, Azure and Google Cloud, side by side, per region and refreshed daily from each provider’s public price list."
        />
      </Helmet>

      <div className="relative z-10 max-w-[1200px] mx-auto w-full px-4 md:px-8 py-12 flex flex-col gap-8">
        <header>
          <h1
            id="pricing-heading"
            className="display-heading text-3xl sm:text-4xl text-slate-950 dark:text-white mb-3"
          >
            {PAGE_TITLE}
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-3xl">
            The list price of one like-for-like service shape on AWS, Azure and Google Cloud, read
            from each provider&rsquo;s public price list and refreshed daily. It is a price, not a
            bill: no reservations, no committed-use discounts, no free tier. Each cell links to the
            page the number came from.
          </p>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <RegionSelect
            region={region}
            regions={regions}
            // Locked only while the first read is in flight. After a failure
            // it stays usable, since changing region is the likeliest fix.
            disabled={!pricing && loading}
            onChange={setRegion}
          />
          <AsOfLine pricing={pricing} />
        </div>

        {error ? (
          <ErrorPanel message={error.message} onRetry={() => setAttempt((n) => n + 1)} />
        ) : null}

        <ScenarioSection pricing={pricing} loading={loading} error={error} />

        <PricingTable services={services} loading={loading} error={error} />
      </div>
    </>
  );
}
