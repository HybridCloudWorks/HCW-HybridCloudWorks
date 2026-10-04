/**
 * The Health Hub's probe registry — one entry per hub dependency, so "is
 * every part of the platform working?" is answered by one list rather than by
 * knowing which page happens to carry a test (ADR 0033 §1 Platform, §8).
 *
 * Every entry is `{ id, label, hub, covers, impact, action, href, kind, safe }`
 * plus the function that answers it, and every answer is one shape:
 *
 *   { status, summary, detail?, checkedAt }
 *
 * where `status` is lib/status.js's vocabulary — healthy / degraded /
 * misconfigured / unavailable / unknown — so a probe here reads like a card
 * on the Integrations page and a row on the Overview tab.
 *
 * Three kinds, by where the answer comes from:
 *
 *   live      `run(ctx)` makes a request and returns a result. These are the
 *             tests the Integrations page already had (SERVICES[].test, run
 *             by the same function so the two pages cannot disagree), plus
 *             reads of routes other hubs expose: the AI providers list and
 *             testAiProvider, the labs snapshot, the newsletter issues, the
 *             public content list for cover images, /api/health.
 *   snapshot  `evaluate(ctx)` reads the ops-health snapshot the page already
 *             holds. Its "Test" is a re-read of the snapshot, so Test all
 *             refreshes it once and evaluates every snapshot probe from it.
 *   session   `evaluate(ctx)` reads a check the page runs with the session's
 *             own token (identity, the Labs no-op probe, the smoke tests);
 *             its "Test" is that check's own action.
 *
 * `safe` says whether Test all may press it. A probe that writes real data
 * (the smoke tests enqueue jobs and build digests; the Labs probe creates a
 * job) or spends quota (YouTube) is run from its own card only, and its
 * `costNote` says why.
 *
 * The table is written one hub per module under probeGroups/ and joined here;
 * the builders and links are probeKit.js, the pure evaluators
 * probeEvaluators.js and the live runners probeRunners.js. Everything a page
 * or a test needs is re-exported from this module, so the registry still has
 * one address.
 */

import { SYSTEM_STATUS } from '@/lib/status';
import { SERVICES } from '@/components/admin/integrations/serviceRegistry';
import { HUBS, result } from './probeKit';
import { PIPELINE_PROBES } from './probeGroups/pipeline';
import { CREATIVE_PROBES } from './probeGroups/creative';
import { AMPLIFY_PROBES } from './probeGroups/amplify';
import { ENHANCED_PROBES } from './probeGroups/enhanced';
import { SPOTLIGHT_PROBES } from './probeGroups/spotlight';
import { PLATFORM_PROBES } from './probeGroups/platform';

export { HUBS, classifyFailure, result } from './probeKit';
export * from './probeEvaluators';
export * from './probeRunners';

// ── The registry ─────────────────────────────────────────────────────────────

export const PROBES = Object.freeze([
  ...PIPELINE_PROBES,
  ...CREATIVE_PROBES,
  ...AMPLIFY_PROBES,
  ...ENHANCED_PROBES,
  ...SPOTLIGHT_PROBES,
  ...PLATFORM_PROBES,
]);

export const PROBE_IDS = Object.freeze(PROBES.map((probe) => probe.id));

/** Probes grouped by hub, in HUBS order. */
export function probesByHub(probes = PROBES) {
  return Object.entries(HUBS)
    .map(([id, label]) => ({ id, label, probes: probes.filter((probe) => probe.hub === id) }))
    .filter((group) => group.probes.length > 0);
}

/**
 * The result to show for one probe: a stored live result, or the evaluation
 * of the page's state for snapshot and session kinds. Never null — a probe
 * with nothing to say says unknown.
 */
export function resolveProbe(probe, ctx, liveResults = {}) {
  const notYet = (summary) => result('unknown', summary, { checkedAt: null });
  if (probe.kind === 'live') return liveResults[probe.id] ?? notYet('Not tested yet.');
  return probe.evaluate(ctx) ?? notYet('Not evaluated.');
}

/** The Markdown lines the Report tab adds for the registry. */
export function probeReportLines(probes, resolve) {
  const lines = ['### Probe registry', ''];
  for (const group of probesByHub(probes)) {
    lines.push(`#### ${group.label}`);
    for (const probe of group.probes) {
      const r = resolve(probe);
      const label = SYSTEM_STATUS[r.status]?.label ?? 'Unknown';
      lines.push(
        `- ${probe.label}: ${label}${r.checkedAt ? ` (${r.checkedAt})` : ''} — ${r.summary}`
      );
    }
    lines.push('');
  }
  return lines;
}

/** Every testable, safe probe: what Test all runs. */
export const safeProbes = (probes = PROBES) => probes.filter((probe) => probe.safe);

/** The service ids the registry covers, for the registry test. */
export const SERVICE_PROBE_IDS = Object.freeze(
  PROBES.filter((probe) => SERVICES.some((service) => service.id === probe.id)).map(
    (probe) => probe.id
  )
);
