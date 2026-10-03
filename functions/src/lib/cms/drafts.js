/**
 * drafts.js — the pure half of the Drafts stage (owner request 2026-10-03):
 * articles the owner writes on /admin/drafts, saved in the site, and sent on
 * to In Review when they are ready.
 *
 * Nothing here does I/O. The routes, the store and the GitHub import are in
 * ./drafts-handlers.js; this module decides what a draft may contain, what
 * the document looks like at each step, and which moves are allowed from
 * where.
 *
 * ONE DOCUMENT, NOT TWO. A draft is an ordinary `content` document — the same
 * container, the same shape the repository import has written since
 * 2026-09-28 — at contentStatus `drafting` (content-status.js
 * DRAFTS_STAGE_STATUS). Send to In Review moves that same document to
 * `in_review`; Back to Drafts moves it back. So there is never a second copy
 * to drift from the first, and "deleting a draft that is In Review also
 * removes the In Review item" holds by construction: they are one document.
 * No new container, no new index, no Terraform.
 *
 * WHAT A DRAFT CAN NEVER BE. Every draft is written `Live: false`,
 * `Status: 'Draft'` and `contentStatus: 'drafting'`, and the edit payload is
 * an allow-list of the eight editor fields — so no Drafts route can set a
 * workflow field, a slug, or anything a public read keys on
 * (public-reads.js isPublicDocument, the manifest's PUBLISHED_PREDICATE).
 * isPublicDocument also refuses `drafting` outright (NEVER_PUBLIC_STATUSES).
 *
 * THE BODY IS STORED AS WRITTEN while it is a draft. normalizeContentBodyFields
 * (trim, TL;DR to the end) runs once, at Send to In Review — the point where
 * the article enters the pipeline, which is where createContentDocument runs
 * it for every other writer. Running it on every save would move the owner's
 * text around under the cursor.
 */
import {
  MAX_SUBTITLE_CHARS,
  MAX_TAG_CHARS,
  MAX_TAGS,
  MAX_TITLE_CHARS,
  inferProviderFromTags,
  isCalendarDate,
} from './repo-draft.js';
import { MAX_DRAFT_BYTES } from './repo-draft-source.js';
import {
  assertStringArray,
  assertStringLength,
  isPlainObject,
} from './content-update-validation.js';
import {
  buildContentQualityReport,
  buildImageLineage,
  buildImageReadinessReport,
  getPrimaryContentBody,
  normalizeContentBodyFields,
} from './content-quality.js';
import { buildDedupFields } from './content-dedup.js';
import { DRAFTS_STAGE_STATUS, VALID_TRANSITIONS } from './content-status.js';

export { DRAFTS_STAGE_STATUS };

/** The status a draft is sent to, and the only one Back to Drafts leaves. */
export const REVIEW_STATUS = 'in_review';

/**
 * The body cap. The same number the repository import caps a fetched file at
 * (repo-draft-source.js), so an article imported from docs/content is never
 * too large to save again. Measured in UTF-8 bytes, as that cap is.
 */
export const MAX_DRAFT_BODY_BYTES = MAX_DRAFT_BYTES;
export const MAX_TRACK_CHARS = 40;
export const MAX_PART_CHARS = 20;
export const MAX_READING_MINUTES = 999;

/**
 * The editor's fields — the seven front-matter keys docs/content/blog-template.md
 * names, plus the body. A save carries these and nothing else.
 */
export const DRAFT_FIELDS = Object.freeze([
  'title',
  'subtitle',
  'date',
  'track',
  'part',
  'tags',
  'reading',
  'body',
]);

/** `draftOrigin` values: written on this page, or imported from docs/content. */
export const DRAFT_ORIGINS = Object.freeze({ site: 'drafts', repo: 'repo-import' });

/** Thrown for input the owner can correct; the handler answers 400 with the message. */
export class DraftInputError extends Error {}

const fail = (message) => {
  throw new DraftInputError(message);
};

function readTags(value) {
  if (value === undefined || value === null || value === '') return [];
  const list = typeof value === 'string' ? value.split(',') : value;
  let tags;
  try {
    tags = assertStringArray(list, 'tags', { maxItems: MAX_TAGS, maxItemLength: MAX_TAG_CHARS });
  } catch (error) {
    fail(error.message);
  }
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function readReading(value) {
  if (value === undefined || value === null || value === '') return null;
  const minutes = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_READING_MINUTES) {
    fail(`reading must be a whole number of minutes, 1-${MAX_READING_MINUTES}`);
  }
  return minutes;
}

function readDate(value) {
  const date = String(value ?? '').trim();
  if (!date) return null;
  if (!isCalendarDate(date)) fail('date must be a calendar date, YYYY-MM-DD');
  return date;
}

