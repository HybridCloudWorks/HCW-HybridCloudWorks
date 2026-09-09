/**
 * publish-transcript.js — the host step for a podcast transcript: what an
 * approval queues, what the job then does, and the record both leave on the
 * document (#437, slice 2; ADR 0029 §1b).
 *
 * ## Two doors, one path
 *
 * Approval (`POST cms/podcast/transcripts/review` → `published`) and the
 * retry button (`POST cms/podcast/transcripts/{id}/publish`) both call
 * `scheduleHostPublish`. It answers the two cases that need no network on the
 * spot — no audio on the transcript, or RSS.com not configured — as a
 * `skipped` record, and otherwise writes a `publish-podcast-transcript` job,
 * marks the document `pending` and sends the queue message. The job
 * (`runHostPublish`, wired in functions/podcast-jobs.js) reads the audio from
 * the `podcast` blob container, calls `publishEpisodeToHost` and stores what
 * it returns. Retry is therefore never a regeneration: it re-runs the same
 * step on the same document, and `host-publish.js` PATCHes the host episode
 * the document already names rather than creating a second one.
 *
 * ## Why a job and not an inline call
 *
 * The client's own deadlines are 30 s for the presigned upload, 300 s for the
 * PUT and 30 s for the episode create — six minutes worst case against an
 * HTTP response bounded at 230 s, and tens of seconds in the ordinary case
 * for a 10 MB MP3. An approval that blocked on that would leave a reviewer
 * watching a spinner for a step whose failure, by design, does not change
 * the approval. So the status is written, the job is queued, the response
 * says `pending` with the job id, and the hub shows "publishing…" until the
 * document says otherwise.
 *
 * ## The record: `host.rsscom`
 *
 * The stable keys are `host-publish.js`'s (`episodeId`, `guid`, `hostStatus`,
 * `audioPath`, `uploadId`, `publishedAt`, `lastAttemptAt`, `error`). This file
 * adds transient ones it strips before the step runs, so they never leak
 * into a stored success or failure:
 *
 *     pending    true from enqueue until the job writes its outcome
 *     jobId      that job, so the hub can poll getJob
 *     queuedAt   when
 *     skipped    'not_configured' | 'no_audio' | 'not_published'
 *     reason     the sentence for it
 *
 * `skipped` is not `error`. Nothing was attempted, so the hub says "not
 * configured" rather than "failed", and the operator's fix is seeding two
 * Key Vault secrets rather than reading an upstream status. A skip clears
 * `error` and a queue clears `skipped`: the record carries one outcome, the
 * latest, and `lastAttemptAt` dates it. The stable keys survive both, so a
 * transcript that already has a host episode keeps showing it while a retry
 * is in flight.
 *
 * ## What never happens here
 *
 * `status`, `approvedAt` and `approvedBy` are never in a patch this file
 * writes: a publish that fails, or is skipped, leaves the approval exactly
 * as the reviewer made it. And nothing writes `podcasts` — the feed is the
 * ingest boundary (ADR 0029 §1b, "What does not"). The site learns of the
 * episode when `timers/podcasts.js` reads the show's feed, exactly as it
 * does for one uploaded by hand, and the accepted cost is the lag between
 * approval and appearance that the hub explains.
 *
 * ## `custom_link`
 *
 * The job resolves the article's public URL through `publicUrlOf` (the same
 * precedence the Social Hub uses) and passes it as `custom_link`; a
 * transcript whose article carries no public URL is published without one.
 * The lookup is injected here so the step is testable without the content
 * container.
 */
import { JOBS_CONTAINER, TERMINAL_JOB_STATUSES, newJobDoc } from '../jobs.js';
import { DEFAULT_AUDIO_MIME, publishEpisodeToHost } from './host-publish.js';
import { PODCAST_AUDIO_CONTAINER, STATUS, TRANSCRIPT_CONTAINER } from './store.js';

/** The platform job that runs the host step. Registered in functions/podcast-jobs.js. */
export const PUBLISH_JOB_TYPE = 'publish-podcast-transcript';

export const HOST_SKIP = Object.freeze({
  notConfigured: 'not_configured',
  noAudio: 'no_audio',
  notPublished: 'not_published',
});

/** Cosmos ids are bounded at 255 bytes; a transcript id longer than this is not one. */
export const MAX_TRANSCRIPT_ID_CHARS = 255;

/**
 * The one validator for a `transcriptId`, shared by the routes that enqueue
 * and the worker that runs, so both refuse the same input with the same
 * sentence. Returns `{ value }` or `{ error }`.
 */
export function parseTranscriptId(raw) {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return { error: 'transcriptId is required' };
  if (id.length > MAX_TRANSCRIPT_ID_CHARS) return { error: 'transcriptId is too long' };
  return { value: id };
}

