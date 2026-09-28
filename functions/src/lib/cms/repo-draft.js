/**
 * repo-draft.js — the pure half of importing a `docs/content/blog-*.md` draft
 * from the repository into the CMS review queue (owner request 2026-09-28).
 *
 * Nothing here does I/O. The fetch, the store and the HTTP shape are in
 * ./repo-import.js; this module decides which paths may be imported at all,
 * reads a draft's front matter, and builds the content document the review
 * queue lists.
 *
 * THE ALLOW-LIST IS A PATTERN, NOT A LOOKUP. `^docs/content/blog-[a-z0-9-]+\.md$`
 * admits no `.`, `/`, `%` or `\` after the directory, so a traversal
 * (`docs/content/../x`), another directory, an encoded separator and a
 * Windows separator all fail the same test, before any URL is built. The two
 * contract documents in the same directory (blog-template.md, blog-machine.md)
 * match the pattern and are refused by name: they describe articles, they are
 * not articles.
 *
 * THE FRONT-MATTER READER IS A PORT, NOT A NEW PARSER. The repository has one
 * front-matter reader, `frontmatter()` in tooling/workflow.py: an anchored
 * `---` block, one `key: value` per line, a value starting with `#` skipped,
 * a trailing ` #` comment dropped, surrounding quotes stripped. That is ported
 * here line for line, with two additions the blog contract needs and the
 * agent files it was written for do not: a quoted value is taken whole (so a
 * title in quotes may contain ` #`, as YAML allows), and `tags` is read as the
 * inline list every post in docs/content writes (`[azure, terraform]`). The
 * keys interpreted are exactly the seven in docs/content/blog-template.md's
 * "Front matter" section — title, subtitle, date, track, part, tags,
 * reading — and no others.
 *
 * THE BODY IS NOT TRANSFORMED. The text after the closing `---` goes into the
 * document as written, so a `landing-zone` or `pricing-scenario` fence reaches
 * the review board and the publish renderer byte for byte. The one change is
 * the one every content writer makes: createContentDocument runs
 * normalizeContentBodyFields over it, which trims and moves a TL;DR section to
 * the end.
 */
import { createHash } from 'node:crypto';
import { slugify } from './publish.js';
import { normalizeProviderName } from './content-update-validation.js';
import { normalizeContentBodyFields } from './content-quality.js';
import { buildDedupFields } from './content-dedup.js';

export const REPO_OWNER = 'HybridCloudWorks';
export const REPO_NAME = 'HCW-HybridCloudWorks';
/** The branch every import reads. A draft on another branch is not reviewable here yet. */
export const REPO_REF = 'main';
export const REPO_DRAFT_DIR = 'docs/content';

export const RAW_ORIGIN = 'https://raw.githubusercontent.com';
export const API_ORIGIN = 'https://api.github.com';
/** Every raw fetch starts with this, and nothing else is fetched from raw. */
export const RAW_PATH_PREFIX = `/${REPO_OWNER}/${REPO_NAME}/${REPO_REF}/${REPO_DRAFT_DIR}/`;
/** Every API call starts with this. */
export const API_PATH_PREFIX = `/repos/${REPO_OWNER}/${REPO_NAME}/`;

export const REPO_DRAFT_PATH_PATTERN = /^docs\/content\/blog-[a-z0-9-]+\.md$/;

/** The article contract and the Blog Machine program — same directory, not articles. */
export const CONTRACT_DOC_PATHS = Object.freeze([
  'docs/content/blog-template.md',
  'docs/content/blog-machine.md',
]);

/** Longer than any real path under the pattern; a cap before the regex runs. */
export const MAX_REPO_PATH_LENGTH = 120;

export const MAX_TITLE_CHARS = 300;
export const MAX_SUBTITLE_CHARS = 500;
export const MAX_TAGS = 12;
export const MAX_TAG_CHARS = 40;

/** Fence languages that render as embeds (blog-template.md "Code blocks"). */
export const EMBED_FENCE_LANGUAGES = Object.freeze(['landing-zone', 'pricing-scenario']);

