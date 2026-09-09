/**
 * host-publish.js — put one approved episode on RSS.com, idempotently (#437,
 * ADR 0029 §1b).
 *
 * ## The contract
 *
 * `publishEpisodeToHost` takes the episode document and returns THE PATCH TO
 * STORE on it. It never throws past itself, and it never touches `status`,
 * `approvedAt` or `approvedBy` — a publish failure does not un-approve an
 * episode. What it writes lives entirely under `host.rsscom`:
 *
 *     host.rsscom = {
 *       episodeId,      // the host's numeric episode id — the idempotency key
 *       guid,           // the host's feed guid, what the ingest will key on
 *       hostStatus,     // Episode.status as last seen: draft|scheduled|published
 *       audioPath,      // the blob path the host currently has audio FROM
 *       uploadId,       // the presigned-upload id that audio went up under
 *       publishedAt,    // first successful publish, never rewritten
 *       lastAttemptAt,  // every run, success or not
 *       error,          // null on success; { status, code, message, retryable } on failure
 *     }
 *
 * The caller (a later slice: the approval hook and the admin retry) merges
 * the patch onto the document. This file does not know the store.
 *
 * ## Idempotent on `host.rsscom.episodeId`
 *
 * The first successful run creates the host episode and records its id.
 * Every run after that PATCHes the same id — metadata always, audio only when
 * `doc.audioPath` differs from `host.rsscom.audioPath` — so a retry after a
 * timeout, a regenerated episode, or an edited summary all converge on one
 * host episode. A second `POST` is the one thing this file must never do,
 * because the feed is public and the ingest keys `podcasts` rows on the feed
 * guid: two host episodes are two site rows.
 *
 * The weak spot is a create that succeeded upstream but whose response was
 * lost before the id was recorded. That is a real gap on a beta API and it is
 * left visible rather than hidden: the next run would create a duplicate.
 * Closing it needs the host to accept a client-chosen key, which the spec does
 * not offer today, or a pre-flight `listEpisodes` search by title, which is
 * heuristic. Recorded here so the later slice decides it on purpose.
 *
 * ## What the host is told
 *
 * `describeForHost` is pure and tested on its own. `ai_content: true` on every
 * episode this file publishes — they are AI-produced, the spec has the flag,
 * and the flag is set honestly. `schedule_datetime` is the current time on
 * create, which the spec documents as "auto-publishing as soon as transcode
 * completes"; without it the episode would sit as a draft on the host and the
 * feed would never carry it. On a re-publish it is sent again only when the
 * last recorded host status is not `published`, because re-scheduling an
 * already-published episode is a behaviour the spec does not describe and
 * this file does not guess at.
 */
import { RssComError } from './rsscom.js';

/** Spec limits: `title` 1–250, `description` ≤ 4000, `custom_link` ≤ 500. */
export const HOST_TITLE_MAX = 250;
export const HOST_DESCRIPTION_MAX = 4000;
export const HOST_LINK_MAX = 500;

export const DEFAULT_AUDIO_MIME = 'audio/mpeg';

const clean = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Cut to at most `max` characters with an ellipsis. The cut lands on the
 * last space inside the prefix when that space is past the halfway point;
 * otherwise it is a hard character cut. So a long sentence is cut between
 * words, and one unbroken run of characters — a URL, a slug, a pasted hash —
 * is cut mid-run rather than dropped to almost nothing. That is the right
 * trade for a title and a description: the host shows them, nothing parses
 * them, and a visibly truncated token is better than a half-empty field.
 */
function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The host-facing fields for one episode document. Pure.
 *
 * Plain text throughout — the spec's `description` says nothing about HTML,
 * and a podcast app that shows tags literally is worse than one that shows a
 * dash list. Key takeaways follow the summary as a list because they are
 * what the episode notes are for.
 *
 * @param {object} doc the `listen_and_learn_episodes` document
 * @param {object} [options]
 * @param {string} [options.publicUrl] the site page for this episode, if the caller has one
 * @returns {{ title: string, description: string, ai_content: true,
 *   itunes_episode_type: 'full', custom_link?: string }}
 */
export function describeForHost(doc, { publicUrl } = {}) {
  const title = truncate(clean(doc?.title), HOST_TITLE_MAX);
  if (!title) {
    throw new RssComError('The episode has no title to publish under.', {
      status: null,
      code: 'VALIDATION',
    });
  }

  const summary = clean(doc?.summary);
  const takeaways = (Array.isArray(doc?.keyTakeaways) ? doc.keyTakeaways : [])
    .map(clean)
    .filter(Boolean);

  const sections = [];
  if (summary) sections.push(summary);
  if (takeaways.length) {
    sections.push(['Key takeaways:', ...takeaways.map((t) => `- ${t}`)].join('\n'));
  }
  const description = truncate(sections.join('\n\n') || title, HOST_DESCRIPTION_MAX);

  const fields = {
    title,
    description,
    ai_content: true,
    itunes_episode_type: 'full',
  };

  const link = clean(publicUrl);
  if (link) {
    if (link.length > HOST_LINK_MAX || !/^https?:\/\//i.test(link)) {
      throw new RssComError(`custom_link must be an http(s) URL of at most ${HOST_LINK_MAX} characters.`, {
        status: null,
        code: 'VALIDATION',
      });
    }
    fields.custom_link = link;
  }

  return fields;
}

/** The last segment of the blob path, which is what the host shows as the file name. */
function filenameFor(audioPath) {
  const last = String(audioPath).split('/').filter(Boolean).pop() || 'episode.mp3';
  return last;
}

