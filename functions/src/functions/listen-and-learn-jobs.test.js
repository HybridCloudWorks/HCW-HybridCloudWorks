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
  // The partition speech-settings.js reads the stored model default at.
  ADMIN_CONFIG_PARTITION: 'admin_config',
}));
vi.mock('../lib/blob-storage.js', () => ({ uploadBlob: vi.fn() }));
// The real cost table stays: the speech estimate below is priced through it,
// and a stubbed getCostEstimate would make the arithmetic here meaningless.
vi.mock('../lib/ai/router.js', async (importOriginal) => ({
  ...(await importOriginal()),
  generateJsonResponse: vi.fn(),
  getActiveAiProvider: vi.fn(),
}));

const { parseGeneratePayload, resolveRunModel, roundUpUsd, speechEstimateForRun, MAX_AREAS_PER_RUN } =
  await import('./listen-and-learn-jobs.js');
const { MAX_SCRIPT_BYTES } = await import('../lib/listen-and-learn/script.js');
const { estimateGeminiCostUsd } = await import('../lib/listen-and-learn/speech/index.js');
const { LISTEN_AND_LEARN_SPEECH_CONFIG_ID } = await import(
  '../lib/listen-and-learn/speech-settings.js'
);
const { ADMIN_CONFIG_PARTITION } = await import('../lib/cosmos-client.js');

const BEST = 'gemini-3.1-flash-tts-preview';
const ECONOMY = 'gemini-2.5-flash-preview-tts';

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

  describe('ttsModel — the owner’s button, per run', () => {
    it('carries either of the two offered models through, and null for none', () => {
      expect(parseGeneratePayload(valid({ ttsModel: BEST })).value.ttsModel).toBe(BEST);
      expect(parseGeneratePayload(valid({ ttsModel: ECONOMY })).value.ttsModel).toBe(ECONOMY);
      expect(parseGeneratePayload(valid()).value.ttsModel).toBeNull();
      expect(parseGeneratePayload(valid({ ttsModel: '' })).value.ttsModel).toBeNull();
      expect(parseGeneratePayload(valid({ ttsModel: null })).value.ttsModel).toBeNull();
    });

    it('refuses any other model id by sentence, before anything else is checked', () => {
      // The id is sent to a paid API as the model name; a near-miss is a
      // request to read before spending on it, not a request to correct.
      const rule = `ttsModel must be one of ${BEST}, ${ECONOMY}`;
      for (const ttsModel of ['gemini-2.5-pro-preview-tts', 'eleven_v3', ` ${BEST}`, 'best', 7]) {
        expect(parseGeneratePayload(valid({ ttsModel })).error).toBe(rule);
      }
      // Refused even on a payload that would fail later for another reason.
      expect(parseGeneratePayload({ ttsModel: 'polly' }).error).toBe(rule);
    });

    it('applies to a source-grounded run too', () => {
      const source = {
        platform: 'azure',
        examCode: 'AZ-104',
        title: 'Entra ID basics',
        sources: [{ kind: 'page', url: 'https://learn.microsoft.com/entra' }],
      };
      expect(parseGeneratePayload({ ...source, ttsModel: ECONOMY }).value).toMatchObject({
        kind: 'source',
        ttsModel: ECONOMY,
      });
      expect(parseGeneratePayload(source).value.ttsModel).toBeNull();
      expect(parseGeneratePayload({ ...source, ttsModel: 'polly' }).error).toMatch(
        /ttsModel must be one of/
      );
    });
  });
});

