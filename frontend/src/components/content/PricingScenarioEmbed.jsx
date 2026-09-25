/**
 * A pricing scenario inside an article (#613, Phase 3). A fenced block whose
 * language is `pricing-scenario` and whose body is a scenario query string —
 *
 *     ```pricing-scenario
 *     scenario=three-tier-web&extras=backup,dr-warm-standby&egress=1000&region=us-east-1
 *     ```
 *
 * — renders as the scenario card from /tools/comparison, read-only: the bars,
 * the totals and the breakdown, no controls, and a link that opens the same
 * scenario in the tool. The markdown renderer's `code` override
 * (components/shared/CodeBlock.jsx) routes that one language here and every
 * other fence to the highlighter as before.
 *
 * LAZY. The scenario arithmetic, its catalogue and the results component are
 * a chunk most articles never need, so this file — the one CodeBlock imports
 * — is a shell around `React.lazy`, and PricingScenarioCard.jsx is the chunk.
 * The frame, the Suspense boundary and the placeholder are EmbedShell.jsx,
 * shared with the other embeds; that file says how the pre-render and the
 * hydration meet.
 */
import React, { lazy } from 'react';
import { EmbedShell } from './EmbedShell';

export const PRICING_SCENARIO_LANGUAGE = 'pricing-scenario';

/** Exposed so a test can load the chunk the way the build's pre-render does. */
export const loadPricingScenarioCard = () => import('./PricingScenarioCard');

const PricingScenarioCard = lazy(loadPricingScenarioCard);

/**
 * @param {object} props
 * @param {string} props.query  the fence body: a scenario query string
 */
export default function PricingScenarioEmbed({ query }) {
  return (
    <EmbedShell
      testId="pricing-scenario-embed"
      placeholderTestId="pricing-scenario-placeholder"
      loadingText="Loading the scenario…"
    >
      <PricingScenarioCard query={query} />
    </EmbedShell>
  );
}