const TRANSIENT_KEYS = new Set(['pending', 'jobId', 'queuedAt', 'skipped', 'reason']);

/**
 * The stable half of `host.rsscom` — what `host-publish.js` wrote, without
 * the transient keys this file adds. This is what the step is handed as the
 * previous record, so `pending`/`skipped` never ride `...previous` into a
 * stored outcome.
 */
export function stableHostRecord(host) {
  const record = host?.rsscom && typeof host.rsscom === 'object' ? host.rsscom : {};
  const stable = {};
  for (const [key, value] of Object.entries(record)) {
    if (!TRANSIENT_KEYS.has(key)) stable[key] = value;
  }
  return stable;
}

/**
 * Whether there is anything to send, decided without a network call.
 *
 * Configuration first, then the document: until the two secrets are seeded
 * every transcript reads "not configured", which names the one fix; once
 * they are, a transcript without audio reads "no audio", which names the
 * other. Nothing is uploaded without audio.
 *
 * @param {object} doc the transcript document
 * @param {{ ok: boolean, reason?: string }} [configured] `isConfigured(env)` or `client.configured`
 * @returns {{ skipped: string, reason: string } | null}
 */
export function hostSkipFor(doc, configured) {
  if (configured && configured.ok === false) {
    return { skipped: HOST_SKIP.notConfigured, reason: configured.reason };
  }
  if (!doc?.audioPath) {
    const cause = doc?.audioError ? ` (${String(doc.audioError).slice(0, 200)})` : '';
    return {
      skipped: HOST_SKIP.noAudio,
      reason:
        `The transcript has no audio${cause}, so nothing was sent to RSS.com; ` +
        'regenerate it once audio synthesis succeeds, then publish again.',
    };
  }
  return null;
}

const skippedPatch = (doc, skip, at) => ({
  host: {
    rsscom: {
      ...stableHostRecord(doc?.host),
      skipped: skip.skipped,
      reason: skip.reason,
      lastAttemptAt: at,
      error: null,
    },
  },
});

const pendingPatch = (doc, jobId, at) => ({
  host: { rsscom: { ...stableHostRecord(doc?.host), pending: true, jobId, queuedAt: at } },
});

const patchTranscript = (store, id, patch) =>
  store.patchDoc(TRANSCRIPT_CONTAINER, id, patch, { partitionKey: id });

/**
 * Whether a publish job the document names is still queued or running. A
 * job document that is gone, or terminal, means the marker is stale — an
 * `onComplete` that could not run, a container wiped — and a new job may go.
 */
async function jobInFlight(store, jobId) {
  if (!jobId) return false;
  const job = await store.readDoc(JOBS_CONTAINER, jobId, jobId);
  return Boolean(job) && !TERMINAL_JOB_STATUSES.includes(job.status);
}

/**
 * Decide and record what happens to one approved transcript: skip it on the
 * spot, refuse to double-queue it, or write the job and mark it pending.
 *
 * The caller has already checked `status === 'published'`; this does not,
 * because the review handler calls it in the same breath as the status
 * write and holds the pre-write document.
 *
 * @param {object} deps
 * @param {{ readDoc: Function, upsertDoc: Function, patchDoc: Function }} deps.store
 * @param {object} deps.doc the transcript as stored
 * @param {{ ok: boolean, reason?: string }} deps.configured `isConfigured(env)`
 * @param {(message: { jobId: string, type: string }) => void} deps.enqueue the queue output
 * @param {{ oid?: string, email?: string }} [deps.requestedBy]
 * @param {() => string} [deps.uuid]
 * @param {() => Date} [deps.now]
 * @returns {Promise<{ outcome: 'skipped' | 'in_flight' | 'queued', host: object, jobId?: string }>}
 */
export async function scheduleHostPublish({
  store,
  doc,
  configured,
  enqueue,
  requestedBy,
  uuid = () => crypto.randomUUID(),
  now = () => new Date(),
}) {
  const id = doc.id;
  const at = now().toISOString();

  const skip = hostSkipFor(doc, configured);
  if (skip) {
    const patch = skippedPatch(doc, skip, at);
    await patchTranscript(store, id, patch);
    return { outcome: 'skipped', host: patch.host.rsscom };
  }

  const current = doc?.host?.rsscom;
  if (current?.pending === true && (await jobInFlight(store, current.jobId))) {
    return { outcome: 'in_flight', jobId: current.jobId, host: current };
  }

  if (typeof enqueue !== 'function') {
    throw new Error(`${PUBLISH_JOB_TYPE}: no queue output wired`);
  }

  // Job document first, then the marker, then the message — the same order
  // as enqueueJob, so a marker never names a job that was not written, and a
  // message lost after the write is the sweeper's ordinary case.
  const jobId = uuid();
  await store.upsertDoc(
    JOBS_CONTAINER,
    newJobDoc({
      id: jobId,
      type: PUBLISH_JOB_TYPE,
      payload: { transcriptId: id },
      requestedBy,
      createdAt: at,
    })
  );
  const patch = pendingPatch(doc, jobId, at);
  await patchTranscript(store, id, patch);
  enqueue({ jobId, type: PUBLISH_JOB_TYPE });
  return { outcome: 'queued', jobId, host: patch.host.rsscom };
}

