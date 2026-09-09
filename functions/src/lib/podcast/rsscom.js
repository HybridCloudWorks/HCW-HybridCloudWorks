/**
 * rsscom.js — the RSS.com Core API, as much of it as publishing needs (#437,
 * ADR 0029 §1b).
 *
 * ## What was verified against the API on 2026-09-09
 *
 * Read from `https://api.rss.com/v4/openapi.json` (the Swagger page at
 * `/v4/docs` is a shell that loads that document). The API is **still in
 * public beta**: RSS.com's help article says it "was introduced in December
 * 2025 and is currently in beta" and that "small changes to the documentation
 * or endpoints may occur". That is why this file is thin and every request it
 * makes is one a caller can repeat — see "Designing against a beta API" on
 * the issue.
 *
 * - Authentication is the `X-Api-Key` header. A key comes from
 *   https://dashboard.rss.com/api-access/ and is on the Max plan.
 * - `GET /v4/podcasts` → `Podcast[]`, each with a numeric `id`. That id is
 *   the `podcast_id` path segment on everything below, and `RSSCOM_PODCAST_ID`
 *   holds it: the client never guesses the show from the list.
 * - `POST /v4/podcasts/{podcast_id}/assets/presigned-uploads` with
 *   `{ asset_type: 'audio' | 'image', expected_mime, filename }` (all three
 *   required) → `201 { id, url, asset_type, expected_mime, filename }`. The
 *   bytes are then `PUT` to `url`, which is a presigned URL on a storage host
 *   rather than on api.rss.com — so the API key is NOT sent with them. The
 *   `id` is the `audio_upload_id` a later episode write references.
 * - `POST /v4/podcasts/{podcast_id}/episodes` requires `title` (1–250) and
 *   `description` (≤ 4000, "also known as episode notes"; the spec says
 *   nothing about HTML, so this client sends plain text). Optional fields the
 *   publisher uses: `audio_upload_id`, `ai_content` (boolean|null, "whether
 *   this episode was made with ai or not"), `itunes_episode_type`
 *   (`full`|`trailer`|`bonus`), `custom_link` (≤ 500, uri), and
 *   `schedule_datetime` — "set to the current timestamp for auto-publishing as
 *   soon as transcode completes; set to null for unscheduling". Without it an
 *   episode is created and left where the dashboard would leave it, which is
 *   a draft. `additionalProperties: false`, so an unknown field is a 400.
 *   Response: `201 Episode`.
 * - `PATCH /v4/podcasts/{podcast_id}/episodes/{episode_id}` takes the same
 *   fields, none required → `200 Episode`.
 * - `GET …/episodes/{episode_id}` → `Episode`; `GET …/episodes` →
 *   `Episode[]` with `page`, `limit` (≤ 100), `order` (`oldest`|`newest`),
 *   `status`, `filter` query parameters.
 * - `Episode.status` is `draft` | `scheduled` | `published`. `Episode` also
 *   carries `guid`, `audio_url`, `publish_datetime`, `dashboard_url` and
 *   `processing.{transcode,transcribe,…}.status` (`pending` | `processing` |
 *   `done` | `error`).
 * - `PUT …/episodes/{episode_id}/transcript` requires `{ transcription
 *   (≤ 500000), format: 'vtt' | 'srt' | 'txt' }` → `EpisodeTranscript
 *   { transcription, format, status: 'draft' | 'published' }`.
 * - Errors: `400 { status, form_errors[], field_errors{} }`; 401, 402, 403,
 *   404 and 500 are `{ status, message }`. 402 is the one to know about —
 *   it is what the API answers when the plan no longer includes API access.
 *
 * ## What this file deliberately does not do
 *
 * No retries. The unit of retry is the episode document (`host-publish.js`):
 * a caller that failed re-runs the publish and the document says which host
 * episode it already has. Retrying a `POST …/episodes` inside the client is
 * how a duplicate episode would be made, and a duplicate on a public feed is
 * the failure #437 lists first.
 *
 * No parsing of responses beyond JSON. The shapes above are what the spec
 * promises today; a beta endpoint that changes shape should fail loudly in
 * the orchestrator's recorded error, not be papered over here.
 *
 * ## Configuration
 *
 * `RSSCOM_API_KEY` and `RSSCOM_PODCAST_ID` are Key Vault references
 * (`RSSCOM-API-KEY`, `RSSCOM-PODCAST-ID` in `infra/functionapp.tf`). They are
 * read through `readKey`, so an unresolved `@Microsoft.KeyVault(…)` string is
 * "not configured" rather than a key, and `isConfigured` says which one is
 * missing in a sentence an operator can act on. Two gates, not one:
 * `listPodcasts` needs the key alone (`hasApiKey`), because it is the call
 * that finds the id the second setting is seeded with; every `{podcast_id}`
 * route and the upload flow need both (`isConfigured`).
 */
