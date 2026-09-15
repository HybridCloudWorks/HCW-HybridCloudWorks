/**
 * The read-only scenario card an article embed renders (#613, Phase 3) —
 * the lazy chunk behind PricingScenarioEmbed.jsx. Same arithmetic and the
 * same results component as /tools/comparison; what differs is that the
 * scenario comes from the fence body rather than the URL, and there is
 * nothing to change it with except the link to the tool.
 *
 * PRE-RENDER SAFE for the same reasons the page is: the fence body is
 * parsed the same way on both sides, the card's first render shows the
 * scenario's name and a loading line, and no number is on the page until
 * `fetchCloudPricing` has answered.
 */
import React, { useMemo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchCloudPricing } from '@/lib/publicApi';
import { DEFAULT_PRICING_REGION } from '@/lib/cloudPricing';
import {
  computeScenario,
  decodeScenario,
  effectiveQuantities,
  encodeScenario,
  extraById,
  formatQuantity,
  isRegionId,
  scenarioById,
} from '@/lib/pricingScenarios';
import { ScenarioResults } from '@/pages/tools/scenario/ScenarioResults';

/**
 * The fence body as scenario state and a region. Whatever a hand-typed
 * fence carries, this never throws: an unknown scenario is the default, an
 * unknown extra is dropped, a region that is not shaped like one is the
 * default region. The card never sets `compare`: an embed shows one region.
 */
export function parseEmbedQuery(query) {
  const params = new URLSearchParams(String(query ?? '').trim());
  const { scenarioId, extras, quantities } = decodeScenario(params);
  const region = params.get('region');
  return {
    state: { scenarioId, extras, quantities },
    region: isRegionId(region) ? region : DEFAULT_PRICING_REGION,
  };
}

/** The canonical URL for the same scenario in the tool. */
export function comparisonHref({ state, region }) {
  const params = new URLSearchParams();
  if (region !== DEFAULT_PRICING_REGION) params.set('region', region);
  for (const [key, value] of Object.entries(encodeScenario(state))) params.set(key, value);
  const query = params.toString();
  return `/tools/comparison${query ? `?${query}` : ''}`;
}

function Summary({ state, region, regionLabel }) {
  const parts = [];
  const extras = state.extras.map((id) => extraById(id)?.label ?? id);
  parts.push(extras.length ? `Extras: ${extras.join(', ')}` : 'No extras');
  parts.push(
    `Egress ${formatQuantity(effectiveQuantities(state.scenarioId, state.quantities)['edge-cdn'])} GB / month`
  );
  parts.push(`Region: ${regionLabel ?? region}`);
  return (
    <p
      className="text-xs text-slate-600 dark:text-slate-400"
      data-testid="pricing-scenario-summary"
    >
      {parts.join(' · ')}
    </p>
  );
}

export default function PricingScenarioCard({ query }) {
  const { state, region } = useMemo(() => parseEmbedQuery(query), [query]);
  const { data, loading, error } = usePublicData(
    () => fetchCloudPricing(region),
    `cloud-pricing:${region}`
  );
  const pricing = data && data.region === region ? data : null;
  const result = useMemo(
    () => (pricing ? computeScenario({ pricing, ...state }) : null),
    [pricing, state]
  );
  const scenario = scenarioById(state.scenarioId);
  const regionLabel = pricing?.regions?.find((r) => r.id === region)?.label ?? null;

  return (
    <Card data-testid="pricing-scenario-card" data-region={region}>
      <CardHeader>
        <CardTitle className="text-lg">Price a scenario: {scenario.label}</CardTitle>
        <CardDescription>{scenario.blurb}</CardDescription>
        <Summary state={state} region={region} regionLabel={regionLabel} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ScenarioResults result={result} loading={loading} error={error} />
        <p className="text-sm">
          <a
            href={comparisonHref({ state, region })}
            className="inline-flex items-center gap-1 font-medium underline decoration-dotted underline-offset-2 hover:text-slate-950 dark:hover:text-white"
          >
            Open in the comparison tool
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
