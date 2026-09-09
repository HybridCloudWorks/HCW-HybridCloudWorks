/**
 * Generation payload validation.
 *
 * `studyGuideUrl` is fetched server-side by the Function App's managed
 * identity, from inside the VNet. An attacker-chosen URL there is an SSRF
 * foothold, not a typo — which is why the scheme check is a hard `https://`
 * prefix test and why it is pinned here rather than left to the parser.
 */
import { describe, it, expect, vi } from 'vitest';

// The module registers a job type on import, and registerJobType throws on a
// duplicate — so the registry is faked rather than shared across test files.
vi.mock('../lib/jobs.js', () => ({ registerJobType: vi.fn() }));
vi.mock('../lib/cosmos-client.js', () => ({
  readDoc: vi.fn(),
  upsertDoc: vi.fn(),
  patchDoc: vi.fn(),
}));
vi.mock('../lib/blob-storage.js', () => ({ uploadBlob: vi.fn() }));
// The real cost table stays: the speech estimate below is priced through it,
// and a stubbed getCostEstimate would make the arithmetic here meaningless.
vi.mock('../lib/ai/router.js', async (importOriginal) => ({
  ...(await importOriginal()),
  generateJsonResponse: vi.fn(),
  getActiveAiProvider: vi.fn(),
}));

const { parseGeneratePayload, speechEstimateForRun, MAX_AREAS_PER_RUN } =
  await import('./listen-and-learn-jobs.js');
const { MAX_SCRIPT_BYTES } = await import('../lib/listen-and-learn/script.js');

const valid = (over = {}) => ({
  platform: 'azure',
  examCode: 'AZ-104',
  studyGuideUrl: 'https://learn.microsoft.com/credentials/az-104',
  ...over,
});

describe('parseGeneratePayload', () => {
  it('accepts a well-formed request and normalises the platform', () => {
    const { value, error } = parseGeneratePayload(valid({ platform: 'AZURE' }));
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      platform: 'azure',
      examCode: 'AZ-104',
      studyGuideUrl: 'https://learn.microsoft.com/credentials/az-104',
      areas: null,
    });
  });

  it('carries the optional certification identity through', () => {
    const { value } = parseGeneratePayload(
      valid({ certTitle: '  Azure Administrator  ', certSlug: 'az-104' })
    );
    expect(value.cert).toEqual({ title: 'Azure Administrator', slug: 'az-104' });
  });

  it('nulls a blank certification title rather than storing an empty string', () => {
    const { value } = parseGeneratePayload(valid({ certTitle: '   ' }));
    expect(value.cert.title).toBeNull();
  });

  it('refuses a platform with no study-guide adapter, naming the ones there are', () => {
    const { error } = parseGeneratePayload(valid({ platform: 'vmware' }));
    expect(error).toMatch(/not available for "vmware"/);
    expect(error).toMatch(/azure, github, aws/);
  });

  it('refuses every non-https study guide URL', () => {
    // http is downgradeable, and file/localhost/metadata URLs are the actual
    // SSRF targets on a Function App inside a VNet.
    for (const studyGuideUrl of [
      'http://learn.microsoft.com/x',
      'file:///etc/passwd',
      'http://169.254.169.254/metadata/instance',
      'HTTPS://learn.microsoft.com/x', // scheme is case-sensitive in this test
      '//learn.microsoft.com/x',
      '',
    ]) {
      expect(parseGeneratePayload(valid({ studyGuideUrl })).error).toBe(
        'studyGuideUrl must be an https URL'
      );
    }
  });

  it('accepts an https URL', () => {
    expect(parseGeneratePayload(valid()).error).toBeUndefined();
  });

  it('requires an exam code', () => {
    expect(parseGeneratePayload(valid({ examCode: '  ' })).error).toBe('examCode is required');
  });

  it('bounds how many areas one run may generate', () => {
    // Each area is a model call plus one or more synthesis requests; an
    // unbounded list is an unbounded spend.
    const areas = Array.from({ length: MAX_AREAS_PER_RUN + 1 }, (_, i) => `area-${i}`);
    expect(parseGeneratePayload(valid({ areas })).error).toMatch(
      new RegExp(`At most ${MAX_AREAS_PER_RUN} areas`)
    );

    const ok = areas.slice(0, MAX_AREAS_PER_RUN);
    expect(parseGeneratePayload(valid({ areas: ok })).error).toBeUndefined();
  });

  it('ignores a non-array areas value instead of trusting it', () => {
    expect(parseGeneratePayload(valid({ areas: 'area-1' })).value.areas).toBeNull();
  });

  it('refuses a missing payload without throwing', () => {
    expect(parseGeneratePayload(undefined).error).toBeTruthy();
    expect(parseGeneratePayload(null).error).toBeTruthy();
  });
});

