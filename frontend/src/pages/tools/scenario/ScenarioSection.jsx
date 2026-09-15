/**
 * The scenario card on /tools/comparison (#613, Phase 2): pick a shape, add
 * extras, see how each cloud's monthly bill rises — priced from the same
 * region and the same cached prices as the Phase 1 table beneath it.
 *
 * PRE-RENDER. With no data the card still renders every control at its
 * default (the URL has no query string at build time) and a "Loading prices
 * for this scenario…" line where the bars go; the first client render, before
 * its fetch resolves, produces exactly that markup, which is what lets React
 * adopt the server HTML. `computeScenario` is only called once `pricing`
 * exists, so no number is on the page until data is.
 */
import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { computeScenario, effectiveQuantities } from '@/lib/pricingScenarios';
import {
  CopyLinkButton,
  EgressSelect,
  ExtrasMenu,
  QuantityEditor,
  ScenarioSelect,
} from './ScenarioControls';
import { ScenarioResults } from './ScenarioResults';
import { ScenarioAssumptions } from './ScenarioAssumptions';
import { useScenarioState } from './useScenarioState';

export function ScenarioSection({ pricing, loading, error }) {
  const [state, update] = useScenarioState();
  const { scenarioId, extras, quantities } = state;

  const result = useMemo(
    () => (pricing ? computeScenario({ pricing, scenarioId, quantities, extras }) : null),
    [pricing, scenarioId, quantities, extras]
  );
  const egressGb = effectiveQuantities(scenarioId, quantities)['edge-cdn'];

  return (
    <Card data-testid="scenario-card">
      <CardHeader>
        <CardTitle className="text-xl">Price a scenario</CardTitle>
        <CardDescription>
          A monthly bill for one shape on each cloud, from the list prices below. Add backup,
          disaster recovery, zone redundancy or a commitment and each becomes its own segment of the
          bar, so the increase is itemised rather than hidden in a total.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <ScenarioSelect
            scenarioId={scenarioId}
            // A new shape drops the overrides: they were relative to the old one.
            onChange={(id) => update({ scenarioId: id, quantities: {} })}
          />
          <ExtrasMenu extras={extras} onChange={(next) => update({ extras: next })} />
          <EgressSelect
            egressGb={egressGb}
            onChange={(gb) => update({ quantities: { ...quantities, 'edge-cdn': gb } })}
          />
          <CopyLinkButton />
        </div>
        <QuantityEditor
          scenarioId={scenarioId}
          overrides={quantities}
          onChange={(next) => update({ quantities: next }, { replace: true })}
        />
        <ScenarioResults result={result} loading={loading} error={error} />
        <ScenarioAssumptions extras={extras} />
      </CardContent>
    </Card>
  );
}
