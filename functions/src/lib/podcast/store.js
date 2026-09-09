/**
 * Persist podcast transcripts — the podcast's own product (#435, #432).
 *
 * A transcript is a two-host script read from something the site already
 * published, plus the audio rendered from it. Two sources feed it: published
 * articles (this slice) and Plaud recordings (#434, later). Both land here,
 * in `podcast_transcripts`, and NOT in `listen_and_learn_episodes`. The
 * owner's ruling (2026-09-08, on #435) is the reason and it is editorial, not
 * technical: Listen & Learn is the Learn section's exam-prep playlist,
 * surfaced per provider, and content transcripts are the written catalogue
 * read aloud for the podcast. Storing the second inside the first's container
 * would have had every Learn playlist reader start serving article episodes.
 * So the two products keep two containers, and the shape below borrows from
 * `listen-and-learn/publish.js` without sharing its storage.
 *
 * Layout
 *   Cosmos   podcast_transcripts/article_{slug} @ /id     — one per article
 *            (Plaud later: podcast_transcripts/plaud_{recordingId})
 *   Blob     podcast/article/{slug}.mp3
 *
 * `/id` rather than a set partition because a transcript has no set: the id is
 * globally unique by construction — `article_` plus the article's slug, which
 * the publish path already keeps unique across the catalogue — so the
 * per-partition uniqueness `listen_and_learn_episodes` needs for repeated area
 * slugs does not arise. Regeneration is therefore idempotent for free, and a
 * regeneration is a whole-document replace, exactly as `saveEpisode` does it:
 * the new draft must not inherit the approval of the version it replaced.
 *
 * `sourceProvider` is recorded when the article names a cloud provider and
 * left null otherwise. It is NOT a refusal condition. The earlier analysis
 * that refused an unknown provider was reasoning about the Learn container,
 * whose listings key on `provider`; nothing here does, and the hub (#442)
 * lists transcripts by date.
 *
 * The container is provisioned by Terraform from infra/cosmos-containers.json.
 * Until that apply runs, every write here answers 404 — `saveTranscript` turns
 * that into a sentence naming the container and the apply, because a
 * generation that spent on a model call and then "failed to save" with a bare
 * `Resource Not Found` sends someone looking at the wrong thing.
 */
import { mediaUrlFor } from '../blob-paths.js';
import { resolveArticleSlug, resolveArticleTitle } from '../listen-and-learn/article-script.js';

export const TRANSCRIPT_CONTAINER = 'podcast_transcripts';

/** Blob container for transcript audio. Declared in infra/storage.tf. */
export const PODCAST_AUDIO_CONTAINER = 'podcast';

export const STATUS = Object.freeze({
  draft: 'draft',
  published: 'published',
  failed: 'failed',
});

export const SOURCE_KINDS = Object.freeze({
  article: 'article',
});

/**
 * The part of an article's identity that names its transcript and its audio.
 *
 * The slug, normally. It falls back to the document id for a legacy article
 * that was published without one — refusing would leave that article the only
 * kind that cannot be read aloud, for no editorial reason. Either way the key
 * becomes a Cosmos id and a blob path segment, so it is held to the blob path
 * character class; an article whose slug and id both fail it is refused by
 * name rather than stored under a mangled key.
 */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function articleKey(article) {
  for (const candidate of [resolveArticleSlug(article), String(article?.id || '').trim()]) {
    if (candidate && KEY_PATTERN.test(candidate)) return candidate;
  }
  throw new Error(
    `Article ${article?.id || '(no id)'} has neither a slug nor an id usable as a transcript key`
  );
}

/** `article_` + the key; Plaud transcripts will be `plaud_` + the recording id. */
export function transcriptId(article) {
  return `${SOURCE_KINDS.article}_${articleKey(article)}`;
}

/** Blob path for one article transcript's audio. Validated by blob-paths `isValidBlobPath`. */
export function audioPath(article) {
  return `${SOURCE_KINDS.article}/${articleKey(article)}.mp3`;
}

/**
 * The article's cloud provider as a lowercase slug, or null.
 *
 * Reads the two spellings the admin pages read (`'Cloud Provider'` on the
 * migrated half of the catalogue, `cloudProvider` on the rest) and nothing
 * else. Null is a valid answer — see the header.
 */
export function resolveArticleProvider(article) {
  const raw = String(article?.['Cloud Provider'] || article?.cloudProvider || '')
    .trim()
    .toLowerCase();
  return raw || null;
}

/**
 * Upload transcript audio and return the URL to persist.
 *
 * Site-relative, through the media delivery route, for the reasons
 * `uploadEpisodeAudio` gives: the storage account denies anonymous reads, and
 * a stored absolute URL breaks on any topology change.
 */
export async function uploadTranscriptAudio({ storage, article, audio, contentType }) {
  const path = audioPath(article);

  await storage.uploadBlob(PODCAST_AUDIO_CONTAINER, path, audio, contentType, {
    sourceKind: SOURCE_KINDS.article,
    sourceId: String(article?.id || ''),
    sourceSlug: resolveArticleSlug(article) || '',
  });

  return { path, url: mediaUrlFor(PODCAST_AUDIO_CONTAINER, path), bytes: audio.length };
}

/**
 * The stored transcript shape. Everything the hub's review and the player read.
 *
 * `host` is reserved for #437: the RSS.com publish record (episode id, URL,
 * published-at) lands there when an approval pushes the episode to the host.
 * Null until then, and present from the start so the hub can key on it.
 */
