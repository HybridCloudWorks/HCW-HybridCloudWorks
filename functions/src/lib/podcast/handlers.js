/**
 * Podcast transcript admin routes: enqueue a generation, read what was
 * generated, and the review decision (#435).
 *
 * Generation is a job (functions/podcast-jobs.js) because a script, a
 * synthesis and an upload take minutes and an HTTP response is bounded at
 * 230 s. The enqueue is here rather than through the generic
 * `POST /api/enqueueJob` so the refusal an unpublished article earns is a
 * 409 the Publish page can show at once, not a failed job it would have to
 * poll for — the job checks again, as the guard for any other caller.
 *
 * Roles. Generating and reading are `editor`, matching the Listen & Learn
 * routes and the job that does the same work. Approving is `publisher`: it
 * is the act that will put an AI-read episode on the podcast feed under the
 * owner's name — #437 hangs the RSS.com publish on it — and "can publish
 * content to live" is what that role is for. Listen & Learn approves at
 * editor; the difference is that a Learn episode goes on a study page and a
 * podcast transcript goes to a host and every subscriber.
 */
import { JOBS_CONTAINER, newJobDoc } from '../jobs.js';
import {
  ARTICLE_CONTAINER,
  TRANSCRIPT_JOB_TYPE,
  parseArticleId,
  refusalFor,
} from './generate.js';
import {
  STATUS,
  TRANSCRIPT_CONTAINER,
  TRANSCRIPT_LIST_FIELDS,
  setTranscriptStatus,
  transcriptId,
} from './store.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * A ceiling, not a page size. The catalogue is tens of articles; anything
 * past this means a container has run away, which is what is defended against.
 */
const MAX_TRANSCRIPTS = 200;

const LIST_PROJECTION = TRANSCRIPT_LIST_FIELDS.map((field) => `c.${field}`).join(', ');

/**
 * Newest generation first, ordered by Cosmos rather than in memory: with the
 * TOP bound, an unordered query could hand back any MAX_TRANSCRIPTS rows and
 * the newest would be the ones missing. A single-property ORDER BY needs only
 * the range index every path has under the container's `/*` policy — the
 * same shape `public-reads.js` uses for `approvedAt`. Every document
 * store.js writes carries `generatedAt`, so none is excluded by the sort.
 */
const LIST_QUERY = `SELECT TOP ${MAX_TRANSCRIPTS} ${LIST_PROJECTION} FROM c ORDER BY c.generatedAt DESC`;

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createPodcastHandlers({
  guard,
  store,
  now = () => new Date(),
  uuid = () => crypto.randomUUID(),
}) {
  return {
    /**
     * POST /api/cms/podcast/transcripts/generate — `{ articleId }`.
     * Answers 202 with the job id, like `enqueueJob`; the transcript appears
     * on the hub when the job finishes.
     *
     * @param {{ enqueue: (message: {jobId: string, type: string}) => void }} io - the queue output
     */
    async generateTranscript(request, context, { enqueue } = {}) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return json(400, { error: 'Body must be a JSON object' });
        }
        // The worker's validator, so the route and the job say the same thing.
        const parsedId = parseArticleId(body.articleId);
        if (parsedId.error) return json(400, { error: parsedId.error });
        const articleId = parsedId.value;

        const article = await store.readDoc(ARTICLE_CONTAINER, articleId, articleId);
        const refusal = refusalFor(article, articleId);
        if (refusal) return json(article ? 409 : 404, { error: refusal });

        let id;
        try {
          id = transcriptId(article);
        } catch (err) {
          return json(409, { error: err.message });
        }

        if (typeof enqueue !== 'function') {
          context.error?.('generatePodcastTranscript: no queue output wired');
          return json(500, { error: 'Job queue is not configured' });
        }

        const jobId = uuid();
        const doc = newJobDoc({
          id: jobId,
          type: TRANSCRIPT_JOB_TYPE,
          payload: { articleId },
          requestedBy: auth.user,
          createdAt: now().toISOString(),
        });
        await store.upsertDoc(JOBS_CONTAINER, doc);
        enqueue({ jobId, type: TRANSCRIPT_JOB_TYPE });

        context.log?.(`generatePodcastTranscript: queued ${jobId} for ${id}`);
        return json(202, {
          ok: true,
          jobId,
          type: TRANSCRIPT_JOB_TYPE,
          status: 'queued',
          poll: `getJob?jobId=${jobId}`,
          transcriptId: id,
        });
      } catch (error) {
        context.error('generatePodcastTranscript failed:', error);
        return json(500, { error: 'Failed to queue the transcript' });
      }
    },

    /** GET /api/cms/podcast/transcripts — every transcript, newest first, no bodies. */
    async listTranscripts(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const items = await store.queryDocs(TRANSCRIPT_CONTAINER, LIST_QUERY, []);
        return json(200, { success: true, items, total: items.length });
      } catch (error) {
        context.error('listPodcastTranscripts failed:', error);
        return json(500, { error: 'Failed to list podcast transcripts' });
      }
    },

    /**
     * GET /api/cms/podcast/transcripts/{id} — one transcript in full, drafts
     * and failures included. This is the review view.
     */
    async getTranscript(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const id = String(request.params?.id || '').trim();
        if (!id) return json(400, { error: 'id is required' });

        const item = await store.readDoc(TRANSCRIPT_CONTAINER, id, id);
        if (!item) return json(404, { error: `No podcast transcript ${id}` });
        return json(200, { success: true, item });
      } catch (error) {
        context.error('getPodcastTranscript failed:', error);
        return json(500, { error: 'Failed to get the podcast transcript' });
      }
    },

    /**
     * POST /api/cms/podcast/transcripts/review — `{ id, status: 'published' | 'draft' }`.
     */
    async reviewTranscript(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return json(400, { error: 'Body must be a JSON object' });
        }
        const id = String(body.id || '').trim();
        const status = String(body.status || '').trim();

        // 'failed' is written by the generator, never chosen by a reviewer:
        // `draft` is how a reviewer withdraws one, and it leaves a record.
        if (status !== STATUS.published && status !== STATUS.draft) {
          return json(400, {
            error: `status must be "${STATUS.published}" or "${STATUS.draft}"`,
          });
        }
        if (!id) return json(400, { error: 'id is required' });

        const updated = await setTranscriptStatus(store, {
          id,
          status,
          actorId: auth.user?.oid || null,
          now: now().toISOString(),
        });

        context.log?.(`reviewPodcastTranscript: ${id} → ${status} by ${auth.user?.oid || 'unknown'}`);
        return json(200, { success: true, id, status, item: updated || null });
      } catch (error) {
        context.error('reviewPodcastTranscript failed:', error);
        return json(500, { error: 'Failed to update the transcript' });
      }
    },
  };
}
