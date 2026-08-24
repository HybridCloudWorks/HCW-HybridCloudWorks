/**
 * Persist generated Listen & Learn episodes.
 *
 * Episodes land as **drafts**. They are AI-written exam guidance published
 * under Saul's name on pages people study from, so nothing reaches the site
 * until it is approved in the admin portal. `status` is the only gate, and the
 * public read filters on it (public-reads.js `getListenAndLearn`).
 *
 * Layout
 *   Cosmos   listen_and_learn/{provider}_{examCode}              — the set
 *            listen_and_learn_episodes/{areaSlug} @ /setId       — one per area
 *   Blob     listenandlearn/{provider}/{examCode}/{areaSlug}.mp3
 *
 * Two containers rather than an `episodes[]` array on the set: episodes are
 * approved, regenerated and listened to individually, and concurrent array
 * updates on a single document lose writes. `listen_and_learn_episodes` is
 * partitioned on `/setId` precisely because an area slug is unique only within
 * its set — flattening these under `/id` would let AZ-104 and AZ-305 overwrite
 * each other's "manage-governance" episode (see cosmos-client PARTITION_KEY_PATHS).
 *
 * Ported from Site-Main `functions/listen-and-learn/publish.js` (088f458).
 * Firestore's `set({merge:true})` has no Cosmos equivalent — an upsert is a
 * whole-document replace — so the two merging writers read first and merge
 * explicitly. That is a round trip, and it is the reason the failure path
 * cannot quietly delete a good episode's transcript.
 */
import { mediaUrlFor } from '../blob-paths.js';

export const SET_CONTAINER = 'listen_and_learn';
export const EPISODE_CONTAINER = 'listen_and_learn_episodes';

/** Blob container for episode audio. Declared in infra/main.tf. */
export const AUDIO_CONTAINER = 'listenandlearn';

export const STATUS = {
  draft: 'draft',
  published: 'published',
  failed: 'failed',
};

/** `azure` + `AZ-104` → `azure_az-104`. Stable, readable, collision-free. */
export function setId(provider, examCode) {
  return `${String(provider).toLowerCase()}_${String(examCode).toLowerCase()}`;
}

/** Blob path for one episode's audio. Validated by blob-paths `isValidBlobPath`. */
export function audioPath(provider, examCode, areaSlug) {
  return `${String(provider).toLowerCase()}/${String(examCode).toLowerCase()}/${areaSlug}.mp3`;
}

/**
 * Upload episode audio and return the URL to persist.
 *
 * The URL is site-relative and points at the media delivery route, not at the
 * storage account. The account denies anonymous reads outright
 * (`allow_nested_items_to_be_public = false` plus a network deny rule), so a
 * direct blob URL would be dead on arrival — and a stored absolute URL breaks
 * on any topology change. Both reasons are set out in public-media.js.
 */
export async function uploadEpisodeAudio({
  storage,
  provider,
  examCode,
  areaSlug,
  audio,
  contentType,
}) {
  const path = audioPath(provider, examCode, areaSlug);

  await storage.uploadBlob(AUDIO_CONTAINER, path, audio, contentType, {
    provider: String(provider).toLowerCase(),
    examCode: String(examCode).toUpperCase(),
    areaSlug,
  });

  return { path, url: mediaUrlFor(AUDIO_CONTAINER, path), bytes: audio.length };
}

