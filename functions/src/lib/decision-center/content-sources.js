/**
 * The Decision Center's content sources (#1013, #1014): the `content`
 * documents that wait on a person, one bounded and ordered read each.
 *
 *   review-queue    queues      draft, ingested, inspected, in_review
 *   frameworks      frameworks  the same statuses, framework items
 *   coder-corner    other       the same statuses, Coder Corner items
 *   editor          queues      needs_rework, approved, editing (not live)
 *   forge-ready     pipelines   forge_ready, staged for one-click publish
 *   publish-ready   pipelines   published but not live: staged, not out
 *
 * Every read is `TOP n ... ORDER BY c._ts DESC`: the most recently written
 * first, where an unordered TOP would be an arbitrary n. `_ts` is on every
 * document; a sort field is not, and Cosmos drops a document missing its
 * ORDER BY property (admin-snapshots.js NEWEST_WRITTEN_FIRST).
 *
 * Each status is in exactly one source, so an item is counted once. A type
 * is matched in the query on the canonical type (CANONICAL_TYPE_SQL), the
 * same rule the queue leaves those types out by, so a row is in exactly one
 * of the review sources whatever its casing; and checked again on the
 * resolved value after the read.
 */
import { REVIEW_DECISION_STATUSES } from '../cms/content-status.js';
import {
  NEWEST_WRITTEN_FIRST,
  getCanonicalContentTypeForAdmin,
  isBlockedContentSource,
  reviewWaitingSince,
} from '../admin-snapshots.js';
import { decisionItem, fromTs, waitedLongerThan } from './items.js';
import { contentHref, contentStage } from './links.js';

/** What a row needs: its title, type, status, waiting time, and the fields the blocked-host check reads. */
const FIELDS = [
  'id',
  'Title',
  'title',
  'type',
  'contentType',
  'publishTarget',
  'contentStatus',
  'Live',
  'fetchedAt',
  'createdAt',
  'Created At',
  'updatedAt',
  'reviewedAt',
  'sentToReviewAt',
  'sourceUrl',
  'sourceUrls',
  'sourceFeed',
  'CD Url',
  'url',
  'link',
  'Cloud Provider',
  'cloudProvider',
  '_ts',
];
const PROJECTION = FIELDS.map((field) => `c["${field}"]`).join(', ');

// Not live exactly as the code reads it (`Live === true`): anything that is
// not the boolean true. `c.Live != true` alone would drop a null Live, since
// Cosmos compares values of different types as undefined.
const NOT_LIVE_CLAUSE = ' AND (NOT IS_BOOL(c.Live) OR c.Live = false)';

/**
 * The canonical type in Cosmos SQL, as getCanonicalContentTypeForAdmin
 * resolves it: the first non-empty of `type`, `contentType` and
 * `publishTarget`, trimmed and lower-cased, `blog` when none. Only its
 * membership in a set of named types is used, and for that the two agree.
 */
export const CANONICAL_TYPE_SQL =
  "LOWER(TRIM((IS_STRING(c.type) AND c.type != '') ? c.type : " +
  "((IS_STRING(c.contentType) AND c.contentType != '') ? c.contentType : " +
  "((IS_STRING(c.publishTarget) AND c.publishTarget != '') ? c.publishTarget : 'blog'))))";

/** A type source's rows: those whose canonical type is `@type`. */
const TYPE_CLAUSE = ` AND ${CANONICAL_TYPE_SQL} = @type`;

/**
 * Leaves out, in the query, the types another source lists (review of
 * #1021): filtered after the read, rows of those types filled the window
 * first, and a run of new frameworks could push every other review item out
 * of it.
 */
const EXCLUDE_TYPES_CLAUSE = ` AND NOT ARRAY_CONTAINS(@excludeTypes, ${CANONICAL_TYPE_SQL})`;

/** One bounded, ordered window over `content`. */
function readWindow(store, { statuses, type = null, excludeTypes = null, notLive = false, limit }) {
  const params = [{ name: '@statuses', value: [...statuses] }];
  if (type) params.push({ name: '@type', value: type });
  if (excludeTypes) params.push({ name: '@excludeTypes', value: [...excludeTypes] });
  const where = [
    'ARRAY_CONTAINS(@statuses, c.contentStatus)',
    type ? TYPE_CLAUSE : '',
    excludeTypes ? EXCLUDE_TYPES_CLAUSE : '',
    notLive ? NOT_LIVE_CLAUSE : '',
  ].join('');
  return store.queryDocs(
    'content',
    `SELECT TOP ${limit} ${PROJECTION} FROM c WHERE ${where}${NEWEST_WRITTEN_FIRST}`,
    params
  );
}

