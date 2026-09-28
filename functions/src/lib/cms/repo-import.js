/**
 * repo-import.js — POST cms/content/import-repo and
 * GET cms/content/import-repo/candidates: put a `docs/content/blog-*.md`
 * draft from the repository into the CMS review queue as `in_review`, and
 * never publish it (owner request 2026-09-28).
 *
 * WHY THIS EXISTS. Drafts are written and reviewed as files in the
 * repository (the three lab articles, #737/#744), and nothing imported them
 * into the CMS, so reading one on the site meant pasting it into the
 * Publish-Ready Builder by hand. This is the repeatable path: list the drafts
 * on `main`, pick some, and each lands in the queue's In Review filter.
 *
 * WHAT IT FETCHES is in ./repo-draft-source.js: two fixed hosts, no token, no
 * redirects, one deadline over headers and body, a byte cap. WHICH PATHS may
 * be asked for, and what a file becomes, is in ./repo-draft.js.
 *
 * WHAT IT WRITES. A new path goes through createContentDocument — the
 * createContentItem write path, the same one createContentFromRecording uses
 * — with `contentStatus: 'in_review'` and `Live: false`, so dedup, the quality
 * report and the document stamping are the existing ones. The id is derived
 * from the path (repoDraftContentId) and the write is create-only, so a
 * second import racing the first is refused, never duplicated, and the create
 * cannot overwrite anything. A new path whose title a published article
 * already carries is refused too (publishedWithTitle), because the dedup
 * gate's seven-day title window does not see the older hand-pasted posts the
 * directory also holds. A path already imported is found by `repoPath`:
 *   - in review → its file-owned fields are patched (buildRepoDraftRefresh),
 *     conditioned on the ETag of the read that decided it, so an approval or
 *     a publish landing in between turns the write into a refusal;
 *   - unchanged since the last import (same sha256) → nothing is written;
 *   - anything else — approved, editing, published, rejected, Live — is
 *     refused and nothing is written. Once a reviewer has moved it on, the
 *     article belongs to the site.
 * No write here can set `published`, `Live` or any publish field; the state
 * machine's transitions stay the only way forward.
 *
 * AUDIT. One `admin_audit_logs` row per path, for every outcome (a refused
 * overwrite of a published article is worth a row too), written after the
 * work and best-effort — as set-slug.js does — so a failed audit write cannot
 * turn a completed import into a 500 that invites a retry.
 *
 * VERSION HISTORY is not written. updateContentItem snapshots each save into
 * content_versions because the site is where those edits live; an imported
 * draft's history is the repository's, and `repoCommitSha` says which commit
 * the document holds.
 */
import { randomUUID } from 'node:crypto';
import { buildDedupFields } from './content-dedup.js';
import {
  REPO_NAME,
  REPO_OWNER,
  REPO_REF,
  buildRepoDraftData,
  buildRepoDraftRefresh,
  checkRepoDraftPath,
  parseRepoDraft,
  repoDraftContentId,
} from './repo-draft.js';

/** Paths per POST. docs/content holds eight articles today. */
export const MAX_IMPORT_PATHS = 10;
/** The only contentStatus an import writes, and the only one it will refresh. */
export const IMPORT_STATUS = 'in_review';
/** Outcomes that leave the draft In Review. */
export const LANDED_OUTCOMES = Object.freeze(['created', 'updated', 'unchanged']);

const REPO = Object.freeze({ owner: REPO_OWNER, name: REPO_NAME, ref: REPO_REF });

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const refusal = (code, error, extra = {}) => ({ outcome: 'refused', code, error, ...extra });

const editorOf = (user = {}) =>
  [user.email, user.preferred_username, user.oid, user.sub].find(Boolean) || 'admin';

/**
 * Validate `{ paths }`. The whole request is refused when any entry fails the
 * allow-list: an invalid path is a client bug, and refusing it before any
 * fetch means a traversal attempt costs nothing and reaches nothing.
 */
export function parseImportRequest(body) {
  const paths = body && typeof body === 'object' && !Array.isArray(body) ? body.paths : undefined;
  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: 'A JSON body { paths: [...] } with at least one path is required.' };
  }
  if (paths.length > MAX_IMPORT_PATHS) {
    return { ok: false, error: `At most ${MAX_IMPORT_PATHS} paths per import.` };
  }
  const invalid = paths
    .map((entry) => ({ entry, check: checkRepoDraftPath(entry) }))
    .filter(({ check }) => !check.ok)
    .map(({ entry, check }) => ({ path: String(entry), reason: check.reason }));
  if (invalid.length) return { ok: false, error: 'Some paths are not importable drafts.', invalid };
  return { ok: true, paths: [...new Set(paths)] };
}

