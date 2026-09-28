/**
 * The anonymous submission POST. The submission pages show whatever it
 * throws, so what it throws must be a visitor's sentence (owner direction
 * 2026-09-28): the server's words only for a 400, which names the form field
 * at fault; the hourly limit in plain words; and "please try again" for the
 * rest — never an HTTP status, and never the missing-API-base message, which
 * names the deployment.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const base = vi.hoisted(() => ({ fail: false }));
vi.mock('@/lib/functionsBase', () => ({
  requireFunctionsBase: () => {
    if (base.fail) {
      throw new Error(
        'VITE_AZURE_FUNCTIONS_URL is not set, so public/submissions cannot be called. Set it to the Function App origin.'
      );
    }
    return 'https://api.test';
  },
}));

import { SUBMISSION_FAILED, SUBMISSION_LIMITED, submitPublicContent } from './publicApi.js';

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const body = { type: 'blog', title: 'A title', summary: 'A summary', content: 'Body' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  base.fail = false;
});

describe('submitPublicContent', () => {
  it('posts the body and returns what the server answered', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, id: 'abc' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    expect(await submitPublicContent(body)).toEqual({ ok: true, id: 'abc' });
    const [[url, init]] = fetchMock.mock.calls;
    expect(String(url)).toBe('https://api.test/public/submissions');
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('names the field at fault on a 400, in the server’s words', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Title is too long' }, 400))
    );
    await expect(submitPublicContent(body)).rejects.toThrow('Title is too long');
  });

  it('says the hourly limit is reached on a 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Submission rate limit exceeded' }, 429))
    );
    await expect(submitPublicContent(body)).rejects.toThrow(SUBMISSION_LIMITED);
  });

  it.each([
    [
      'a 500 with a server sentence',
      () => jsonResponse({ error: 'cosmos said 409 on content' }, 500),
    ],
    ['a 503 with no body', () => ({ ok: false, status: 503, json: async () => JSON.parse('{') })],
    ['a 403', () => jsonResponse({ error: 'Forbidden' }, 403)],
  ])('says only "please try again" for %s', async (_label, respond) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond())
    );
    const error = await submitPublicContent(body).catch((e) => e);
    expect(error.message).toBe(SUBMISSION_FAILED);
    expect(error.message).not.toMatch(/HTTP|\d{3}|cosmos|Forbidden/i);
  });

  it('says only "please try again" when the request never leaves, or the build has no API base', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
    );
    await expect(submitPublicContent(body)).rejects.toThrow(SUBMISSION_FAILED);

    base.fail = true;
    const error = await submitPublicContent(body).catch((e) => e);
    expect(error.message).toBe(SUBMISSION_FAILED);
    expect(error.message).not.toMatch(/function app|VITE_/i);
  });
});
