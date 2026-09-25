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
 * is the chunk. The frame, the Suspense boundary and the placeholder are
 * EmbedShell.jsx, shared with the other embeds. The card is a pure function
 * of the fence body, so the pre-rendered HTML carries the whole card.
 */
import React, { lazy } from 'react';
import { EmbedShell } from './EmbedShell';

export const LANDING_ZONE_LANGUAGE = 'landing-zone';

/** Exposed so a test can load the chunk the way the build's pre-render does. */
export const loadLandingZoneCard = () => import('./LandingZoneCard');

const LandingZoneCard = lazy(loadLandingZoneCard);

/**
 * @param {object} props
 * @param {string} props.query  the fence body: the build's share query string
 */
export default function LandingZoneEmbed({ query }) {
  return (
    <EmbedShell
      testId="landing-zone-embed"
      placeholderTestId="landing-zone-placeholder"
      loadingText="Loading the landing zone…"
    >
      <LandingZoneCard query={query} />
    </EmbedShell>
  );
}
