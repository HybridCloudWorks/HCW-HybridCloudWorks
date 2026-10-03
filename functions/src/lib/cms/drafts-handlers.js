/**
 * drafts-handlers.js — the routes behind /admin/drafts (owner request
 * 2026-10-03). What a draft is and which moves are allowed is ./drafts.js;
 * this is the store, the GitHub import and the HTTP shape.
 *
 *   GET    cms/drafts                       the list (no bodies)
 *   POST   cms/drafts                       a new draft { fields }
 *   GET    cms/drafts/{id}                  one draft, with its body
 *   PUT    cms/drafts/{id}                  save { fields, etag }
 *   DELETE cms/drafts/{id}                  delete { etag }
 *   POST   cms/drafts/{id}/send-to-review   drafting → in_review { etag }
 *   POST   cms/drafts/{id}/back-to-drafts   in_review → drafting { etag }
 *   POST   cms/drafts/import-repo           docs/content → Drafts, once
 *
 * Every route is behind requireRole at editor, the role that creates and
 * reviews content everywhere else (createContentItem, transitionContentStatus,
 * the repository import before this).
 *
 * TWO TABS CANNOT OVERWRITE EACH OTHER. Every write that changes an existing
 * draft — save, delete, both transitions — carries the `etag` of the version
 * the page is showing, is refused before any write when the stored version is
 * already newer, and is written conditioned on that etag (patchDoc's ifMatch,
 * deleteDocIfMatch) so a write landing in between turns into a refusal rather
 * than an overwrite. The refusal is a 412 with `code: 'CONFLICT'` and the
 * current version's summary, which the page uses to offer a reload. Same rule
 * the repository import followed for its in-review refresh.
 *
 * THE IMPORT IS ONCE PER FILE. It lists docs/content on main through the
 * existing pinned source (repo-draft-source.js: two hosts, no token, no
 * redirects, a deadline and a byte cap), skips every path a document already
 * claims (`repoPath`) before fetching anything, and creates the rest
 * create-only under the id derived from the path (repoDraftContentId), so a
 * double click or a second run never duplicates: the database refuses the
 * second create. A file whose title a published article already carries is
 * skipped, as the original import refused it. Nothing here reads a file back
 * over a draft: after import, the Drafts page is the article's source of
 * truth and docs/content is an archive.
 *
 * AUDIT. One row per action, written after the work and best-effort (as
 * set-slug.js and the original import did), so a failed audit write cannot
 * turn a completed save into a 500 that invites a retry. The transitions also
 * write the `audits` status_transition row transitionContentStatus writes.
 */
import { randomUUID } from 'node:crypto';
import { buildDedupFields } from './content-dedup.js';
import {
  REPO_NAME,
  REPO_OWNER,
  REPO_REF,
  buildRepoDraftData,
  parseRepoDraft,
  repoDraftContentId,
} from './repo-draft.js';
import {
  DRAFTS_STAGE_STATUS,
  DraftInputError,
  REVIEW_STATUS,
  asImportedDraft,
  backToDraftsRefusal,
  buildBackToDraftsPatch,
  buildDraftUpdate,
  buildNewDraftDocument,
  buildSendToReviewPatch,
  comesFromDrafts,
  deleteRefusal,
  saveRefusal,
  sendToReviewRefusal,
  stageOf,
  toDraftSummary,
  toDraftView,
  validateDraftFields,
} from './drafts.js';

/** Rows the list returns. The Drafts stage is one person's desk; this is generous. */
export const MAX_LISTED_DRAFTS = 200;
/** Content ids are UUIDs; migrated ones are Firestore ids. Neither has anything else. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const REPO = Object.freeze({ owner: REPO_OWNER, name: REPO_NAME, ref: REPO_REF });

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const refused = ({ status, code, error }, extra = {}) =>
  json(status, { ok: false, code, error, ...extra });

const editorOf = (user = {}) =>
  [user.email, user.preferred_username, user.oid, user.sub].find(Boolean) || 'admin';

const LIST_PROJECTION = [
  'c.id',
  'c.Title',
  'c.title',
  'c.Summary',
  'c.summary',
  'c.contentStatus',
  'c.Live',
  'c.draftOrigin',
  'c.repoPath',
  'c.updatedAt',
  'c["Created At"]',
  'c._etag',
].join(', ');

/**
 * Every document the page shows: the drafts, and anything that came from
 * Drafts (written or imported here, or put In Review by the original import —
 * `repoPath`). Bounded, projected, no bodies.
 */
