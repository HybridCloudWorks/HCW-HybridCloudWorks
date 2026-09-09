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
 *            listen_and_learn_episodes/source_{slug} @ /setId    — one per source episode
 *   Blob     listenandlearn/{provider}/{examCode}/{areaSlug}.mp3
 *
 * Two containers rather than an `episodes[]` array on the set: episodes are
 * approved, regenerated and listened to individually, and concurrent array
 * updates on a single document lose writes. `listen_and_learn_episodes` is
 * partitioned on `/setId` precisely because an area slug is unique only within
 * its set — flattening these under `/id` would let AZ-104 and AZ-305 overwrite
 * each other's "manage-governance" episode (see cosmos-client PARTITION_KEY_PATHS).
 *
 * TWO KINDS OF EPISODE (#433). A guide-grounded episode is one scored area of
 * the official study guide; a source-grounded one is built from web pages and
 * YouTube videos the owner chose. Both live in the same container under the
 * same set, because both are Listen & Learn episodes of one certification,
 * and both are reviewed and approved the same way. What tells them apart is
 * `kind`, a STORED field — never inferred from whether `sources` happens to be
 * empty — read through `episodeKindOf`, which is the one place the rule "a
 * document with no `kind` is a guide episode" lives: every episode written
 * before #433 is a guide episode and carries no `kind`. The source list is
 * stored beside the transcript for the same reason the transcript is: a
 * reviewer who cannot see what the model was given is reviewing half of it.
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

/** What an episode was grounded on. See the header. */
export const EPISODE_KIND = Object.freeze({
  guide: 'guide',
  source: 'source',
});

/**
 * The one rule for reading `kind`: a document with none is a guide episode,
 * because every episode written before #433 was one and none of them carries
 * the field. Anything that is not a known kind is also read as guide rather
 * than passed through — a reader that branches on the value must not meet a
 * third one.
 */
export function episodeKindOf(doc) {
  return doc?.kind === EPISODE_KIND.source ? EPISODE_KIND.source : EPISODE_KIND.guide;
}

/**
 * The document id of a source-grounded episode: `source_<slug of its title>`.
 *
 * Within the set's partition, so regenerating the same title replaces the
 * same document — idempotent, like a guide area. The underscore is the point:
 * `studyguide.slugify` maps every non-alphanumeric run to a single hyphen, so
 * no guide area can ever produce an id containing `_`, and a guide area named
 * "Source control" (slug `source-control`) cannot collide with a source
 * episode titled "Control" — which `source-control` would have. The id is
 * also the blob path segment, and `_` is within `blob-paths` PATH_PATTERN.
 */
export const SOURCE_EPISODE_ID_PREFIX = 'source_';

/** `Manage Azure identities` → `manage-azure-identities`; same rule as studyguide.js. */
export function slugifyTitle(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function sourceEpisodeId(title) {
  const slug = slugifyTitle(title);
  if (!slug) throw new Error('A source-grounded episode needs a title with at least one letter or digit');
  return `${SOURCE_EPISODE_ID_PREFIX}${slug}`;
}

/**
 * Where source episodes sort: after every guide area. `order` is study-guide
 * position for guide episodes and the largest real guide has eight areas, so
 * anything past that keeps the guide's order intact and puts the owner's own
 * episodes at the end of the set. Several source episodes tie, and the sort in
 * handlers.js is stable, so they keep query order among themselves.
 */
export const SOURCE_EPISODE_ORDER = 1000;

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

/**
 * The stored episode shape. Everything the admin review and the player read.
 *
 * `kind` is written on every new document, guide episodes included, from
 * #433 on; `sources` is the list `validateGroundingSources` resolved — deduped,
 * classified — and is empty for a guide episode, which is not what makes it
 * one (see the header).
 */
export function toEpisodeDoc({
  area,
  script,
  audio,
  videos,
  examCode,
  provider,
  order,
  now,
  kind = EPISODE_KIND.guide,
  sources = [],
}) {
  return {
    id: area.slug,
    setId: setId(provider, examCode),
    provider,
    examCode,
    areaSlug: area.slug,
    areaName: area.name,
    kind: kind === EPISODE_KIND.source ? EPISODE_KIND.source : EPISODE_KIND.guide,
    sources: Array.isArray(sources) ? sources : [],
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
  { provider, examCode, area, script, audio, videos, order, now, kind, sources }
) {
  const doc = toEpisodeDoc({
    area,
    script,
    audio,
    videos,
    examCode,
    provider,
    order,
    now,
    kind,
    sources,
  });
  await store.upsertDoc(EPISODE_CONTAINER, doc);
  return doc;
}

/**
 * Record that an area failed, so the admin page shows a gap instead of silence.
 *
 * Merges onto whatever is stored. A previous good generation keeps its
 * transcript and audio and is merely marked failed — replacing it wholesale
 * would destroy a working episode because its *re*generation failed.
 *
 * `kind` is written explicitly: a failure marker for a source episode that
 * had never succeeded would otherwise be a document with no `kind`, which
 * `episodeKindOf` reads as guide. The caller's kind wins, then the stored
 * one, then the default.
 */
export async function saveEpisodeFailure(
  store,
  { provider, examCode, area, error, order, now, kind }
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
    kind: episodeKindOf(kind ? { kind } : existing),
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
 * The set a source-grounded episode belongs to, created only if it is missing.
 *
 * A source episode is one episode of a certification, not a guide run, so it
 * must not do what `saveSet` does — stamp `generatedAt` and `studyGuideUrl`
 * as if the guide had been parsed again. If the set exists it is left exactly
 * as it is. If it does not (the owner grounded an episode before ever running
 * the guide), a minimal set is written so the admin list and `getSet` can
 * find the episode: `areaCount` 0 and no study-guide fields, which the guide
 * run fills in when it happens.
 */
export async function ensureSet(store, { provider, examCode, cert, now, actorId }) {
  const id = setId(provider, examCode);
  const existing = await store.readDoc(SET_CONTAINER, id, id);
  if (existing) return existing;

  const doc = {
    id,
    provider,
    examCode,
    certSlug: cert?.slug || String(examCode).toLowerCase(),
    certTitle: cert?.title || String(examCode),
    studyGuideUrl: null,
    studyGuideTitle: null,
    areaCount: 0,
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
