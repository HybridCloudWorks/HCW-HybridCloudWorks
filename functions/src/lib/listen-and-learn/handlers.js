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
 */
import { EPISODE_CONTAINER, SET_CONTAINER, STATUS, setId, setEpisodeStatus } from './publish.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

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
 * @param {{ queryDocs: Function, readDoc: Function, patchDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 */
export function createListenAndLearnHandlers({ guard, store, now = () => new Date() }) {
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

        return json(200, { success: true, set: set || null, episodes: [...episodes].sort(byOrder) });
      } catch (error) {
        context.error('getListenAndLearnSet failed:', error);
        return json(500, { error: 'Failed to get the Listen & Learn set' });
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