describe('resolveRunModel', () => {
  // Precedence: the run's choice → the stored default → null, which
  // speech/index.js and gemini.js resolve to LISTEN_AND_LEARN_TTS_MODEL and
  // the module default.
  const storeWith = (doc) => ({ readDoc: vi.fn(async () => doc) });

  it('takes the run’s choice without reading the setting', async () => {
    const store = storeWith({ geminiModel: ECONOMY });
    expect(await resolveRunModel(BEST, store)).toBe(BEST);
    expect(store.readDoc).not.toHaveBeenCalled();
  });

  it('reads the stored default from admin_config when the run chose nothing', async () => {
    const store = storeWith({ id: LISTEN_AND_LEARN_SPEECH_CONFIG_ID, geminiModel: ECONOMY });
    expect(await resolveRunModel(null, store)).toBe(ECONOMY);
    expect(store.readDoc).toHaveBeenCalledWith(
      'admin_config',
      LISTEN_AND_LEARN_SPEECH_CONFIG_ID,
      ADMIN_CONFIG_PARTITION
    );
  });

  it('is null when nothing is stored, or the stored value is not one of the two ids', async () => {
    expect(await resolveRunModel(null, storeWith(null))).toBeNull();
    expect(await resolveRunModel(null, storeWith({ geminiModel: 'gemini-2.5-pro-preview-tts' }))).toBeNull();
    expect(await resolveRunModel(null, storeWith({}))).toBeNull();
  });

  it('lets a settings read failure fail the run rather than reading in a voice nobody chose', async () => {
    const store = {
      readDoc: vi.fn(async () => {
        throw new Error('Cosmos unavailable');
      }),
    };
    await expect(resolveRunModel(null, store)).rejects.toThrow('Cosmos unavailable');
  });
});