function readText(value, name, max, { required = false } = {}) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    fail(`${name} must be a string`);
  }
  try {
    return assertStringLength(value, name, max, { allowEmpty: !required }).trim();
  } catch (error) {
    return fail(error.message);
  }
}

/**
 * A save's payload → the eight fields, normalised. Throws DraftInputError.
 *
 * An allow-list, so `contentStatus`, `Live`, `Status`, `slug` and every other
 * field FORBIDDEN_CONTENT_UPDATE_KEYS protects are refused by not being one
 * of the eight — named in the error, so a client bug is visible.
 *
 * @param {unknown} input
 * @returns {{ title: string, subtitle: string, date: string|null, track: string|null,
 *   part: string|null, tags: string[], reading: number|null, body: string }}
 */
export function validateDraftFields(input) {
  if (!isPlainObject(input)) fail('A JSON object of draft fields is required.');
  const unknown = Object.keys(input).filter((key) => !DRAFT_FIELDS.includes(key));
  if (unknown.length) fail(`Not a draft field: ${unknown.join(', ')}`);

  const body = input.body ?? '';
  if (typeof body !== 'string') fail('body must be a string');
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_DRAFT_BODY_BYTES) {
    fail(`The body is ${bytes} bytes; at most ${MAX_DRAFT_BODY_BYTES}.`);
  }
  return {
    title: readText(input.title, 'title', MAX_TITLE_CHARS, { required: true }),
    subtitle: readText(input.subtitle, 'subtitle', MAX_SUBTITLE_CHARS),
    date: readDate(input.date),
    track: readText(input.track, 'track', MAX_TRACK_CHARS) || null,
    part: readText(input.part, 'part', MAX_PART_CHARS) || null,
    tags: readTags(input.tags),
    reading: readReading(input.reading),
    body,
  };
}

/** The document fields the eight editor fields map to — the repository import's names. */
function documentFields(fields) {
  return {
    Title: fields.title,
    title: fields.title,
    Summary: fields.subtitle,
    summary: fields.subtitle,
    Content: fields.body,
    content: fields.body,
    postContent: fields.body,
    Tags: fields.tags,
    // `undefined` deletes on a patch (patchDoc's convention) and is dropped
    // from a create: no reading time stated, none stored.
    readTime: fields.reading ? `${fields.reading} min` : undefined,
    frontMatter: {
      title: fields.title,
      subtitle: fields.subtitle,
      date: fields.date,
      track: fields.track,
      part: fields.part,
      tags: fields.tags,
      reading: fields.reading,
    },
  };
}

/**
 * The fields that make a document a draft and keep it off every public read.
 * Applied last on every create, so nothing spread before them can win.
 */
export const DRAFT_INVARIANTS = Object.freeze({
  contentStatus: DRAFTS_STAGE_STATUS,
  Live: false,
  Status: 'Draft',
  approvedForBlog: false,
  approvedForNews: false,
  // The change-feed inspector would rewrite a hand-written article with a
  // model's summary of it (repo-draft.js buildRepoDraftData, same reason).
  inspectTrigger: false,
});

/**
 * A new draft written on the page. No slug (the slug-holders probe is not
 * status-filtered, so a draft holding one would push a published article onto
 * a suffix — repo-draft.js), no dedup fields (a half-written draft must not
 * make the dedup gate refuse other content by title; they are stamped at Send
 * to In Review), no provider (inferred from the tags at Send to In Review, set
 * on the review board otherwise).
 */
export function buildNewDraftDocument({ id, fields, editor, now = () => new Date() }) {
  const stamp = now().toISOString();
  const { readTime, ...rest } = documentFields(fields);
  return {
    id,
    type: 'blog',
    publishTarget: 'blog',
    ...rest,
    ...(readTime && { readTime }),
    keyTopics: fields.tags,
    Author: 'Hybrid Cloud Works',
    source: 'drafts',
    sourceTrustLevel: 'manual',
    trustedSource: true,
    draftOrigin: DRAFT_ORIGINS.site,
    storageCollection: 'content',
    createdBy: editor,
    'Created At': stamp,
    updatedAt: stamp,
    updatedBy: editor,
    ...DRAFT_INVARIANTS,
  };
}

/**
 * A docs/content file, as a draft: repo-draft.js buildRepoDraftData's document
 * (the existing import's shape, provenance and all) with the Drafts stage's
 * status and stamping in place of in_review's.
 */
export function asImportedDraft(repoData, { id, editor, now = () => new Date() }) {
  const stamp = now().toISOString();
  return {
    ...repoData,
    id,
    draftOrigin: DRAFT_ORIGINS.repo,
    storageCollection: 'content',
    createdBy: editor,
    'Created At': stamp,
    updatedAt: stamp,
    updatedBy: editor,
    ...DRAFT_INVARIANTS,
  };
}