/** What a landed draft reports back. */
function landed(outcome, { draft, contentId, commitSha }) {
  return {
    outcome,
    contentId,
    contentStatus: IMPORT_STATUS,
    title: draft.title,
    slug: draft.slug,
    provider: draft.provider,
    embeds: draft.embeds,
    warnings: draft.warnings,
    repoCommitSha: commitSha,
  };
}

/** The file, its commit, and what it parses to. */
async function readDraft(source, path) {
  const [fetched, commitSha] = await Promise.all([
    source.fetchDraft(path),
    source.lastCommitSha(path),
  ]);
  return { fetched, commitSha, parsed: parseRepoDraft(fetched.text) };
}

/** The refusal for an article past review, or null while it may be refreshed. */
function pastReview(current) {
  if (current.Live === true) {
    return refusal(
      'LIVE',
      'This article is live on the site. An import never overwrites a published article.',
      { contentId: current.id, contentStatus: current.contentStatus || null }
    );
  }
  const status = String(current.contentStatus || '');
  if (status === IMPORT_STATUS) return null;
  return refusal(
    'NOT_IN_REVIEW',
    `This article is "${status || 'unknown'}", past review. An import only refreshes an article that is still in review.`,
    { contentId: current.id, contentStatus: status || null }
  );
}

/**
 * The patch, conditioned on the read that decided "still in review": an
 * approval or a publish in between is a 412, and a refusal, not an overwrite.
 * Returns whether it was written.
 */
async function patchIfUnchanged(store, current, update) {
  try {
    await store.patchDoc('content', current.id, update, { ifMatch: current._etag });
    return true;
  } catch (error) {
    if (error?.code === 412 || error?.code === 404) return false;
    throw error;
  }
}

async function refreshDraft(deps, { path, current, user }) {
  const blocked = pastReview(current);
  if (blocked) return blocked;
  const { fetched, commitSha, parsed } = await readDraft(deps.source, path);
  if (!parsed.ok) return refusal(parsed.code, parsed.error, { contentId: current.id });
  const report = { draft: parsed.draft, contentId: current.id, commitSha };
  if (current.repoContentSha256 === fetched.contentSha256) {
    return landed('unchanged', { ...report, commitSha: current.repoCommitSha || commitSha });
  }
  const update = buildRepoDraftRefresh({
    path,
    draft: parsed.draft,
    source: { ...fetched, commitSha },
    editor: editorOf(user),
    current,
    now: deps.now,
  });
  const written = await patchIfUnchanged(deps.store, current, update);
  return written
    ? landed('updated', report)
    : refusal(
        'CHANGED_DURING_IMPORT',
        'The article changed while it was being imported; nothing was written. Reload and try again.',
        { contentId: current.id }
      );
}

/**
 * A published article already carrying this title, at any date. The dedup
 * gate createContentDocument runs matches a title only within seven days,
 * which is right for a news feed and wrong here: docs/content also holds the
 * posts that were pasted in by hand and published weeks ago, and the
 * candidate list offers them beside the new ones. Importing one of those must
 * not queue a second copy of a live article. Best-effort by nature — a
 * migrated document may carry no normalizedTitle — so it narrows the case
 * rather than closing it; the reviewer still sees the draft before anything
 * is published.
 */
async function publishedWithTitle(store, title) {
  const { normalizedTitle } = buildDedupFields({ title });
  if (!normalizedTitle) return null;
  const rows = await store.queryDocs(
    'content',
    'SELECT TOP 5 c.id, c.contentStatus, c.Live FROM c WHERE c.normalizedTitle = @title',
    [{ name: '@title', value: normalizedTitle }]
  );
  return rows.find((row) => row.Live === true || row.contentStatus === 'published') || null;
}

/**
 * createContentDocument writes with `store.upsertDoc`, which "can never
 * overwrite" there only because the id is a fresh random one. The import's id
 * is derived from the path, so its store maps that write to createDoc: the
 * same guarantee, held by the database instead of by randomness. A 409 from
 * it is reported as `{ status: 'exists' }`.
 */
