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
 * ROLES. Every read and every edit is editor-gated. Publishing — setting a
 * chapter's status to `published` — is publisher-gated (ADR 0033 §4), the
 * same floor as `publish-content`; withdrawing to draft stays editor.
 *
 * DELETES ARE SOFT. A book or chapter delete stamps `softDeletedAt`; the
 * public reads already drop those rows (public-reads.js `isSoftDeleted`),
 * the admin reads drop them here, and nothing is removed from storage except
 * a single audio VERSION's blob when that version is deleted by hand — never
 * the active one.
 */
import { JOBS_CONTAINER, newJobDoc } from '../jobs.js';
// The one body-shape test the other admin writers use: an object, not null,
// not an array. A JSON array passes `typeof === 'object'` and then fails on
// a field message that names the wrong problem.
import { isPlainObject } from '../cms/content-update-validation.js';
import {
  AUDIO_CONTAINER,
  EPISODE_CONTAINER,
  EPISODE_KIND,
  SET_CONTAINER,
  STATUS,
  activeVersionOf,
  episodeKindOf,
  mirrorActiveVersion,
  setId,
  setEpisodeStatus,
  speakableTextOf,
  versionsOf,
} from './publish.js';
import { LISTEN_AND_LEARN_JOB_TYPE, parseSourceEpisodePayload } from './source-episode.js';
import {
  parseBookCreate,
  parseBookPatch,
  parseChapterCreate,
  parseChapterPatch,
  parseReorder,
  publishedChapters,
  summarizeChapters,
  toBookView,
  toChapterView,
} from './library.js';
import { MAX_SCRIPT_BYTES } from './script.js';
import {
  AZURE_VOICES,
  GEMINI_VOICES,
  SPEAKING_RATE,
  VOICE_PROVIDERS,
  listenAndLearnModelOptions,
  LISTEN_AND_LEARN_DEFAULT_MODEL,
  parseTtsModel,
  readStoredListenAndLearnModel,
  voiceSettingsOf,
} from './speech-settings.js';
import { describeSpeechProviders, estimateSpeechCostUsd } from './speech/index.js';

/** The job that speaks a hand-made chapter's text (listen-and-learn-jobs.js). */
export const SPEAK_CHAPTER_JOB_TYPE = 'speak-listen-and-learn-chapter';

const PRODUCT = 'listenAndLearn';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

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

/**
 * Ceilings, not page sizes. A certification has at most eight areas and the
 * site has tens of certifications; anything past these means a container has
 * run away, which is the case being defended against.
 */
const MAX_SETS = 200;
const MAX_EPISODES_PER_SET = 50;
/** Every chapter row across every book, projected to five fields. */
const MAX_CHAPTER_ROWS = 5000;

/** Study-guide order, which is the order episodes are meant to be heard in. */
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

const isSoftDeleted = (doc) => Boolean(doc?.softDeletedAt || doc?.softDeleteExpiresAt);

const CHAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,120}$/;
const VERSION_ID_PATTERN = /^[a-z0-9]{1,20}$/i;

/** `platform` and `examCode` from the route, lower-cased and trimmed, or null. */
function routeSet(request) {
  const platform = String(request.params?.platform || '')
    .trim()
    .toLowerCase();
  const examCode = String(request.params?.examCode || '').trim();
  if (!platform || !examCode) return null;
  return { platform, examCode, id: setId(platform, examCode) };
}

