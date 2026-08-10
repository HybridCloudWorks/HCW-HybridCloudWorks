/**
 * Public content submissions: validation, document composition, and the
 * anonymous quota.
 *
 * Replaces four frontend pages that `addDoc` straight into the `content`
 * collection from the browser (pages/submissions/*.jsx). That path had no
 * server-side validation at all — the length caps and URL checks lived only in
 * React state, so anyone with the Firestore config could write arbitrary
 * documents into the review pipeline. This module is the server-side contract
 * those pages should always have had.
 *
 * Field parity matters more than elegance here: the review pipeline
 * (contentStatus 'ingested', Live false, the Title/Summary casing duplicates)
 * is consumed by the admin queue and publish path as-is, so the composed
 * document reproduces what the pages wrote — including the duplicated
 * casing — rather than tidying it and silently breaking the queue.
 */

import { sanitizeSubmittedHtml } from './sanitize-html.js';

/** Mirrors MAX_CONTENT_LENGTH in the submission pages. */
export const MAX_CONTENT_LENGTH = 50000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_SUMMARY_LENGTH = 2000;
export const MAX_URL_LENGTH = 2048;
export const MAX_TAGS = 12;

/** Mirrors VALID_URL_RE in the submission pages. */
const VALID_URL_RE = /^https?:\/\/.+\..+/;