import { readKey } from '../ai/router.js';
import { fetchWithTimeout } from '../http/fetch-with-timeout.js';

export const RSSCOM_API_BASE_URL = 'https://api.rss.com/v4';

/** JSON calls. Generous because the create-episode call kicks off a transcode. */
export const RSSCOM_TIMEOUT_MS = 30_000;

/**
 * The audio PUT. A Listen & Learn episode is 64 kbps mono, so twenty minutes
 * is under 10 MB; five minutes is ample for that and for a human recording
 * several times the size, and still a deadline rather than forever.
 */
export const RSSCOM_UPLOAD_TIMEOUT_MS = 300_000;

export const API_KEY_SETTING = 'RSSCOM_API_KEY';
export const PODCAST_ID_SETTING = 'RSSCOM_PODCAST_ID';

/**
 * One error type for everything the client raises, so a caller can record it
 * on a document without inspecting the cause.
 *
 * `status` is the upstream HTTP status, or `null` when no response was had
 * (timeout, DNS, not configured). `detail` is what the API said, already
 * flattened to a string. `code` is ours: `NOT_CONFIGURED`, `KEY_REJECTED`,
 * `PLAN_REQUIRED`, `VALIDATION`, `NOT_FOUND`, `UPSTREAM`, `TIMEOUT`, `NETWORK`,
 * and for the keyless PUT to the presigned URL `UPLOAD_REJECTED` (401/403 from
 * the storage host — an expired URL, never the API key), `UPLOAD_FAILED` (any
 * other status from it) and `UPLOAD_UNREACHABLE` (no response from it — the
 * message names the upload host, not RSS.com).
 * `retryable` is true when repeating the same call later could succeed
 * without a change on our side.
 */
export class RssComError extends Error {
  constructor(
    message,
    { status = null, code = 'UPSTREAM', detail = null, retryable = false } = {}
  ) {
    super(message);
    this.name = 'RssComError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.retryable = retryable;
  }
}

/**
 * Whether the account-level calls can run — `GET /v4/podcasts` needs only the
 * key. Split from `isConfigured` because that call is how the podcast id is
 * discovered in the first place; gating it on the id it exists to find would
 * make the seeding instruction circular.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function hasApiKey(env = process.env) {
  if (readKey(env, API_KEY_SETTING)) return { ok: true };
  return {
    ok: false,
    reason:
      `RSS.com publishing is not configured: ${API_KEY_SETTING} (Key Vault secret ` +
      'RSSCOM-API-KEY) is not set, so episodes stay on the manual upload path.',
  };
}

/**
 * Whether publishing can run at all, and if not, why, in one sentence. This
 * is the gate for every `{podcast_id}` route and for the upload flow.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ ok: true, podcastId: string } | { ok: false, reason: string }}
 */
export function isConfigured(env = process.env) {
  const apiKey = readKey(env, API_KEY_SETTING);
  const podcastId = readKey(env, PODCAST_ID_SETTING);
  const missing = [];
  if (!apiKey) missing.push(`${API_KEY_SETTING} (Key Vault secret RSSCOM-API-KEY)`);
  if (!podcastId) missing.push(`${PODCAST_ID_SETTING} (Key Vault secret RSSCOM-PODCAST-ID)`);
  if (missing.length) {
    return {
      ok: false,
      reason: `RSS.com publishing is not configured: ${missing.join(' and ')} ${
        missing.length === 1 ? 'is' : 'are'
      } not set, so episodes stay on the manual upload path.`,
    };
  }
  if (!/^\d+$/.test(podcastId)) {
    return {
      ok: false,
      reason:
        `RSS.com publishing is not configured: ${PODCAST_ID_SETTING} must be the numeric id ` +
        `GET /v4/podcasts returns for the show, not "${podcastId}".`,
    };
  }
  return { ok: true, podcastId };
}

/** Flatten the API's error body to one line. 400s carry lists; the rest a message. */
function describeErrorBody(data, text) {
  if (data && typeof data === 'object') {
    const parts = [];
    if (typeof data.message === 'string' && data.message) parts.push(data.message);
    if (Array.isArray(data.form_errors) && data.form_errors.length) {
      parts.push(data.form_errors.join('; '));
    }
    if (data.field_errors && typeof data.field_errors === 'object') {
      for (const [field, errors] of Object.entries(data.field_errors)) {
        const list = Array.isArray(errors) ? errors.join(', ') : String(errors);
        parts.push(`${field}: ${list}`);
      }
    }
    if (parts.length) return parts.join(' — ');
  }
  return String(text || '').slice(0, 300);
}