/** Accept a bare Buffer or `{ bytes | body, contentType }` from `readAudio`. */
function normaliseAudio(result) {
  if (!result) return null;
  if (Buffer.isBuffer(result) || result instanceof Uint8Array) {
    return { bytes: result, contentType: DEFAULT_AUDIO_MIME };
  }
  const bytes = result.bytes || result.body || null;
  if (!bytes || !bytes.length) return null;
  return { bytes, contentType: result.contentType || DEFAULT_AUDIO_MIME };
}

function toRecordedError(error) {
  if (error instanceof RssComError) {
    return {
      status: error.status ?? null,
      code: error.code,
      message: error.message,
      retryable: Boolean(error.retryable),
    };
  }
  return {
    status: null,
    code: 'UNEXPECTED',
    message: error?.message ? String(error.message) : String(error),
    retryable: false,
  };
}

/**
 * Upload the document's audio and return the presigned-upload id.
 *
 * Three calls, in order: read the bytes (ours), create the presigned upload
 * (API key), PUT the bytes (no key). A failure at any step is the caller's
 * failure — nothing here is partially recorded, because an upload the host
 * has not been told about is invisible to it and costs nothing to redo.
 */
async function uploadAudioFor({ client, readAudio, doc }) {
  const audio = normaliseAudio(await readAudio(doc.audioPath));
  if (!audio) {
    throw new RssComError(`No audio bytes were read for ${doc.audioPath}.`, {
      status: null,
      code: 'VALIDATION',
    });
  }
  const upload = await client.createPresignedUpload({
    assetType: 'audio',
    mime: audio.contentType,
    filename: filenameFor(doc.audioPath),
  });
  if (!upload?.id || !upload?.url) {
    throw new RssComError('The presigned upload answered without an id and a url.', {
      status: null,
      code: 'UPSTREAM',
      detail: JSON.stringify(upload).slice(0, 300),
    });
  }
  await client.uploadAudio(upload.url, audio.bytes, audio.contentType);
  return upload.id;
}

/**
 * Publish or re-publish one episode document to RSS.com.
 *
 * @param {object} deps
 * @param {ReturnType<import('./rsscom.js').createRssComClient>} deps.client
 * @param {(audioPath: string) => Promise<Buffer|{bytes?: Buffer, body?: Buffer, contentType?: string}>} deps.readAudio
 * @param {object} deps.doc the episode document as stored
 * @param {() => Date} [deps.now]
 * @param {string} [deps.publicUrl] the site page for the episode, becomes `custom_link`
 * @returns {Promise<{ host: { rsscom: object } }>} the patch to merge onto the document
 */
export async function publishEpisodeToHost({ client, readAudio, doc, now = () => new Date(), publicUrl }) {
  const previous = doc?.host?.rsscom && typeof doc.host.rsscom === 'object' ? doc.host.rsscom : {};
  const attemptAt = now().toISOString();

  const failure = (error) => ({
    host: { rsscom: { ...previous, lastAttemptAt: attemptAt, error: toRecordedError(error) } },
  });

  try {
    if (!client) {
      throw new RssComError('RSS.com publishing has no client; nothing was sent.', {
        status: null,
        code: 'NOT_CONFIGURED',
      });
    }
    if (client.configured && client.configured.ok === false) {
      throw new RssComError(client.configured.reason, { status: null, code: 'NOT_CONFIGURED' });
    }
    if (!doc?.audioPath) {
      throw new RssComError('The episode has no audio, so there is nothing to publish.', {
        status: null,
        code: 'VALIDATION',
      });
    }

    const metadata = describeForHost(doc, { publicUrl });

    if (previous.episodeId) {
      const audioChanged = doc.audioPath !== previous.audioPath;
      const fields = { ...metadata };
      let uploadId = previous.uploadId ?? null;
      if (audioChanged) {
        uploadId = await uploadAudioFor({ client, readAudio, doc });
        fields.audio_upload_id = uploadId;
      }
      if (previous.hostStatus !== 'published') fields.schedule_datetime = attemptAt;

      const episode = await client.updateEpisode(previous.episodeId, fields);
      return {
        host: {
          rsscom: {
            ...previous,
            episodeId: previous.episodeId,
            guid: episode?.guid ?? previous.guid ?? null,
            hostStatus: episode?.status ?? previous.hostStatus ?? null,
            audioPath: doc.audioPath,
            uploadId,
            publishedAt: previous.publishedAt ?? attemptAt,
            lastAttemptAt: attemptAt,
            error: null,
          },
        },
      };
    }

    const uploadId = await uploadAudioFor({ client, readAudio, doc });
    const episode = await client.createEpisode({
      ...metadata,
      audio_upload_id: uploadId,
      schedule_datetime: attemptAt,
    });
    if (episode?.id === undefined || episode?.id === null) {
      throw new RssComError('RSS.com created the episode but answered without an id.', {
        status: null,
        code: 'UPSTREAM',
        detail: JSON.stringify(episode).slice(0, 300),
      });
    }
    return {
      host: {
        rsscom: {
          ...previous,
          episodeId: episode.id,
          guid: episode.guid ?? null,
          hostStatus: episode.status ?? null,
          audioPath: doc.audioPath,
          uploadId,
          publishedAt: attemptAt,
          lastAttemptAt: attemptAt,
          error: null,
        },
      },
    };
  } catch (error) {
    return failure(error);
  }
}