export function toTranscriptDoc({ article, script, audio, now }) {
  return {
    id: transcriptId(article),
    sourceKind: SOURCE_KINDS.article,
    sourceId: article?.id || null,
    sourceSlug: resolveArticleSlug(article) || null,
    sourceTitle: resolveArticleTitle(article) || null,
    sourceProvider: resolveArticleProvider(article),
    title: script.title,
    summary: script.summary,
    keyTakeaways: script.keyTakeaways,
    // The transcript is the artefact: it is what the hub reviews against the
    // article, the accessible equivalent of the audio, and what #436 re-voices.
    transcript: script.dialogue,
    speakers: script.speakers,
    // Partial coverage is a fact about the transcript, so it travels with it —
    // the review is the only place a cut article can be caught.
    truncated: script.truncated === true,
    audioUrl: audio?.url || null,
    audioPath: audio?.path || null,
    audioBytes: audio?.bytes || null,
    speechProvider: audio?.speechProvider || null,
    speechModel: audio?.speechModel || null,
    durationSeconds: audio?.durationSeconds ?? null,
    // Set when the script generated but the audio did not — no speech key,
    // a rejected one, or a blob container Terraform has not created yet. The
    // hub shows it so "no player" is explained rather than mysterious.
    audioError: audio?.error || null,
    status: STATUS.draft,
    generatedAt: now,
    approvedAt: null,
    approvedBy: null,
    host: null,
  };
}

/**
 * The fields a listing carries. An allowlist, like
 * `LISTEN_AND_LEARN_LIST_FIELDS`: the transcript body is withheld from the
 * list on purpose — it is kilobytes per row and the hub reads it one
 * transcript at a time through the detail route.
 */
export const TRANSCRIPT_LIST_FIELDS = Object.freeze([
  'id',
  'sourceKind',
  'sourceId',
  'sourceSlug',
  'sourceTitle',
  'sourceProvider',
  'title',
  'summary',
  'truncated',
  'audioUrl',
  'audioBytes',
  'durationSeconds',
  'audioError',
  'status',
  'error',
  'generatedAt',
  'approvedAt',
  'approvedBy',
  'host',
]);

/**
 * A Cosmos 404 on a write means the container itself is missing — a document
 * cannot be "not found" on an upsert. Say what that means and what fixes it.
 */
function explainWriteFailure(err) {
  const code = err?.code ?? err?.statusCode;
  if (code !== 404) return err;
  const wrapped = new Error(
    `Cosmos container "${TRANSCRIPT_CONTAINER}" is not provisioned yet, so the transcript could ` +
      `not be saved. It is declared in infra/cosmos-containers.json; run the Terraform apply that ` +
      `creates it, then generate again. Cosmos said: ${err?.message || err}`
  );
  wrapped.cause = err;
  return wrapped;
}

/**
 * Write one transcript as a draft, replacing any previous generation for the
 * same article. A whole-document replace, deliberately: a regenerated
 * transcript must not inherit the approval of the version it replaced.
 */
export async function saveTranscript(store, { article, script, audio, now }) {
  const doc = toTranscriptDoc({ article, script, audio, now });
  try {
    await store.upsertDoc(TRANSCRIPT_CONTAINER, doc);
  } catch (err) {
    throw explainWriteFailure(err);
  }
  return doc;
}

/**
 * Record that a generation failed, so the hub shows a gap instead of silence.
 *
 * Merges onto whatever is stored, like `saveEpisodeFailure`: a previous good
 * transcript keeps its text and audio and is merely marked failed — replacing
 * it wholesale would destroy a working transcript because its *re*generation
 * failed.
 */
export async function markTranscriptFailed(store, { article, error, now }) {
  const id = transcriptId(article);
  const existing = (await store.readDoc(TRANSCRIPT_CONTAINER, id, id)) || {};

  const doc = {
    ...existing,
    id,
    sourceKind: SOURCE_KINDS.article,
    sourceId: article?.id || existing.sourceId || null,
    sourceSlug: resolveArticleSlug(article) || existing.sourceSlug || null,
    sourceTitle: resolveArticleTitle(article) || existing.sourceTitle || null,
    sourceProvider: resolveArticleProvider(article) ?? existing.sourceProvider ?? null,
    status: STATUS.failed,
    error: String(error).slice(0, 500),
    generatedAt: now,
    host: existing.host ?? null,
  };
  try {
    await store.upsertDoc(TRANSCRIPT_CONTAINER, doc);
  } catch (err) {
    throw explainWriteFailure(err);
  }
  return doc;
}

/**
 * Approve or unapprove a single transcript.
 *
 * Publishing stamps who approved it and when. This is the act that will put
 * an AI-read episode under the owner's name on the podcast feed (#437 hangs
 * the host publish on it), so the provenance is the point.
 */
export async function setTranscriptStatus(store, { id, status, actorId, now }) {
  if (!Object.values(STATUS).includes(status)) {
    throw new Error(`Unknown transcript status "${status}"`);
  }

  return store.patchDoc(
    TRANSCRIPT_CONTAINER,
    id,
    {
      status,
      approvedAt: status === STATUS.published ? now : null,
      approvedBy: status === STATUS.published ? actorId || null : null,
    },
    { partitionKey: id }
  );
}
