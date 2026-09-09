/**
 * The Plaud Embedded client against a stubbed fetch: the request it sends
 * (headers, body shape — verified 2026-09-08, see the module header), the
 * poll loop to SUCCESS and to FAILURE, the not-configured sentence, and the
 * result normaliser's two spellings.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  API_KEY_SETTING,
  CLIENT_ID_SETTING,
  DEFAULT_BASE_URL,
  DEFAULT_WAIT_TIMEOUT_MS,
  PlaudEmbeddedNotConfiguredError,
  createTranscription,
  getTranscription,
  isPlaudEmbeddedConfigured,
  normalizeEmbeddedResult,
  waitForTranscription,
} from './plaud-embedded.js';

const env = { [CLIENT_ID_SETTING]: 'client-1', [API_KEY_SETTING]: 'key-1' };

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

describe('configuration', () => {
  it('needs both halves, resolved — an unseeded Key Vault reference is not a key', () => {
    expect(isPlaudEmbeddedConfigured(env)).toBe(true);
    expect(isPlaudEmbeddedConfigured({ [CLIENT_ID_SETTING]: 'client-1' })).toBe(false);
    expect(
      isPlaudEmbeddedConfigured({
        [CLIENT_ID_SETTING]: 'client-1',
        [API_KEY_SETTING]: '@Microsoft.KeyVault(SecretUri=https://kv/secrets/PLAUD-EMBEDDED-API-KEY)',
      })
    ).toBe(false);
    expect(isPlaudEmbeddedConfigured({})).toBe(false);
  });

  it('not configured → a plain sentence naming both settings, and no call', async () => {
    const fetch = vi.fn();
    await expect(createTranscription({ fileUrl: 'https://x.test/a.mp3', env: {}, fetch })).rejects.toThrow(
      PlaudEmbeddedNotConfiguredError
    );
    await expect(createTranscription({ fileUrl: 'https://x.test/a.mp3', env: {}, fetch })).rejects.toThrow(
      /PLAUD_EMBEDDED_CLIENT_ID and PLAUD_EMBEDDED_API_KEY/
    );
    await expect(getTranscription({ transcriptionId: 't', env: {}, fetch })).rejects.toThrow(
      PlaudEmbeddedNotConfiguredError
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('createTranscription', () => {
  it('POSTs the documented body with the two headers and returns the task id', async () => {
    const fetch = vi.fn(async () => response({ transcription_id: 'task_exec_1', status: 'PENDING', data: {} }));
    const out = await createTranscription({
      fileUrl: 'https://api-azure.example/api/public/media/podcast/uploads/u1.mp3',
      hotwords: ['Terraform', 'AKS, hub'],
      env,
      fetch,
    });

    expect(out).toEqual({ transcriptionId: 'task_exec_1', status: 'PENDING' });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BASE_URL}/open/partner/ai/transcriptions/`);
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({
      'X-Client-Id': 'client-1',
      'X-Client-Api-Key': 'key-1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(options.body)).toEqual({
      file_url: 'https://api-azure.example/api/public/media/podcast/uploads/u1.mp3',
      params: {
        transcribe: { language: 'auto' },
        diarization: { enabled: true },
        // A comma-separated string, as documented — and a comma inside a
        // word cannot split it into two.
        hotwords: 'Terraform,AKS  hub',
      },
    });
  });

  it('honours a configured base URL and omits hotwords when there are none', async () => {
    const fetch = vi.fn(async () => response({ transcription_id: 't2', status: 'PENDING' }));
    await createTranscription({
      fileUrl: 'https://x.test/a.mp3',
      env: { ...env, PLAUD_EMBEDDED_BASE_URL: 'https://platform-jp.plaud.ai/developer/api/' },
      fetch,
    });
    expect(fetch.mock.calls[0][0]).toBe('https://platform-jp.plaud.ai/developer/api/open/partner/ai/transcriptions/');
    expect(JSON.parse(fetch.mock.calls[0][1].body).params.hotwords).toBeUndefined();
  });

  it('refuses a non-https file URL before calling', async () => {
    const fetch = vi.fn();
    await expect(createTranscription({ fileUrl: 'http://x.test/a.mp3', env, fetch })).rejects.toThrow(
      /https URL/
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps 401/403 to a credential sentence, 429 to the rate limit, others to the status', async () => {
    const at = (status, body) =>
      createTranscription({ fileUrl: 'https://x.test/a.mp3', env, fetch: vi.fn(async () => response(body, status)) });
    await expect(at(401, { message: 'bad key' })).rejects.toMatchObject({
      code: 'PLAUD_EMBEDDED_UNAUTHENTICATED',
      message: expect.stringMatching(/rejected the client id or API key.*bad key/),
    });
    await expect(at(429, '')).rejects.toMatchObject({ code: 'PLAUD_EMBEDDED_RATE_LIMITED' });
    await expect(at(500, 'boom')).rejects.toThrow(/HTTP 500.*boom/);
  });

  it('a 2xx with no transcription_id is an error, not a silent success', async () => {
    await expect(
      createTranscription({ fileUrl: 'https://x.test/a.mp3', env, fetch: vi.fn(async () => response({})) })
    ).rejects.toThrow(/no transcription_id/);
  });
});

describe('waitForTranscription', () => {
  const ticking = () => {
    let t = 0;
    return { now: () => t, sleep: vi.fn(async (ms) => (t += ms)) };
  };

  it('polls the GET route until SUCCESS and returns the data', async () => {
    const statuses = ['PENDING', 'STARTED', 'PROGRESS', 'SUCCESS'];
    const fetch = vi.fn(async (url) => {
      expect(url).toBe(`${DEFAULT_BASE_URL}/open/partner/ai/transcriptions/task_exec_1`);
      const status = statuses.shift();
      return response({
        transcription_id: 'task_exec_1',
        status,
        data: status === 'SUCCESS' ? { text: 'hi', results: [] } : {},
      });
    });
    const clock = ticking();
    const out = await waitForTranscription({
      transcriptionId: 'task_exec_1',
      env,
      fetch,
      timeoutMs: 60_000,
      intervalMs: 5_000,
      ...clock,
    });
    expect(out.status).toBe('SUCCESS');
    expect(out.data).toEqual({ text: 'hi', results: [] });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(clock.sleep).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ 'X-Client-Id': 'client-1' });
  });

  it('FAILURE and REVOKED are terminal errors naming the task', async () => {
    for (const status of ['FAILURE', 'REVOKED']) {
      const fetch = vi.fn(async () => response({ transcription_id: 't9', status }));
      await expect(
        waitForTranscription({ transcriptionId: 't9', env, fetch, timeoutMs: 60_000, ...ticking() })
      ).rejects.toMatchObject({
        code: `PLAUD_EMBEDDED_${status}`,
        message: expect.stringMatching(new RegExp(`t9 ended with status ${status}`)),
      });
    }
  });

  it('stops with a named timeout, before the job would be killed', async () => {
    const fetch = vi.fn(async () => response({ transcription_id: 't3', status: 'PROGRESS' }));
    const clock = ticking();
    await expect(
      waitForTranscription({ transcriptionId: 't3', env, fetch, timeoutMs: 25_000, intervalMs: 10_000, ...clock })
    ).rejects.toMatchObject({
      code: 'PLAUD_EMBEDDED_TIMEOUT',
      message: expect.stringMatching(/t3 was still PROGRESS after 25 s.*7 days/),
    });
    // 0 → poll, sleep to 10 → poll, sleep to 20 → poll, 30 > 25 → stop.
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('defaults timeoutMs to the documented constant, under the upload job budget', async () => {
    const fetch = vi.fn(async () => response({ transcription_id: 't5', status: 'PROGRESS' }));
    const clock = ticking();
    await expect(
      waitForTranscription({ transcriptionId: 't5', env, fetch, intervalMs: 60_000, ...clock })
    ).rejects.toMatchObject({
      code: 'PLAUD_EMBEDDED_TIMEOUT',
      message: expect.stringMatching(/after 1200 s/),
    });
    expect(DEFAULT_WAIT_TIMEOUT_MS).toBe(20 * 60 * 1000);
    expect(DEFAULT_WAIT_TIMEOUT_MS).toBeLessThan(25 * 60 * 1000);
    // Polled at 0, 60 s … 1200 s (21 reads) and stopped when the next poll
    // would land past the deadline: ended by the clock, not by exhaustion.
    expect(fetch).toHaveBeenCalledTimes(21);
  });

  it('refuses a non-finite or non-positive budget by name instead of looping forever', async () => {
    const fetch = vi.fn();
    for (const timeoutMs of [NaN, 0, -1, Infinity, '5000', null]) {
      await expect(
        waitForTranscription({ transcriptionId: 't6', env, fetch, timeoutMs, ...ticking() })
      ).rejects.toThrow(/positive timeoutMs in milliseconds/);
    }
    await expect(
      waitForTranscription({ transcriptionId: 't6', env, fetch, timeoutMs: 1000, intervalMs: 0, ...ticking() })
    ).rejects.toThrow(/positive intervalMs/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SUCCESS with no data is an error rather than an empty transcript', async () => {
    const fetch = vi.fn(async () => response({ transcription_id: 't4', status: 'SUCCESS' }));
    await expect(
      waitForTranscription({ transcriptionId: 't4', env, fetch, timeoutMs: 60_000, ...ticking() })
    ).rejects.toThrow(/SUCCESS for t4 but returned no data/);
  });
});

describe('normalizeEmbeddedResult', () => {
  it('reads the reference page shape (results/speaker_id, seconds) into ms segments', () => {
    const out = normalizeEmbeddedResult({
      text: 'Meeting started at 10am. Then more.',
      language: 'en',
      duration: 1843,
      results: [
        { start: 0, end: 4.2, text: 'Meeting started at 10am.', speaker_id: 'Speaker 1', language: 'en-US' },
        { start: 4.2, end: 9.75, text: 'Then more.', speaker_id: 'Speaker 2' },
        { start: 9.75, end: 10, text: '   ', speaker_id: 'Speaker 2' },
      ],
    });
    expect(out).toEqual({
      segments: [
        { startMs: 0, endMs: 4200, text: 'Meeting started at 10am.', speaker: 'Speaker 1' },
        { startMs: 4200, endMs: 9750, text: 'Then more.', speaker: 'Speaker 2' },
      ],
      durationMs: 1_843_000,
      language: 'en',
      text: 'Meeting started at 10am. Then more.',
    });
  });

  it('reads the overview page shape (segments/speaker) too, and derives what is missing', () => {
    const out = normalizeEmbeddedResult({
      segments: [
        { start: 1, end: 2, text: 'One', speaker: 'A' },
        { start: 2, end: 3.5, text: 'Two' },
      ],
    });
    expect(out.segments).toEqual([
      { startMs: 1000, endMs: 2000, text: 'One', speaker: 'A' },
      { startMs: 2000, endMs: 3500, text: 'Two', speaker: null },
    ]);
    expect(out.durationMs).toBe(3500);
    expect(out.language).toBeNull();
    expect(out.text).toBe('One\nTwo');
  });

  it('an empty or malformed data object is an empty transcript, not a throw', () => {
    expect(normalizeEmbeddedResult(null)).toEqual({ segments: [], durationMs: null, language: null, text: '' });
    expect(normalizeEmbeddedResult({ results: 'nope' }).segments).toEqual([]);
  });
});