/**
 * May this path be imported? Pure; the only gate between a request body and
 * a URL.
 *
 * @param {unknown} value
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function checkRepoDraftPath(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'path must be a string' };
  if (value.length === 0 || value.length > MAX_REPO_PATH_LENGTH) {
    return { ok: false, reason: `path must be 1-${MAX_REPO_PATH_LENGTH} characters` };
  }
  if (!REPO_DRAFT_PATH_PATTERN.test(value)) {
    return {
      ok: false,
      reason: 'path must match docs/content/blog-<lowercase-name>.md',
    };
  }
  if (CONTRACT_DOC_PATHS.includes(value)) {
    return { ok: false, reason: `${value} is the article contract, not an article` };
  }
  return { ok: true, path: value };
}

/** The one raw URL a path may be fetched from. Call only with a checked path. */
export function rawUrlFor(path) {
  return `${RAW_ORIGIN}/${REPO_OWNER}/${REPO_NAME}/${REPO_REF}/${path}`;
}

/** The GitHub page for the file, for the review board's Source URL link. */
export function blobUrlFor(path) {
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${REPO_REF}/${path}`;
}

/** sha256 of a string or buffer, hex. Detects "the file has not changed since". */
export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The namespace for repoDraftContentId. Fixed forever: changing it would give
 * every already-imported draft a different id, and the next import would find
 * the old document by repoPath and the new id would never be used — harmless,
 * but it would make the id meaningless as a key.
 */
export const REPO_DRAFT_ID_NAMESPACE = '8bccdb11-a980-4071-bc3a-805c389b371b';

/**
 * A deterministic, UUID-shaped document id for a repository path (RFC 9562
 * version 5: SHA-1 over the namespace and the name).
 *
 * Why not randomUUID, which every other creator uses: the create is the one
 * write in the import that has no document to condition on. With a fresh
 * random id, two imports of the same path racing each other (a double click)
 * would both find nothing by repoPath and both create, and every later import
 * would then find two. With the id derived from the path, both race to the
 * same id and the create is create-only (repo-import.js), so the second one
 * is refused rather than duplicated. UUID-shaped so nothing downstream — the
 * slug suffix a colliding publish takes, the preview route — sees a
 * difference.
 */
export function repoDraftContentId(path) {
  const namespace = Buffer.from(REPO_DRAFT_ID_NAMESPACE.replace(/-/g, ''), 'hex');
  const name = Buffer.from(`${REPO_OWNER}/${REPO_NAME}:${path}`, 'utf8');
  const bytes = createHash('sha1').update(namespace).update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `\A---\s*\n(.*?)\n---\s*\n` from workflow.py, on LF-normalised text. */
const FRONT_MATTER_BLOCK = /^---[^\S\n]*\n([\s\S]*?)\n---[^\S\n]*(?:\n|$)/;
/** `^([A-Za-z_][\w-]*):\s*(.+?)\s*$` from workflow.py. */
const FRONT_MATTER_LINE = /^([A-Za-z_][\w-]*):\s*(.+?)\s*$/;

function readScalar(raw) {
  const quote = raw[0];
  if (quote === '"' || quote === "'") {
    const close = raw.indexOf(quote, 1);
    if (close > 0) return raw.slice(1, close);
  }
  // workflow.py: `value.split(" #", 1)[0].strip().strip("\"'")`
  return raw
    .split(' #')[0]
    .trim()
    .replace(/^["']+|["']+$/g, '');
}

/**
 * The front-matter block of a markdown file, as flat string fields, and the
 * text after it. `fields` is null when the file does not open with a block.
 *
 * @param {string} text
 * @returns {{ fields: Record<string, string> | null, body: string }}
 */
export function parseFrontMatter(text) {
  const source = String(text ?? '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n');
  const match = FRONT_MATTER_BLOCK.exec(source);
  if (!match) return { fields: null, body: source };
  const fields = {};
  for (const line of match[1].split('\n')) {
    const entry = FRONT_MATTER_LINE.exec(line);
    if (entry && !entry[2].startsWith('#')) fields[entry[1]] = readScalar(entry[2]);
  }
  return { fields, body: source.slice(match[0].length) };
}

/** `[a, b]` or `a, b` → ['a', 'b'], trimmed, unquoted, capped. */
export function parseInlineList(value) {
  const raw = String(value || '').trim();
  const inner = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  return inner
    .split(',')
    .map((item) =>
      item
        .trim()
        .replace(/^["']+|["']+$/g, '')
        .slice(0, MAX_TAG_CHARS)
    )
    .filter(Boolean)
    .slice(0, MAX_TAGS);
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Links written relative to the repository (`[Part 2](blog-lab-02-x.md)`).
 * They work on GitHub and resolve to nothing on the site, so the import says
 * so rather than rewriting prose it does not own.
 */
export function findRepoRelativeLinks(body) {
  const targets = new Set();
  const pattern = /\]\(((?!https?:\/\/|mailto:|#|\/)[^)\s]+?\.md)(?:#[^)\s]*)?\)/g;
  let match;
  while ((match = pattern.exec(String(body || ''))) !== null) targets.add(match[1]);
  return [...targets];
}

/** How many embed fences of each kind the body carries. */
export function countEmbedFences(body) {
  const counts = {};
  for (const language of EMBED_FENCE_LANGUAGES) {
    const fence = new RegExp(`^\`\`\`${language}[^\\S\\n]*$`, 'gm');
    counts[language] = (String(body || '').match(fence) || []).length;
  }
  return counts;
}