function classify(status) {
  if (status === 401 || status === 403) return { code: 'KEY_REJECTED', retryable: false };
  if (status === 402) return { code: 'PLAN_REQUIRED', retryable: false };
  if (status === 400) return { code: 'VALIDATION', retryable: false };
  if (status === 404) return { code: 'NOT_FOUND', retryable: false };
  if (status === 408 || status === 429 || status >= 500) {
    return { code: 'UPSTREAM', retryable: true };
  }
  return { code: 'UPSTREAM', retryable: false };
}

function messageFor(operation, status, detail) {
  if (status === 401 || status === 403) {
    return `RSS.com rejected the API key while ${operation} (${status}${detail ? ` ${detail}` : ''}).`;
  }
  if (status === 402) {
    return `RSS.com answered 402 while ${operation}: the plan does not include API access${
      detail ? ` (${detail})` : ''
    }.`;
  }
  return `RSS.com answered ${status} while ${operation}${detail ? `: ${detail}` : ''}.`;
}

/**
 * A refused PUT to the presigned URL. That request carries no API key — the
 * URL is the credential, and it is a storage host answering, not api.rss.com —
 * so its 401/403 must not read as "the API key was rejected". The usual cause
 * is an expired or already-used URL, and the remedy is a fresh presigned
 * upload, which a re-run mints: retryable. A 5xx from the storage host is
 * retryable for the ordinary reason; a 4xx of another kind is not.
 */
function uploadError(status, detail) {
  const suffix = detail ? `: ${detail}` : '';
  if (status === 401 || status === 403) {
    return new RssComError(
      `The presigned upload URL refused the PUT (HTTP ${status})${suffix} — ` +
        'the URL may have expired or been used already; re-run to mint a new one.',
      { status, code: 'UPLOAD_REJECTED', detail, retryable: true }
    );
  }
  const retryable = status === 408 || status === 429 || status >= 500;
  return new RssComError(
    `The presigned upload URL answered ${status} to the PUT${suffix}.`,
    { status, code: 'UPLOAD_FAILED', detail, retryable }
  );
}

/**
 * A transport failure (no response) on the presigned PUT. The PUT goes to
 * the storage host the presigned URL names, not to api.rss.com, so a DNS
 * failure or a timeout there must not read as "RSS.com could not be
 * reached" — an operator would check the wrong host. The message names the
 * upload host; the code is `UPLOAD_UNREACHABLE`; retryable, because a re-run
 * mints a fresh URL and the storage host may simply have been slow.
 */
function uploadTransportError(url, error) {
  let host = 'the upload host';
  try {
    host = new URL(url).hostname || host;
  } catch {
    // An unparseable URL has already been refused before the PUT; keep the fallback.
  }
  const detail = error?.message || String(error);
  const what = error?.code === 'FETCH_TIMEOUT' ? 'did not answer the PUT' : 'could not be reached for the PUT';
  return new RssComError(
    `The upload host ${host} ${what} (${detail}) — re-run to mint a fresh presigned upload.`,
    { status: null, code: 'UPLOAD_UNREACHABLE', detail, retryable: true }
  );
}

/** Map a transport failure (no response) on an api.rss.com call to the typed error. */
function transportError(operation, error) {
  if (error?.code === 'FETCH_TIMEOUT') {
    return new RssComError(`RSS.com did not answer while ${operation} (${error.message}).`, {
      status: null,
      code: 'TIMEOUT',
      detail: error.message,
      retryable: true,
    });
  }
  return new RssComError(
    `RSS.com could not be reached while ${operation} (${error?.message || String(error)}).`,
    { status: null, code: 'NETWORK', detail: error?.message || String(error), retryable: true }
  );
}

/**
 * Build a client. Cheap; holds no connection. Every method throws
 * `RssComError` and nothing else.
 *
 * @param {object} [options]
 * @param {Record<string, string|undefined>} [options.env]
 * @param {Function} [options.fetch] injected for tests; normally global fetch
 */
