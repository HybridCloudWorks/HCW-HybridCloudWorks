/**
 * What a failed request tells the caller (#498).
 *
 * Several handlers answer `{ error: <label>, message: <why> }`, and the client
 * used to throw only `error`. The Social Hub caption button therefore showed
 * "Failed to generate caption" and nothing else while the sentence naming the
 * real cause — a provider with no key, a rejected credential — sat one line
 * away and was discarded. That is the same shape that cost #358 two days on
 * Publer: the status code shown, the reason dropped.
 *
 * Kept separate from api.test.js, which is about token handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/entraAuth', () => ({ acquireApiToken: async () => 'token' }));
vi.mock('@/lib/functionsBase', () => ({
  requireFunctionsBase: () => 'https://api.example.test/api',
  getFunctionsBase: () => 'https://api.example.test/api',
}));

import { postJSON } from '@/lib/api';

const failing = (body) => ({ ok: false, status: 500, json: async () => body });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a failed call surfaces the cause, not only the label', () => {
  it('appends the message the API put beside the error', async () => {
    fetch.mockResolvedValue(
      failing({ error: 'Failed to generate caption', message: 'No AI provider is configured' })
    );
    await expect(postJSON('generateSocialCaption', {})).rejects.toThrow(
      'Failed to generate caption — No AI provider is configured'
    );
  });

  it('does not repeat a message that only restates the error', async () => {
    fetch.mockResolvedValue(failing({ error: 'Nope', message: 'Nope' }));
    await expect(postJSON('x', {})).rejects.toThrow(/^Nope$/);
  });

  it('still works when the API sends no message at all', async () => {
    fetch.mockResolvedValue(failing({ error: 'Just the label' }));
    await expect(postJSON('x', {})).rejects.toThrow(/^Just the label$/);
  });

  it('keeps details after the cause when both are present', async () => {
    fetch.mockResolvedValue(failing({ error: 'E', message: 'why', details: { code: 7 } }));
    await expect(postJSON('x', {})).rejects.toThrow('E — why Details: {"code":7}');
  });

  it('ignores a message that is not a string', async () => {
    fetch.mockResolvedValue(failing({ error: 'E', message: { nested: true } }));
    await expect(postJSON('x', {})).rejects.toThrow(/^E$/);
  });
});