/** When this item started waiting: review items by reviewWaitingSince, the rest by their last write. */
function waitingSinceOf(row) {
  const stored =
    contentStage(row) === 'review'
      ? reviewWaitingSince(row)
      : row.updatedAt || row.reviewedAt || row.fetchedAt;
  return stored || fromTs(row._ts);
}

/** Editing is someone's work in progress; needs_rework and a long wait want attention first. */
function contentPriority(status, waitingSince, nowMs) {
  if (status === 'editing') return 'low';
  if (status === 'needs_rework' || waitedLongerThan(waitingSince, nowMs)) return 'high';
  return 'normal';
}

function contentDecision(row, category, nowMs) {
  const status = String(row.contentStatus || 'ingested');
  const waitingSince = waitingSinceOf(row);
  return decisionItem({
    id: `content:${row.id}`,
    category,
    kind: getCanonicalContentTypeForAdmin(row),
    title: row.Title || row.title || row.sourceUrl,
    stage: contentStage(row),
    status,
    waitingSince,
    priority: contentPriority(status, waitingSince, nowMs),
    href: contentHref(row),
    source: { collection: 'content', id: row.id, Live: row.Live === true },
    detail: row['Cloud Provider'] || row.cloudProvider || '',
  });
}

/** A content source: one window, the rows it keeps, and the category its items land in. */
function contentSource({ id, label, category, statuses, type, excludeTypes, notLive, limit, keep = () => true }) {
  return Object.freeze({
    id,
    label,
    category,
    role: 'viewer',
    async collect({ store, now }) {
      const rows = (await readWindow(store, { statuses, type, excludeTypes, notLive, limit })) || [];
      const nowMs = now().getTime();
      const items = rows
        .filter((row) => !isBlockedContentSource(row) && keep(row))
        .map((row) => contentDecision(row, category, nowMs));
      return { items, truncated: rows.length >= limit };
    },
  });
}

/** Types with a tab of their own, so the queue leaves them to it. */
const TYPES_WITH_THEIR_OWN_TAB = new Set(['framework', 'coder_corner']);
const isType = (type) => (row) => getCanonicalContentTypeForAdmin(row) === type;

export const CONTENT_SOURCES = Object.freeze([
  contentSource({
    id: 'review-queue',
    label: 'Review Queue',
    category: 'queues',
    statuses: REVIEW_DECISION_STATUSES,
    excludeTypes: TYPES_WITH_THEIR_OWN_TAB,
    limit: 100,
    // Checked again on the resolved value, as the type sources check theirs.
    keep: (row) => !TYPES_WITH_THEIR_OWN_TAB.has(getCanonicalContentTypeForAdmin(row)),
  }),
  contentSource({
    id: 'frameworks',
    label: 'Frameworks awaiting review',
    category: 'frameworks',
    statuses: REVIEW_DECISION_STATUSES,
    type: 'framework',
    limit: 50,
    keep: isType('framework'),
  }),
  contentSource({
    id: 'coder-corner',
    label: 'Coder Corner awaiting review',
    category: 'other',
    statuses: REVIEW_DECISION_STATUSES,
    type: 'coder_corner',
    limit: 50,
    keep: isType('coder_corner'),
  }),
  contentSource({
    id: 'editor',
    label: 'Editor stage',
    category: 'queues',
    statuses: ['needs_rework', 'approved', 'editing'],
    notLive: true,
    limit: 50,
  }),
  contentSource({
    id: 'forge-ready',
    label: 'Forge ready, staged for approval',
    category: 'pipelines',
    statuses: ['forge_ready'],
    notLive: true,
    limit: 50,
  }),
  contentSource({
    id: 'publish-ready',
    label: 'Marked published, not live yet',
    category: 'pipelines',
    statuses: ['published'],
    notLive: true,
    limit: 50,
  }),
]);