/**
 * The patch a Save applies. `blogDraft` only when the document already has one
 * — approval copies the body into an absent blogDraft and keeps a present one
 * (content-status.js), so a stale one left here would be the text the editor
 * opens after approval (repo-draft.js made the same choice for re-imports).
 */
export function buildDraftUpdate(fields, { current = {}, editor, now = () => new Date() }) {
  const stamp = now().toISOString();
  return {
    ...documentFields(fields),
    ...(typeof current.blogDraft === 'string' && { blogDraft: fields.body }),
    updatedAt: stamp,
    updatedBy: editor,
  };
}

// ── where a document is, and what may be done to it ────────────────────────

const statusOf = (doc = {}) => String(doc.contentStatus || 'ingested');

/**
 * Did this article come through the Drafts stage? A draft now, one written or
 * imported here (`draftOrigin`), or one the original repository import put In
 * Review (`repoPath` — the two Docker drafts imported before this page
 * existed).
 */
export function comesFromDrafts(doc = {}) {
  return statusOf(doc) === DRAFTS_STAGE_STATUS || Boolean(doc.draftOrigin) || Boolean(doc.repoPath);
}

/** 'draft' | 'in_review' | 'live' | 'past_review' — what the list shows. */
export function stageOf(doc = {}) {
  if (doc.Live === true) return 'live';
  const status = statusOf(doc);
  if (status === DRAFTS_STAGE_STATUS) return 'draft';
  if (status === REVIEW_STATUS) return 'in_review';
  return 'past_review';
}

/** May the state machine walk this edge? The one table, content-status.js. */
export const isAllowedEdge = (from, to) => Boolean(VALID_TRANSITIONS[from]?.includes(to));

/** Which buttons the page offers for a document. The handlers enforce the same rules. */
export function allowedActions(doc = {}) {
  const stage = stageOf(doc);
  const fromDrafts = comesFromDrafts(doc);
  return {
    edit: stage === 'draft',
    save: stage === 'draft',
    sendToReview: stage === 'draft' && isAllowedEdge(DRAFTS_STAGE_STATUS, REVIEW_STATUS),
    backToDrafts:
      stage === 'in_review' && fromDrafts && isAllowedEdge(REVIEW_STATUS, DRAFTS_STAGE_STATUS),
    delete: stage === 'draft' || (stage === 'in_review' && fromDrafts),
  };
}

const refusal = (status, code, error) => ({ status, code, error });

const LIVE_REFUSAL = (verb) =>
  refusal(
    409,
    'LIVE',
    `This article is live on the site, so ${verb} is refused and nothing was changed. A published article is never touched from Drafts.`
  );

const pastReview = (doc, verb) =>
  refusal(
    409,
    'PAST_REVIEW',
    `This article is "${statusOf(doc)}", past review, so ${verb} is refused and nothing was changed.`
  );

/** Null when a delete may go ahead, else why not. */
export function deleteRefusal(doc) {
  if (doc.Live === true) return LIVE_REFUSAL('deleting it');
  if (!comesFromDrafts(doc)) {
    return refusal(
      409,
      'NOT_A_DRAFT',
      'This article did not come from Drafts; nothing was changed.'
    );
  }
  if (!allowedActions(doc).delete) return pastReview(doc, 'deleting it here');
  return null;
}

/** Null when a save may go ahead, else why not. */
export function saveRefusal(doc) {
  if (doc.Live === true) return LIVE_REFUSAL('saving over it');
  if (stageOf(doc) === 'in_review') {
    return refusal(
      409,
      'IN_REVIEW',
      'This article is In Review, so it is not saved from here. Use Back to Drafts to edit it again.'
    );
  }
  if (stageOf(doc) !== 'draft') return pastReview(doc, 'saving over it');
  return null;
}

/** Null when Send to In Review may go ahead, else why not. */
export function sendToReviewRefusal(doc) {
  const blocked = saveRefusal(doc);
  if (blocked)
    return blocked.code === 'IN_REVIEW'
      ? { ...blocked, error: 'This article is already In Review.' }
      : blocked;
  if (!isAllowedEdge(statusOf(doc), REVIEW_STATUS)) return pastReview(doc, 'sending it to review');
  if (!String(doc.Title || doc.title || '').trim()) {
    return refusal(422, 'NO_TITLE', 'Give the draft a title before sending it to In Review.');
  }
  if (!getPrimaryContentBody(doc)) {
    return refusal(422, 'EMPTY_BODY', 'The draft has no body yet; write the article first.');
  }
  return null;
}