describe('speechEstimateForRun', () => {
  // Stated in the 202 before the run starts (ADR 0029 §2a). A ceiling: every
  // episode priced at MAX_SCRIPT_BYTES, the most UTF-8 bytes a script may hold.
  const ELEVEN = { ELEVENLABS_API_KEY: 'e', GEMINI_API_KEY: 'g' };

  it('prices every requested area at the script ceiling', () => {
    const estimate = speechEstimateForRun(valid({ areas: ['a', 'b'] }), ELEVEN);
    expect(MAX_SCRIPT_BYTES).toBe(9000);
    expect(estimate).toEqual({
      provider: 'elevenlabs',
      model: 'eleven_v3',
      episodes: 2,
      perEpisodeUsd: 0.9,
      estimatedCostUsd: 1.8,
    });
  });

  it('assumes the most a run may generate when the areas are not yet known', () => {
    const estimate = speechEstimateForRun(valid(), ELEVEN);
    expect(estimate.episodes).toBe(MAX_AREAS_PER_RUN);
    expect(estimate.estimatedCostUsd).toBeCloseTo(0.9 * MAX_AREAS_PER_RUN, 6);
  });

  it('never prices more areas than a run may generate', () => {
    const areas = Array.from({ length: MAX_AREAS_PER_RUN + 3 }, (_, i) => `area-${i}`);
    expect(speechEstimateForRun(valid({ areas }), ELEVEN).episodes).toBe(MAX_AREAS_PER_RUN);
  });

  it('says there is no provider rather than pricing nothing at zero, and why', () => {
    expect(speechEstimateForRun(valid(), {})).toEqual({
      provider: null,
      model: null,
      episodes: MAX_AREAS_PER_RUN,
      perEpisodeUsd: null,
      estimatedCostUsd: null,
      reason: 'not_configured',
    });
  });

  it('tells an unusable pin apart from nothing configured', () => {
    // Both price as null; only one of them is the normal transcript-only
    // state. The other is a setting to correct before the audio step fails.
    const pinned = { GEMINI_API_KEY: 'g', LISTEN_AND_LEARN_TTS_PROVIDER: 'elevenlabs' };
    expect(speechEstimateForRun(valid(), pinned)).toMatchObject({
      provider: null,
      reason: 'pin_unavailable',
    });
    const unknown = { GEMINI_API_KEY: 'g', LISTEN_AND_LEARN_TTS_PROVIDER: 'polly' };
    expect(speechEstimateForRun(valid(), unknown).reason).toBe('pin_unavailable');
    // A usable pin carries no reason at all.
    const usable = { GEMINI_API_KEY: 'g', LISTEN_AND_LEARN_TTS_PROVIDER: 'gemini' };
    expect(speechEstimateForRun(valid(), usable)).not.toHaveProperty('reason');
  });

  it('follows the switch: Gemini when the ElevenLabs key is absent', () => {
    const estimate = speechEstimateForRun(valid({ areas: ['a'] }), { GEMINI_API_KEY: 'g' });
    expect(estimate.provider).toBe('gemini');
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    expect(estimate.estimatedCostUsd).toBeLessThan(0.9);
  });

  it('does not throw on a payload the worker would refuse', () => {
    expect(() => speechEstimateForRun(null, ELEVEN)).not.toThrow();
    expect(speechEstimateForRun({ areas: 'not-a-list' }, ELEVEN).episodes).toBe(MAX_AREAS_PER_RUN);
  });
});