/**
 * Adapt a `readBlobForDelivery`-shaped reader to what `publishEpisodeToHost`
 * wants from `readAudio`. Null stays null (the step records it as a
 * validation failure naming the path). A blob stored without a real content
 * type falls back to `audio/mpeg`, because that is what the generator writes
 * and `expected_mime` on the presigned upload must match the PUT.
 */
export function audioReaderFor(readBlob, container = PODCAST_AUDIO_CONTAINER) {
  return async (audioPath) => {
    const blob = await readBlob(container, audioPath);
    if (!blob) return null;
    const contentType =
      blob.contentType && blob.contentType !== 'application/octet-stream'
        ? blob.contentType
        : DEFAULT_AUDIO_MIME;
    return { bytes: blob.body, contentType };
  };
}

/**
 * The job's half: read the transcript, refuse what should not go, run the
 * step, store the record. Returns the stored `host.rsscom`.
 *
 * Throws only when there is no document to record on. A transcript that
 * was withdrawn to draft between enqueue and run is not a failure — it is
 * recorded as `skipped: 'not_published'` and the job succeeds, because the
 * job did exactly what the document allowed.
 *
 * @param {object} deps
 * @param {{ readDoc: Function, patchDoc: Function }} deps.store
 * @param {string} deps.id the transcript id
 * @param {ReturnType<import('./rsscom.js').createRssComClient>} deps.client
 * @param {(audioPath: string) => Promise<object|null>} deps.readAudio
 * @param {(doc: object) => Promise<string|null>} [deps.resolvePublicUrl] the article's public URL, for `custom_link`
 * @param {() => Date} [deps.now]
 */
export async function runHostPublish({
  store,
  id,
  client,
  readAudio,
  resolvePublicUrl,
  now = () => new Date(),
}) {
  const doc = await store.readDoc(TRANSCRIPT_CONTAINER, id, id);
  if (!doc) throw new Error(`Podcast transcript ${id} was not found`);
  const at = now().toISOString();

  let skip = null;
  if (doc.status !== STATUS.published) {
    skip = {
      skipped: HOST_SKIP.notPublished,
      reason:
        `The transcript is ${doc.status || 'not published'}, so nothing was sent to RSS.com; ` +
        'approving it is what publishes it.',
    };
  } else {
    skip = hostSkipFor(doc, client?.configured);
  }
  if (skip) {
    const patch = skippedPatch(doc, skip, at);
    await patchTranscript(store, id, patch);
    return patch.host.rsscom;
  }

  const publicUrl =
    typeof resolvePublicUrl === 'function' ? (await resolvePublicUrl(doc)) || null : null;

  const patch = await publishEpisodeToHost({
    client,
    readAudio,
    doc: { ...doc, host: { rsscom: stableHostRecord(doc.host) } },
    now,
    publicUrl: publicUrl || undefined,
  });
  await patchTranscript(store, id, patch);
  return patch.host.rsscom;
}

/**
 * The job died around the step rather than in it — a thrown store error, or
 * the platform timeout — so `pending` would otherwise stay true forever and
 * the hub would say "publishing…" about a job that is over. Clear it and
 * record why, retryable, but only while the marker is still set: a worker
 * that stored its outcome a moment before the timer fired has already said
 * something better, and this must not overwrite it.
 *
 * @param {object} deps
 * @param {{ readDoc: Function, patchDoc: Function }} deps.store
 * @param {string} deps.id
 * @param {'failed' | 'timeout' | string} deps.status the job's terminal status
 * @param {string|null} deps.error the job's recorded error text
 * @param {() => Date} [deps.now]
 * @returns {Promise<boolean>} whether a record was written
 */
export async function recordHostJobFailure({ store, id, status, error, now = () => new Date() }) {
  const doc = await store.readDoc(TRANSCRIPT_CONTAINER, id, id);
  if (!doc || doc.host?.rsscom?.pending !== true) return false;
  const patch = {
    host: {
      rsscom: {
        ...stableHostRecord(doc.host),
        lastAttemptAt: now().toISOString(),
        error: {
          status: null,
          code: status === 'timeout' ? 'JOB_TIMEOUT' : 'JOB_FAILED',
          message: error || `The publish job ended as ${status}.`,
          retryable: true,
        },
      },
    },
  };
  await patchTranscript(store, id, patch);
  return true;
}
