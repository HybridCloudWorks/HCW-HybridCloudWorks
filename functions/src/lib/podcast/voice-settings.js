/**
 * The two podcast voices, as the owner chose them by ear on the Audio tab
 * (#725; ADR 0029 §2a, amended 2026-09-26).
 *
 * Stored in `admin_config/podcast_voices` as `{ Maya: <voice id>, Elena:
 * <voice id> }`, written by the Platform settings page through
 * `normalizePodcastVoices` in lib/platform-settings.js, the same store and
 * route as the Listen & Learn voice. Not Function App settings: those need a
 * Terraform apply to change, and a voice is chosen by listening, a few times.
 *
 * Podcast only. `LISTEN_AND_LEARN_VOICE_MAYA` / `…_ELENA` belong to Gemini
 * and Azure, which read Listen & Learn; the podcast no longer reads them, so
 * neither product's voice can be set by accident through the other's
 * setting (#725, ADR 0029 §2b).
 *
 * Every podcast render reads this first: the episode pipeline
 * (podcast/generate.js) and the live check (podcast/elevenlabs-admin.js)
 * pass it to the speech switch as `voices`, and speech/elevenlabs.js falls
 * back to its own defaults only for a host this leaves out.
 */
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { DEFAULT_SPEAKERS } from '../listen-and-learn/script.js';
import { isElevenLabsVoiceId } from '../listen-and-learn/speech/elevenlabs-voice-plan.js';

/** The `admin_config` document the choice lives in. */
export const PODCAST_VOICES_CONFIG_ID = 'podcast_voices';

/** The two hosts every podcast script is written for (script.js DEFAULT_SPEAKERS). */
export const PODCAST_HOSTS = Object.freeze([DEFAULT_SPEAKERS.a, DEFAULT_SPEAKERS.b]);

/**
 * The stored choice, or null when there is none or it is not one: both hosts
 * present, each an ElevenLabs-shaped id, and different. A hand-seeded
 * document that fails that is not a choice here, and the page shows it as
 * invalid. A read FAILURE is not caught, for the reason
 * speech-settings.js gives: a render that cannot read its settings must not
 * proceed in a voice nobody chose.
 *
 * @param {(container: string, id: string, partition: string) => Promise<object|null>} readDoc
 * @returns {Promise<Record<string,string>|null>}
 */
export async function readStoredPodcastVoices(readDoc) {
  const doc = await readDoc('admin_config', PODCAST_VOICES_CONFIG_ID, ADMIN_CONFIG_PARTITION);
  if (!doc) return null;
  const voices = {};
  for (const host of PODCAST_HOSTS) {
    if (!isElevenLabsVoiceId(doc[host])) return null;
    voices[host] = doc[host];
  }
  return new Set(Object.values(voices)).size === PODCAST_HOSTS.length ? voices : null;
}