describe('speechEstimateForRun', () => {
  // Stated in the 202 before the run starts (ADR 0029 §2a). A ceiling: every
  // episode priced at MAX_SCRIPT_BYTES, the most UTF-8 bytes a script may
  // hold. Always the Listen & Learn product: Gemini, never ElevenLabs.
  const GEMINI = { GEMINI_API_KEY: 'g' };
  const ALL = { ELEVENLABS_API_KEY: 'e', GEMINI_API_KEY: 'g' };
  const perEpisode = (model) => estimateGeminiCostUsd(model, MAX_SCRIPT_BYTES);

  it('prices every requested area at the script ceiling, with Gemini', () => {
    const estimate = speechEstimateForRun(valid({ areas: ['a', 'b'] }), GEMINI);
    expect(MAX_SCRIPT_BYTES).toBe(9000);
    expect(perEpisode(BEST)).toBeGreaterThan(0);
    expect(estimate).toEqual({
      provider: 'gemini',
      model: BEST,
      modelSource: 'default',
      episodes: 2,
      perEpisodeUsd: perEpisode(BEST),
      estimatedCostUsd: roundUpUsd(perEpisode(BEST) * 2),
    });
    expect(estimate.estimatedCostUsd).toBeGreaterThanOrEqual(perEpisode(BEST) * 2);
  });

  it('trims the run total to six decimals without ever dropping below the exact figure', () => {
    // toFixed rounds to nearest; a ceiling rounds up (Copilot on the PR).
    expect(roundUpUsd(0.4400004)).toBe(0.440001);
    expect(roundUpUsd(0.4400006)).toBe(0.440001);
    expect(roundUpUsd(0.44)).toBe(0.44);
    expect(roundUpUsd(0)).toBe(0);
    for (const usd of [0.1234561, 1.9999999, 3.5200001, 7 / 3]) {
      expect(roundUpUsd(usd)).toBeGreaterThanOrEqual(usd);
      expect(roundUpUsd(usd) - usd).toBeLessThan(1e-6);
    }
  });

  it('describes Gemini even when the ElevenLabs key is present — that key is the podcast’s', () => {
    const estimate = speechEstimateForRun(valid({ areas: ['a'] }), ALL);
    expect(estimate.provider).toBe('gemini');
    expect(estimate.model).toBe(BEST);
    expect(estimate.perEpisodeUsd).toBe(perEpisode(BEST));
  });

  it('names the run’s chosen model and prices it', () => {
    const estimate = speechEstimateForRun(valid({ areas: ['a'], ttsModel: ECONOMY }), GEMINI);
    expect(estimate).toMatchObject({
      provider: 'gemini',
      model: ECONOMY,
      modelSource: 'run',
      perEpisodeUsd: perEpisode(ECONOMY),
      estimatedCostUsd: perEpisode(ECONOMY),
    });
    expect(perEpisode(ECONOMY)).toBeCloseTo(perEpisode(BEST) / 2, 6);
  });

  it('treats a model id that is not offered as absent, never echoing it back', () => {
    // The worker refuses it by sentence; the estimate is best effort and
    // must not let an untrusted field choose a path or appear in the 202.
    const estimate = speechEstimateForRun(valid({ ttsModel: 'gemini-2.5-pro-preview-tts' }), GEMINI);
    expect(estimate.model).toBe(BEST);
    expect(estimate.modelSource).toBe('default');
    expect(JSON.stringify(estimate)).not.toContain('pro-preview');
  });

  it('assumes the most a run may generate when the areas are not yet known', () => {
    const estimate = speechEstimateForRun(valid(), GEMINI);
    expect(estimate.episodes).toBe(MAX_AREAS_PER_RUN);
    expect(estimate.estimatedCostUsd).toBeCloseTo(perEpisode(BEST) * MAX_AREAS_PER_RUN, 6);
  });

  it('never prices more areas than a run may generate', () => {
    const areas = Array.from({ length: MAX_AREAS_PER_RUN + 3 }, (_, i) => `area-${i}`);
    expect(speechEstimateForRun(valid({ areas }), GEMINI).episodes).toBe(MAX_AREAS_PER_RUN);
  });

  it('says there is no provider rather than pricing nothing at zero, and why', () => {
    const none = {
      provider: null,
      model: null,
      modelSource: null,
      episodes: MAX_AREAS_PER_RUN,
      perEpisodeUsd: null,
      estimatedCostUsd: null,
      reason: 'not_configured',
    };
    expect(speechEstimateForRun(valid(), {})).toEqual(none);
    // An ElevenLabs key alone configures nothing for this product.
    expect(speechEstimateForRun(valid(), { ELEVENLABS_API_KEY: 'e' })).toEqual(none);
  });

  it('tells an unusable pin apart from nothing configured', () => {
    // Both price as null; only one of them is the normal transcript-only
    // state. The other is a setting to correct before the audio step fails.
    const pinned = { GEMINI_API_KEY: 'g', LISTEN_AND_LEARN_TTS_PROVIDER: 'azure' };
    expect(speechEstimateForRun(valid(), pinned)).toMatchObject({
      provider: null,
      reason: 'pin_unavailable',
    });
    // A pin naming the podcast's provider is unusable too, key or no key.
    const crossed = { ...ALL, LISTEN_AND_LEARN_TTS_PROVIDER: 'elevenlabs' };
    expect(speechEstimateForRun(valid(), crossed).reason).toBe('pin_unavailable');
    const unknown = { GEMINI_API_KEY: 'g', LISTEN_AND_LEARN_TTS_PROVIDER: 'polly' };
    expect(speechEstimateForRun(valid(), unknown).reason).toBe('pin_unavailable');
    // A usable pin — the one Terraform sets — carries no reason at all.
    const usable = { ...ALL, LISTEN_AND_LEARN_TTS_PROVIDER: 'gemini' };
    expect(speechEstimateForRun(valid(), usable)).not.toHaveProperty('reason');
    expect(speechEstimateForRun(valid(), usable).provider).toBe('gemini');
  });

  it('is honest that Azure Speech is not priced', () => {
    const azure = { AZURE_SPEECH_KEY: 'a', AZURE_SPEECH_REGION: 'eastus' };
    expect(speechEstimateForRun(valid({ areas: ['a'] }), azure)).toEqual({
      provider: 'azure',
      model: null,
      modelSource: null,
      episodes: 1,
      perEpisodeUsd: null,
      estimatedCostUsd: null,
    });
  });

  it('does not throw on a payload the worker would refuse', () => {
    expect(() => speechEstimateForRun(null, GEMINI)).not.toThrow();
    expect(speechEstimateForRun({ areas: 'not-a-list' }, GEMINI).episodes).toBe(MAX_AREAS_PER_RUN);
  });
});
