/**
 * The stored podcast voices (#725): read from admin_config/podcast_voices at
 * the admin_config partition, and a choice only when both hosts carry a
 * distinct, ElevenLabs-shaped id. Anything else is no choice, which makes a
 * render say "Choose the podcast voices first" rather than guess.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  PODCAST_HOSTS,
  PODCAST_VOICES_CONFIG_ID,
  readStoredPodcastVoices,
} from './voice-settings.js';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { DEFAULT_SPEAKERS } from '../listen-and-learn/script.js';

const MAYA = 'MayaVoice00000000001';
const ELENA = 'ElenaVoice0000000002';

describe('readStoredPodcastVoices', () => {
  it('names the two hosts the script writes, and its own document', () => {
    expect(PODCAST_HOSTS).toEqual([DEFAULT_SPEAKERS.a, DEFAULT_SPEAKERS.b]);
    expect(PODCAST_HOSTS).toEqual(['Maya', 'Elena']);
    expect(PODCAST_VOICES_CONFIG_ID).toBe('podcast_voices');
  });

  it('reads admin_config/podcast_voices and returns both voices', async () => {
    const readDoc = vi.fn(async () => ({
      id: 'podcast_voices',
      Maya: MAYA,
      Elena: ELENA,
      updatedAt: 'x',
    }));
    expect(await readStoredPodcastVoices(readDoc)).toEqual({ Maya: MAYA, Elena: ELENA });
    expect(readDoc).toHaveBeenCalledWith(
      'admin_config',
      PODCAST_VOICES_CONFIG_ID,
      ADMIN_CONFIG_PARTITION
    );
  });

  it('is no choice when nothing is stored, a host is missing, an id is malformed, or both are the same', async () => {
    for (const doc of [
      null,
      { Maya: MAYA },
      { Maya: MAYA, Elena: '' },
      { Maya: 'Kore', Elena: ELENA },
      { Maya: MAYA, Elena: MAYA },
    ]) {
      expect(await readStoredPodcastVoices(async () => doc), JSON.stringify(doc)).toBeNull();
    }
  });

  it('lets a read failure through: a render must not proceed in voices nobody chose', async () => {
    await expect(
      readStoredPodcastVoices(async () => {
        throw new Error('cosmos down');
      })
    ).rejects.toThrow('cosmos down');
  });
});