export function createRssComClient({ env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  const configured = isConfigured(env);
  const keyed = hasApiKey(env);
  const apiKey = keyed.ok ? readKey(env, API_KEY_SETTING) : '';
  const podcastId = configured.ok ? configured.podcastId : null;

  /** The `{podcast_id}` routes and the upload flow: both settings, or the full sentence. */
  function requireConfigured() {
    if (!configured.ok) {
      throw new RssComError(configured.reason, { status: null, code: 'NOT_CONFIGURED' });
    }
  }

  /** The account-level routes: the key alone, so the show's id can be discovered. */
  function requireApiKey() {
    if (!keyed.ok) {
      throw new RssComError(keyed.reason, { status: null, code: 'NOT_CONFIGURED' });
    }
  }

  async function call(operation, method, path, { body, query, scope = 'podcast' } = {}) {
    if (scope === 'key') requireApiKey();
    else requireConfigured();
    const url = new URL(`${RSSCOM_API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetchWithTimeout(fetchImpl, url.toString(), {
        method,
        headers: {
          'X-Api-Key': apiKey,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        timeoutMs: RSSCOM_TIMEOUT_MS,
      });
    } catch (error) {
      throw transportError(operation, error);
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const detail = describeErrorBody(data, text);
      const { code, retryable } = classify(response.status);
      throw new RssComError(messageFor(operation, response.status, detail), {
        status: response.status,
        code,
        detail,
        retryable,
      });
    }
    return data;
  }

  const episodes = () => `/podcasts/${podcastId}/episodes`;

  return {
    /** `isConfigured(env)` for this client, so a caller need not re-read env. */
    configured,
    podcastId,

    /**
     * `GET /v4/podcasts` — every show the key can see. Gated on the key
     * alone: this is the call that discovers the numeric id `RSSCOM_PODCAST_ID`
     * is seeded with, so it must work before that setting exists.
     */
    listPodcasts() {
      return call('listing podcasts', 'GET', '/podcasts', { scope: 'key' });
    },

    /**
     * `POST …/assets/presigned-uploads`. Returns `{ id, url, … }`; the caller
     * PUTs bytes to `url` and references `id` as `audio_upload_id`.
     */
    async createPresignedUpload({ assetType = 'audio', mime, filename }) {
      if (!mime || !filename) {
        throw new RssComError('A presigned upload needs both a mime type and a filename.', {
          status: null,
          code: 'VALIDATION',
        });
      }
      return call(
        'creating a presigned upload',
        'POST',
        `/podcasts/${podcastId}/assets/presigned-uploads`,
        { body: { asset_type: assetType, expected_mime: mime, filename } }
      );
    },

    /**
     * PUT the bytes to a presigned URL. No API key: the URL is the credential,
     * and it points at a storage host that has no use for ours.
     *
     * @param {string} url
     * @param {Buffer|Uint8Array} bytes
     * @param {string} mime must equal the `expected_mime` the upload was created with
     */
    async uploadAudio(url, bytes, mime) {
      requireConfigured();
      if (!url || typeof url !== 'string') {
        throw new RssComError('The presigned upload did not carry a URL to PUT to.', {
          status: null,
          code: 'VALIDATION',
        });
      }
      if (!bytes || !bytes.length) {
        throw new RssComError('Refusing to upload zero bytes of audio.', {
          status: null,
          code: 'VALIDATION',
        });
      }
      let response;
      try {
        response = await fetchWithTimeout(fetchImpl, url, {
          method: 'PUT',
          headers: { 'Content-Type': mime, 'Content-Length': String(bytes.length) },
          body: bytes,
          timeoutMs: RSSCOM_UPLOAD_TIMEOUT_MS,
        });
      } catch (error) {
        throw uploadTransportError(url, error);
      }
      if (!response.ok) {
        const text = typeof response.text === 'function' ? await response.text() : '';
        const detail = String(text || '').slice(0, 300);
        throw uploadError(response.status, detail);
      }
      return { status: response.status, bytes: bytes.length };
    },

    /** `POST …/episodes`. `fields` is the request body verbatim (snake_case). */
    createEpisode(fields) {
      return call('creating the episode', 'POST', episodes(), { body: fields });
    },

    /** `PATCH …/episodes/{id}`. Partial; only the given fields change. */
    updateEpisode(episodeId, fields) {
      return call(
        'updating the episode',
        'PATCH',
        `${episodes()}/${encodeURIComponent(episodeId)}`,
        { body: fields }
      );
    },

    /** `GET …/episodes/{id}`. */
    getEpisode(episodeId) {
      return call('reading the episode', 'GET', `${episodes()}/${encodeURIComponent(episodeId)}`);
    },

    /** `GET …/episodes` with the spec's query parameters, all optional. */
    listEpisodes({ page, limit, order, status, filter } = {}) {
      return call('listing episodes', 'GET', episodes(), {
        query: { page, limit, order, status, filter },
      });
    },

    /** `PUT …/episodes/{id}/transcript` with `{ transcription, format }`. */
    async putTranscript(episodeId, { transcription, format = 'txt' }) {
      if (typeof transcription !== 'string' || !transcription) {
        throw new RssComError('A transcript needs a non-empty transcription.', {
          status: null,
          code: 'VALIDATION',
        });
      }
      return call(
        'writing the transcript',
        'PUT',
        `${episodes()}/${encodeURIComponent(episodeId)}/transcript`,
        { body: { transcription, format } }
      );
    },
  };
}