/** The first tag that names a provider the CMS knows, else null. */
export function inferProviderFromTags(tags = []) {
  for (const tag of tags) {
    const provider = normalizeProviderName(tag);
    if (provider) return provider;
  }
  return null;
}

const refuse = (code, error) => ({ ok: false, code, error });

/**
 * A draft file → the fields the content document is built from, or the
 * reason it cannot be one. Pure.
 *
 * @param {string} text the file as fetched
 * @returns {{ ok: true, draft: object } | { ok: false, code: string, error: string }}
 */
export function parseRepoDraft(text) {
  const { fields, body } = parseFrontMatter(text);
  if (!fields) {
    return refuse(
      'NO_FRONT_MATTER',
      'The file does not open with a --- front-matter block (docs/content/blog-template.md, "Front matter").'
    );
  }
  const title = String(fields.title || '').trim();
  if (!title) return refuse('NO_TITLE', 'The front matter has no title.');
  if (title.length > MAX_TITLE_CHARS) {
    return refuse(
      'TITLE_TOO_LONG',
      `The title is ${title.length} characters; at most ${MAX_TITLE_CHARS}.`
    );
  }
  const articleBody = body.replace(/^\n+/, '').trimEnd();
  if (!articleBody.trim()) return refuse('EMPTY_BODY', 'The file has front matter and no article.');

  const warnings = [];
  const date = String(fields.date || '').trim();
  if (date && !isCalendarDate(date))
    warnings.push(`date "${date}" is not YYYY-MM-DD and was ignored`);
  const readingRaw = String(fields.reading || '').trim();
  const reading =
    /^\d{1,3}$/.test(readingRaw) && Number(readingRaw) > 0 ? Number(readingRaw) : null;
  if (readingRaw && reading === null)
    warnings.push(`reading "${readingRaw}" is not a number of minutes and was ignored`);
  const relativeLinks = findRepoRelativeLinks(articleBody);
  if (relativeLinks.length) {
    warnings.push(
      `links to repository files will not resolve on the site: ${relativeLinks.join(', ')}`
    );
  }

  const tags = parseInlineList(fields.tags);
  return {
    ok: true,
    draft: {
      title,
      subtitle: String(fields.subtitle || '')
        .trim()
        .slice(0, MAX_SUBTITLE_CHARS),
      date: date && isCalendarDate(date) ? date : null,
      track: String(fields.track || '').trim() || null,
      part: String(fields.part || '').trim() || null,
      tags,
      reading,
      body: articleBody,
      // What the first publish will assign, absent a collision: processPublishContent
      // takes slugify(title) on a first publish and ignores a stored slug. It is
      // reported, not stored — see buildRepoDraftData.
      slug: slugify(title),
      provider: inferProviderFromTags(tags),
      embeds: countEmbedFences(articleBody),
      warnings,
    },
  };
}

/** The front matter as read, kept on the document for provenance. */
function frontMatterRecord(draft) {
  return {
    title: draft.title,
    subtitle: draft.subtitle,
    date: draft.date,
    track: draft.track,
    part: draft.part,
    tags: draft.tags,
    reading: draft.reading,
  };
}

/** Where the bytes came from. `commitSha` null means the lookup failed and `ref` is all there is. */
function provenance({ path, source }) {
  return {
    repoPath: path,
    repoRef: REPO_REF,
    repoCommitSha: source.commitSha || null,
    repoRawUrl: source.rawUrl,
    repoContentSha256: source.contentSha256,
  };
}