function truthyQuery(request, name) {
  const value = String(request.query?.get?.(name) ?? '')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

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

  /** Read a set and its live chapters, or the 404 to answer with. */
  async function loadSet(ref, { includeDeleted = false } = {}) {
    const [set, rows] = await Promise.all([
      store.readDoc(SET_CONTAINER, ref.id, ref.id),
      store.queryDocs(
        EPISODE_CONTAINER,
        `SELECT TOP ${MAX_EPISODES_PER_SET} * FROM c WHERE c.setId = @setId`,
        [{ name: '@setId', value: ref.id }]
      ),
    ]);
    const chapters = includeDeleted ? rows : rows.filter((doc) => !isSoftDeleted(doc));
    if ((!set || isSoftDeleted(set)) && chapters.length === 0) return { missing: true };
    return { set: set && !isSoftDeleted(set) ? set : null, chapters: [...chapters].sort(byOrder) };
  }

  /** One chapter in a set, or null; soft-deleted reads as absent. */
  async function loadChapter(ref, chapterId) {
    const doc = await store.readDoc(EPISODE_CONTAINER, chapterId, ref.id);
    return doc && !isSoftDeleted(doc) ? doc : null;
  }

  /** Write a job document and queue it; the 202 body every enqueue answers. */
  async function queueJob({ type, payload, user, enqueue, extra = {} }) {
    const jobId = uuid();
    const doc = newJobDoc({ id: jobId, type, payload, requestedBy: user, createdAt: stamp() });
    await store.upsertDoc(JOBS_CONTAINER, doc);
    enqueue({ jobId, type });
    return json(202, {
      ok: true,
      jobId,
      type,
      status: 'queued',
      poll: `getJob?jobId=${jobId}`,
      ...extra,
    });
  }

  /**
   * What speaking `bytes` of text would cost for a book, before it is spent:
   * the book's provider and model, else the run's model, else the stored
   * default — the same resolution the worker applies. Null when no provider
   * would run, which the page shows as "transcript only".
   */
  async function estimateFor(set, { bytes, ttsModel = null }) {
    const voice = voiceSettingsOf(set);
    const stored = await readStoredListenAndLearnModel(store.readDoc).catch(() => null);
    const model = voice.model || ttsModel || stored || null;
    const estimate = estimateSpeechCostUsd({
      product: PRODUCT,
      ceilingBytes: bytes,
      model,
      provider: voice.provider === 'auto' ? null : voice.provider,
      env,
    });
    return estimate
      ? {
          provider: estimate.provider,
          model: estimate.model,
          bytes: estimate.bytes,
          estimatedCostUsd: estimate.estimatedCostUsd,
        }
      : { provider: null, model, bytes, estimatedCostUsd: null };
  }

  /** Archive or restore every live chapter of a book, one write each. */
  async function archiveChapters(ref, chapters, archive, at) {
    for (const chapter of chapters) {
      if (archive && chapter.status !== STATUS.archived) {
        await store.patchDoc(
          EPISODE_CONTAINER,
          chapter.id,
          {
            status: STATUS.archived,
            statusBeforeArchive: chapter.status || STATUS.draft,
            archivedAt: at,
            archivedWithBook: true,
            updatedAt: at,
          },
          { partitionKey: ref.id }
        );
      } else if (!archive && chapter.status === STATUS.archived && chapter.archivedWithBook) {
        await store.patchDoc(
          EPISODE_CONTAINER,
          chapter.id,
          {
            status: chapter.statusBeforeArchive || STATUS.draft,
            statusBeforeArchive: null,
            archivedAt: null,
            archivedWithBook: null,
            updatedAt: at,
          },
          { partitionKey: ref.id }
        );
      }
    }
  }

  return {
    /**
     * GET /api/cms/listen-and-learn — every book and course, newest first,
     * each with its chapter counts and duration total for the Library grid.
     * Soft-deleted books are never listed; archived ones only with
     * `?archived=1`.
     */
    async listSets(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const [rows, chapterRows] = await Promise.all([
          store.queryDocs(SET_CONTAINER, `SELECT TOP ${MAX_SETS} * FROM c`, []),
          store.queryDocs(
            EPISODE_CONTAINER,
            `SELECT TOP ${MAX_CHAPTER_ROWS} c.setId, c.status, c.durationSeconds, c.softDeletedAt, c.softDeleteExpiresAt FROM c`,
            []
          ),
        ]);
        const includeArchived = truthyQuery(request, 'archived');
        const counts = summarizeChapters(chapterRows);
        const items = rows
          .filter((set) => !isSoftDeleted(set) && (includeArchived || !set.archivedAt))
          .sort((a, b) =>
            String(b.updatedAt || b.generatedAt || '').localeCompare(
              String(a.updatedAt || a.generatedAt || '')
            )
          )
          .map((set) => toBookView(set, counts.get(set.id) || null));
        return json(200, { success: true, items, total: items.length });
      } catch (error) {
        context.error('listListenAndLearnSets failed:', error);
        return json(500, { error: 'Failed to list Listen & Learn sets' });
      }
    },

    /**
     * GET /api/cms/listen-and-learn/{platform}/{examCode} — one book and every
     * chapter in it, drafts, failures and archived included. This is the
     * review view, so it deliberately shows what the public read hides.
     */
    async getSet(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const ref = routeSet(request);
        if (!ref) return json(400, { error: 'platform and examCode are required' });

        const loaded = await loadSet(ref);
        if (loaded.missing) {
          return json(404, { error: `No Listen & Learn set for ${ref.platform}/${ref.examCode}` });
        }

        return json(200, {
          success: true,
          set: loaded.set
            ? toBookView(loaded.set, summarizeChapters(loaded.chapters).get(ref.id))
            : null,
          episodes: loaded.chapters.map((doc) => toChapterView(doc, loaded.set)),
        });
      } catch (error) {
        context.error('getListenAndLearnSet failed:', error);
        return json(500, { error: 'Failed to get the Listen & Learn set' });
      }
    },

    /**
     * POST /api/cms/listen-and-learn
     * `{ provider, kind?, title, examCode?, author?, description?, coverImageUrl?, tags?, voice? }`
     *
     * A book with no certification (ADR 0033 §4), or a course shell for one.
     * 409 when the code is taken: the code is the route and the blob path
     * segment, and a second book under it would share both.
     */
    async createBook(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = await request.json().catch(() => null);
        if (!isPlainObject(body)) return json(400, { error: 'Body must be a JSON object' });
        const parsed = parseBookCreate(body);
        if (parsed.error) return json(400, { error: parsed.error });

        const { provider, examCode } = parsed.value;
        const id = setId(provider, examCode);
        const existing = await store.readDoc(SET_CONTAINER, id, id);
        if (existing && !isSoftDeleted(existing)) {
          return json(409, { error: `A book or course already exists at ${provider}/${examCode}` });
        }

        const at = stamp();
        const doc = {
          id,
          provider,
          examCode,
          ...parsed.value,
          certSlug: body.certSlug ? String(body.certSlug).trim() : examCode,
          certTitle: parsed.value.certTitle || parsed.value.title,
          studyGuideUrl: null,
          studyGuideTitle: null,
          areaCount: 0,
          areaSlugs: [],
          generatedAt: at,
          generatedBy: auth.user?.oid || null,
          createdAt: at,
          createdBy: auth.user?.oid || null,
          updatedAt: at,
          updatedBy: auth.user?.oid || null,
          archivedAt: null,
          softDeletedAt: null,
        };
        await store.upsertDoc(SET_CONTAINER, doc);
        context.log?.(
          `createListenAndLearnBook: ${id} (${doc.kind}) by ${auth.user?.oid || 'unknown'}`
        );
        return json(201, { success: true, item: toBookView(doc) });
      } catch (error) {
        context.error('createListenAndLearnBook failed:', error);
        return json(500, { error: 'Failed to create the book' });
      }
    },

    /**
     * PATCH /api/cms/listen-and-learn/{platform}/{examCode}
     * `{ title?, certTitle?, author?, description?, coverImageUrl?, tags?, kind?, voice?, archived? }`
     *
     * Metadata edits and archive / restore. Archiving a book archives every
     * live chapter with it, so the public reads — which select
     * `status = 'published'` — stop serving them in the same stroke; restore
     * puts back the chapters the archive took, and only those.
     */
    async patchBook(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const ref = routeSet(request);
        if (!ref) return json(400, { error: 'platform and examCode are required' });
        const body = await request.json().catch(() => null);
        if (!isPlainObject(body)) return json(400, { error: 'Body must be a JSON object' });

        const { archived, ...fields } = body;
        const patch = Object.keys(fields).length ? parseBookPatch(fields) : { value: {} };
        if (patch.error) return json(400, { error: patch.error });
        if (archived !== undefined && typeof archived !== 'boolean') {
          return json(400, { error: 'archived must be true or false' });
        }
        if (archived === undefined && Object.keys(patch.value).length === 0) {
          return json(400, { error: 'Nothing to change' });
        }

        const loaded = await loadSet(ref);
        if (loaded.missing || !loaded.set) {
          return json(404, { error: `No Listen & Learn set for ${ref.platform}/${ref.examCode}` });
        }

        const at = stamp();
        const updates = { ...patch.value, updatedAt: at, updatedBy: auth.user?.oid || null };
        if (archived === true && !loaded.set.archivedAt) {
          updates.archivedAt = at;
          await archiveChapters(ref, loaded.chapters, true, at);
        } else if (archived === false && loaded.set.archivedAt) {
          updates.archivedAt = null;
          await archiveChapters(ref, loaded.chapters, false, at);
        }

        const updated = await store.patchDoc(SET_CONTAINER, ref.id, updates, {
          partitionKey: ref.id,
        });
        context.log?.(
          `patchListenAndLearnBook: ${ref.id} ${Object.keys(updates).join(',')} by ${auth.user?.oid || 'unknown'}`
        );
        return json(200, {
          success: true,
          item: toBookView(updated || { ...loaded.set, ...updates }),
        });
      } catch (error) {
        context.error('patchListenAndLearnBook failed:', error);
        return json(500, { error: 'Failed to update the book' });
      }
    },

    /**
     * DELETE /api/cms/listen-and-learn/{platform}/{examCode}[?force=1]
     *
     * Soft: stamps `softDeletedAt` on the book and every chapter. Refused
     * with 409 and the list of published chapters unless `force`, because a
     * delete that silently takes live audio off the site is the kind of
     * thing a confirm dialog exists for.
     */
    async deleteBook(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const ref = routeSet(request);
        if (!ref) return json(400, { error: 'platform and examCode are required' });
        const loaded = await loadSet(ref);
        if (loaded.missing) {
          return json(404, { error: `No Listen & Learn set for ${ref.platform}/${ref.examCode}` });
        }
        const live = publishedChapters(loaded.chapters);
        if (live.length > 0 && !truthyQuery(request, 'force')) {
          return json(409, {
            error: `${live.length} published ${live.length === 1 ? 'chapter is' : 'chapters are'} live; confirm to delete them too`,
            published: live.map((c) => ({ id: c.id, title: c.title || c.areaName || c.id })),
          });
        }

        const at = stamp();
        const by = auth.user?.oid || null;
        for (const chapter of loaded.chapters) {
          await store.patchDoc(
            EPISODE_CONTAINER,
            chapter.id,
            { softDeletedAt: at, softDeletedBy: by, updatedAt: at },
            { partitionKey: ref.id }
          );
        }
        if (loaded.set) {
          await store.patchDoc(
            SET_CONTAINER,
            ref.id,
            { softDeletedAt: at, softDeletedBy: by, updatedAt: at },
            { partitionKey: ref.id }
          );
        }
        context.log?.(
          `deleteListenAndLearnBook: ${ref.id} with ${loaded.chapters.length} chapters by ${by || 'unknown'}`
        );
        return json(200, { success: true, id: ref.id, chapters: loaded.chapters.length });
      } catch (error) {
        context.error('deleteListenAndLearnBook failed:', error);
        return json(500, { error: 'Failed to delete the book' });
      }
    },

    /**
     * POST /api/cms/listen-and-learn/{platform}/{examCode}/chapters
     * `{ title, sourceText? | contentId?, speak? }`
     *
     * A hand-made chapter (ADR 0033 §4): its text is pasted, or read from a
     * content item's body with the markup dropped. Lands as a draft with no
     * audio and, unless `speak: false`, queues the job that reads it, whose
     * id the 201 carries so the page can follow it.
     */
    async createChapter(request, context, { enqueue } = {}) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const ref = routeSet(request);
        if (!ref) return json(400, { error: 'platform and examCode are required' });
        const body = await request.json().catch(() => null);
        if (!isPlainObject(body)) return json(400, { error: 'Body must be a JSON object' });
        const parsed = parseChapterCreate(body);
        if (parsed.error) return json(400, { error: parsed.error });

        const set = await store.readDoc(SET_CONTAINER, ref.id, ref.id);
        if (!set || isSoftDeleted(set)) {
          return json(404, { error: `No Listen & Learn set for ${ref.platform}/${ref.examCode}` });
        }

        let { sourceText } = parsed.value;
        if (!sourceText && parsed.value.contentId) {
          const item = await store.readDoc(
            'content',
            parsed.value.contentId,
            parsed.value.contentId
          );
          if (!item) return json(404, { error: `content ${parsed.value.contentId} not found` });
          sourceText = speakableTextOf(item);
          if (!sourceText) {
            return json(400, { error: 'That content item has no body text to speak' });
          }
        }

        const existing = await store.readDoc(EPISODE_CONTAINER, parsed.value.id, ref.id);
        if (existing && !isSoftDeleted(existing)) {
          return json(409, {
            error: `A chapter titled "${parsed.value.title}" already exists; rename it`,
          });
        }

        const siblings = await store.queryDocs(
          EPISODE_CONTAINER,
          `SELECT TOP ${MAX_EPISODES_PER_SET} c.id, c["order"], c.softDeletedAt FROM c WHERE c.setId = @setId`,
          [{ name: '@setId', value: ref.id }]
        );
        const order =
          siblings
            .filter((s) => !isSoftDeleted(s))
            .reduce((max, s) => Math.max(max, s.order ?? 0), -1) + 1;

        const at = stamp();
        const by = auth.user?.oid || null;
        const doc = {
          id: parsed.value.id,
          setId: ref.id,
          provider: ref.platform,
          examCode: ref.examCode,
          areaSlug: parsed.value.id,
          areaName: parsed.value.title,
          kind: EPISODE_KIND.manual,
          sources: [],
          sourceText,
          sourceContentId: parsed.value.contentId,
          versions: [],
          order,
          weightLabel: '',
          weightLow: null,
          title: parsed.value.title,
          summary: '',
          keyTakeaways: [],
          transcript: [],
          speakers: null,
          audioUrl: null,
          audioPath: null,
          audioBytes: null,
          speechProvider: null,
          speechModel: null,
          durationSeconds: null,
          audioError: null,
          videos: [],
          status: STATUS.draft,
          generatedAt: at,
          approvedAt: null,
          approvedBy: null,
          createdAt: at,
          createdBy: by,
          updatedAt: at,
          updatedBy: by,
        };
        await store.upsertDoc(EPISODE_CONTAINER, doc);

        let queued = null;
        if (parsed.value.speak) {
          if (typeof enqueue !== 'function') {
            context.error?.('createChapter: no queue output wired');
          } else {
            const accepted = await queueJob({
              type: SPEAK_CHAPTER_JOB_TYPE,
              payload: { platform: ref.platform, examCode: ref.examCode, chapterId: doc.id },
              user: auth.user,
              enqueue,
              extra: {
                speech: await estimateFor(set, { bytes: Buffer.byteLength(sourceText, 'utf8') }),
              },
            });
            queued = JSON.parse(accepted.body);
          }
        }

        context.log?.(`createListenAndLearnChapter: ${ref.id}/${doc.id} by ${by || 'unknown'}`);
        return json(201, { success: true, item: toChapterView(doc, set), job: queued });
      } catch (error) {
        context.error('createListenAndLearnChapter failed:', error);
        return json(500, { error: 'Failed to create the chapter' });
      }
    },

    /**
     * PATCH /api/cms/listen-and-learn/{platform}/{examCode}/chapters/{chapterId}
     * `{ title?, order?, sourceText?, activeVersionId?, archived?, clearError? }`
     *
     * Rename, reposition, change the text to speak next time, choose which
     * take is live, archive / restore, or keep the current take after a
     * failed regeneration (`clearError`). Choosing a version rewrites the
     * top-level audio fields from it, so the public players follow.
     */
    async patchChapter(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const ref = routeSet(request);
        const chapterId = String(request.params?.chapterId || '').trim();
        if (!ref || !CHAPTER_ID_PATTERN.test(chapterId)) {
          return json(400, { error: 'platform, examCode and chapterId are required' });
        }
        const body = await request.json().catch(() => null);
        if (!isPlainObject(body)) return json(400, { error: 'Body must be a JSON object' });
        const parsed = parseChapterPatch(body);
        if (parsed.error) return json(400, { error: parsed.error });

        const chapter = await loadChapter(ref, chapterId);
        if (!chapter) return json(404, { error: `No chapter ${chapterId} in ${ref.id}` });

        const at = stamp();
        const by = auth.user?.oid || null;
        const { title, order, sourceText, activeVersionId, archived, clearError } = parsed.value;
        const updates = { updatedAt: at, updatedBy: by };
        if (title !== undefined) Object.assign(updates, { title, titleEditedAt: at });
        if (order !== undefined) Object.assign(updates, { order, orderEditedAt: at });
        if (sourceText !== undefined) updates.sourceText = sourceText;
        if (clearError) updates.lastError = null;

        if (activeVersionId !== undefined) {
          const versions = versionsOf(chapter);
          if (!versions.some((v) => v.id === activeVersionId)) {
            return json(404, { error: `No version ${activeVersionId} on this chapter` });
          }
          const next = versions.map((v) => ({ ...v, active: v.id === activeVersionId }));
          const mirrored = mirrorActiveVersion({ ...chapter, versions: next });
          Object.assign(updates, {
            versions: next,
            audioUrl: mirrored.audioUrl,
            audioPath: mirrored.audioPath,
            audioBytes: mirrored.audioBytes,
            durationSeconds: mirrored.durationSeconds,
            speechProvider: mirrored.speechProvider,
            speechModel: mirrored.speechModel,
          });
        }

        if (archived === true && chapter.status !== STATUS.archived) {
          Object.assign(updates, {
            status: STATUS.archived,
            statusBeforeArchive: chapter.status || STATUS.draft,
            archivedAt: at,
            archivedWithBook: null,
          });
        } else if (archived === false && chapter.status === STATUS.archived) {
          Object.assign(updates, {
            status: chapter.statusBeforeArchive || STATUS.draft,
            statusBeforeArchive: null,
            archivedAt: null,
            archivedWithBook: null,
          });
        }

        const updated = await store.patchDoc(EPISODE_CONTAINER, chapterId, updates, {
          partitionKey: ref.id,
        });
        const set = await store.readDoc(SET_CONTAINER, ref.id, ref.id);
        context.log?.(
          `patchListenAndLearnChapter: ${ref.id}/${chapterId} ${Object.keys(updates).join(',')} by ${by || 'unknown'}`
        );
        return json(200, {
          success: true,
          item: toChapterView(updated || { ...chapter, ...updates }, set),
        });
      } catch (error) {
        context.error('patchListenAndLearnChapter failed:', error);
        return json(500, { error: 'Failed to update the chapter' });
      }
    },

    /**
     * PATCH /api/cms/listen-and-learn/{platform}/{examCode}/chapters
     * `{ order: [chapterId, …] }` — the new order, first to last. One write
     * per chapter whose position changed, none for the rest.
     */
    async reorderChapters(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const ref = routeSet(request);
        if (!ref) return json(400, { error: 'platform and examCode are required' });
        const body = await request.json().catch(() => null);
        if (!isPlainObject(body)) return json(400, { error: 'Body must be a JSON object' });
        const parsed = parseReorder(body);
        if (parsed.error) return json(400, { error: parsed.error });

        const loaded = await loadSet(ref);
        if (loaded.missing) {
          return json(404, { error: `No Listen & Learn set for ${ref.platform}/${ref.examCode}` });
        }
        const byId = new Map(loaded.chapters.map((c) => [c.id, c]));
        const unknown = parsed.value.filter((id) => !byId.has(id));
        if (unknown.length) {
          return json(404, {
            error: `Unknown chapter${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`,
          });
        }

        const at = stamp();
        let changed = 0;
        for (const [index, id] of parsed.value.entries()) {
          if (byId.get(id).order === index) continue;
          await store.patchDoc(
            EPISODE_CONTAINER,
            id,
            { order: index, orderEditedAt: at, updatedAt: at, updatedBy: auth.user?.oid || null },
            { partitionKey: ref.id }
          );
          changed += 1;
        }
        context.log?.(`reorderListenAndLearnChapters: ${ref.id} ${changed} moved`);
        return json(200, { success: true, changed, order: parsed.value });
      } catch (error) {
        context.error('reorderListenAndLearnChapters failed:', error);
        return json(500, { error: 'Failed to reorder the chapters' });
      }
    },

    /**
     * DELETE /api/cms/listen-and-learn/{platform}/{examCode}/chapters/{chapterId}[?force=1]
     * Soft; refused with 409 for a published chapter unless `force`.
     */
    async deleteChapter(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const ref = routeSet(request);
        const chapterId = String(request.params?.chapterId || '').trim();
        if (!ref || !CHAPTER_ID_PATTERN.test(chapterId)) {
          return json(400, { error: 'platform, examCode and chapterId are required' });
        }
        const chapter = await loadChapter(ref, chapterId);
        if (!chapter) return json(404, { error: `No chapter ${chapterId} in ${ref.id}` });
        if (chapter.status === STATUS.published && !truthyQuery(request, 'force')) {
          return json(409, {
            error: 'This chapter is published; confirm to take it off the site and delete it',
            published: [{ id: chapter.id, title: chapter.title || chapter.areaName || chapter.id }],
          });
        }
        const at = stamp();
        await store.patchDoc(
          EPISODE_CONTAINER,
          chapterId,
          { softDeletedAt: at, softDeletedBy: auth.user?.oid || null, updatedAt: at },
          { partitionKey: ref.id }
        );
        context.log?.(
          `deleteListenAndLearnChapter: ${ref.id}/${chapterId} by ${auth.user?.oid || 'unknown'}`
        );
        return json(200, { success: true, id: chapterId });
      } catch (error) {
        context.error('deleteListenAndLearnChapter failed:', error);
        return json(500, { error: 'Failed to delete the chapter' });
      }
    },

    /**
     * DELETE /api/cms/listen-and-learn/{platform}/{examCode}/chapters/{chapterId}/versions/{versionId}
     *
     * Removes one take: its blob and its entry. Never the active one — the
     * players would point at nothing — and never the implicit `legacy`
     * version's blob while it is the only take, for the same reason.
     */
    async deleteVersion(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const ref = routeSet(request);
        const chapterId = String(request.params?.chapterId || '').trim();
        const versionId = String(request.params?.versionId || '').trim();
        if (!ref || !CHAPTER_ID_PATTERN.test(chapterId) || !VERSION_ID_PATTERN.test(versionId)) {
          return json(400, { error: 'platform, examCode, chapterId and versionId are required' });
        }
        const chapter = await loadChapter(ref, chapterId);
        if (!chapter) return json(404, { error: `No chapter ${chapterId} in ${ref.id}` });

        const versions = versionsOf(chapter);
        const target = versions.find((v) => v.id === versionId);
        if (!target) return json(404, { error: `No version ${versionId} on this chapter` });
        if (target.active || activeVersionOf(chapter)?.id === versionId) {
          return json(409, {
            error: 'The active version cannot be deleted; make another one active first',
          });
        }

        if (target.audioPath && typeof storage.deleteBlob === 'function') {
          await storage.deleteBlob(AUDIO_CONTAINER, target.audioPath);
        }
        const at = stamp();
        const remaining = versions.filter((v) => v.id !== versionId);
        await store.patchDoc(
          EPISODE_CONTAINER,
          chapterId,
          { versions: remaining, updatedAt: at, updatedBy: auth.user?.oid || null },
          { partitionKey: ref.id }
        );
        context.log?.(
          `deleteListenAndLearnVersion: ${ref.id}/${chapterId}/${versionId} by ${auth.user?.oid || 'unknown'}`
        );
        return json(200, { success: true, id: versionId, versions: remaining });
      } catch (error) {
        context.error('deleteListenAndLearnVersion failed:', error);
        return json(500, { error: 'Failed to delete the version' });
      }
    },

    /**
     * POST /api/cms/listen-and-learn/{platform}/{examCode}/chapters/{chapterId}/regenerate
     * `{ ttsModel? }`
     *
     * One chapter, a new take (ADR 0033 §4). Which job runs depends on the
     * chapter's kind: a guide chapter re-reads its area from the set's study
     * guide (`areas: [slug]`), a source chapter re-reads its stored sources,
     * a hand-made chapter speaks its `sourceText`. Each lands as a new
     * active version; the approval is kept; a failure keeps the current
     * take live. The 202 carries the expected speech spend.
     */
    async regenerateChapter(request, context, { enqueue } = {}) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const ref = routeSet(request);
        const chapterId = String(request.params?.chapterId || '').trim();
        if (!ref || !CHAPTER_ID_PATTERN.test(chapterId)) {
          return json(400, { error: 'platform, examCode and chapterId are required' });
        }
        const body = (await request.json().catch(() => null)) ?? {};
        if (!isPlainObject(body)) return json(400, { error: 'Body must be a JSON object' });
        const model = parseTtsModel(body.ttsModel);
        if (model.error) return json(400, { error: model.error });

        const [set, chapter] = await Promise.all([
          store.readDoc(SET_CONTAINER, ref.id, ref.id),
          loadChapter(ref, chapterId),
        ]);
        if (!chapter) return json(404, { error: `No chapter ${chapterId} in ${ref.id}` });
        if (typeof enqueue !== 'function') {
          context.error?.('regenerateChapter: no queue output wired');
          return json(500, { error: 'Job queue is not configured' });
        }

        const kind = episodeKindOf(chapter);
        const cert = {
          ...(set?.certTitle ? { certTitle: set.certTitle } : {}),
          ...(set?.certSlug ? { certSlug: set.certSlug } : {}),
        };
        const ttsModel = model.value ? { ttsModel: model.value } : {};
        let type;
        let payload;
        let bytes = MAX_SCRIPT_BYTES;

        if (kind === EPISODE_KIND.manual) {
          if (!chapter.sourceText) {
            return json(400, { error: 'This chapter has no text to speak; add some first' });
          }
          type = SPEAK_CHAPTER_JOB_TYPE;
          payload = { platform: ref.platform, examCode: ref.examCode, chapterId, ...ttsModel };
          bytes = Buffer.byteLength(chapter.sourceText, 'utf8');
        } else if (kind === EPISODE_KIND.source) {
          const parsed = parseSourceEpisodePayload({
            platform: ref.platform,
            examCode: ref.examCode,
            title: chapter.areaName || chapter.title,
            sources: chapter.sources,
            ...cert,
          });
          if (parsed.error) return json(400, { error: parsed.error });
          type = LISTEN_AND_LEARN_JOB_TYPE;
          payload = {
            platform: ref.platform,
            examCode: ref.examCode,
            title: parsed.value.title,
            sources: parsed.value.sources,
            ...cert,
            ...ttsModel,
          };
        } else {
          if (!set?.studyGuideUrl) {
            return json(400, {
              error:
                'This chapter was read from a study guide the set no longer names; run the set from the Generate tab',
            });
          }
          type = LISTEN_AND_LEARN_JOB_TYPE;
          payload = {
            platform: ref.platform,
            examCode: ref.examCode,
            studyGuideUrl: set.studyGuideUrl,
            areas: [chapter.areaSlug || chapter.id],
            ...cert,
            ...ttsModel,
          };
        }

        const speech = await estimateFor(set, { bytes, ttsModel: model.value });
        context.log?.(`regenerateListenAndLearnChapter: ${ref.id}/${chapterId} as ${type}`);
        return await queueJob({
          type,
          payload,
          user: auth.user,
          enqueue,
          extra: { chapterId, speech },
        });
      } catch (error) {
        context.error('regenerateListenAndLearnChapter failed:', error);
        return json(500, { error: 'Failed to queue the regeneration' });
      }
    },

    /**
     * GET /api/cms/listen-and-learn/speech-options — what the Settings tab
     * and the book voice dialog offer: the models with their ceilings and
     * which is the default, the voices per provider, the providers with
     * their configuration state and the one that would run, the pin, and
     * the speaking-rate bounds. Read from the server so the page cannot
     * describe a fallback the code does not have.
     */
    async speechOptions(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const stored = await readStoredListenAndLearnModel(store.readDoc).catch(() => null);
        return json(200, {
          success: true,
          models: listenAndLearnModelOptions(),
          defaultModel: LISTEN_AND_LEARN_DEFAULT_MODEL,
          storedModel: stored,
          effectiveModel: stored || LISTEN_AND_LEARN_DEFAULT_MODEL,
          voices: { gemini: GEMINI_VOICES, azure: AZURE_VOICES },
          voiceProviders: VOICE_PROVIDERS,
          speakingRate: SPEAKING_RATE,
          speech: describeSpeechProviders(env, { product: PRODUCT }),
        });
      } catch (error) {
        context.error('listenAndLearnSpeechOptions failed:', error);
        return json(500, { error: 'Failed to read the speech options' });
      }
    },

    /**
     * POST /api/cms/listen-and-learn/estimate
     * `{ bytes? | text?, ttsModel?, platform?, examCode? }`
     *
     * What speaking this much text would cost, before it is spoken: by the
     * book's voice when one is named, else by the run's model or the stored
     * default. A ceiling, in the same arithmetic the 202 uses.
     */
    async estimateSpeech(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = await request.json().catch(() => null);
        if (!isPlainObject(body)) return json(400, { error: 'Body must be a JSON object' });
        const model = parseTtsModel(body.ttsModel);
        if (model.error) return json(400, { error: model.error });
        let bytes;
        if (typeof body.text === 'string') bytes = Buffer.byteLength(body.text, 'utf8');
        else if (Number.isFinite(Number(body.bytes)) && Number(body.bytes) >= 0)
          bytes = Math.ceil(Number(body.bytes));
        else return json(400, { error: 'Give text or a byte count to price' });

        let set = null;
        if (body.platform && body.examCode) {
          const id = setId(String(body.platform), String(body.examCode));
          set = await store.readDoc(SET_CONTAINER, id, id);
        }
        return json(200, {
          success: true,
          ...(await estimateFor(set, { bytes, ttsModel: model.value })),
        });
      } catch (error) {
        context.error('listenAndLearnEstimate failed:', error);
        return json(500, { error: 'Failed to estimate the speech cost' });
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
        if (!isPlainObject(body)) {
          return json(400, { error: 'Body must be a JSON object' });
        }

        const parsed = parseSourceEpisodePayload(body);
        if (parsed.error) return json(400, { error: parsed.error });
        const { platform, examCode, title, areaSlug, sources, cert } = parsed.value;

        if (typeof enqueue !== 'function') {
          context.error?.('generateSourceEpisode: no queue output wired');
          return json(500, { error: 'Job queue is not configured' });
        }

        // The job id is the correlation key; the episode id would be the
        // owner's title, which is content and stays out of the log.
        const response = await queueJob({
          type: LISTEN_AND_LEARN_JOB_TYPE,
          payload: {
            platform,
            examCode,
            title,
            sources,
            ...(cert.title ? { certTitle: cert.title } : {}),
            ...(cert.slug ? { certSlug: cert.slug } : {}),
          },
          user: auth.user,
          enqueue,
          extra: { areaSlug, sourceCount: sources.length },
        });
        context.log?.(
          `generateSourceEpisode: queued ${JSON.parse(response.body).jobId} for ${examCode} (${sources.length} sources)`
        );
        return response;
      } catch (error) {
        context.error('generateSourceEpisode failed:', error);
        return json(500, { error: 'Failed to queue the source-grounded episode' });
      }
    },

    /**
     * POST /api/cms/listen-and-learn/review
     * `{ platform, examCode, areaSlug, status: 'published' | 'draft' }`
     *
     * Publishing is publisher-gated; withdrawing to draft is editor-gated
     * (ADR 0033 §4). The role is read from the body before the guard runs,
     * and an unreadable body is refused by the editor floor first.
     */
    async reviewEpisode(request, context) {
      const body = await request.json().catch(() => null);
      const wantsPublish =
        isPlainObject(body) && String(body.status || '').trim() === STATUS.published;
      const auth = await guard.requireRole(request, wantsPublish ? 'publisher' : 'editor');
      if (auth.error) return auth.error;
      try {
        if (!isPlainObject(body)) {
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
        // record of why, which is what `draft` is for. 'archived' has its own
        // control on the chapter.
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
          now: stamp(),
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
