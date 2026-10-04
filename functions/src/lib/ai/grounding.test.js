/**
 * grounding.js — the pure half of source grounding. The source-list rules
 * are pinned through router.test.js (which imports them from router.js);
 * this covers what moved here and is not reachable from the router's
 * surface: the sentence for a chain without Gemini, and the two readers of
 * a completed interaction.
 */
import { describe, it, expect } from 'vitest';
import { failedRetrievals, groundedOutputText, groundingUnavailable } from './grounding.js';

describe('groundingUnavailable', () => {
  it('names the fix for each reason Gemini is not in the chain, in that order', () => {
    expect(groundingUnavailable({ available: [], disabled: [], pinned: '' })).toMatch(
      /GEMINI_API_KEY is not set/
    );
    expect(
      groundingUnavailable({ available: ['gemini'], disabled: ['gemini'], pinned: '' })
    ).toMatch(/disabled in the admin portal/);
    expect(
      groundingUnavailable({ available: ['gemini', 'openai'], disabled: [], pinned: 'openai' })
    ).toMatch(/pins openai/);
    expect(groundingUnavailable({ available: ['gemini'], disabled: [], pinned: '' })).toMatch(
      /not in the provider chain/
    );
  });
});

describe('interaction readers', () => {
  const data = {
    steps: [
      { type: 'url_context_result', result: [{ url: 'https://a', status: 'success' }] },
      {
        type: 'url_context_result',
        result: [{ url: 'https://b', status: 'paywall' }, { status: 'error' }],
      },
      { type: 'model_output', content: [{ type: 'text', text: '{"a":' }, { type: 'image' }] },
      { type: 'model_output', content: [{ type: 'text', text: '1}' }] },
    ],
  };

  it('joins every text block of every model_output step', () => {
    expect(groundedOutputText(data)).toBe('{"a":1}');
    expect(groundedOutputText({})).toBe('');
  });

  it('lists only the retrievals the API reported as not successful', () => {
    expect(failedRetrievals(data)).toEqual(['https://b (paywall)', 'a source (error)']);
    expect(failedRetrievals({ steps: [] })).toEqual([]);
  });
});
