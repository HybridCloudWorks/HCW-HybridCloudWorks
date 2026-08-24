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
import { DEFAULT_PROVIDERS, aggregateByProvider, aggregateBySource } from './aiEngine.js';
import { PROVIDERS } from '../../../functions/src/lib/ai/router.js';
import { USAGE_SOURCES } from '../../../functions/src/lib/ai/usage.js';
import { SOURCE_LABELS } from '../pages/admin/AIEngineUsageTab.jsx';

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

describe('usage aggregation', () => {
  const rows = [
    {
      provider: 'gemini',
      source: 'listen-and-learn:audio',
      totalTokens: 17280,
      estimatedCostUsd: 0.17,
      estimatedTokens: true,
    },
    {
      provider: 'gemini',
      source: 'listen-and-learn:audio',
      totalTokens: 17000,
      estimatedCostUsd: 0.17,
    },
    {
      provider: 'gemini',
      source: 'listen-and-learn:script',
      totalTokens: 4000,
      estimatedCostUsd: 0.002,
    },
    { provider: 'anthropic', source: 'admin', totalTokens: 900, estimatedCostUsd: 0.01 },
  ];

  it('groups by provider, as it always has', () => {
    const agg = aggregateByProvider(rows);
    expect(Object.keys(agg).sort()).toEqual(['anthropic', 'gemini']);
    expect(agg.gemini.calls).toBe(3);
    expect(agg.gemini.tokens).toBe(38280);
  });

  it('groups by feature, which is the question when one vendor serves several', () => {
    // Provider alone answers "which vendor". It cannot answer "what did the
    // audio cost", and audio is priced an order of magnitude above text.
    const agg = aggregateBySource(rows);
    expect(Object.keys(agg).sort()).toEqual([
      'admin',
      'listen-and-learn:audio',
      'listen-and-learn:script',
    ]);
    expect(agg['listen-and-learn:audio'].calls).toBe(2);
    expect(agg['listen-and-learn:audio'].tokens).toBe(34280);
    expect(agg['listen-and-learn:audio'].costUsd).toBeCloseTo(0.34, 6);
  });

  it('counts rows whose tokens were derived rather than reported', () => {
    // Shown on the page so a derived figure is never read as a billed one.
    const agg = aggregateBySource(rows);
    expect(agg['listen-and-learn:audio'].estimated).toBe(1);
    expect(agg['listen-and-learn:script'].estimated).toBe(0);
  });

  it('treats a row with no source as an admin call', () => {
    // Every row imported from before the source field existed.
    const agg = aggregateBySource([{ provider: 'openai', totalTokens: 10, estimatedCostUsd: 0 }]);
    expect(agg.admin.calls).toBe(1);
  });

  it('handles missing totals without producing NaN', () => {
    const agg = aggregateBySource([{ provider: 'gemini', source: 'admin' }]);
    expect(agg.admin.tokens).toBe(0);
    expect(agg.admin.costUsd).toBe(0);
  });
});

describe('SOURCE_LABELS covers every source the API writes', () => {
  it('names each USAGE_SOURCES value, so none renders as a raw slug', () => {
    for (const source of Object.values(USAGE_SOURCES)) {
      expect(SOURCE_LABELS[source], `no label for "${source}"`).toBeTruthy();
    }
  });
});