async function persistCreateOnly(deps, { data, user, contentId }) {
  const store = {
    queryDocs: (...args) => deps.store.queryDocs(...args),
    upsertDoc: (container, doc) => deps.store.createDoc(container, doc),
  };
  try {
    return await deps.persist({
      store,
      user,
      data,
      // The critique is the reviewer's call, as it is for the forge and for
      // recordings; the article is finished prose, not a model's draft.
      runEditorialCritique: false,
      now: deps.now,
      uuid: () => contentId,
    });
  } catch (error) {
    if (error?.code === 409) return { status: 'exists' };
    throw error;
  }
}

/** createContentDocument's answer, as an import outcome. */
function persistOutcome(result, report) {
  if (result.status === 'exists') {
    return refusal(
      'ALREADY_EXISTS',
      "A document with this draft's id already exists (another import finished first). Nothing was written; reload the list.",
      { contentId: report.contentId }
    );
  }
  if (result.status === 409) {
    const reason = result.body?.duplicateReason || null;
    return refusal(
      'DUPLICATE',
      `An article like this already exists (${reason || 'duplicate'}). Nothing was written.`,
      {
        existingId: result.body?.existingId || null,
        duplicateReason: reason,
      }
    );
  }
  if (result.status !== 200) {
    return refusal(
      'NOT_CREATED',
      result.body?.error || `The content write answered ${result.status}.`
    );
  }
  return landed('created', { ...report, contentId: result.body.contentId });
}

async function createDraft(deps, { path, user }) {
  const { fetched, commitSha, parsed } = await readDraft(deps.source, path);
  if (!parsed.ok) return refusal(parsed.code, parsed.error);
  const { draft } = parsed;
  const live = await publishedWithTitle(deps.store, draft.title);
  if (live) {
    return refusal(
      'PUBLISHED_ELSEWHERE',
      `An article titled "${draft.title}" is already published (${live.id}). Nothing was written.`,
      { existingId: live.id, title: draft.title }
    );
  }
  const contentId = repoDraftContentId(path);
  const data = buildRepoDraftData({
    path,
    draft,
    source: { ...fetched, commitSha },
    editor: editorOf(user),
    now: deps.now,
  });
  // The invariant the owner asked for, checked where the write happens rather
  // than trusted from the builder.
  if (data.contentStatus !== IMPORT_STATUS || data.Live !== false) {
    throw new Error(
      'repo-import: refusing to create a document that is not in_review and not Live'
    );
  }
  const result = await persistCreateOnly(deps, { data, user, contentId });
  return persistOutcome(result, { draft, contentId, commitSha });
}

/** A coded error is the source's and says what happened; anything else is ours. */
function failure(deps, path, error) {
  if (typeof error?.code === 'string')
    return { outcome: 'failed', code: error.code, error: error.message };
  deps.log.error?.(`[repo-import] ${path}: ${error?.message || error}`);
  return {
    outcome: 'failed',
    code: 'INTERNAL',
    error: 'The import failed unexpectedly; see the function logs.',
  };
}

async function importOne(deps, path, user) {
  try {
    const matches = await deps.store.queryDocs(
      'content',
      'SELECT c.id FROM c WHERE c.repoPath = @repoPath',
      [{ name: '@repoPath', value: path }]
    );
    if (matches.length > 1) {
      return refusal(
        'AMBIGUOUS',
        `${matches.length} documents claim this path; resolve that by hand before importing again.`,
        { contentIds: matches.map((row) => row.id) }
      );
    }
    const current = matches.length
      ? await deps.store.readDoc('content', matches[0].id, matches[0].id)
      : null;
    return current
      ? await refreshDraft(deps, { path, current, user })
      : await createDraft(deps, { path, user });
  } catch (error) {
    return failure(deps, path, error);
  }
}

async function auditImport(deps, result, { user, request }) {
  try {
    await deps.store.upsertDoc('admin_audit_logs', {
      id: deps.uuid(),
      action: 'content_repo_import',
      userId: user.oid || user.sub || null,
      userEmail: user.email || null,
      timestamp: deps.now().toISOString(),
      contentId: result.contentId || null,
      contentTitle: result.title || '',
      details: {
        repoPath: result.path,
        repoRef: REPO_REF,
        repoCommitSha: result.repoCommitSha || null,
        outcome: result.outcome,
        ...(result.code && { code: result.code }),
        ...(result.contentStatus !== undefined && { contentStatus: result.contentStatus }),
      },
      userAgent: request.headers?.get?.('user-agent') || null,
      compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
    });
  } catch (error) {
    deps.log.error?.('[repo-import] audit row failed', error);
  }
}

