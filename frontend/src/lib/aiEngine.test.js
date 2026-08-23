/**
 * The admin portal's provider list, held against the API's.
 *
 * This file exists because the two silently disagreed for the whole of the
 * migration. `DEFAULT_PROVIDERS` came over from Site-Main and was never
 * revisited, so the AI Engine page showed:
 *
 *   - Vertex, `enabled: true`, though the router removed it at the port — it
 *     authenticates with GCP Application Default Credentials, which a Function
 *     App cannot hold, so it could not have worked at all.
 *   - OpenAI in DEPRECATED_PROVIDERS, deleted from the container on every admin
 *     page load, though the router calls OpenAI happily.
 *   - Perplexity, Bedrock and Replicate, none of which anything routes text to.
 *
 * Every one of those was visible on screen and wrong, and nothing failed. The
 * owner reasonably concluded from the page that Gemini/Vertex was the primary
 * provider when Anthropic was in fact first and Vertex was gone.
 *
 * So the lists are compared here, against the API's own source. Importing the
 * backend module directly is the point: a fixture copied into this file would
 * reintroduce the exact problem it is meant to catch.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_PROVIDERS } from './aiEngine.js';
import { PROVIDERS } from '../../../functions/src/lib/ai/router.js';

const ids = DEFAULT_PROVIDERS.map((p) => p.id);

describe('DEFAULT_PROVIDERS matches the API', () => {
  it('lists exactly the providers the router implements, in the same order', () => {
    expect(ids).toEqual([...PROVIDERS]);
  });

  it('offers no provider the API cannot route to', () => {
    // The specific failure: 'vertex' on this list for months.
    const strangers = ids.filter((id) => !PROVIDERS.includes(id));
    expect(strangers, 'listed in the portal but unknown to the router').toEqual([]);
  });

  it('names the environment variable the router actually reads for each', () => {
    // A wrong apiKeyEnvVar sends someone to seed the wrong secret, and the
    // symptom is a provider that stays silently unavailable.
    const expected = {
      gemini: 'GEMINI_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
    };
    for (const provider of DEFAULT_PROVIDERS) {
      expect(provider.apiKeyEnvVar, provider.id).toBe(expected[provider.id]);
    }
  });

  it('gives every provider a contiguous order starting at 1', () => {
    // Ties are the one case where the active provider can differ between
    // Function App instances, so the seed must not create one.
    expect(DEFAULT_PROVIDERS.map((p) => p.order)).toEqual(
      DEFAULT_PROVIDERS.map((_, index) => index + 1)
    );
  });

  it('seeds every provider enabled, matching the API rule that absent means on', () => {
    expect(DEFAULT_PROVIDERS.every((p) => p.enabled === true)).toBe(true);
  });

  it('lists its defaultModel among its own models', () => {
    for (const provider of DEFAULT_PROVIDERS) {
      expect(provider.models, provider.id).toContain(provider.defaultModel);
    }
  });
});