export const LIST_QUERY =
  `SELECT TOP ${MAX_LISTED_DRAFTS} ${LIST_PROJECTION} FROM c ` +
  'WHERE c.contentStatus = @drafting OR IS_DEFINED(c.draftOrigin) OR IS_DEFINED(c.repoPath)';

const NOT_FOUND = { status: 404, code: 'NOT_FOUND', error: 'No such draft.' };
const CONFLICT_MESSAGE =
  'This draft changed in another tab or on another device since you opened it. Nothing was saved; reload it to see the latest version.';

async function readBody(request) {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

function readId(request) {
  const id = String(request.params?.id || '');
  return ID_PATTERN.test(id) ? id : null;
}

function readEtag(body) {
  return typeof body.etag === 'string' && body.etag.length > 0 && body.etag.length <= 200
    ? body.etag
    : null;
}

const ETAG_REQUIRED = {
  status: 400,
  code: 'ETAG_REQUIRED',
  error: 'etag is required: send the etag of the version you are looking at (reload the draft).',
};

/**
 * A published article already carrying this title, at any date, other than
 * this document. Carried over from the original import (repo-import.js,
 * retired with this page): the dedup gate's seven-day title window does not
 * see the older hand-pasted posts docs/content also holds, and importing or
 * sending one of those must not queue a second copy of a live article.
 */
export async function publishedWithTitle(store, title, selfId = null) {
  const { normalizedTitle } = buildDedupFields({ title });
  if (!normalizedTitle) return null;
  const rows = await store.queryDocs(
    'content',
    'SELECT TOP 5 c.id, c.contentStatus, c.Live FROM c WHERE c.normalizedTitle = @title',
    [{ name: '@title', value: normalizedTitle }]
  );
  return (
    rows.find(
      (row) => row.id !== selfId && (row.Live === true || row.contentStatus === 'published')
    ) || null
  );
}

async function claimsByPath(store, paths) {
  const byPath = new Map();
  if (paths.length === 0) return byPath;
  const rows = await store.queryDocs(
    'content',
    'SELECT c.id, c.repoPath, c.contentStatus, c.Live, c.Title, c.title FROM c WHERE ARRAY_CONTAINS(@paths, c.repoPath)',
    [{ name: '@paths', value: paths }]
  );
  for (const row of rows) byPath.set(row.repoPath, [...(byPath.get(row.repoPath) || []), row]);
  return byPath;
}

/** Upstream failures the import maps to a status; anything else from GitHub is a 502. */
const STATUS_BY_UPSTREAM_CODE = Object.freeze({ RATE_LIMITED: 503, TIMEOUT: 504 });

const isPreconditionFailure = (error) => error?.code === 412 || error?.code === 404;

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, createDoc: Function, patchDoc: Function,
 *   deleteDocIfMatch: Function, upsertDoc: Function }} deps.store
 *   `createDoc` is create-only (409 when the id exists); `upsertDoc` writes audit rows only.
 * @param {ReturnType<import('./repo-draft-source.js').createRepoDraftSource>} deps.source
 * @param {(contentId: string) => Promise<unknown>} [deps.onContentDeleted] dashboard counters
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 * @param {{ error?: Function }} [deps.log]
 */