function tally(results) {
  const counts = {};
  for (const { outcome } of results) counts[outcome] = (counts[outcome] || 0) + 1;
  return counts;
}

/** One file of the listing, with what it already is on the site. */
function candidateView(file, claims = []) {
  const [doc] = claims;
  const imported = doc
    ? {
        contentId: doc.id,
        contentStatus: doc.contentStatus || null,
        live: doc.Live === true,
        repoCommitSha: doc.repoCommitSha || null,
        importedAt: doc.repoRefreshedAt || doc.repoImportedAt || null,
      }
    : null;
  const refreshable =
    claims.length === 1 && !imported.live && imported.contentStatus === IMPORT_STATUS;
  return {
    ...file,
    imported,
    importable: claims.length === 0 || refreshable,
    ...(claims.length > 1 && { ambiguous: true }),
  };
}

async function claimsByPath(store, paths) {
  const byPath = new Map();
  if (paths.length === 0) return byPath;
  const rows = await store.queryDocs(
    'content',
    'SELECT c.id, c.repoPath, c.contentStatus, c.Live, c.repoCommitSha, c.repoImportedAt, c.repoRefreshedAt FROM c WHERE ARRAY_CONTAINS(@paths, c.repoPath)',
    [{ name: '@paths', value: paths }]
  );
  for (const row of rows) byPath.set(row.repoPath, [...(byPath.get(row.repoPath) || []), row]);
  return byPath;
}

/** Upstream failures the candidate list maps to a status; anything else is a 502. */
const STATUS_BY_UPSTREAM_CODE = Object.freeze({ RATE_LIMITED: 503, TIMEOUT: 504 });

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, patchDoc: Function, upsertDoc: Function, createDoc: Function }} deps.store
 *   `createDoc` is create-only (409 when the id exists); `upsertDoc` writes the audit rows.
 * @param {ReturnType<import('./repo-draft-source.js').createRepoDraftSource>} deps.source
 * @param {Function} deps.persist createContentDocument (lib/cms/content-create.js)
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid] audit row ids
 * @param {{ log?: Function, warn?: Function, error?: Function }} [deps.log]
 */
export function createRepoImportHandlers({
  guard,
  now = () => new Date(),
  uuid = randomUUID,
  log = {},
  ...rest
}) {
  if (typeof rest.persist !== 'function') {
    throw new Error('createRepoImportHandlers requires persist (createContentDocument)');
  }
  const deps = { ...rest, now, uuid, log };

  return {
    /** POST /api/cms/content/import-repo — editor. */
    async importDrafts(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const parsed = parseImportRequest(await request.json().catch(() => null));
      if (!parsed.ok) return json(400, { ok: false, ...parsed });
      try {
        const results = await Promise.all(
          parsed.paths.map(async (path) => ({ path, ...(await importOne(deps, path, auth.user)) }))
        );
        await Promise.all(
          results.map((result) => auditImport(deps, result, { user: auth.user, request }))
        );
        const counts = tally(results);
        context?.log?.(`[repo-import] ${JSON.stringify(counts)}`);
        return json(200, { ok: true, repo: REPO, results, counts });
      } catch (error) {
        context?.error?.('importRepoDrafts failed:', error);
        return json(500, {
          ok: false,
          error: 'Failed to import drafts',
          message: error?.message || 'Unknown error',
        });
      }
    },

    /** GET /api/cms/content/import-repo/candidates — editor. */
    async listCandidates(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const files = await deps.source.listCandidates();
        const claims = await claimsByPath(
          deps.store,
          files.map((file) => file.path)
        );
        const candidates = files.map((file) => candidateView(file, claims.get(file.path)));
        return json(200, { ok: true, repo: REPO, candidates });
      } catch (error) {
        const upstream = typeof error?.code === 'string';
        const status = upstream ? STATUS_BY_UPSTREAM_CODE[error.code] || 502 : 500;
        context?.warn?.(`[repo-import] candidates ${status} ${error?.code || 'ERROR'}`);
        return json(status, {
          ok: false,
          code: upstream ? error.code : 'INTERNAL',
          error: upstream
            ? `Could not list the drafts on GitHub: ${error.message}`
            : 'Failed to list import candidates',
        });
      }
    },
  };
}
