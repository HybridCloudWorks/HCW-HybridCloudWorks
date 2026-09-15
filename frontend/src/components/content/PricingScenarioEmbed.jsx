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
 * At pre-render, `prerenderToNodeStream` resolves the lazy import and the
 * static HTML carries the card at its loading state; in the browser, React
 * leaves that boundary as the server sent it until the chunk arrives, then
 * hydrates it against markup the card's first render reproduces exactly.
 */
import React, { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';

export const PRICING_SCENARIO_LANGUAGE = 'pricing-scenario';

/** Exposed so a test can load the chunk the way the build's pre-render does. */
export const loadPricingScenarioCard = () => import('./PricingScenarioCard');

const PricingScenarioCard = lazy(loadPricingScenarioCard);

function Placeholder() {
  return (
    <p
      className="flex items-center gap-2 rounded-lg border border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400"
      data-testid="pricing-scenario-placeholder"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Loading the scenario…
    </p>
  );
}

/**
 * @param {object} props
 * @param {string} props.query  the fence body: a scenario query string
 */
export default function PricingScenarioEmbed({ query }) {
  return (
    <div className="not-prose my-6" data-testid="pricing-scenario-embed">
      <Suspense fallback={<Placeholder />}>
        <PricingScenarioCard query={query} />
      </Suspense>
    </div>
  );
}
