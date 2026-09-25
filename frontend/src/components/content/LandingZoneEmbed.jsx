/**
 * A landing zone build inside an article (#670, Phase 4 of #657). A fenced
 * block whose language is `landing-zone` and whose body is the build's share
 * query string —
 *
 *     ```landing-zone
 *     lz=mg,policy,mgmt,hub,fw&corp=2
 *     ```
 *
 * — renders as a read-only card: the diagram, the selected components with a
 * line each, and a link that opens the same build in /tools/landing-zone.
 * The markdown renderer's `code` override (components/shared/CodeBlock.jsx)
 * routes that one language here and every other fence to the highlighter as
 * before, through the same map the `pricing-scenario` fence uses.
 *
 * LAZY, the way PricingScenarioEmbed.jsx is. The catalogue, the layout and
 * the SVG are a chunk most articles never need, so this file — the one
 * CodeBlock imports — is a shell around `React.lazy`, and LandingZoneCard.jsx
 * is the chunk. At pre-render, `prerenderToNodeStream` resolves the lazy
 * import and the static HTML carries the whole card, because the card is a
 * pure function of the fence body; in the browser, React leaves that
 * boundary as the server sent it until the chunk arrives, then hydrates it
 * against markup the card's first render reproduces exactly.
 */
import React, { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';

export const LANDING_ZONE_LANGUAGE = 'landing-zone';

/** Exposed so a test can load the chunk the way the build's pre-render does. */
export const loadLandingZoneCard = () => import('./LandingZoneCard');

const LandingZoneCard = lazy(loadLandingZoneCard);

function Placeholder() {
  return (
    <p
      className="flex items-center gap-2 rounded-lg border border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400"
      data-testid="landing-zone-placeholder"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Loading the landing zone…
    </p>
  );
}

/**
 * @param {object} props
 * @param {string} props.query  the fence body: the build's share query string
 */
export default function LandingZoneEmbed({ query }) {
  return (
    <div className="not-prose my-6" data-testid="landing-zone-embed">
      <Suspense fallback={<Placeholder />}>
        <LandingZoneCard query={query} />
      </Suspense>
    </div>
  );
}
