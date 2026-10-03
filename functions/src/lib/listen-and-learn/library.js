/**
 * The Audio Library model over the two Listen & Learn containers (ADR 0033
 * §4): a BOOK or COURSE is a `listen_and_learn` document, a CHAPTER or LESSON
 * is a `listen_and_learn_episodes` document in its partition, and an AUDIO
 * VERSION is an entry in the chapter's `versions[]` (publish.js). No new
 * container: everything here is new fields on the existing documents, read
 * with defaults so a set generated before the library existed is a course
 * with one implicit version per episode.
 *
 * This module is the pure half — the body validators the handlers apply and
 * the view shapes they return — so every rule about what a book may carry is
 * testable without a store. The handlers (handlers.js) do the I/O.
 */
import {
  EPISODE_KIND,
  STATUS,
  activeVersionOf,
  episodeKindOf,
  manualChapterId,
  slugifyTitle,
  versionsOf,
} from './publish.js';
import { normalizeVoiceSettings, voiceSettingsOf } from './speech-settings.js';

export const BOOK_KINDS = Object.freeze(['course', 'book']);

/** A provider segment is a blob path segment and a public route segment. */
const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
/** A book's code is its slug: the exam code slot for a book with no exam. */
const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,60}$/;

export const LIMITS = Object.freeze({
  title: 160,
  author: 120,
  description: 2000,
  tag: 40,
  tags: 20,
  url: 500,
  // Enough for a long article; the speech is chunked, so this is a cost and
  // sanity bound rather than a provider limit.
  sourceText: 60000,
});

const str = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

function checkText(value, field, max, { required = false } = {}) {
  if (value === undefined) return { skip: true };
  if (value === null || value === '') {
    return required ? { error: `${field} is required` } : { value: null };
  }
  if (typeof value !== 'string') return { error: `${field} must be a string` };
  const text = str(value);
  if (required && !text) return { error: `${field} is required` };
  if (text.length > max) return { error: `${field} must be at most ${max} characters` };
  return { value: text || null };
}

function checkUrl(value, field) {
  if (value === undefined) return { skip: true };
  if (value === null || value === '') return { value: null };
  if (typeof value !== 'string') return { error: `${field} must be a string` };
  const url = value.trim();
  if (url.length > LIMITS.url)
    return { error: `${field} must be at most ${LIMITS.url} characters` };
  // Site-relative media paths (the gallery's) or https; nothing executable.
  if (!/^(\/[^/\\][^\s]*|https:\/\/[^\s]+)$/.test(url)) {
    return { error: `${field} must be an https URL or a site-relative path` };
  }
  return { value: url };
}

function checkTags(value) {
  if (value === undefined) return { skip: true };
  if (value === null) return { value: [] };
  if (!Array.isArray(value)) return { error: 'tags must be an array of strings' };
  if (value.length > LIMITS.tags) return { error: `tags must hold at most ${LIMITS.tags} entries` };
  const tags = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return { error: 'tags must be an array of strings' };
    const tag = str(raw).toLowerCase();
    if (!tag) continue;
    if (tag.length > LIMITS.tag) return { error: `a tag must be at most ${LIMITS.tag} characters` };
    if (!tags.includes(tag)) tags.push(tag);
  }
  return { value: tags };
}

/**
 * The fields a book PATCH may carry, validated: `{ value }` holds only the
 * fields present in the body, so the handler can hand it to `patchDoc`
 * without touching anything the body did not name.
 */
export function parseBookPatch(body) {
  const out = {};
  const checks = [
    ['title', checkText(body?.title, 'title', LIMITS.title, { required: true })],
    ['certTitle', checkText(body?.certTitle, 'certTitle', LIMITS.title)],
    ['author', checkText(body?.author, 'author', LIMITS.author)],
    ['description', checkText(body?.description, 'description', LIMITS.description)],
    ['coverImageUrl', checkUrl(body?.coverImageUrl, 'coverImageUrl')],
    ['tags', checkTags(body?.tags)],
  ];
  for (const [field, checked] of checks) {
    if (checked.skip) continue;
    if (checked.error) return { error: checked.error };
    out[field] = checked.value;
  }
  if (body?.kind !== undefined) {
    if (!BOOK_KINDS.includes(body.kind)) {
      return { error: `kind must be one of ${BOOK_KINDS.join(', ')}` };
    }
    out.kind = body.kind;
  }
  if (body?.voice !== undefined) {
    const voice = normalizeVoiceSettings(body.voice);
    if (voice.error) return { error: voice.error };
    out.voice = voice.value;
  }
  if (body?.sourceContentIds !== undefined) {
    if (
      !Array.isArray(body.sourceContentIds) ||
      body.sourceContentIds.some((id) => typeof id !== 'string' || !id.trim())
    ) {
      return { error: 'sourceContentIds must be an array of ids' };
    }
    out.sourceContentIds = [...new Set(body.sourceContentIds.map((id) => id.trim()))].slice(0, 50);
  }
  if (Object.keys(out).length === 0) return { error: 'Nothing to change' };
  return { value: out };
}

