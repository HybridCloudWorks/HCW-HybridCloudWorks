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
 * WHAT IT FETCHES, AND FROM WHERE. Two hosts, fixed here and nowhere else:
 * `raw.githubusercontent.com` for the file at
 * `HybridCloudWorks/HCW-HybridCloudWorks/main/<path>`, and `api.github.com`
 * under `repos/HybridCloudWorks/HCW-HybridCloudWorks/` for the directory
 * listing and the last commit to touch the file. The repository is public, so
 * no token is sent. Every URL is built from constants and a path that passed
 * checkRepoDraftPath (repo-draft.js), and then checked again against the two
 * prefixes before the request, so the caller controls which allow-listed file
 * is read and never which host or repository. `redirect: 'error'` means a 3xx
 * fails rather than following to wherever it points; a response that reports
 * a different URL anyway is refused. Each request has one deadline covering
 * the headers AND the body, and the body is read against a byte cap as it
 * streams. That is why this does not use lib/http/fetch-with-timeout.js: that
 * helper clears its timer when the headers arrive, so a body that trickles
 * would be bounded only by the runtime's own five-minute body timeout.
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
  API_ORIGIN,
  API_PATH_PREFIX,
  RAW_ORIGIN,
  RAW_PATH_PREFIX,
  REPO_DRAFT_DIR,
  REPO_NAME,
  REPO_OWNER,
  REPO_REF,
  buildRepoDraftData,
  buildRepoDraftRefresh,
  checkRepoDraftPath,
  parseRepoDraft,
  rawUrlFor,
  repoDraftContentId,
  sha256Hex,
} from './repo-draft.js';

/** Per request, headers and body together. GitHub answers these in well under a second. */
export const GITHUB_FETCH_TIMEOUT_MS = 8000;
/** The three lab drafts are 14-18 KB. */
export const MAX_DRAFT_BYTES = 256 * 1024;
/** A directory listing or a one-row commit list. */
export const MAX_API_BYTES = 512 * 1024;
/** Paths per POST. docs/content holds eight articles today. */
export const MAX_IMPORT_PATHS = 10;
/** The only contentStatus an import writes, and the only one it will refresh. */
export const IMPORT_STATUS = 'in_review';

const USER_AGENT = 'HybridCloudWorks-CMS-repo-import';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function coded(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

/**
 * Is this URL one of the two the import may fetch? Exported for the test that
 * pins it. Parsed, not prefix-matched as a string, so `https://api.github.com.evil.test/`
 * and `https://raw.githubusercontent.com@evil.test/` are not mistaken for them.
 */
export function isPinnedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.port) return false;
  if (url.origin === RAW_ORIGIN) return url.pathname.startsWith(RAW_PATH_PREFIX);
  if (url.origin === API_ORIGIN) return url.pathname.startsWith(API_PATH_PREFIX);
  return false;
}

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw coded('TOO_LARGE', `The response declares ${declared} bytes (at most ${maxBytes}).`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw coded('TOO_LARGE', `The response is ${buffer.length} bytes (at most ${maxBytes}).`);
    }
    return buffer;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw coded('TOO_LARGE', `The response is over ${maxBytes} bytes.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** GitHub's unauthenticated limit is 60 an hour per address; say when it resets. */
function upstreamError(response, url) {
  const remaining = response.headers?.get?.('x-ratelimit-remaining');
  if ((response.status === 403 || response.status === 429) && remaining === '0') {
    const reset = Number(response.headers?.get?.('x-ratelimit-reset'));
    const at = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null;
    return coded(
      'RATE_LIMITED',
      `GitHub's unauthenticated rate limit is used up${at ? `; it resets at ${at}` : ''}.`,
      { resetAt: at }
    );
  }
  if (response.status === 404) {
    return coded('NOT_FOUND', `${new URL(url).pathname} was not found on ${REPO_REF}.`);
  }
  return coded('UPSTREAM_STATUS', `GitHub answered HTTP ${response.status}.`, {
    upstreamStatus: response.status,
  });
}

