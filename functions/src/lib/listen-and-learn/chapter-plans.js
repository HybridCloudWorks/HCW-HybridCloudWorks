/**
 * Pure planning the chapter routes do before writing (PR #841 split of
 * handlers.js): the patch a chapter edit produces, the document a hand-made
 * chapter starts as, and which job regenerates a chapter by its kind.
 */
import { EPISODE_KIND, STATUS, episodeKindOf, mirrorActiveVersion, versionsOf } from './publish.js';
import { LISTEN_AND_LEARN_JOB_TYPE, parseSourceEpisodePayload } from './source-episode.js';
import { chapterArchiveUpdates } from './library.js';
import { MAX_SCRIPT_BYTES } from './script.js';
import { refuse } from './handlers-shared.js';

/** The job that speaks a hand-made chapter's text (listen-and-learn-jobs.js). */
export const SPEAK_CHAPTER_JOB_TYPE = 'speak-listen-and-learn-chapter';

/** The audio fields that follow a newly chosen active version; null if unknown. */
function activeVersionUpdates(chapter, activeVersionId) {
  const versions = versionsOf(chapter);
  if (!versions.some((v) => v.id === activeVersionId)) return null;
  const next = versions.map((v) => ({ ...v, active: v.id === activeVersionId }));
  const mirrored = mirrorActiveVersion({ ...chapter, versions: next });
  return {
    versions: next,
    audioUrl: mirrored.audioUrl,
    audioPath: mirrored.audioPath,
    audioBytes: mirrored.audioBytes,
    durationSeconds: mirrored.durationSeconds,
    speechProvider: mirrored.speechProvider,
    speechModel: mirrored.speechModel,
  };
}

/**
 * The patch a chapter PATCH writes, from its parsed body against the chapter
 * as stored: edits are stamped, choosing a version rewrites the top-level
 * audio fields from it so the public players follow, and archive / restore
 * is a no-op when the chapter is already there.
 */
export function chapterPatchUpdates(chapter, parsed, { at, by }) {
  const { title, order, sourceText, activeVersionId, archived, clearError } = parsed;
  const updates = { updatedAt: at, updatedBy: by };
  if (title !== undefined) Object.assign(updates, { title, titleEditedAt: at });
  if (order !== undefined) Object.assign(updates, { order, orderEditedAt: at });
  if (sourceText !== undefined) updates.sourceText = sourceText;
  if (clearError) updates.lastError = null;
  if (activeVersionId !== undefined) {
    const chosen = activeVersionUpdates(chapter, activeVersionId);
    if (!chosen) return refuse(404, `No version ${activeVersionId} on this chapter`);
    Object.assign(updates, chosen);
  }
  if (archived !== undefined) {
    Object.assign(updates, chapterArchiveUpdates(chapter, archived, { at }) || {});
  }
  return { ok: true, updates };
}

/** The document a hand-made chapter starts as: a draft with no audio yet. */
export function newChapterDoc({ ref, parsed, sourceText, order, at, by }) {
  return {
    id: parsed.id,
    setId: ref.id,
    provider: ref.platform,
    examCode: ref.examCode,
    areaSlug: parsed.id,
    areaName: parsed.title,
    kind: EPISODE_KIND.manual,
    sources: [],
    sourceText,
    sourceContentId: parsed.contentId,
    versions: [],
    order,
    weightLabel: '',
    weightLow: null,
    title: parsed.title,
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
}

/**
 * Which job regenerates a chapter, by its kind: a guide chapter re-reads its
 * area from the set's study guide (`areas: [slug]`), a source chapter
 * re-reads its stored sources, a hand-made chapter speaks its `sourceText`.
 * Each answers `{ type, payload, bytes }` — the bytes price the run — or the
 * 400 that says why this chapter cannot be regenerated as it stands.
 */
const REGENERATION_PLANS = Object.freeze({
  [EPISODE_KIND.manual]({ chapter, chapterId, ref, modelFields }) {
    if (!chapter.sourceText) {
      return refuse(400, 'This chapter has no text to speak; add some first');
    }
    return {
      ok: true,
      type: SPEAK_CHAPTER_JOB_TYPE,
      payload: { platform: ref.platform, examCode: ref.examCode, chapterId, ...modelFields },
      bytes: Buffer.byteLength(chapter.sourceText, 'utf8'),
    };
  },
  [EPISODE_KIND.source]({ chapter, ref, cert, modelFields }) {
    const parsed = parseSourceEpisodePayload({
      platform: ref.platform,
      examCode: ref.examCode,
      title: chapter.areaName || chapter.title,
      sources: chapter.sources,
      ...cert,
    });
    if (parsed.error) return refuse(400, parsed.error);
    return {
      ok: true,
      type: LISTEN_AND_LEARN_JOB_TYPE,
      payload: {
        platform: ref.platform,
        examCode: ref.examCode,
        title: parsed.value.title,
        sources: parsed.value.sources,
        ...cert,
        ...modelFields,
      },
      bytes: MAX_SCRIPT_BYTES,
    };
  },
  [EPISODE_KIND.guide]({ chapter, set, ref, cert, modelFields }) {
    if (!set?.studyGuideUrl) {
      return refuse(
        400,
        'This chapter was read from a study guide the set no longer names; run the set from the Generate tab'
      );
    }
    return {
      ok: true,
      type: LISTEN_AND_LEARN_JOB_TYPE,
      payload: {
        platform: ref.platform,
        examCode: ref.examCode,
        studyGuideUrl: set.studyGuideUrl,
        areas: [chapter.areaSlug || chapter.id],
        ...cert,
        ...modelFields,
      },
      bytes: MAX_SCRIPT_BYTES,
    };
  },
});

export function regenerationPlan({ chapter, chapterId, set, ref, ttsModel }) {
  const cert = {
    ...(set?.certTitle ? { certTitle: set.certTitle } : {}),
    ...(set?.certSlug ? { certSlug: set.certSlug } : {}),
  };
  const modelFields = ttsModel ? { ttsModel } : {};
  const plan = REGENERATION_PLANS[episodeKindOf(chapter)];
  return plan({ chapter, chapterId, set, ref, cert, modelFields });
}
