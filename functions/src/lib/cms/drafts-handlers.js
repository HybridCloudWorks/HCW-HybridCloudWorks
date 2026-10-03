/**
 * drafts-handlers.js — the routes behind /admin/drafts (owner request
 * 2026-10-03). What a draft is and which moves are allowed is ./drafts.js
 * and ./drafts-stage.js; the docs/content import is ./drafts-import.js; this
 * is the store and the HTTP shape.
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
 * AUDIT. One row per action, written after the work and best-effort (as
 * set-slug.js and the original import did), so a failed audit write cannot
 * turn a completed save into a 500 that invites a retry. The transitions also
 * write the `audits` status_transition row transitionContentStatus writes.
 */
import { randomUUID } from 'node:crypto';
import { REPO_REF } from './repo-draft.js';
import {
  DRAFTS_STAGE_STATUS,
  DraftInputError,
  REVIEW_STATUS,
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
import { createDraftsImporter, editorOf, publishedWithTitle } from './drafts-import.js';

export { publishedWithTitle };

/** Rows the list returns. The Drafts stage is one person's desk; this is generous. */
export const MAX_LISTED_DRAFTS = 200;
/** Content ids are UUIDs; migrated ones are Firestore ids. Neither has anything else. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const refused = ({ status, code, error }, extra = {}) =>
  json(status, { ok: false, code, error, ...extra });

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
const BAD_ID = { status: 400, code: 'BAD_ID', error: 'A draft id is required.' };
const ETAG_REQUIRED = {
  status: 400,
  code: 'ETAG_REQUIRED',
  error: 'etag is required: send the etag of the version you are looking at (reload the draft).',
};
const CONFLICT_MESSAGE =
  'This draft changed in another tab or on another device since you opened it. Nothing was saved; reload it to see the latest version.';

/** Thrown inside a handler to answer with a refusal; the route wrapper turns it into the response. */
class Refusal extends Error {
  constructor(refusal, extra = {}) {
    super(refusal.error);
    this.response = refused(refusal, extra);
  }
}

/** Throw when `refusal` is set: a refusal is an answer, not a branch every handler repeats. */
const refuseIf = (refusal, extra) => {
  if (refusal) throw new Refusal(refusal, extra);
};

async function readBody(request) {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

function readId(request) {
  const id = String(request.params?.id || '');
  refuseIf(!ID_PATTERN.test(id) && BAD_ID);
  return id;
}

function readEtag(body) {
  const { etag } = body;
  const valid = typeof etag === 'string' && etag.length > 0 && etag.length <= 200;
  refuseIf(!valid && ETAG_REQUIRED);
  return etag;
}

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
  const importer = createDraftsImporter({ store, source, now, log });

  async function writeAudit(container, row) {
    try {
      await store.upsertDoc(container, { id: uuid(), timestamp: now().toISOString(), ...row });
    } catch (error) {
      log.error?.(`[drafts] ${container} row ${row.action} failed`, error);
    }
  }

  const audit = (action, { user, request, contentId = null, title = '', details = {} }) =>
    writeAudit('admin_audit_logs', {
      action,
      userId: user.oid || user.sub || null,
      userEmail: user.email || null,
      contentId,
      contentTitle: title,
      details,
      userAgent: request.headers?.get?.('user-agent') || null,
      compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
    });

  /** The status_transition row createContentStatusTransitioner writes, for the same history. */
  const auditTransition = ({ user, request, doc, from, to }) =>
    writeAudit('audits', {
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

  /** The 412 a lost race answers, with what is stored now (or 404 if it is gone). */
  async function conflict(id) {
    const latest = await store.readDoc('content', id, id).catch(() => null);
    refuseIf(!latest && { ...NOT_FOUND, error: 'This draft no longer exists.' });
    throw new Refusal(
      { status: 412, code: 'CONFLICT', error: CONFLICT_MESSAGE },
      { current: toDraftSummary(latest) }
    );
  }

  /** A document this page may show, or the 404. */
  async function readDraft(id) {
    const doc = await store.readDoc('content', id, id);
    refuseIf(!(doc && comesFromDrafts(doc)) && NOT_FOUND);
    return doc;
  }

  /**
   * The shared front half of every write to an existing draft: the id, the
   * etag, the document, that it belongs to this page, and that the page is
   * looking at the version that is stored.
   */
  async function loadForWrite(request) {
    const id = readId(request);
    const body = await readBody(request);
    const etag = readEtag(body);
    const current = await readDraft(id);
    if (current._etag !== etag) await conflict(id);
    return { id, body, etag, current };
  }

  /** patchDoc under the etag; a lost race becomes the 412. */
  async function patchUnderEtag(id, update, etag) {
    try {
      return await store.patchDoc('content', id, update, { ifMatch: etag });
    } catch (error) {
      if (isPreconditionFailure(error)) return conflict(id);
      throw error;
    }
  }

  async function deleteUnderEtag(id, etag) {
    try {
      await store.deleteDocIfMatch('content', id, etag);
    } catch (error) {
      if (isPreconditionFailure(error)) await conflict(id);
      throw error;
    }
  }

  /**
   * Every route: the guard, then the work. A Refusal or a DraftInputError is
   * the answer it carries; anything else is a 500 naming the action.
   */
  const route = (what, work) => async (request, context) => {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;
    try {
      return await work({ request, context, user: auth.user });
    } catch (error) {
      if (error instanceof Refusal) return error.response;
      if (error instanceof DraftInputError) {
        return refused({ status: 400, code: 'INVALID', error: error.message });
      }
      context?.error?.(`[drafts] ${what} failed:`, error);
      return json(500, {
        ok: false,
        error: `Failed to ${what}`,
        message: error?.message || 'Unknown error',
      });
    }
  };

  /** A route that changes an existing draft: route() plus loadForWrite. */
  const writeRoute = (what, work) =>
    route(what, async (args) => work({ ...args, ...(await loadForWrite(args.request)) }));

  /** Counters after a delete; the change feed never delivers one (T-324). */
  async function countersAfterDelete(id, context) {
    if (!onContentDeleted) return;
    await Promise.resolve(onContentDeleted(id)).catch((error) =>
      context?.warn?.(`[drafts] counters not updated for ${id}: ${error?.message}`)
    );
  }

  return {
    /** GET cms/drafts */
    list: route('list drafts', async () => {
      const rows = await store.queryDocs('content', LIST_QUERY, [
        { name: '@drafting', value: DRAFTS_STAGE_STATUS },
      ]);
      const drafts = rows
        .map(toDraftSummary)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return json(200, { ok: true, drafts, limit: MAX_LISTED_DRAFTS });
    }),

    /** GET cms/drafts/{id} */
    get: route('read the draft', async ({ request }) => {
      const doc = await readDraft(readId(request));
      return json(200, { ok: true, draft: toDraftView(doc) });
    }),

    /** POST cms/drafts — { fields } */
    create: route('create the draft', async ({ request, user }) => {
      const fields = validateDraftFields((await readBody(request)).fields);
      const doc = buildNewDraftDocument({ id: uuid(), fields, editor: editorOf(user), now });
      const created = (await store.createDoc('content', doc)) || doc;
      await audit('content_draft_created', { user, request, contentId: doc.id, title: doc.Title });
      return json(201, { ok: true, draft: toDraftView(created) });
    }),

    /** PUT cms/drafts/{id} — { fields, etag } */
    update: writeRoute('save the draft', async ({ request, user, id, body, etag, current }) => {
      const fields = validateDraftFields(body.fields);
      refuseIf(saveRefusal(current));
      const update = buildDraftUpdate(fields, { current, editor: editorOf(user), now });
      const written = await patchUnderEtag(id, update, etag);
      await audit('content_draft_saved', {
        user,
        request,
        contentId: id,
        title: fields.title,
        details: { updatedFields: Object.keys(update) },
      });
      return json(200, { ok: true, draft: toDraftView(written) });
    }),

    /**
     * DELETE cms/drafts/{id} — { etag }. A draft, or an article from Drafts
     * that is still In Review (the same document, so both go). Anything live
     * or past review is refused and untouched.
     */
    remove: writeRoute(
      'delete the draft',
      async ({ request, context, user, id, etag, current }) => {
        refuseIf(deleteRefusal(current));
        await deleteUnderEtag(id, etag);
        await countersAfterDelete(id, context);
        const stage = stageOf(current);
        await audit('content_draft_deleted', {
          user,
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
      }
    ),

    /** POST cms/drafts/{id}/send-to-review — { etag } */
    sendToReview: writeRoute(
      'send the draft to review',
      async ({ request, user, id, etag, current }) => {
        refuseIf(sendToReviewRefusal(current));
        const title = String(current.Title || current.title || '').trim();
        const live = await publishedWithTitle(store, title, id);
        refuseIf(
          live && {
            status: 409,
            code: 'PUBLISHED_ELSEWHERE',
            error: `An article titled "${title}" is already published (${live?.id}). Retitle the draft, or delete it if it is that article.`,
          },
          { existingId: live?.id }
        );
        const patch = buildSendToReviewPatch(current, { editor: editorOf(user), now });
        const written = await patchUnderEtag(id, patch, etag);
        await auditTransition({
          user,
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
      }
    ),

    /** POST cms/drafts/{id}/back-to-drafts — { etag } */
    backToDrafts: writeRoute(
      'move the article back to Drafts',
      async ({ request, user, id, etag, current }) => {
        refuseIf(backToDraftsRefusal(current));
        const patch = buildBackToDraftsPatch({ editor: editorOf(user), now });
        const written = await patchUnderEtag(id, patch, etag);
        await auditTransition({
          user,
          request,
          doc: current,
          from: REVIEW_STATUS,
          to: DRAFTS_STAGE_STATUS,
        });
        return json(200, { ok: true, draft: toDraftView(written) });
      }
    ),

    /** POST cms/drafts/import-repo — every docs/content article not yet imported. */
    importFromRepo: route('import the repository drafts', async ({ request, context, user }) => {
      const { status, body } = await importer.importAll(user);
      if (status !== 200) {
        context?.warn?.(`[drafts] import listing ${status} ${body.code}`);
        return json(status, body);
      }
      await Promise.all(
        body.results.map((result) =>
          audit('content_draft_repo_import', {
            user,
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
      context?.log?.(`[drafts] import ${JSON.stringify(body.counts)}`);
      return json(200, body);
    }),
  };
}
