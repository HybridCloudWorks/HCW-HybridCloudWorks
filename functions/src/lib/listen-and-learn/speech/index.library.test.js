/**
 * The speech switch's Audio Library additions (ADR 0033 §4): a book's own
 * provider outranks the pin and is held to the product rule, language and
 * rate reach the provider, and the Advanced section's description of the
 * providers is read from the switch rather than remembered.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  describeSpeechProviders,
  estimateSpeechCostUsd,
  resolveSpeechProvider,
  synthesizeDialogue,
} from './index.js';
import { buildSsml } from './azure.js';

const GEMINI = { GEMINI_API_KEY: 'g' };
const BOTH = { ...GEMINI, AZURE_SPEECH_KEY: 'a', AZURE_SPEECH_REGION: 'eastus' };
const LL = { product: 'listenAndLearn' };

describe('a book’s provider', () => {
  it('outranks the product order and the pin when it is configured', () => {
    expect(resolveSpeechProvider(BOTH, { ...LL, provider: 'azure' }).name).toBe('azure');
    expect(
      resolveSpeechProvider(
        { ...BOTH, LISTEN_AND_LEARN_TTS_PROVIDER: 'gemini' },
        { ...LL, provider: 'azure' }
      ).name
    ).toBe('azure');
    expect(resolveSpeechProvider(BOTH, { ...LL, provider: null }).name).toBe('gemini');
  });

  it('fails by sentence rather than falling through when the book’s provider is not configured or not the product’s', () => {
    expect(() => resolveSpeechProvider(GEMINI, { ...LL, provider: 'azure' })).toThrow(
      /asks for "azure", which is not configured \(AZURE_SPEECH_KEY/
    );
    expect(() => resolveSpeechProvider(BOTH, { ...LL, provider: 'elevenlabs' })).toThrow(
      /not a Listen & Learn provider/
    );
    expect(
      estimateSpeechCostUsd({ ...LL, ceilingBytes: 100, provider: 'azure', env: GEMINI })
    ).toBeNull();
  });
});

describe('language and rate', () => {
  it('reach the Azure SSML as xml:lang and a prosody rate, and 1 leaves the pace unmarked', () => {
    const turns = [{ speaker: 'Maya', text: 'Hi' }];
    const voices = { Maya: 'en-US-AvaNeural' };
    expect(buildSsml(turns, { voices, lang: 'en-GB', speakingRate: 1.25 })).toContain(
      '<prosody rate="125%">Hi</prosody>'
    );
    expect(buildSsml(turns, { voices, lang: 'en-GB', speakingRate: 1.25 })).toContain(
      'xml:lang="en-GB"'
    );
    expect(buildSsml(turns, { voices, speakingRate: 1 })).not.toContain('prosody');
  });

  it('are handed to the provider by synthesizeDialogue', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([0xff, 0xfb, 0, 0]).buffer,
    }));
    await synthesizeDialogue({
      ...LL,
      provider: 'azure',
      dialogue: [{ speaker: 'Narrator', text: 'Chapter one.' }],
      voices: { Narrator: 'en-US-AvaNeural' },
      lang: 'fr-FR',
      speakingRate: 0.9,
      env: BOTH,
      fetchImpl,
    });
    const ssml = fetchImpl.mock.calls[0][1].body;
    expect(ssml).toContain('xml:lang="fr-FR"');
    expect(ssml).toContain('<prosody rate="90%">');
    expect(ssml).toContain('en-US-AvaNeural');
  });
});

describe('describeSpeechProviders', () => {
  it('says which providers are configured, which the product may use, and which would run', () => {
    const described = describeSpeechProviders({ ...GEMINI, ELEVENLABS_API_KEY: 'e' }, LL);
    expect(described.order).toEqual(['gemini', 'azure']);
    expect(described.wouldRun).toBe('gemini');
    expect(described.pinError).toBeNull();
    expect(described.pin).toEqual({ setting: 'LISTEN_AND_LEARN_TTS_PROVIDER', value: null });
    const byId = Object.fromEntries(described.providers.map((p) => [p.id, p]));
    expect(byId.gemini).toMatchObject({ configured: true, allowed: true, reason: null });
    expect(byId.azure).toMatchObject({ configured: false, allowed: true });
    expect(byId.azure.requirement).toMatch(/AZURE_SPEECH_KEY/);
    expect(byId.elevenlabs).toMatchObject({ configured: true, allowed: false });
    expect(byId.elevenlabs.reason).toMatch(/podcast voice/);
  });

  it('reports an unusable pin as a sentence instead of throwing', () => {
    const described = describeSpeechProviders(
      { ...GEMINI, LISTEN_AND_LEARN_TTS_PROVIDER: 'azure' },
      LL
    );
    expect(described.wouldRun).toBeNull();
    expect(described.pinError).toMatch(/pins "azure", which is not configured/);
    expect(described.pin.value).toBe('azure');
  });

  it('with nothing configured says so without a provider', () => {
    const described = describeSpeechProviders({}, LL);
    expect(described.wouldRun).toBeNull();
    expect(described.providers.every((p) => !p.configured)).toBe(true);
  });
});