/**
 * The GitHub side: list, fetch, and look up the commit. Injected into the
 * handlers so the tests can pin every URL it is asked for.
 *
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [deps]
 */
export function createRepoDraftSource({
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = GITHUB_FETCH_TIMEOUT_MS,
} = {}) {
  async function get(url, { accept, maxBytes }) {
    if (!isPinnedUrl(url)) throw coded('HOST_NOT_ALLOWED', 'Refusing to fetch outside the repository.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: accept,
          'User-Agent': USER_AGENT,
          ...(accept.includes('github') && { 'X-GitHub-Api-Version': '2022-11-28' }),
        },
      });
      // Belt and braces for a fetch that does not honour `redirect: 'error'`.
      if (response.status >= 300 && response.status < 400) {
        throw coded('REDIRECTED', `GitHub answered HTTP ${response.status}; redirects are not followed.`);
      }
      // Compared parsed, so a runtime that re-serialises the URL it was given
      // is not mistaken for one that went somewhere else.
      if (response.url && new URL(response.url).href !== new URL(url).href) {
        throw coded('REDIRECTED', 'The response came from a different URL; refusing it.');
      }
      if (!response.ok) throw upstreamError(response, url);
      return await readCapped(response, maxBytes);
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        throw coded('TIMEOUT', `GitHub did not answer within ${timeoutMs} ms.`);
      }
      if (typeof error?.code === 'string') throw error;
      // undici rejects `redirect: 'error'` as TypeError('fetch failed') with
      // the reason on `cause`; name it, or a moved file reads as an outage.
      if (/redirect/i.test(String(error?.cause?.message || ''))) {
        throw coded('REDIRECTED', 'GitHub answered with a redirect; redirects are not followed.');
      }
      throw coded('FETCH_FAILED', `Could not reach GitHub: ${error?.message || error}`);
    } finally {
      clearTimeout(timer);
    }
  }

  const apiJson = async (path) => {
    const bytes = await get(`${API_ORIGIN}${API_PATH_PREFIX}${path}`, {
      accept: 'application/vnd.github+json',
      maxBytes: MAX_API_BYTES,
    });
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      throw coded('UPSTREAM_SHAPE', 'GitHub answered with something that is not JSON.');
    }
  };

  return {
    /** Every importable file in docs/content on main: path, name, size, blob sha. */
    async listCandidates() {
      const rows = await apiJson(`contents/${REPO_DRAFT_DIR}?ref=${REPO_REF}`);
      if (!Array.isArray(rows)) throw coded('UPSTREAM_SHAPE', 'The directory listing is not a list.');
      return rows
        .filter((row) => row?.type === 'file' && checkRepoDraftPath(row.path).ok)
        .map((row) => ({
          path: row.path,
          name: String(row.name || row.path.split('/').at(-1)),
          size: Number(row.size) || 0,
          blobSha: typeof row.sha === 'string' ? row.sha : null,
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
    },

    /** The file's text, where it came from, and its sha256. Throws a coded error. */
    async fetchDraft(path) {
      const rawUrl = rawUrlFor(path);
      const bytes = await get(rawUrl, { accept: 'text/plain', maxBytes: MAX_DRAFT_BYTES });
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw coded('NOT_UTF8', 'The file is not UTF-8 text.');
      }
      return { text, rawUrl, contentSha256: sha256Hex(bytes) };
    },

    /**
     * The sha of the last commit on main to touch the file, or null. Never
     * throws: the commit is provenance, and a rate-limited lookup must not
     * stop a draft reaching review — the document records `repoRef: 'main'`
     * either way.
     */
    async lastCommitSha(path) {
      try {
        const rows = await apiJson(
          `commits?path=${encodeURIComponent(path)}&sha=${REPO_REF}&per_page=1`
        );
        const sha = Array.isArray(rows) ? rows[0]?.sha : null;
        return typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
      } catch {
        return null;
      }
    },
  };
}

/** Where the handlers expect GitHub-side failures to map. */
const STATUS_BY_UPSTREAM_CODE = Object.freeze({ RATE_LIMITED: 503, TIMEOUT: 504 });

/**
 * Validate `{ paths }`. The whole request is refused when any entry fails the
 * allow-list: an invalid path is a client bug, and refusing it before any
 * fetch means a traversal attempt costs nothing and reaches nothing.
 */
export function parseImportRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'A JSON body { paths: [...] } is required.' };
  }
  const { paths } = body;
  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: 'paths must be a non-empty array.' };
  }
  if (paths.length > MAX_IMPORT_PATHS) {
    return { ok: false, error: `At most ${MAX_IMPORT_PATHS} paths per import.` };
  }
  const invalid = [];
  for (const entry of paths) {
    const check = checkRepoDraftPath(entry);
    if (!check.ok) invalid.push({ path: typeof entry === 'string' ? entry : String(entry), reason: check.reason });
  }
  if (invalid.length) {
    return { ok: false, error: 'Some paths are not importable drafts.', invalid };
  }
  return { ok: true, paths: [...new Set(paths)] };
}

