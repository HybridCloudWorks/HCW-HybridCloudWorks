/**
 * The RSS.com client (#437).
 *
 * The spec it was written against is quoted in the module header; these tests
 * pin what the client sends — path, method, header, body shape — so a drift
 * in that beta API shows up as a failing assertion about a request rather
 * than as a 400 in production with nothing to compare it to.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  RSSCOM_API_BASE_URL,
  RSSCOM_TIMEOUT_MS,
  RSSCOM_UPLOAD_TIMEOUT_MS,
  RssComError,
  createRssComClient,
  hasApiKey,
  isConfigured,
} from './rsscom.js';

const ENV = { RSSCOM_API_KEY: 'rk_test', RSSCOM_PODCAST_ID: '4242' };

const reply = (status, body, { text } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (text !== undefined ? text : body === undefined ? '' : JSON.stringify(body)),
});

function build({ env = ENV, responses = [] } = {}) {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => queue.shift() || reply(200, {}));
  const client = createRssComClient({ env, fetch: fetchImpl });
  const lastCall = () => fetchImpl.mock.calls.at(-1);
  return { client, fetchImpl, lastCall };
}

describe('isConfigured', () => {
  it('names the missing settings and their vault secrets in one sentence', () => {
    const out = isConfigured({});
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/^RSS\.com publishing is not configured: /);
    expect(out.reason).toContain('RSSCOM_API_KEY (Key Vault secret RSSCOM-API-KEY)');
    expect(out.reason).toContain('RSSCOM_PODCAST_ID (Key Vault secret RSSCOM-PODCAST-ID)');
    expect(out.reason).toContain('manual upload path');
  });

  it('names only the one that is missing', () => {
    const out = isConfigured({ RSSCOM_API_KEY: 'rk' });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('RSSCOM_PODCAST_ID');
    expect(out.reason).not.toContain('RSSCOM_API_KEY (');
    expect(out.reason).toMatch(/ is not set/);
  });

  it('treats an unresolved Key Vault reference as absent, not as a key', () => {
    const out = isConfigured({
      RSSCOM_API_KEY: '@Microsoft.KeyVault(SecretUri=https://kv/secrets/RSSCOM-API-KEY)',
      RSSCOM_PODCAST_ID: '4242',
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('RSSCOM_API_KEY');
  });

  it('refuses a podcast id that is not the numeric id the spec uses in paths', () => {
    const out = isConfigured({ RSSCOM_API_KEY: 'rk', RSSCOM_PODCAST_ID: 'hybrid-cloud-insights' });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/numeric id/);
    expect(out.reason).toContain('hybrid-cloud-insights');
  });

  it('returns the podcast id when both are present', () => {
    expect(isConfigured(ENV)).toEqual({ ok: true, podcastId: '4242' });
  });
});

describe('requests', () => {
  it('sends the API key as X-Api-Key with a JSON body and the per-call timeout', async () => {
    const { client, lastCall } = build({ responses: [reply(201, { id: 9 })] });
    await client.createEpisode({ title: 't', description: 'd' });
    const [url, init] = lastCall();
    expect(url).toBe(`${RSSCOM_API_BASE_URL}/podcasts/4242/episodes`);
    expect(init.method).toBe('POST');
    expect(init.headers['X-Api-Key']).toBe('rk_test');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ title: 't', description: 'd' });
    // fetchWithTimeout strips timeoutMs and attaches a signal.
    expect(init.timeoutMs).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(RSSCOM_TIMEOUT_MS).toBeLessThan(RSSCOM_UPLOAD_TIMEOUT_MS);
  });

  it('GET /v4/podcasts carries no body and no Content-Type', async () => {
    const { client, lastCall } = build({ responses: [reply(200, [{ id: 4242 }])] });
    const out = await client.listPodcasts();
    expect(out).toEqual([{ id: 4242 }]);
    const [url, init] = lastCall();
    expect(url).toBe(`${RSSCOM_API_BASE_URL}/podcasts`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('createPresignedUpload posts the three required fields under the spec names', async () => {
    const { client, lastCall } = build({
      responses: [reply(201, { id: 'up_1', url: 'https://store.example/put' })],
    });
    const out = await client.createPresignedUpload({ mime: 'audio/mpeg', filename: 'a.mp3' });
    expect(out).toEqual({ id: 'up_1', url: 'https://store.example/put' });
    const [url, init] = lastCall();
    expect(url).toBe(`${RSSCOM_API_BASE_URL}/podcasts/4242/assets/presigned-uploads`);
    expect(JSON.parse(init.body)).toEqual({
      asset_type: 'audio',
      expected_mime: 'audio/mpeg',
      filename: 'a.mp3',
    });
  });

  it('createPresignedUpload rejects rather than throws when a field is missing', async () => {
    const { client, fetchImpl } = build();
    await expect(client.createPresignedUpload({ mime: 'audio/mpeg' })).rejects.toBeInstanceOf(
      RssComError
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uploadAudio PUTs the bytes to the presigned URL WITHOUT the API key', async () => {
    const { client, lastCall } = build({ responses: [reply(200)] });
    const bytes = Buffer.from('mp3-bytes');
    const out = await client.uploadAudio('https://store.example/put?sig=1', bytes, 'audio/mpeg');
    expect(out).toEqual({ status: 200, bytes: bytes.length });
    const [url, init] = lastCall();
    expect(url).toBe('https://store.example/put?sig=1');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(bytes);
    expect(init.headers['Content-Type']).toBe('audio/mpeg');
    expect(init.headers['X-Api-Key']).toBeUndefined();
    expect(JSON.stringify(init.headers)).not.toContain('rk_test');
  });

  it('a 403 on the presigned PUT is an expired URL, never a rejected API key', async () => {
    // The PUT carries no key, so a storage host's 403 cannot be about ours.
    const { client } = build({ responses: [reply(403, undefined, { text: 'Request has expired' })] });
    const error = await client
      .uploadAudio('https://store.example/put?sig=1', Buffer.from('mp3'), 'audio/mpeg')
      .catch((e) => e);
    expect(error).toBeInstanceOf(RssComError);
    expect(error.status).toBe(403);
    expect(error.code).toBe('UPLOAD_REJECTED');
    expect(error.code).not.toBe('KEY_REJECTED');
    expect(error.retryable).toBe(true);
    expect(error.detail).toBe('Request has expired');
    expect(error.message).toMatch(/presigned upload URL refused the PUT \(HTTP 403\)/);
    expect(error.message).toMatch(/re-run to mint a new one/);
    expect(error.message).not.toMatch(/API key/);
  });

  it('other PUT failures are UPLOAD_FAILED, retryable only for 5xx/429/408', async () => {
    const cases = [
      [500, true],
      [429, true],
      [400, false],
      [404, false],
    ];
    for (const [status, retryable] of cases) {
      const { client } = build({ responses: [reply(status, undefined, { text: 'nope' })] });
      const error = await client
        .uploadAudio('https://store.example/put', Buffer.from('mp3'), 'audio/mpeg')
        .catch((e) => e);
      expect(error.code).toBe('UPLOAD_FAILED');
      expect(error.status).toBe(status);
      expect(error.retryable).toBe(retryable);
      expect(error.message).not.toMatch(/API key/);
    }
  });

  it('a fetch rejection on the presigned PUT names the upload host, never RSS.com', async () => {
    // The PUT goes to the storage host in the presigned URL. A DNS failure
    // there is that host's, and the message must send an operator to it.
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND uploads.storage.example');
    });
    const client = createRssComClient({ env: ENV, fetch: fetchImpl });
    const error = await client
      .uploadAudio('https://uploads.storage.example/put?sig=1', Buffer.from('mp3'), 'audio/mpeg')
      .catch((e) => e);
    expect(error).toBeInstanceOf(RssComError);
    expect(error.code).toBe('UPLOAD_UNREACHABLE');
    expect(error.status).toBeNull();
    expect(error.retryable).toBe(true);
    expect(error.detail).toBe('getaddrinfo ENOTFOUND uploads.storage.example');
    expect(error.message).toContain('The upload host uploads.storage.example could not be reached for the PUT');
    expect(error.message).toMatch(/re-run to mint a fresh presigned upload/);
    expect(error.message).not.toContain('RSS.com');
    expect(error.message).not.toMatch(/could not be reached while/);
  });

  it('a timeout on the presigned PUT is the upload host not answering, not RSS.com', async () => {
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        );
      });
    vi.useFakeTimers();
    try {
      const client = createRssComClient({ env: ENV, fetch: fetchImpl });
      const pending = client
        .uploadAudio('https://uploads.storage.example/put', Buffer.from('mp3'), 'audio/mpeg')
        .catch((e) => e);
      await vi.advanceTimersByTimeAsync(RSSCOM_UPLOAD_TIMEOUT_MS + 1);
      const error = await pending;
      expect(error.code).toBe('UPLOAD_UNREACHABLE');
      expect(error.retryable).toBe(true);
      expect(error.message).toContain('The upload host uploads.storage.example did not answer the PUT');
      expect(error.message).toContain(`timeout after ${RSSCOM_UPLOAD_TIMEOUT_MS} ms`);
      expect(error.message).not.toContain('RSS.com');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uploadAudio refuses zero bytes before touching the network', async () => {
    const { client, fetchImpl } = build();
    await expect(
      client.uploadAudio('https://store.example/put', Buffer.alloc(0), 'audio/mpeg')
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('updateEpisode PATCHes the episode path; getEpisode GETs it', async () => {
    const { client, fetchImpl } = build({
      responses: [reply(200, { id: 9, status: 'published' }), reply(200, { id: 9 })],
    });
    await client.updateEpisode(9, { title: 'new' });
    await client.getEpisode(9);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${RSSCOM_API_BASE_URL}/podcasts/4242/episodes/9`);
    expect(fetchImpl.mock.calls[0][1].method).toBe('PATCH');
    expect(fetchImpl.mock.calls[1][1].method).toBe('GET');
  });

  it('listEpisodes passes only the query parameters that were given', async () => {
    const { client, lastCall } = build({ responses: [reply(200, [])] });
    await client.listEpisodes({ status: 'published', limit: 10 });
    const [url] = lastCall();
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/v4/podcasts/4242/episodes');
    expect([...parsed.searchParams.entries()].sort()).toEqual([
      ['limit', '10'],
      ['status', 'published'],
    ]);
  });

  it('putTranscript PUTs { transcription, format } and defaults the format to txt', async () => {
    const { client, lastCall } = build({
      responses: [reply(200, { transcription: 'x', format: 'txt', status: 'draft' })],
    });
    await client.putTranscript(9, { transcription: 'hello' });
    const [url, init] = lastCall();
    expect(url).toBe(`${RSSCOM_API_BASE_URL}/podcasts/4242/episodes/9/transcript`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ transcription: 'hello', format: 'txt' });
  });
});

describe('errors', () => {
  it('is a typed error carrying the status and the upstream message', async () => {
    const { client } = build({ responses: [reply(500, { status: 500, message: 'boom' })] });
    const error = await client.listPodcasts().catch((e) => e);
    expect(error).toBeInstanceOf(RssComError);
    expect(error.name).toBe('RssComError');
    expect(error.status).toBe(500);
    expect(error.detail).toBe('boom');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('RSS.com answered 500 while listing podcasts: boom.');
  });

  it('401 reads as a rejected key — configured, not missing', async () => {
    const { client } = build({ responses: [reply(401, { status: 401, message: 'Unauthorized' })] });
    const error = await client.createEpisode({ title: 't', description: 'd' }).catch((e) => e);
    expect(error.status).toBe(401);
    expect(error.code).toBe('KEY_REJECTED');
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/rejected the API key/);
    expect(error.message).not.toMatch(/not configured/);
  });

  it('402 says the plan no longer includes API access', async () => {
    const { client } = build({
      responses: [reply(402, { status: 402, message: 'Payment Required' })],
    });
    const error = await client.listPodcasts().catch((e) => e);
    expect(error.code).toBe('PLAN_REQUIRED');
    expect(error.message).toMatch(/plan does not include API access/);
  });

  it('400 flattens form_errors and field_errors into the detail', async () => {
    const { client } = build({
      responses: [
        reply(400, {
          status: 400,
          form_errors: ['body is odd'],
          field_errors: { title: ['is required', 'too long'], description: ['is required'] },
        }),
      ],
    });
    const error = await client.createEpisode({}).catch((e) => e);
    expect(error.code).toBe('VALIDATION');
    expect(error.detail).toBe(
      'body is odd — title: is required, too long — description: is required'
    );
  });

  it('a non-JSON error body is kept as truncated text rather than lost', async () => {
    const { client } = build({ responses: [reply(502, undefined, { text: '<html>bad gateway' })] });
    const error = await client.listPodcasts().catch((e) => e);
    expect(error.status).toBe(502);
    expect(error.detail).toBe('<html>bad gateway');
  });

  it('a timeout has no status and is retryable', async () => {
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        );
      });
    vi.useFakeTimers();
    try {
      const client = createRssComClient({ env: ENV, fetch: fetchImpl });
      const pending = client.listPodcasts().catch((e) => e);
      await vi.advanceTimersByTimeAsync(RSSCOM_TIMEOUT_MS + 1);
      const error = await pending;
      expect(error).toBeInstanceOf(RssComError);
      expect(error.status).toBeNull();
      expect(error.code).toBe('TIMEOUT');
      expect(error.retryable).toBe(true);
      expect(error.message).toMatch(/did not answer while listing podcasts/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a network failure has no status and is retryable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.rss.com');
    });
    const client = createRssComClient({ env: ENV, fetch: fetchImpl });
    const error = await client.listPodcasts().catch((e) => e);
    expect(error.code).toBe('NETWORK');
    expect(error.status).toBeNull();
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('ENOTFOUND');
  });

  it('listPodcasts works with the key alone, so the podcast id can be discovered; episode calls still refuse', async () => {
    // The seeding instruction tells the owner to read the id from GET
    // /v4/podcasts. A gate that demanded the id for that call would be circular.
    const { client, fetchImpl, lastCall } = build({
      env: { RSSCOM_API_KEY: 'rk_only' },
      responses: [reply(200, [{ id: 4242, title: 'Hybrid Cloud Insights' }])],
    });
    expect(client.configured.ok).toBe(false);
    expect(hasApiKey({ RSSCOM_API_KEY: 'rk_only' })).toEqual({ ok: true });

    const shows = await client.listPodcasts();
    expect(shows).toEqual([{ id: 4242, title: 'Hybrid Cloud Insights' }]);
    const [url, init] = lastCall();
    expect(url).toBe(`${RSSCOM_API_BASE_URL}/podcasts`);
    expect(init.headers['X-Api-Key']).toBe('rk_only');

    const error = await client.createEpisode({ title: 't', description: 'd' }).catch((e) => e);
    expect(error).toBeInstanceOf(RssComError);
    expect(error.code).toBe('NOT_CONFIGURED');
    expect(error.message).toMatch(/^RSS\.com publishing is not configured: /);
    expect(error.message).toContain('RSSCOM_PODCAST_ID (Key Vault secret RSSCOM-PODCAST-ID) is not set');
    expect(error.message).not.toContain('RSSCOM_API_KEY (');
    // Only the discovery call reached the network.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('listPodcasts without a key refuses with a sentence naming only the key', async () => {
    const { client, fetchImpl } = build({ env: { RSSCOM_PODCAST_ID: '4242' } });
    const error = await client.listPodcasts().catch((e) => e);
    expect(error.code).toBe('NOT_CONFIGURED');
    expect(error.message).toContain('RSSCOM_API_KEY (Key Vault secret RSSCOM-API-KEY) is not set');
    expect(error.message).not.toContain('RSSCOM_PODCAST_ID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('an unconfigured client rejects every call with the plain sentence and sends nothing', async () => {
    const { client, fetchImpl } = build({ env: {} });
    expect(client.configured.ok).toBe(false);
    for (const attempt of [
      () => client.listPodcasts(),
      () => client.createEpisode({ title: 't', description: 'd' }),
      () => client.uploadAudio('https://x', Buffer.from('a'), 'audio/mpeg'),
    ]) {
      const error = await attempt().catch((e) => e);
      expect(error).toBeInstanceOf(RssComError);
      expect(error.code).toBe('NOT_CONFIGURED');
      expect(error.status).toBeNull();
      expect(error.message).toMatch(/^RSS\.com publishing is not configured: /);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
