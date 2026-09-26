/**
 * Which ElevenLabs voices the current plan lets the API use, and why not
 * when it does not (#725; ADR 0029 §2a, amended 2026-09-26). Pure functions
 * over the voices elevenlabs-voices.js lists; no network.
 *
 * **The rule.** "Voice Library voices are not available via the API to free
 * tier users" (https://elevenlabs.io/docs/overview/capabilities/voices, read
 * 2026-09-26). So on the free plan a key may use the account's own voices and
 * its default voices, and not library copies. Which listing a voice came from
 * says which it is (see elevenlabs-voices.js).
 *
 * Two more fields narrow it: `is_legacy` (a Legacy id "will automatically
 * route to" a replacement,
 * https://elevenlabs.io/docs/help-center/product/voices/my-voices/what-are-legacy-voices,
 * so it would not sound like its preview) and `available_for_tiers`, "the
 * tiers the voice is available for"
 * (https://elevenlabs.io/docs/api-reference/voices/search), read as a
 * restriction only when it names some.
 */

/**
 * An ElevenLabs voice id as every documented one is: twenty letters and
 * digits (`EXAVITQu4vr4xnSDxMaL`, `9BWtsMINqrJLrRacOk9x` in the Legacy
 * listing, `sB1b5zUrxQVAFl2PhZFp` in the shared-voice listing). A Gemini name
 * (`Kore`) or an Azure one (`en-US-AvaMultilingualNeural`) fails it, which is
 * the mistake the shared `LISTEN_AND_LEARN_VOICE_*` settings invited.
 */
export const VOICE_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

export const isElevenLabsVoiceId = (value) =>
  typeof value === 'string' && VOICE_ID_PATTERN.test(value);

/** The rule, as the page states it above the list. */
export const FREE_PLAN_RULE =
  'On the free plan ElevenLabs lets the API use your own voices and its default voices, not Voice Library voices.';

const lower = (value) => String(value || '').toLowerCase();

const unusable = (reason) => ({ usable: false, reason });

/** The library-voice refusal, or null when the plan allows library voices. */
function libraryRefusal(voice, subscription) {
  if (voice.type !== 'library') return null;
  if (!subscription) {
    return unusable(
      'Voice Library voice, and the plan could not be read: the free plan cannot use these through the API.'
    );
  }
  if (!subscription.freePlan) return null;
  return unusable(
    'Voice Library voice: the free plan cannot use it through the API (HTTP 402 paid_plan_required).'
  );
}

/** The tier refusal, or null when the voice names no tiers or names this one. */
function tierRefusal(voice, subscription) {
  const tiers = voice.tiers.map(lower);
  if (tiers.length === 0) return null;
  if (subscription && tiers.includes(lower(subscription.tier))) return null;
  const plans = voice.tiers.length > 1 ? 'plans' : 'plan';
  return unusable(`ElevenLabs offers it on the ${voice.tiers.join(', ')} ${plans} only.`);
}

/**
 * Whether one voice can be used through the API on this plan, and if not,
 * why, in a sentence the page shows beside it. `subscription` is the
 * normalised account (elevenlabs-account.js) or null when it could not be
 * read, in which case a library voice is treated as the free plan treats it:
 * the pre-flight would refuse the render anyway, and the page must not offer
 * a voice it cannot vouch for.
 */
export function voiceUsability(voice, subscription) {
  if (!isElevenLabsVoiceId(voice.voiceId)) {
    return unusable('Its id is not the 20-character shape this page saves.');
  }
  if (voice.legacy) {
    return unusable(
      'Legacy voice: ElevenLabs routes its id to a replacement, so it would not sound like this preview.'
    );
  }
  return (
    libraryRefusal(voice, subscription) ??
    tierRefusal(voice, subscription) ?? { usable: true, reason: null }
  );
}

const TYPE_RANK = Object.freeze({ default: 0, own: 1, library: 2 });

/** Usable first, then default, own and library, then by name. */
function byUsefulness(a, b) {
  if (a.usable !== b.usable) return a.usable ? -1 : 1;
  const rank = (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9);
  return rank || a.name.localeCompare(b.name, 'en');
}

/**
 * The listing as the picker shows it: every voice, usable ones first, each
 * with `usable` and, when not, `unavailableReason`. Nothing is hidden: a
 * voice the plan does not allow is shown with the reason, because "why is my
 * voice not here" is the question this page exists to answer.
 */
export function voicesForPlan(voices, subscription) {
  return voices
    .map((voice) => {
      const { usable, reason } = voiceUsability(voice, subscription);
      return { ...voice, usable, unavailableReason: reason };
    })
    .sort(byUsefulness);
}