/** Null when Back to Drafts may go ahead, else why not. */
export function backToDraftsRefusal(doc) {
  if (doc.Live === true) return LIVE_REFUSAL('moving it back to Drafts');
  if (!comesFromDrafts(doc)) {
    return refusal(
      409,
      'NOT_A_DRAFT',
      'This article did not come from Drafts; nothing was changed.'
    );
  }
  if (stageOf(doc) === 'draft')
    return refusal(409, 'ALREADY_DRAFT', 'This article is already a draft.');
  if (!allowedActions(doc).backToDrafts) return pastReview(doc, 'moving it back to Drafts');
  return null;
}

/**
 * drafting → in_review: the same end state the repository import produced —
 * an in_review, Live false document with the body normalised, the dedup
 * fields, the quality and image-readiness reports and the image lineage
 * createContentDocument stamps on every new document — so the review board
 * cannot tell an article sent from Drafts from one imported straight into
 * review. The provider is filled from the tags only when none is set
 * (repo-draft.js inferProviderFromTags), never overwritten.
 */
export function buildSendToReviewPatch(doc, { editor, now = () => new Date() }) {
  const stamp = now().toISOString();
  const body = getPrimaryContentBody(doc);
  const bodies = normalizeContentBodyFields({
    Content: body,
    content: body,
    postContent: body,
    ...(typeof doc.blogDraft === 'string' && { blogDraft: body }),
  });
  const title = String(doc.Title || doc.title || '').trim();
  const tags = Array.isArray(doc.Tags) ? doc.Tags : [];
  const provider = doc['Cloud Provider'] || doc.cloudProvider ? null : inferProviderFromTags(tags);
  const merged = { ...doc, ...bodies };
  const imageReadiness = buildImageReadinessReport(merged);
  return {
    contentStatus: REVIEW_STATUS,
    Live: false,
    Status: 'Draft',
    ...bodies,
    ...buildDedupFields({ url: doc.sourceUrl, title }),
    ...(provider && { 'Cloud Provider': provider, cloudProvider: provider }),
    contentQuality: buildContentQualityReport(merged, null),
    imageReadiness,
    imageQuality: imageReadiness,
    ...(!doc.imageLineage && { imageLineage: buildImageLineage(merged) }),
    sentToReviewAt: stamp,
    sentToReviewBy: editor,
    updatedAt: stamp,
    updatedBy: editor,
  };
}

/** in_review → drafting. Status and stamps only; the article is left as the reviewer left it. */
export function buildBackToDraftsPatch({ editor, now = () => new Date() }) {
  const stamp = now().toISOString();
  return {
    contentStatus: DRAFTS_STAGE_STATUS,
    Live: false,
    returnedToDraftsAt: stamp,
    returnedToDraftsBy: editor,
    updatedAt: stamp,
    updatedBy: editor,
  };
}

// ── what the page receives ─────────────────────────────────────────────────

function readingOf(doc) {
  const fromReadTime = /^(\d{1,3})\b/.exec(String(doc.readTime || ''))?.[1];
  if (fromReadTime) return Number(fromReadTime);
  const fromFrontMatter = Number(doc.frontMatter?.reading);
  return Number.isInteger(fromFrontMatter) && fromFrontMatter > 0 ? fromFrontMatter : null;
}

/** One row of the list. No body: the list is read on every visit. */
export function toDraftSummary(doc = {}) {
  return {
    id: doc.id,
    title: String(doc.Title || doc.title || '').trim() || 'Untitled draft',
    subtitle: String(doc.Summary ?? doc.summary ?? ''),
    contentStatus: statusOf(doc),
    stage: stageOf(doc),
    live: doc.Live === true,
    origin: doc.draftOrigin || (doc.repoPath ? DRAFT_ORIGINS.repo : null),
    repoPath: doc.repoPath || null,
    updatedAt: doc.updatedAt || doc['Created At'] || null,
    etag: doc._etag || null,
    actions: allowedActions(doc),
  };
}

/** The open draft: the summary plus the eight editor fields. */
export function toDraftView(doc = {}) {
  const front = doc.frontMatter || {};
  const tags = Array.isArray(doc.Tags) ? doc.Tags : Array.isArray(front.tags) ? front.tags : [];
  return {
    ...toDraftSummary(doc),
    fields: {
      title: String(doc.Title || doc.title || ''),
      subtitle: String(doc.Summary ?? doc.summary ?? ''),
      date: front.date || null,
      track: front.track || null,
      part: front.part || null,
      tags: tags.map(String),
      reading: readingOf(doc),
      body: getPrimaryContentBody(doc),
    },
  };
}