/**
 * A new book from a POST body: a provider, a kind, a title, and the
 * optional metadata. Its code — the exam-code slot, the blob path segment
 * and the admin route segment — is the title's slug unless the body names
 * an exam code, which a course bound to a certification does.
 */
export function parseBookCreate(body) {
  const provider = String(body?.provider || '')
    .trim()
    .toLowerCase();
  if (!PROVIDER_PATTERN.test(provider)) {
    return { error: 'provider is required (lowercase letters, digits and hyphens)' };
  }
  const kind = body?.kind === undefined ? 'book' : body.kind;
  if (!BOOK_KINDS.includes(kind)) return { error: `kind must be one of ${BOOK_KINDS.join(', ')}` };

  const patch = parseBookPatch({ ...body, kind, title: body?.title ?? '' });
  if (patch.error) return { error: patch.error };

  const explicit = body?.examCode === undefined ? '' : String(body.examCode).trim().toLowerCase();
  const code = explicit || slugifyTitle(patch.value.title);
  if (!CODE_PATTERN.test(code)) {
    return { error: 'The title (or exam code) must yield a slug of letters, digits and hyphens' };
  }

  return {
    value: {
      provider,
      examCode: code,
      ...patch.value,
      voice: patch.value.voice || voiceSettingsOf(null),
      tags: patch.value.tags || [],
      author: patch.value.author ?? null,
      description: patch.value.description ?? null,
      coverImageUrl: patch.value.coverImageUrl ?? null,
    },
  };
}

/**
 * A new hand-made chapter from a POST body: a title, and its text either
 * pasted or to be read from a content item (the handler resolves the item).
 * `{ value }` carries the id the chapter will have, so a duplicate is
 * refused before anything is written.
 */
export function parseChapterCreate(body) {
  const title = checkText(body?.title, 'title', LIMITS.title, { required: true });
  if (title.skip || title.error) return { error: title.error || 'title is required' };

  const text = checkText(body?.sourceText, 'sourceText', LIMITS.sourceText);
  if (text.error) return { error: text.error };

  const contentId = typeof body?.contentId === 'string' ? body.contentId.trim() : '';
  const sourceText = text.skip ? null : text.value;
  if (!sourceText && !contentId) {
    return { error: 'Give the chapter text to speak (sourceText) or a content item (contentId)' };
  }

  let id;
  try {
    id = manualChapterId(title.value);
  } catch (err) {
    return { error: err.message };
  }

  const speak = body?.speak === undefined ? Boolean(sourceText || contentId) : Boolean(body.speak);

  return {
    value: {
      id,
      title: title.value,
      // Spoken text keeps its line breaks: `checkText` collapsed whitespace
      // for a label, so the raw value is re-read here, bounded the same way.
      sourceText: sourceText ? String(body.sourceText).trim().slice(0, LIMITS.sourceText) : null,
      contentId: contentId || null,
      speak,
    },
  };
}

/**
 * The fields a chapter PATCH may carry: a rename, a new position, new text
 * to speak next time, the active version, archive / restore, and clearing a
 * regeneration error ("Keep current"). Validated the same way as a book.
 */
export function parseChapterPatch(body) {
  const out = {};
  const title = checkText(body?.title, 'title', LIMITS.title, { required: true });
  if (title.error) return { error: title.error };
  if (!title.skip) out.title = title.value;

  if (body?.order !== undefined) {
    const order = Number(body.order);
    if (!Number.isInteger(order) || order < 0 || order > 10000) {
      return { error: 'order must be a whole number between 0 and 10000' };
    }
    out.order = order;
  }

  if (body?.sourceText !== undefined) {
    if (body.sourceText !== null && typeof body.sourceText !== 'string') {
      return { error: 'sourceText must be a string' };
    }
    const text = body.sourceText === null ? '' : body.sourceText.trim();
    if (text.length > LIMITS.sourceText) {
      return { error: `sourceText must be at most ${LIMITS.sourceText} characters` };
    }
    out.sourceText = text || null;
  }

  if (body?.activeVersionId !== undefined) {
    if (
      typeof body.activeVersionId !== 'string' ||
      !/^[a-z0-9]{1,20}$/i.test(body.activeVersionId)
    ) {
      return { error: 'activeVersionId must name a version' };
    }
    out.activeVersionId = body.activeVersionId;
  }

  if (body?.archived !== undefined) {
    if (typeof body.archived !== 'boolean') return { error: 'archived must be true or false' };
    out.archived = body.archived;
  }

  if (body?.clearError !== undefined) {
    if (body.clearError !== true) return { error: 'clearError must be true' };
    out.clearError = true;
  }

  if (Object.keys(out).length === 0) return { error: 'Nothing to change' };
  return { value: out };
}