/**
 * The `data` for createContentDocument — the createContentItem write path, so
 * an imported draft is shaped like every other draft (the Publish-Ready
 * Builder's persistStage.js payload and draft-from-recording.js are the two
 * it follows) and goes through the same dedup and document stamping.
 *
 * Deliberate choices, each against a specific failure:
 *   - `contentStatus: 'in_review'` and `Live: false`, fixed here and asserted
 *     again by the caller before it writes. `in_review` is outside
 *     QUALITY_ENFORCED_STATUSES, so the quality gate reports without blocking,
 *     and its only forward edges are approved/published/rejected — every one
 *     a human's transition.
 *   - No `slug`/`Slug`. The slug-holders probe a publish runs is not filtered
 *     by status, so an unpublished document holding a slug would push any
 *     other article that wants the URL onto a suffix. A first publish assigns
 *     slugify(title) regardless (parseRepoDraft reports it).
 *   - `inspectTrigger: false`: the change-feed inspector would rewrite a
 *     finished article with a model's summary of it.
 *   - The front-matter `date` is recorded, not mapped to a publish-date
 *     field: the publish pipeline would take it as the article's published
 *     date, and when to date it is the reviewer's decision.
 *   - `Cloud Provider` only when a tag names one. Otherwise the review board
 *     shows "Unknown Provider - Select One", which is the honest state.
 */
export function buildRepoDraftData({ path, draft, source, editor, now = () => new Date() }) {
  const stamp = now().toISOString();
  return {
    type: 'blog',
    publishTarget: 'blog',
    Title: draft.title,
    title: draft.title,
    Summary: draft.subtitle,
    summary: draft.subtitle,
    Content: draft.body,
    content: draft.body,
    postContent: draft.body,
    Author: 'Hybrid Cloud Works',
    ...(draft.provider && { 'Cloud Provider': draft.provider, cloudProvider: draft.provider }),
    Tags: draft.tags,
    keyTopics: draft.tags,
    ...(draft.reading && { readTime: `${draft.reading} min` }),
    Live: false,
    approvedForBlog: false,
    approvedForNews: false,
    Status: 'Draft',
    contentStatus: 'in_review',
    inspectTrigger: false,
    source: 'repo',
    sourceTrustLevel: 'manual',
    trustedSource: true,
    sourceUrl: blobUrlFor(path),
    ...provenance({ path, source }),
    frontMatter: frontMatterRecord(draft),
    repoImportedAt: stamp,
    repoImportedBy: editor,
    fetchedAt: stamp,
  };
}

/**
 * The patch a re-import applies to the in-review document it found.
 *
 * THE REPOSITORY OWNS THE ARTICLE WHILE IT IS IN REVIEW, AND ONLY THEN. So
 * this rewrites what the file says — title, subtitle, body, tags, reading
 * time — and the provenance, and nothing a reviewer decides: not the
 * provider, the key topics, the images or the schedule, and never
 * contentStatus, Live or a publish field (no key here can move the document
 * through the state machine). Once the article is approved it belongs to the
 * site and repo-import.js refuses to touch it.
 *
 * `blogDraft` is written only when the document already has one: approval
 * copies the body into an absent blogDraft (content-status.js), but keeps a
 * present one, so a stale blogDraft left behind here would be the text the
 * editor opens after approval.
 *
 * The body fields go through normalizeContentBodyFields, as they do on the
 * create path and in updateContentItem, and `normalizedTitle` follows a
 * changed title so the dedup check keeps matching the document by what it is
 * now called. `readTime` undefined is a deletion (patchDoc's convention): the
 * file no longer states a reading time.
 */
export function buildRepoDraftRefresh({
  path,
  draft,
  source,
  editor,
  current = {},
  now = () => new Date(),
}) {
  const stamp = now().toISOString();
  const bodies = normalizeContentBodyFields({
    Content: draft.body,
    content: draft.body,
    postContent: draft.body,
    ...(typeof current.blogDraft === 'string' && { blogDraft: draft.body }),
  });
  return {
    Title: draft.title,
    title: draft.title,
    Summary: draft.subtitle,
    summary: draft.subtitle,
    ...bodies,
    ...buildDedupFields({ title: draft.title }),
    Tags: draft.tags,
    readTime: draft.reading ? `${draft.reading} min` : undefined,
    ...provenance({ path, source }),
    frontMatter: frontMatterRecord(draft),
    repoRefreshedAt: stamp,
    repoRefreshedBy: editor,
    updatedAt: stamp,
    updatedBy: editor,
  };
}