export function createDraftsHandlers({
  guard,
  store,
  source,
  onContentDeleted = null,
  now = () => new Date(),
  uuid = randomUUID,
  log = {},
}) {
  const authorize = (request) => guard.requireRole(request, 'editor');

  async function audit(action, { user, request, contentId = null, title = '', details = {} }) {
    try {
      await store.upsertDoc('admin_audit_logs', {
        id: uuid(),
        action,
        userId: user.oid || user.sub || null,
        userEmail: user.email || null,
        timestamp: now().toISOString(),
        contentId,
        contentTitle: title,
        details,
        userAgent: request.headers?.get?.('user-agent') || null,
        compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
      });
    } catch (error) {
      log.error?.(`[drafts] audit row ${action} failed`, error);
    }
  }

  /** The status_transition row createContentStatusTransitioner writes, for the same history. */
  async function auditTransition({ user, request, doc, from, to }) {
    try {
      await store.upsertDoc('audits', {
        id: uuid(),
        timestamp: now().toISOString(),
        action: 'status_transition',
        resourceType: 'content',
        resourceId: doc.id,
        resourceTitle: doc.Title || doc.title || '',
        userId: user.oid || user.sub || editorOf(user),
        userName: user.name || null,
        userEmail: user.email || null,
        changes: {
          before: { contentStatus: from },
          after: { contentStatus: to },
          changedFields: ['contentStatus'],
          notes: '',
        },
        ipAddress: null,
        userAgent: request.headers?.get?.('user-agent') || null,
        metadata: { authMethod: 'entra_bearer_token', reviewedBy: editorOf(user), via: 'drafts' },
        compliance: { dataClassification: 'internal', retentionMonths: 24, identityVerified: true },
      });
    } catch (error) {
      log.error?.('[drafts] audits row failed', error);
    }
  }

  /** The 412 a lost race answers, with what is stored now (or 404 if it is gone). */
  async function conflict(id) {
    const latest = await store.readDoc('content', id, id).catch(() => null);
    if (!latest) return refused({ ...NOT_FOUND, error: 'This draft no longer exists.' });
    return refused(
      { status: 412, code: 'CONFLICT', error: CONFLICT_MESSAGE },
      { current: toDraftSummary(latest) }
    );
  }

  /**
   * The shared front half of every write to an existing draft: the id, the
   * etag, the document, that it belongs to this page, and that the page is
   * looking at the version that is stored.
   */
  async function loadForWrite(request) {
    const id = readId(request);
    if (!id)
      return {
        response: refused({
          ...NOT_FOUND,
          status: 400,
          code: 'BAD_ID',
          error: 'A draft id is required.',
        }),
      };
    const body = await readBody(request);
    const etag = readEtag(body);
    if (!etag) return { response: refused(ETAG_REQUIRED) };
    const current = await store.readDoc('content', id, id);
    if (!current || !comesFromDrafts(current)) return { response: refused(NOT_FOUND) };
    if (current._etag !== etag) return { response: await conflict(id) };
    return { id, body, etag, current };
  }

  /** patchDoc under the etag; null when the race was lost. */
  async function patchIfUnchanged(id, update, etag) {
    try {
      return await store.patchDoc('content', id, update, { ifMatch: etag });
    } catch (error) {
      if (isPreconditionFailure(error)) return null;
      throw error;
    }
  }

  const failed = (context, what, error) => {
    context?.error?.(`[drafts] ${what} failed:`, error);
    return json(500, {
      ok: false,
      error: `Failed to ${what}`,
      message: error?.message || 'Unknown error',
    });
  };

  // ── the GitHub import ────────────────────────────────────────────────────

  function importFailure(path, error) {
    if (typeof error?.code === 'string') {
      return { path, outcome: 'failed', code: error.code, error: error.message };
    }
    log.error?.(`[drafts] import ${path}: ${error?.message || error}`);
    return {
      path,
      outcome: 'failed',
      code: 'INTERNAL',
      error: 'The import failed unexpectedly; see the function logs.',
    };
  }

  function alreadyClaimed(path, rows) {
    if (rows.length > 1) {
      return {
        path,
        outcome: 'skipped',
        code: 'AMBIGUOUS',
        error: `${rows.length} documents claim this path; resolve that by hand.`,
        contentIds: rows.map((row) => row.id),
      };
    }
    const [row] = rows;
    return {
      path,
      outcome: 'skipped',
      code: 'ALREADY_IMPORTED',
      contentId: row.id,
      title: row.Title || row.title || null,
      contentStatus: row.contentStatus || null,
      stage: stageOf(row),
    };
  }

  async function importOne(path, claims, user) {
    if (claims?.length) return alreadyClaimed(path, claims);
    try {
      const [fetched, commitSha] = await Promise.all([
        source.fetchDraft(path),
        source.lastCommitSha(path),
      ]);
      const parsed = parseRepoDraft(fetched.text);
      if (!parsed.ok) return { path, outcome: 'refused', code: parsed.code, error: parsed.error };
      const { draft } = parsed;
      const live = await publishedWithTitle(store, draft.title);
      if (live) {
        return {
          path,
          outcome: 'skipped',
          code: 'PUBLISHED_ELSEWHERE',
          title: draft.title,
          existingId: live.id,
          error: `An article titled "${draft.title}" is already published (${live.id}).`,
        };
      }
      const id = repoDraftContentId(path);
      const editor = editorOf(user);
      const doc = asImportedDraft(
        buildRepoDraftData({ path, draft, source: { ...fetched, commitSha }, editor, now }),
        { id, editor, now }
      );
      // The invariant, checked where the write happens rather than trusted
      // from the builders.
      if (doc.contentStatus !== DRAFTS_STAGE_STATUS || doc.Live !== false) {
        throw new Error('drafts: refusing to import a document that is not a draft');
      }
      try {
        await store.createDoc('content', doc);
      } catch (error) {
        if (error?.code === 409) {
          return {
            path,
            outcome: 'skipped',
            code: 'ALREADY_IMPORTED',
            contentId: id,
            title: draft.title,
          };
        }
        throw error;
      }
      return {
        path,
        outcome: 'imported',
        contentId: id,
        title: draft.title,
        contentStatus: DRAFTS_STAGE_STATUS,
        warnings: draft.warnings,
        repoCommitSha: commitSha,
      };
    } catch (error) {
      return importFailure(path, error);
    }
  }

  return {
    /** GET cms/drafts */
    async list(request, context) {
      const auth = await authorize(request);
      if (auth.error) return auth.error;
      try {
        const rows = await store.queryDocs('content', LIST_QUERY, [
          { name: '@drafting', value: DRAFTS_STAGE_STATUS },
        ]);
        const drafts = rows
          .map(toDraftSummary)
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        return json(200, { ok: true, drafts, limit: MAX_LISTED_DRAFTS });
      } catch (error) {
        context?.error?.('[drafts] list failed:', error);
        return json(500, { ok: false, error: 'Failed to list drafts' });
      }
    },

    /** GET cms/drafts/{id} */
    async get(request, context) {
      const auth = await authorize(request);
      if (auth.error) return auth.error;
      const id = readId(request);
      if (!id)
        return refused({
          ...NOT_FOUND,
          status: 400,
          code: 'BAD_ID',
          error: 'A draft id is required.',
        });
      try {
        const doc = await store.readDoc('content', id, id);
        if (!doc || !comesFromDrafts(doc)) return refused(NOT_FOUND);
        return json(200, { ok: true, draft: toDraftView(doc) });
      } catch (error) {
        context?.error?.('[drafts] get failed:', error);
        return json(500, { ok: false, error: 'Failed to read the draft' });
      }
    },

    /** POST cms/drafts — { fields } */
    async create(request, context) {
      const auth = await authorize(request);
      if (auth.error) return auth.error;
      const body = await readBody(request);
      let fields;
      try {
        fields = validateDraftFields(body.fields);
      } catch (error) {
        if (error instanceof DraftInputError)
          return refused({ status: 400, code: 'INVALID', error: error.message });
        throw error;
      }
      try {
        const doc = buildNewDraftDocument({ id: uuid(), fields, editor: editorOf(auth.user), now });
        const created = (await store.createDoc('content', doc)) || doc;
        await audit('content_draft_created', {
          user: auth.user,
          request,
          contentId: doc.id,
          title: doc.Title,
        });
        return json(201, { ok: true, draft: toDraftView(created) });
      } catch (error) {
        return failed(context, 'create the draft', error);
      }
    },

    /** PUT cms/drafts/{id} — { fields, etag } */
    async update(request, context) {
      const auth = await authorize(request);
      if (auth.error) return auth.error;
      try {
        const loaded = await loadForWrite(request);
        if (loaded.response) return loaded.response;
        const { id, body, etag, current } = loaded;
        let fields;
        try {
          fields = validateDraftFields(body.fields);
        } catch (error) {
          if (error instanceof DraftInputError)
            return refused({ status: 400, code: 'INVALID', error: error.message });
          throw error;
        }
        const blocked = saveRefusal(current);
        if (blocked) return refused(blocked);
        const update = buildDraftUpdate(fields, { current, editor: editorOf(auth.user), now });
        const written = await patchIfUnchanged(id, update, etag);
        if (!written) return await conflict(id);
        await audit('content_draft_saved', {
          user: auth.user,
          request,
          contentId: id,
          title: fields.title,
          details: { updatedFields: Object.keys(update) },
        });
        return json(200, { ok: true, draft: toDraftView(written) });
      } catch (error) {
        return failed(context, 'save the draft', error);
      }
    },

    /**
     * DELETE cms/drafts/{id} — { etag }. A draft, or an article from Drafts
     * that is still In Review (the same document, so both go). Anything live
     * or past review is refused and untouched.
     */
    async remove(request, context) {
      const auth = await authorize(request);
      if (auth.error) return auth.error;
      try {
        const loaded = await loadForWrite(request);
        if (loaded.response) return loaded.response;
        const { id, etag, current } = loaded;
        const blocked = deleteRefusal(current);
        if (blocked) return refused(blocked);
        try {
          await store.deleteDocIfMatch('content', id, etag);
        } catch (error) {
          if (isPreconditionFailure(error)) return await conflict(id);
          throw error;
        }
        // The change feed never delivers a delete (T-324); the dashboard
        // counters move here, best-effort — as DELETE cms/content/{id} does.
        if (onContentDeleted) {
          await Promise.resolve(onContentDeleted(id)).catch((error) =>
            context?.warn?.(`[drafts] counters not updated for ${id}: ${error?.message}`)
          );
        }
        const stage = stageOf(current);
        await audit('content_draft_deleted', {
          user: auth.user,
          request,
          contentId: id,
          title: current.Title || current.title || '',
          details: {
            stage,
            contentStatus: current.contentStatus || null,
            repoPath: current.repoPath || null,
          },
        });
        return json(200, { ok: true, deleted: id, stage });
      } catch (error) {
        return failed(context, 'delete the draft', error);
      }
    },

    /** POST cms/drafts/{id}/send-to-review — { etag } */
    async sendToReview(request, context) {
      const auth = await authorize(request);
      if (auth.error) return auth.error;
      try {
        const loaded = await loadForWrite(request);
        if (loaded.response) return loaded.response;
        const { id, etag, current } = loaded;
        const blocked = sendToReviewRefusal(current);
        if (blocked) return refused(blocked);
        const title = String(current.Title || current.title || '').trim();
        const live = await publishedWithTitle(store, title, id);
        if (live) {
          return refused(
            {
              status: 409,
              code: 'PUBLISHED_ELSEWHERE',
              error: `An article titled "${title}" is already published (${live.id}). Retitle the draft, or delete it if it is that article.`,
            },
            { existingId: live.id }
          );
        }
        const patch = buildSendToReviewPatch(current, { editor: editorOf(auth.user), now });
        const written = await patchIfUnchanged(id, patch, etag);
        if (!written) return await conflict(id);
        await auditTransition({
          user: auth.user,
          request,
          doc: current,
          from: DRAFTS_STAGE_STATUS,
          to: REVIEW_STATUS,
        });
        return json(200, {
          ok: true,
          draft: toDraftView(written),
          reviewPath: `/admin/queue/${encodeURIComponent(id)}`,
        });
      } catch (error) {
        return failed(context, 'send the draft to review', error);
      }
    },

    /** POST cms/drafts/{id}/back-to-drafts — { etag } */
    async backToDrafts(request, context) {
      const auth = await authorize(request);
      if (auth.error) return auth.error;
      try {
        const loaded = await loadForWrite(request);
        if (loaded.response) return loaded.response;
        const { id, etag, current } = loaded;
        const blocked = backToDraftsRefusal(current);
        if (blocked) return refused(blocked);
        const written = await patchIfUnchanged(
          id,
          buildBackToDraftsPatch({ editor: editorOf(auth.user), now }),
          etag
        );
        if (!written) return await conflict(id);
        await auditTransition({
          user: auth.user,
          request,
          doc: current,
          from: REVIEW_STATUS,
          to: DRAFTS_STAGE_STATUS,
        });
        return json(200, { ok: true, draft: toDraftView(written) });
      } catch (error) {
        return failed(context, 'move the article back to Drafts', error);
      }
    },

    /** POST cms/drafts/import-repo — every docs/content draft not yet imported. */
    async importFromRepo(request, context) {
      const auth = await authorize(request);
      if (auth.error) return auth.error;
      let files;
      try {
        files = await source.listCandidates();
      } catch (error) {
        const upstream = typeof error?.code === 'string';
        const status = upstream ? STATUS_BY_UPSTREAM_CODE[error.code] || 502 : 500;
        context?.warn?.(`[drafts] import listing ${status} ${error?.code || 'ERROR'}`);
        return json(status, {
          ok: false,
          code: upstream ? error.code : 'INTERNAL',
          error: upstream
            ? `Could not list docs/content on GitHub: ${error.message}`
            : 'Failed to list the repository drafts',
        });
      }
      try {
        const paths = files.map((file) => file.path);
        const claims = await claimsByPath(store, paths);
        const results = await Promise.all(
          paths.map((path) => importOne(path, claims.get(path), auth.user))
        );
        await Promise.all(
          results.map((result) =>
            audit('content_draft_repo_import', {
              user: auth.user,
              request,
              contentId: result.contentId || null,
              title: result.title || '',
              details: {
                repoPath: result.path,
                repoRef: REPO_REF,
                outcome: result.outcome,
                ...(result.code && { code: result.code }),
              },
            })
          )
        );
        const counts = {};
        for (const { outcome } of results) counts[outcome] = (counts[outcome] || 0) + 1;
        context?.log?.(`[drafts] import ${JSON.stringify(counts)}`);
        return json(200, { ok: true, repo: REPO, results, counts });
      } catch (error) {
        return failed(context, 'import the repository drafts', error);
      }
    },
  };
}
