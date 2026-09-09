/**
 * Listen & Learn admin reads and the review decision.
 *
 * Generation is a job (functions/listen-and-learn-jobs.js) because it takes
 * minutes; everything here is fast, so it stays a plain request. The split
 * matters for one reason beyond latency: approving an episode is the act that
 * puts AI-written exam guidance in front of people studying for a paid exam,
 * and it must be a deliberate, separately audited step rather than something a
 * generation run can do to itself.
 *
 * Ported from Site-Main `functions/listen-and-learn/index.js` (088f458).
 * `requireAdmin(req, res, 'editor')` becomes this repository's role guard, and
 * the two admin list reads are new — upstream's page read Firestore directly.
 *
 * One enqueue lives here after all (#433): `generateSourceEpisode` queues the
 * same `generate-listen-and-learn` job the guide run uses, with a source list
 * in the payload. It goes through this route rather than the generic
 * `POST /api/enqueueJob` so that an over-cap list, or a YouTube URL given as
 * a page, is refused with the sentence at once — a 400 the form shows — and
 * not as a failed job the page would have to poll for. The worker validates
 * again, as the guard for any other caller. Same shape as the podcast
 * transcript enqueue (podcast/handlers.js), for the same reason.
 */
import { JOBS_CONTAINER, newJobDoc } from '../jobs.js';
import {
  EPISODE_CONTAINER,
  SET_CONTAINER,
  STATUS,
  episodeKindOf,
  setId,
  setEpisodeStatus,
} from './publish.js';
import { LISTEN_AND_LEARN_JOB_TYPE, parseSourceEpisodePayload } from './source-episode.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * An episode as the review view returns it: `kind` resolved by the one rule
 * (a document with none is a guide episode) and `sources` always an array, so
 * the page never has to know that documents written before #433 carry
 * neither field. The review view is the one place a reviewer sees what the
 * model was given, which is why the sources ride along with the transcript.
 */
export function toReviewEpisode(doc) {
  return {
    ...doc,
    kind: episodeKindOf(doc),
    sources: Array.isArray(doc?.sources) ? doc.sources : [],
  };
}

/**
 * Ceilings, not page sizes. A certification has at most eight areas and the
 * site has tens of certifications; anything past these means a container has
 * run away, which is the case being defended against.
 */
const MAX_SETS = 200;
const MAX_EPISODES_PER_SET = 50;