/** Anonymous submissions per hashed client per rolling hour. */
export const SUBMISSIONS_PER_HOUR = 5;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Per-type contract. Providers are per-page in the source
 * (pages/submissions/*.jsx) and deliberately not merged into one set — a
 * 'framework' submission claiming provider 'Aws' was never possible in the UI
 * and should not become possible through the API.
 */
export const SUBMISSION_TYPES = Object.freeze({
  blog: {
    publishTarget: 'blog',
    providers: ['Azure', 'Aws', 'Gcp', 'Github', 'Terraform', 'Finops'],
    requires: ['title', 'summary', 'content'],
    optional: ['tags', 'sourceUrl'],
  },
  architecture: {
    publishTarget: 'architecture',
    providers: ['AWS', 'Azure', 'GCP', 'FinOps'],
    requires: ['title', 'summary', 'overviewHtml'],
    optional: ['tags', 'category', 'complexity', 'diagramUrl', 'components', 'estimatedMonthlyCost'],
  },
  framework: {
    publishTarget: 'framework',
    providers: ['Github', 'Terraform'],
    requires: ['title', 'summary', 'overviewHtml'],
    optional: ['tags', 'category', 'complexity', 'docLink', 'commandExample', 'keyPillars', 'patterns'],
  },
  coder_corner: {
    publishTarget: 'coder_corner',
    providers: ['AWS', 'Azure', 'GCP'],
    requires: ['title', 'summary', 'content', 'language'],
    optional: ['tags', 'repoUrl', 'codeSnippet', 'explanation'],
  },
});

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function checkUrl(value, field) {
  if (!value) return null;
  if (value.length > MAX_URL_LENGTH) return `${field} is too long`;
  if (!VALID_URL_RE.test(value)) return `${field} is not a valid http(s) URL`;
  return null;
}

/**
 * Validate a raw request body against the per-type contract.
 *
 * @returns {{ error: string } | { value: object }}
 */
export function validateSubmission(body) {
  if (!body || typeof body !== 'object') return { error: 'Body must be a JSON object' };

  const type = str(body.type);
  const spec = SUBMISSION_TYPES[type];
  if (!spec) {
    return { error: `type must be one of: ${Object.keys(SUBMISSION_TYPES).join(', ')}` };
  }

  const title = str(body.title);
  const summary = str(body.summary);
  if (!title) return { error: 'Title is required' };
  if (title.length > MAX_TITLE_LENGTH) return { error: 'Title is too long' };
  if (!summary) return { error: 'Summary is required' };
  if (summary.length > MAX_SUMMARY_LENGTH) return { error: 'Summary is too long' };

  const provider = str(body.cloudProvider || body.provider);
  if (!spec.providers.includes(provider)) {
    return { error: `cloudProvider must be one of: ${spec.providers.join(', ')}` };
  }

  const content = str(body.content);
  // Sanitized here, not merely on render. This field arrives anonymously and
  // is eventually rendered with dangerouslySetInnerHTML on a public template;
  // sanitizing at ingest makes safety a property of the stored data rather
  // than of one component's rendering choice (TODO.md T-408).
  //
  // The length check below therefore measures the SANITIZED value: the cap
  // exists to bound what is stored, and measuring the input would let a
  // payload of stripped markup pass a check the stored string never met.
  const overviewHtml = sanitizeSubmittedHtml(str(body.overviewHtml));
  if (spec.requires.includes('content')) {
    if (!content) return { error: 'Content is required' };
    if (content.length > MAX_CONTENT_LENGTH) {
      return { error: `Content must be under ${MAX_CONTENT_LENGTH / 1000}KB` };
    }
  }
  if (spec.requires.includes('overviewHtml')) {
    if (!overviewHtml) return { error: 'Overview is required' };
    if (overviewHtml.length > MAX_CONTENT_LENGTH) {
      return { error: `Overview must be under ${MAX_CONTENT_LENGTH / 1000}KB` };
    }
  }
  if (spec.requires.includes('language') && !str(body.language)) {
    return { error: 'Language is required' };
  }

  for (const [field, value] of [
    ['sourceUrl', str(body.sourceUrl)],
    ['diagramUrl', str(body.diagramUrl)],
    ['docLink', str(body.docLink)],
    ['repoUrl', str(body.repoUrl)],
  ]) {
    const err = checkUrl(value, field);
    if (err) return { error: err };
  }

  let tags = Array.isArray(body.tags)
    ? body.tags
    : str(body.tags).split(',');
  tags = tags.map(str).filter(Boolean).slice(0, MAX_TAGS);

  return {
    value: {
      type,
      spec,
      title,
      summary,
      provider,
      content,
      overviewHtml,
      tags,
      language: str(body.language),
      category: str(body.category),
      complexity: str(body.complexity),
      sourceUrl: str(body.sourceUrl),
      diagramUrl: str(body.diagramUrl),
      docLink: str(body.docLink),
      repoUrl: str(body.repoUrl),
      codeSnippet: str(body.codeSnippet),
      explanation: str(body.explanation),
      commandExample: str(body.commandExample),
    },
  };
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Compose the `content` document for a validated submission.
 *
 * Field parity with the four pages is deliberate, duplicated casing included —
 * the admin queue reads Title/Summary and the publish path reads
 * title/summary, and this is not the place to fix that.
 */
export function composeSubmissionDoc(value, { nowIso = new Date().toISOString(), id } = {}) {
  const base = {
    id: id ?? `sub-${slugify(value.title).slice(0, 60)}-${Date.now().toString(36)}`,
    type: value.type,
    contentStatus: 'ingested',
    storageCollection: 'content',
    publishTarget: value.spec.publishTarget,
    Live: false,
    approvedForBlog: false,
    source: 'template-form',
    submittedVia: 'public-api',
    slug: slugify(value.title),
    title: value.title,
    Title: value.title,
    summary: value.summary,
    Summary: value.summary,
    cloudProvider: value.provider,
    tags: value.tags,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  switch (value.type) {
    case 'blog':
      return {
        ...base,
        content: value.content,
        Content: value.content,
        postContent: value.content,
        sourceUrl: value.sourceUrl,
      };
    case 'coder_corner':
      return {
        ...base,
        content: value.content,
        Content: value.content,
        postContent: value.content,
        category: 'Coder Corner',
        language: value.language,
        repoUrl: value.repoUrl,
        codeSnippet: value.codeSnippet,
        explanation: value.explanation,
        tags: ['coder-corner', value.provider.toLowerCase(), ...value.tags].filter(Boolean).slice(0, MAX_TAGS),
      };
    case 'architecture':
      return {
        ...base,
        category: value.category,
        complexity: value.complexity,
        diagramUrl: value.diagramUrl,
        overviewHtml: value.overviewHtml,
      };
    case 'framework':
      return {
        ...base,
        category: value.category,
        complexity: value.complexity,
        docLink: value.docLink,
        overviewHtml: value.overviewHtml,
        commandExample: value.commandExample,
      };
    /* c8 ignore next 2 -- unreachable: validateSubmission rejects unknown types */
    default:
      throw new Error(`Unhandled submission type: ${value.type}`);
  }
}

/**
 * Enforce the rolling-hour anonymous quota.
 *
 * Same shape as Site-Main's enforceAnonymousExportRateLimit
 * (cloud-tools.js:417): a per-key counter document, reset when the window
 * lapses. Cosmos has no cross-operation transaction here; the read-modify-
 * write race can under-count by at most the number of truly simultaneous
 * requests from ONE client, which is acceptable for an abuse brake. The
 * container carries a TTL (see migration-manifest CONTAINER_TTL_SECONDS) so
 * stale counters age out on their own.
 *
 * @param {{ readDoc: Function, upsertDoc: Function }} store cosmos-client fns
 * @param {string} key hashed client identity (client-identity.js anonymousKey)
 * @param {{ now?: number, limit?: number }} [options]
 * @throws {Error} code SUBMISSION_RATE_LIMIT when over quota
 */
export async function enforceSubmissionQuota(store, key, { now = Date.now(), limit = SUBMISSIONS_PER_HOUR } = {}) {
  const existing = await store.readDoc('submission_quota', key, key);
  const windowStartMs = Number(existing?.windowStartMs) || 0;
  // Absence is checked explicitly rather than through `now - 0 < WINDOW_MS`:
  // the source's arithmetic-only form happens to work because real epoch
  // milliseconds dwarf the window, which is a coincidence, not a contract.
  const inWindow = existing != null && now - windowStartMs < WINDOW_MS;
  const count = inWindow ? Number(existing?.count) || 0 : 0;

  if (count >= limit) {
    const err = new Error('Submission rate limit exceeded — try again later');
    err.code = 'SUBMISSION_RATE_LIMIT';
    throw err;
  }

  await store.upsertDoc('submission_quota', {
    id: key,
    windowStartMs: inWindow ? windowStartMs : now,
    count: count + 1,
    updatedAt: new Date(now).toISOString(),
  });
}
