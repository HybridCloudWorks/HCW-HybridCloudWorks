/**
 * One status vocabulary for the whole admin (ADR 0033 §2).
 *
 * Until 2026-10-03 five surfaces used five vocabularies — PASS/FAIL/UNKNOWN,
 * connected/error/untested, Broken/Not configured/Working, failed/degraded,
 * OPERATIONAL/REGIONAL — for the same five situations. A reader learning one
 * page learned nothing about the next. This module names the situations once:
 *
 *   SYSTEM_STATUS   how a dependency, probe or integration is doing
 *   CONTENT_STATUS  where a piece of content is in the pipeline, as a person
 *                   reads it (the stored ids are content-status.js's)
 *
 * Both carry a tone (ok / warn / bad / off / muted) the StatusBadge turns into
 * colour AND an icon, so colour is never the only signal.
 */

export const SYSTEM_STATUS = Object.freeze({
  healthy: { id: 'healthy', label: 'Healthy', tone: 'ok', help: 'Working as expected.' },
  degraded: {
    id: 'degraded',
    label: 'Degraded',
    tone: 'warn',
    help: 'Working, but slower, partial or recently failing.',
  },
  misconfigured: {
    id: 'misconfigured',
    label: 'Misconfigured',
    tone: 'bad',
    help: 'Reachable, but a setting or key is wrong or missing.',
  },
  unavailable: {
    id: 'unavailable',
    label: 'Unavailable',
    tone: 'bad',
    help: 'Not reachable, or the last attempt failed outright.',
  },
  unknown: {
    id: 'unknown',
    label: 'Unknown',
    tone: 'muted',
    help: 'Not checked yet, or the check itself could not run.',
  },
});

/**
 * Map the words older surfaces still produce onto the shared vocabulary.
 * Unknown input is `unknown`, never a guess.
 */
export function toSystemStatus(value) {
  const v = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!v) return SYSTEM_STATUS.unknown;
  if (
    ['healthy', 'ok', 'pass', 'connected', 'working', 'live', 'operational', 'success'].includes(v)
  )
    return SYSTEM_STATUS.healthy;
  if (['degraded', 'regional', 'slow', 'going live', 'pending', 'stale'].includes(v))
    return SYSTEM_STATUS.degraded;
  if (['misconfigured', 'not configured', 'never', 'missing', 'unconfigured'].includes(v))
    return SYSTEM_STATUS.misconfigured;
  if (
    ['unavailable', 'fail', 'failed', 'error', 'broken', 'failing', 'down', 'offline'].includes(v)
  )
    return SYSTEM_STATUS.unavailable;
  return SYSTEM_STATUS.unknown;
}

/**
 * Content pipeline statuses as a reader sees them. Ids are the stored values
 * in functions/src/lib/cms/content-status.js; `stage` is the pipeline stage
 * the dashboard and the stepper place it in.
 */
export const CONTENT_STATUS = Object.freeze({
  drafting: {
    label: 'Drafting',
    tone: 'muted',
    stage: 'drafts',
    help: 'Being written on the Drafts page; not in the pipeline yet.',
  },
  draft: {
    label: 'Draft',
    tone: 'muted',
    stage: 'review',
    help: 'Created by a tool and waiting for a first look.',
  },
  ingested: {
    label: 'Ingested',
    tone: 'muted',
    stage: 'review',
    help: 'Arrived from a feed or import; not yet inspected.',
  },
  inspected: {
    label: 'Inspected',
    tone: 'warn',
    stage: 'review',
    help: 'The inspector has read it; waiting for your decision.',
  },
  needs_rework: {
    label: 'Needs rework',
    tone: 'warn',
    stage: 'editor',
    help: 'The inspector found problems to fix before review.',
  },
  in_review: {
    label: 'In review',
    tone: 'warn',
    stage: 'review',
    help: 'Being reviewed on its board.',
  },
  approved: {
    label: 'Approved',
    tone: 'ok',
    stage: 'editor',
    help: 'Cleared for editing and publishing.',
  },
  editing: { label: 'Editing', tone: 'ok', stage: 'editor', help: 'Open in the editor.' },
  forge_ready: {
    label: 'Forge ready',
    tone: 'ok',
    stage: 'publish',
    help: 'AI-drafted and graded above the threshold; one click from publishing.',
  },
  published: {
    label: 'Published',
    tone: 'ok',
    stage: 'live',
    help: 'Marked published; live when the Live flag is set.',
  },
  rejected: {
    label: 'Rejected',
    tone: 'bad',
    stage: 'off',
    help: 'Declined; deleted after the grace period unless restored.',
  },
  archived: {
    label: 'Archived',
    tone: 'off',
    stage: 'off',
    help: 'Kept but no longer live or in the pipeline.',
  },
});

/** Legacy spellings still found on old documents and in old links. */
const CONTENT_ALIASES = Object.freeze({
  approved_blog: 'approved',
  approved_news: 'approved',
  published_blog: 'published',
  published_news: 'published',
  published_both: 'published',
  published_live: 'published',
  ready_to_publish: 'approved',
});

export function contentStatusInfo(statusOrItem) {
  const item =
    typeof statusOrItem === 'string' ? { contentStatus: statusOrItem } : statusOrItem || {};
  const raw = String(item.contentStatus || 'ingested').toLowerCase();
  const id = CONTENT_ALIASES[raw] || raw;
  const base = CONTENT_STATUS[id] || {
    label: raw.replace(/_/g, ' '),
    tone: 'muted',
    stage: 'review',
    help: '',
  };
  if (item.Live === true && id !== 'rejected' && id !== 'archived') {
    return {
      id: 'live',
      label: 'Live',
      tone: 'ok',
      stage: 'live',
      help: 'Visitors can open this page now.',
    };
  }
  return { id, ...base };
}
