/**
 * Listen & Learn admin reads, the review decision, and — since ADR 0033 §4 —
 * the Audio Library lifecycle: books and courses, their chapters, and each
 * chapter's audio versions.
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
 * Three enqueues live here (#433, ADR 0033 §4): the source-grounded episode,
 * a chapter regeneration and a hand-made chapter's first reading all queue
 * the job through this route rather than the generic `POST /api/enqueueJob`,
 * so that a bad list, a chapter with nothing to speak or a guide chapter
 * whose set has no study guide is refused with the sentence at once — a 400
 * the form shows — and not as a failed job the page would poll for. The
 * worker validates again, as the guard for any other caller. Same shape as
 * the podcast transcript enqueue (podcast/handlers.js), for the same reason.
 *
 * The routes live beside this file (PR #841), each a function of the `ctx`
 * the factory below builds — the deps plus the store reads and the scaffold
 * every route shares — so the factory is wiring only:
 *   handlers-shared.js   the route and body readers, `guarded`, the store
 *                        reads, the job enqueue and the speech estimate
 *   book-handlers.js     books and courses
 *   chapter-handlers.js  chapters and their audio versions
 *   chapter-plans.js     the pure planning behind the chapter writes
 *   speech-handlers.js   speech options, the estimate, the source-grounded
 *                        episode enqueue, the review decision
 */
import { toChapterView } from './library.js';
import {
  estimateFor,
  guardedWith,
  loadChapterFrom,
  loadSetFrom,
  nextChapterOrderIn,
  queueJob,
  resolveChapterTextFrom,
} from './handlers-shared.js';
import { createBook, deleteBook, getSet, listSets, patchBook } from './book-handlers.js';
import {
  createChapter,
  deleteChapter,
  deleteVersion,
  patchChapter,
  regenerateChapter,
  reorderChapters,
} from './chapter-handlers.js';
import {
  estimateSpeech,
  generateSourceEpisode,
  reviewEpisode,
  speechOptions,
} from './speech-handlers.js';

export { SPEAK_CHAPTER_JOB_TYPE } from './chapter-plans.js';

/**
 * An episode as the review view returns it: `kind` resolved by the one rule
 * (a document with none is a guide episode) and `sources` always an array, so
 * the page never has to know that documents written before #433 carry
 * neither field. Kept by name for the tests and callers that use it; the
 * library view (`toChapterView`) is this plus the versions and the guide
 * check, which need the set.
 */
export function toReviewEpisode(doc) {
  return toChapterView(doc, null);
}

/** Route name → the function of `ctx` that builds it. */
const ROUTES = Object.freeze({
  listSets,
  getSet,
  createBook,
  patchBook,
  deleteBook,
  createChapter,
  patchChapter,
  reorderChapters,
  deleteChapter,
  deleteVersion,
  regenerateChapter,
  speechOptions,
  estimateSpeech,
  generateSourceEpisode,
  reviewEpisode,
});

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, patchDoc: Function, upsertDoc?: Function }} deps.store
 *   `upsertDoc` is needed by the enqueues and the creates, which write documents
 * @param {{ deleteBlob?: Function }} [deps.storage] needed only to delete a version's audio
 * @param {object} [deps.env] for the speech options read
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createListenAndLearnHandlers({
  guard,
  store,
  storage = {},
  env = process.env,
  now = () => new Date(),
  uuid = () => crypto.randomUUID(),
}) {
  const stamp = () => now().toISOString();
  const deps = { store, storage, env, uuid, stamp };
  const ctx = {
    ...deps,
    actorOf: (auth) => auth.user?.oid || null,
    guarded: guardedWith(guard),
    loadSet: (ref) => loadSetFrom(store, ref),
    loadChapter: (ref, chapterId) => loadChapterFrom(store, ref, chapterId),
    resolveChapterText: (parsed) => resolveChapterTextFrom(store, parsed),
    nextChapterOrder: (ref) => nextChapterOrderIn(store, ref),
    queueJob: (job) => queueJob(deps, job),
    estimateFor: (set, spend) => estimateFor(deps, set, spend),
  };
  return Object.fromEntries(Object.entries(ROUTES).map(([name, route]) => [name, route(ctx)]));
}