/** `{ order: [ids] }` — every id a string, no duplicates, at least one. */
export function parseReorder(body) {
  const ids = body?.order;
  if (!Array.isArray(ids) || ids.length === 0) return { error: 'order must list the chapter ids' };
  if (ids.length > 200) return { error: 'order lists too many chapters' };
  if (ids.some((id) => typeof id !== 'string' || !id.trim())) {
    return { error: 'order must list chapter ids' };
  }
  if (new Set(ids).size !== ids.length) return { error: 'order lists a chapter twice' };
  return { value: ids.map((id) => id.trim()) };
}

// ── view shapes ─────────────────────────────────────────────────────────────

/**
 * A chapter as the admin reads it: kind and sources resolved by the one rule,
 * versions always an array with the active one named, and — against its
 * book — whether a guide chapter is still in the current study guide.
 */
export function toChapterView(doc, set = null) {
  const versions = versionsOf(doc);
  const active = activeVersionOf(doc);
  const kind = episodeKindOf(doc);
  const inGuide =
    kind !== EPISODE_KIND.guide ||
    !Array.isArray(set?.areaSlugs) ||
    set.areaSlugs.length === 0 ||
    set.areaSlugs.includes(doc.areaSlug || doc.id);
  return {
    ...doc,
    kind,
    sources: Array.isArray(doc?.sources) ? doc.sources : [],
    versions,
    activeVersionId: active?.id || null,
    versionCount: versions.length,
    droppedFromGuide: !inGuide,
    lastError: doc?.lastError || null,
  };
}

/**
 * A book as the admin reads it, with defaults for every field a pre-library
 * set lacks, and the chapter counts the Library grid shows when they were
 * aggregated for it.
 */
export function toBookView(doc, counts = null) {
  const kind = doc?.kind === 'book' ? 'book' : 'course';
  return {
    ...doc,
    kind,
    title: doc?.title || doc?.certTitle || doc?.examCode || doc?.id || '',
    author: doc?.author ?? null,
    description: doc?.description ?? null,
    coverImageUrl: doc?.coverImageUrl ?? null,
    tags: Array.isArray(doc?.tags) ? doc.tags : [],
    sourceContentIds: Array.isArray(doc?.sourceContentIds) ? doc.sourceContentIds : [],
    archivedAt: doc?.archivedAt ?? null,
    voice: voiceSettingsOf(doc),
    counts: counts || {
      chapters: 0,
      published: 0,
      drafts: 0,
      failed: 0,
      archived: 0,
      durationSeconds: 0,
    },
  };
}

/**
 * Per-book counts from a projection of every chapter row (setId, status,
 * durationSeconds, softDeletedAt). Soft-deleted chapters are not counted;
 * archived ones are counted apart; the duration total is of the live and
 * draft chapters, which is what a listener could hear.
 */
export function summarizeChapters(rows) {
  const bySet = new Map();
  for (const row of rows || []) {
    if (!row?.setId || row.softDeletedAt || row.softDeleteExpiresAt) continue;
    const counts = bySet.get(row.setId) || {
      chapters: 0,
      published: 0,
      drafts: 0,
      failed: 0,
      archived: 0,
      durationSeconds: 0,
    };
    counts.chapters += 1;
    if (row.status === STATUS.published) counts.published += 1;
    else if (row.status === STATUS.failed) counts.failed += 1;
    else if (row.status === STATUS.archived) counts.archived += 1;
    else counts.drafts += 1;
    if (row.status !== STATUS.archived && Number.isFinite(Number(row.durationSeconds))) {
      counts.durationSeconds += Math.max(0, Math.round(Number(row.durationSeconds)));
    }
    bySet.set(row.setId, counts);
  }
  return bySet;
}

/** The chapters that stand in the way of a delete without `force`. */
export function publishedChapters(chapters) {
  return (chapters || []).filter(
    (c) => c?.status === STATUS.published && !c.softDeletedAt && !c.softDeleteExpiresAt
  );
}