/** Study-guide order, which is the order episodes are meant to be heard in. */
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, patchDoc: Function, upsertDoc?: Function }} deps.store
 *   `upsertDoc` is needed only by `generateSourceEpisode`, which writes the job document
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createListenAndLearnHandlers({
  guard,
  store,
  now = () => new Date(),
  uuid = () => crypto.randomUUID(),
}) {
  return {
    /** GET /api/cms/listen-and-learn — every set, newest generation first. */
    async listSets(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const rows = await store.queryDocs(SET_CONTAINER, `SELECT TOP ${MAX_SETS} * FROM c`, []);
        const items = [...rows].sort((a, b) =>
          String(b.generatedAt || '').localeCompare(String(a.generatedAt || ''))
        );
        return json(200, { success: true, items, total: items.length });
      } catch (error) {
        context.error('listListenAndLearnSets failed:', error);
        return json(500, { error: 'Failed to list Listen & Learn sets' });
      }
    },

    /**
     * GET /api/cms/listen-and-learn/{platform}/{examCode} — one set and every
     * episode in it, drafts and failures included. This is the review view, so
     * it deliberately shows what the public read hides.
     */
    async getSet(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const platform = String(request.params.platform || '')
          .trim()
          .toLowerCase();
        const examCode = String(request.params.examCode || '').trim();
        if (!platform || !examCode) {
          return json(400, { error: 'platform and examCode are required' });
        }

        const id = setId(platform, examCode);
        const [set, episodes] = await Promise.all([
          store.readDoc(SET_CONTAINER, id, id),
          store.queryDocs(
            EPISODE_CONTAINER,
            `SELECT TOP ${MAX_EPISODES_PER_SET} * FROM c WHERE c.setId = @setId`,
            [{ name: '@setId', value: id }]
          ),
        ]);

        if (!set && episodes.length === 0) {
          return json(404, { error: `No Listen & Learn set for ${platform}/${examCode}` });
        }

        return json(200, {
          success: true,
          set: set || null,
          episodes: [...episodes].sort(byOrder).map(toReviewEpisode),
        });
      } catch (error) {
        context.error('getListenAndLearnSet failed:', error);
        return json(500, { error: 'Failed to get the Listen & Learn set' });
      }
    },

    /**
     * POST /api/cms/listen-and-learn/source-episode
     * `{ platform, examCode, title, sources: [{ kind, url, title? }], certTitle?, certSlug? }`
     *
     * Queues one source-grounded episode (#433) and answers 202 with the job
     * id, like `enqueueJob`; the episode appears in the set as a draft when
     * the job finishes. The list is validated here with the worker's own
     * validator — see the header for why — and the payload written to the
     * job is the normalised one, so the worker cannot read a field the
     * route did not check.
     *
     * @param {{ enqueue: (message: {jobId: string, type: string}) => void }} io - the queue output
     */
    async generateSourceEpisode(request, context, { enqueue } = {}) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return json(400, { error: 'Body must be a JSON object' });
        }

        const parsed = parseSourceEpisodePayload(body);
        if (parsed.error) return json(400, { error: parsed.error });
        const { platform, examCode, title, areaSlug, sources, cert } = parsed.value;

        if (typeof enqueue !== 'function') {
          context.error?.('generateSourceEpisode: no queue output wired');
          return json(500, { error: 'Job queue is not configured' });
        }

        const jobId = uuid();
        const doc = newJobDoc({
          id: jobId,
          type: LISTEN_AND_LEARN_JOB_TYPE,
          payload: {
            platform,
            examCode,
            title,
            sources,
            ...(cert.title ? { certTitle: cert.title } : {}),
            ...(cert.slug ? { certSlug: cert.slug } : {}),
          },
          requestedBy: auth.user,
          createdAt: now().toISOString(),
        });
        await store.upsertDoc(JOBS_CONTAINER, doc);
        enqueue({ jobId, type: LISTEN_AND_LEARN_JOB_TYPE });

        context.log?.(
          `generateSourceEpisode: queued ${jobId} for ${examCode}/${areaSlug} (${sources.length} sources)`
        );
        return json(202, {
          ok: true,
          jobId,
          type: LISTEN_AND_LEARN_JOB_TYPE,
          status: 'queued',
          poll: `getJob?jobId=${jobId}`,
          areaSlug,
          sourceCount: sources.length,
        });
      } catch (error) {
        context.error('generateSourceEpisode failed:', error);
        return json(500, { error: 'Failed to queue the source-grounded episode' });
      }
    },

    /**
     * POST /api/cms/listen-and-learn/review
     * `{ platform, examCode, areaSlug, status: 'published' | 'draft' }`
     */
    async reviewEpisode(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return json(400, { error: 'Body must be a JSON object' });
        }

        const platform = String(body.platform || '')
          .trim()
          .toLowerCase();
        const examCode = String(body.examCode || '').trim();
        const areaSlug = String(body.areaSlug || '').trim();
        const status = String(body.status || '').trim();

        // 'failed' is written by the generator, never chosen by a reviewer:
        // marking a working episode failed would hide it from the site with no
        // record of why, which is what `draft` is for.
        if (status !== STATUS.published && status !== STATUS.draft) {
          return json(400, {
            error: `status must be "${STATUS.published}" or "${STATUS.draft}"`,
          });
        }
        if (!platform || !examCode || !areaSlug) {
          return json(400, { error: 'platform, examCode and areaSlug are required' });
        }

        const updated = await setEpisodeStatus(store, {
          provider: platform,
          examCode,
          areaSlug,
          status,
          actorId: auth.user?.oid || null,
          now: now().toISOString(),
        });

        context.log?.(
          `reviewListenAndLearn: ${examCode}/${areaSlug} → ${status} by ${auth.user?.oid || 'unknown'}`
        );
        return json(200, { success: true, examCode, areaSlug, status, item: updated || null });
      } catch (error) {
        context.error('reviewListenAndLearn failed:', error);
        return json(500, { error: 'Failed to update the episode' });
      }
    },
  };
}
