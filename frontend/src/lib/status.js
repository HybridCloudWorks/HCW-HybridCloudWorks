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
 *
 * Every other status table in the admin (speaking, ambassador, chapter) is
 * built by `statusTable` below, so the record shape — `{ id, label, tone,
 * help }` — is written once and a badge can read any of them.
 */

/**
 * A frozen status table from `{ id: [label, tone, help] }` rows. `fields`
 * names the columns in row order, for a table that carries more than the
 * three every badge needs (CONTENT_STATUS adds `stage`).
 */
export function statusTable(rows, fields = ['label', 'tone', 'help']) {
  const entries = Object.entries(rows).map(([id, values]) => {
    const record = { id };
    fields.forEach((field, index) => {
      record[field] = values[index];
    });
    return [id, Object.freeze(record)];
  });
  return Object.freeze(Object.fromEntries(entries));
}

export const SYSTEM_STATUS = statusTable({
  healthy: ['Healthy', 'ok', 'Working as expected.'],
  degraded: ['Degraded', 'warn', 'Working, but slower, partial or recently failing.'],
  misconfigured: ['Misconfigured', 'bad', 'Reachable, but a setting or key is wrong or missing.'],
  unavailable: ['Unavailable', 'bad', 'Not reachable, or the last attempt failed outright.'],
  unknown: ['Unknown', 'muted', 'Not checked yet, or the check itself could not run.'],
});

/** The words older surfaces still produce, by the shared state each means. */
const SYSTEM_WORDS = Object.freeze({
  healthy: ['healthy', 'ok', 'pass', 'connected', 'working', 'live', 'operational', 'success'],
  degraded: ['degraded', 'regional', 'slow', 'going live', 'pending', 'stale'],
  misconfigured: ['misconfigured', 'not configured', 'never', 'missing', 'unconfigured'],
  unavailable: ['unavailable', 'fail', 'failed', 'error', 'broken', 'failing', 'down', 'offline'],
});

const WORD_TO_SYSTEM = new Map(
  Object.entries(SYSTEM_WORDS).flatMap(([id, words]) => words.map((word) => [word, id]))
);

/**
 * Map the words older surfaces still produce onto the shared vocabulary.
 * Unknown input is `unknown`, never a guess.
 */
export function toSystemStatus(value) {
  const word = String(value ?? '')
    .trim()
    .toLowerCase();
  return SYSTEM_STATUS[WORD_TO_SYSTEM.get(word)] ?? SYSTEM_STATUS.unknown;
}

/**
 * Content pipeline statuses as a reader sees them. Ids are the stored values
 * in functions/src/lib/cms/content-status.js; `stage` is the pipeline stage
 * the dashboard and the stepper place it in.
 */
export const CONTENT_STATUS = statusTable(
  {
    drafting: [
      'Drafting',
      'muted',
      'drafts',
      'Being written on the Drafts page; not in the pipeline yet.',
    ],
    draft: ['Draft', 'muted', 'review', 'Created by a tool and waiting for a first look.'],
    ingested: ['Ingested', 'muted', 'review', 'Arrived from a feed or import; not yet inspected.'],
    inspected: [
      'Inspected',
      'warn',
      'review',
      'The inspector has read it; waiting for your decision.',
    ],
    needs_rework: [
      'Needs rework',
      'warn',
      'editor',
      'The inspector found problems to fix before review.',
    ],
    in_review: ['In review', 'warn', 'review', 'Being reviewed on its board.'],
    approved: ['Approved', 'ok', 'editor', 'Cleared for editing and publishing.'],
    editing: ['Editing', 'ok', 'editor', 'Open in the editor.'],
    forge_ready: [
      'Forge ready',
      'ok',
      'publish',
      'AI-drafted and graded above the threshold; one click from publishing.',
    ],
    published: ['Published', 'ok', 'live', 'Marked published; live when the Live flag is set.'],
    rejected: [
      'Rejected',
      'bad',
      'off',
      'Declined; deleted after the grace period unless restored.',
    ],
    archived: ['Archived', 'off', 'off', 'Kept but no longer live or in the pipeline.'],
  },
  ['label', 'tone', 'stage', 'help']
);

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

const LIVE = Object.freeze({
  id: 'live',
  label: 'Live',
  tone: 'ok',
  stage: 'live',
  help: 'Visitors can open this page now.',
});

/** A status no table knows, shown as words rather than thrown. */
const unlistedContentStatus = (raw) => ({
  label: raw.replace(/_/g, ' '),
  tone: 'muted',
  stage: 'review',
  help: '',
});

export function contentStatusInfo(statusOrItem) {
  const item =
    typeof statusOrItem === 'string' ? { contentStatus: statusOrItem } : statusOrItem || {};
  const raw = String(item.contentStatus || 'ingested').toLowerCase();
  const id = CONTENT_ALIASES[raw] || raw;
  const base = CONTENT_STATUS[id] || unlistedContentStatus(raw);
  const offThePipeline = id === 'rejected' || id === 'archived';
  if (item.Live === true && !offThePipeline) return LIVE;
  return { id, ...base };
}