/** The stored episode shape. Everything the admin review and the player read. */
export function toEpisodeDoc({ area, script, audio, videos, examCode, provider, order, now }) {
  return {
    id: area.slug,
    setId: setId(provider, examCode),
    provider,
    examCode,
    areaSlug: area.slug,
    areaName: area.name,
    // Position in the official study guide. Episodes are listened to in the
    // order the exam presents them, which is rarely the order a query returns
    // and never the order exam weighting would give.
    order: Number.isInteger(order) ? order : 0,
    weightLabel: area.weightLabel || '',
    weightLow: area.weightLow ?? null,
    title: script.title,
    summary: script.summary,
    keyTakeaways: script.keyTakeaways,
    // The transcript is kept deliberately: it is the accessible equivalent of
    // the audio, and it is what makes an episode reviewable before approval.
    transcript: script.dialogue,
    speakers: script.speakers,
    audioUrl: audio?.url || null,
    audioPath: audio?.path || null,
    audioBytes: audio?.bytes || null,
    // Provenance for the audio, alongside the approver's for the decision.
    speechProvider: audio?.speechProvider || null,
    speechModel: audio?.speechModel || null,
    durationSeconds: audio?.durationSeconds ?? null,
    // Set when the script generated but synthesis did not — no key yet, or a
    // rejected one. The admin page shows it so "no player" is explained
    // rather than mysterious.
    audioError: audio?.error || null,
    videos: videos || [],
    status: STATUS.draft,
    generatedAt: now,
    approvedAt: null,
    approvedBy: null,
  };
}

/**
 * Write one episode as a draft, replacing any previous generation for the
 * same area. Regeneration is idempotent because the document id is the area
 * slug within the set's partition.
 *
 * A whole-document replace, deliberately: a regenerated episode must not
 * inherit the approval of the version it replaced.
 */
export async function saveEpisode(
  store,
  { provider, examCode, area, script, audio, videos, order, now }
) {
  const doc = toEpisodeDoc({ area, script, audio, videos, examCode, provider, order, now });
  await store.upsertDoc(EPISODE_CONTAINER, doc);
  return doc;
}

/**
 * Record that an area failed, so the admin page shows a gap instead of silence.
 *
 * Merges onto whatever is stored. A previous good generation keeps its
 * transcript and audio and is merely marked failed — replacing it wholesale
 * would destroy a working episode because its *re*generation failed.
 */
export async function saveEpisodeFailure(
  store,
  { provider, examCode, area, error, order, now }
) {
  const id = setId(provider, examCode);
  const existing = (await store.readDoc(EPISODE_CONTAINER, area.slug, id)) || {};

  await store.upsertDoc(EPISODE_CONTAINER, {
    ...existing,
    id: area.slug,
    setId: id,
    provider,
    examCode,
    areaSlug: area.slug,
    areaName: area.name,
    weightLabel: area.weightLabel || '',
    order: Number.isInteger(order) ? order : (existing.order ?? 0),
    status: STATUS.failed,
    error: String(error).slice(0, 500),
    generatedAt: now,
  });
}

/** Upsert the parent document that describes the certification this set belongs to. */
export async function saveSet(store, { provider, examCode, guide, cert, now, actorId }) {
  const id = setId(provider, examCode);
  const existing = (await store.readDoc(SET_CONTAINER, id, id)) || {};

  const doc = {
    ...existing,
    id,
    provider,
    examCode,
    certSlug: cert?.slug || String(examCode).toLowerCase(),
    certTitle: cert?.title || guide.title,
    studyGuideUrl: guide.sourceUrl,
    studyGuideTitle: guide.title,
    areaCount: guide.areas.length,
    generatedAt: now,
    generatedBy: actorId || null,
  };

  await store.upsertDoc(SET_CONTAINER, doc);
  return doc;
}

/**
 * Approve or unapprove a single episode.
 *
 * Publishing stamps who approved it and when — for AI-generated study content
 * the provenance is the point, not decoration.
 */
export async function setEpisodeStatus(
  store,
  { provider, examCode, areaSlug, status, actorId, now }
) {
  if (!Object.values(STATUS).includes(status)) {
    throw new Error(`Unknown episode status "${status}"`);
  }
  const id = setId(provider, examCode);

  return store.patchDoc(
    EPISODE_CONTAINER,
    areaSlug,
    {
      status,
      approvedAt: status === STATUS.published ? now : null,
      approvedBy: status === STATUS.published ? actorId || null : null,
    },
    { partitionKey: id }
  );
}