const editorOf = (user = {}) =>
  user.email || user.preferred_username || user.oid || user.sub || 'admin';

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, patchDoc: Function, upsertDoc: Function, createDoc: Function }} deps.store
 *   `createDoc` is create-only (409 when the id exists); `upsertDoc` writes the audit rows.
 * @param {ReturnType<typeof createRepoDraftSource>} deps.source
 * @param {Function} deps.persist createContentDocument (lib/cms/content-create.js)
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid] audit row ids
 * @param {{ log?: Function, warn?: Function, error?: Function }} [deps.log]
 */
export function createRepoImportHandlers({
  guard,
  store,
  source,
  persist,
  now = () => new Date(),
  uuid = randomUUID,
  log = {},
}) {
  if (typeof persist !== 'function') {
    throw new Error('createRepoImportHandlers requires persist (createContentDocument)');
  }

  /** Content documents claiming a repository path. */
  const findByRepoPath = (path) =>
    store.queryDocs('content', 'SELECT c.id FROM c WHERE c.repoPath = @repoPath', [
      { name: '@repoPath', value: path },
    ]);

  /**
   * createContentDocument writes with `store.upsertDoc`, which "can never
   * overwrite" there only because the id is a fresh random one. The import's
   * id is derived from the path, so its store maps that write to createDoc:
   * the same guarantee, held by the database instead of by randomness.
   */
  const createOnlyStore = {
    queryDocs: (...args) => store.queryDocs(...args),
    upsertDoc: (container, doc) => store.createDoc(container, doc),
  };

  async function refresh({ path, current, user }) {
    const status = String(current.contentStatus || '');
    if (current.Live === true || status !== IMPORT_STATUS) {
      return {
        outcome: 'refused',
        code: current.Live === true ? 'LIVE' : 'NOT_IN_REVIEW',
        contentId: current.id,
        contentStatus: status || null,
        error:
          current.Live === true
            ? 'This article is live on the site. An import never overwrites a published article.'
            : `This article is "${status || 'unknown'}", past review. An import only refreshes an article that is still in review.`,
      };
    }
    const [fetched, commitSha] = await Promise.all([
      source.fetchDraft(path),
      source.lastCommitSha(path),
    ]);
    const parsed = parseRepoDraft(fetched.text);
    if (!parsed.ok) return { outcome: 'refused', code: parsed.code, error: parsed.error, contentId: current.id };
    const summary = summarize(parsed.draft, current.id, IMPORT_STATUS);
    if (current.repoContentSha256 === fetched.contentSha256) {
      return { outcome: 'unchanged', ...summary, repoCommitSha: current.repoCommitSha || commitSha };
    }
    const update = buildRepoDraftRefresh({
      path,
      draft: parsed.draft,
      source: { ...fetched, commitSha },
      editor: editorOf(user),
      current,
      now,
    });
    try {
      // Conditioned on the read that decided "still in review": an approval or
      // a publish in between is a 412 here, not an overwrite.
      await store.patchDoc('content', current.id, update, { ifMatch: current._etag });
    } catch (error) {
      if (error?.code === 412 || error?.code === 404) {
        return {
          outcome: 'refused',
          code: 'CHANGED_DURING_IMPORT',
          contentId: current.id,
          error: 'The article changed while it was being imported; nothing was written. Reload and try again.',
        };
      }
      throw error;
    }
    return { outcome: 'updated', ...summary, repoCommitSha: commitSha };
  }

  /**
   * A published article already carrying this title, at any date. The dedup
   * gate createContentDocument runs matches a title only within seven days,
   * which is right for a news feed and wrong here: docs/content also holds
   * the posts that were pasted in by hand and published weeks ago, and the
   * candidate list offers them beside the new ones. Importing one of those
   * must not queue a second copy of a live article. Best-effort by nature — a
   * migrated document may carry no normalizedTitle — so it narrows the case
   * rather than closing it; the reviewer still sees the draft before anything
   * is published.
   */
  async function publishedWithTitle(title) {
    const { normalizedTitle } = buildDedupFields({ title });
    if (!normalizedTitle) return null;
    const rows = await store.queryDocs(
      'content',
      'SELECT TOP 5 c.id, c.contentStatus, c.Live FROM c WHERE c.normalizedTitle = @title',
      [{ name: '@title', value: normalizedTitle }]
    );
    return rows.find((row) => row.Live === true || row.contentStatus === 'published') || null;
  }

  async function create({ path, user }) {
    const [fetched, commitSha] = await Promise.all([
      source.fetchDraft(path),
      source.lastCommitSha(path),
    ]);
    const parsed = parseRepoDraft(fetched.text);
    if (!parsed.ok) return { outcome: 'refused', code: parsed.code, error: parsed.error };
    const live = await publishedWithTitle(parsed.draft.title);
    if (live) {
      return {
        outcome: 'refused',
        code: 'PUBLISHED_ELSEWHERE',
        existingId: live.id,
        title: parsed.draft.title,
        error: `An article titled "${parsed.draft.title}" is already published (${live.id}). Nothing was written.`,
      };
    }
    const contentId = repoDraftContentId(path);
    const data = buildRepoDraftData({
      path,
      draft: parsed.draft,
      source: { ...fetched, commitSha },
      editor: editorOf(user),
      now,
    });
    // The invariant the owner asked for, checked where the write happens
    // rather than trusted from the builder.
    if (data.contentStatus !== IMPORT_STATUS || data.Live !== false) {
      throw new Error('repo-import: refusing to create a document that is not in_review and not Live');
    }
    let result;
    try {
      result = await persist({
        store: createOnlyStore,
        user,
        data,
        // The critique is the reviewer's call, as it is for the forge and for
        // recordings; the article is finished prose, not a model's draft.
        runEditorialCritique: false,
        now,
        uuid: () => contentId,
      });
    } catch (error) {
      if (error?.code === 409) {
        return {
          outcome: 'refused',
          code: 'ALREADY_EXISTS',
          contentId,
          error: 'A document with this draft\'s id already exists (another import finished first). Nothing was written; reload the list.',
        };
      }
      throw error;
    }
    if (result.status === 409) {
      return {
        outcome: 'refused',
        code: 'DUPLICATE',
        existingId: result.body?.existingId || null,
        duplicateReason: result.body?.duplicateReason || null,
        error: `An article like this already exists (${result.body?.duplicateReason || 'duplicate'}). Nothing was written.`,
      };
    }
    if (result.status !== 200) {
      return {
        outcome: 'refused',
        code: 'NOT_CREATED',
        error: result.body?.error || `The content write answered ${result.status}.`,
      };
    }
    return {
      outcome: 'created',
      ...summarize(parsed.draft, result.body.contentId, IMPORT_STATUS),
      repoCommitSha: commitSha,
    };
  }

  function summarize(draft, contentId, contentStatus) {
    return {
      contentId,
      contentStatus,
      title: draft.title,
      slug: draft.slug,
      provider: draft.provider,
      embeds: draft.embeds,
      warnings: draft.warnings,
    };
  }

  async function importOne(path, user) {
    try {
      const matches = await findByRepoPath(path);
      if (matches.length > 1) {
        return {
          outcome: 'refused',
          code: 'AMBIGUOUS',
          contentIds: matches.map((row) => row.id),
          error: `${matches.length} documents claim this path; resolve that by hand before importing again.`,
        };
      }
      const current = matches.length ? await store.readDoc('content', matches[0].id, matches[0].id) : null;
      return current ? await refresh({ path, current, user }) : await create({ path, user });
    } catch (error) {
      if (error?.code && typeof error.code === 'string') {
        return { outcome: 'failed', code: error.code, error: error.message };
      }
      log.error?.(`[repo-import] ${path}: ${error?.message || error}`);
      return { outcome: 'failed', code: 'INTERNAL', error: 'The import failed unexpectedly; see the function logs.' };
    }
  }

  async function audit(result, { user, request }) {
    try {
      await store.upsertDoc('admin_audit_logs', {
        id: uuid(),
        action: 'content_repo_import',
        userId: user.oid || user.sub || null,
        userEmail: user.email || null,
        timestamp: now().toISOString(),
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
      log.error?.('[repo-import] audit row failed', error);
    }
  }

  return {
    /** POST /api/cms/content/import-repo — editor. */
    async importDrafts(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      const body = await request.json().catch(() => null);
      const parsed = parseImportRequest(body);
      if (!parsed.ok) {
        return json(400, { ok: false, error: parsed.error, ...(parsed.invalid && { invalid: parsed.invalid }) });
      }

      try {
        const results = await Promise.all(
          parsed.paths.map(async (path) => ({ path, ...(await importOne(path, user)) }))
        );
        await Promise.all(results.map((result) => audit(result, { user, request })));
        const counts = results.reduce((acc, result) => {
          acc[result.outcome] = (acc[result.outcome] || 0) + 1;
          return acc;
        }, {});
        context?.log?.(`[repo-import] ${JSON.stringify(counts)}`);
        return json(200, { ok: true, repo: { owner: REPO_OWNER, name: REPO_NAME, ref: REPO_REF }, results, counts });
      } catch (error) {
        context?.error?.('importRepoDrafts failed:', error);
        return json(500, { ok: false, error: 'Failed to import drafts', message: error?.message || 'Unknown error' });
      }
    },

    /** GET /api/cms/content/import-repo/candidates — editor. */
    async listCandidates(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      let files;
      try {
        files = await source.listCandidates();
      } catch (error) {
        const status = STATUS_BY_UPSTREAM_CODE[error?.code] || 502;
        context?.warn?.(`[repo-import] candidates ${status} ${error?.code || 'ERROR'}`);
        return json(status, {
          ok: false,
          code: error?.code || 'FETCH_FAILED',
          error: `Could not list the drafts on GitHub: ${error?.message || error}`,
        });
      }

      try {
        const paths = files.map((file) => file.path);
        const rows = paths.length
          ? await store.queryDocs(
              'content',
              'SELECT c.id, c.repoPath, c.contentStatus, c.Live, c.repoCommitSha, c.repoImportedAt, c.repoRefreshedAt FROM c WHERE ARRAY_CONTAINS(@paths, c.repoPath)',
              [{ name: '@paths', value: paths }]
            )
          : [];
        const byPath = new Map();
        for (const row of rows) {
          if (!byPath.has(row.repoPath)) byPath.set(row.repoPath, []);
          byPath.get(row.repoPath).push(row);
        }
        const candidates = files.map((file) => {
          const claims = byPath.get(file.path) || [];
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
          const importable =
            claims.length === 0 ||
            (claims.length === 1 && imported.contentStatus === IMPORT_STATUS && !imported.live);
          return { ...file, imported, importable, ...(claims.length > 1 && { ambiguous: true }) };
        });
        return json(200, {
          ok: true,
          repo: { owner: REPO_OWNER, name: REPO_NAME, ref: REPO_REF },
          candidates,
        });
      } catch (error) {
        context?.error?.('listRepoDraftCandidates failed:', error);
        return json(500, { ok: false, error: 'Failed to list import candidates' });
      }
    },
  };
}
