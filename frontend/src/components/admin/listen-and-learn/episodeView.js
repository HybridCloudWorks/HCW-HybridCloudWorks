/**
 * How a Listen & Learn run, a book and its chapters read: durations, sizes,
 * spend, status words, and the sentence the 202 turns into.
 *
 * Pure functions, no React and no icons, so the wording can be tested without
 * rendering anything — the same split certView.js uses for the Certifications
 * Hub. Moved here from ListenAndLearnPage when #574 split the page into tabs;
 * the Audio Library words (ADR 0033 §4) joined them on 2026-10-03.
 */
import { GEMINI_TTS_MODEL_TIERS } from '@/lib/listenAndLearn';
import { statusTable } from '@/lib/status';

export const formatDuration = (seconds) => {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/** `2 h 05 min` / `47 min` / `0 min` for a book's total; null for nothing. */
export const formatTotalDuration = (seconds) => {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
};

export const formatSize = (bytes) =>
  bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : null;

/** Sub-cent runs are normal here, so two decimals would read as free. */
export const formatCost = (usd) => (usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`);

/**
 * Chapter statuses as StatusBadge takes them (`{ label, tone, help }`), one
 * vocabulary with lib/status.js's tones so colour is never the only signal.
 */
export const CHAPTER_STATUS = statusTable({
  published: ['Published', 'ok', 'Live on the site; visitors can play it now.'],
  draft: ['Draft', 'muted', 'Generated and waiting for approval; not on the site.'],
  failed: ['Failed', 'bad', 'The last generation failed and there is no take to play.'],
  archived: ['Archived', 'off', 'Kept but off the site; Restore puts it back as it was.'],
});

export function chapterStatus(status) {
  return (
    CHAPTER_STATUS[status] || {
      id: String(status || ''),
      label: String(status || 'Unknown'),
      tone: 'muted',
      help: '',
    }
  );
}

/** What a chapter was made from, as a word. */
export const KIND_LABEL = Object.freeze({
  guide: 'Study guide',
  source: 'Sources',
  manual: 'Text',
});

export const BOOK_KIND_LABEL = Object.freeze({ course: 'Course', book: 'Book' });

/** `Chapter` / `Lesson`, by the kind of book it belongs to. */
export function chapterNoun(book, count = 1) {
  const noun = book?.kind === 'course' ? 'lesson' : 'chapter';
  return count === 1 ? noun : `${noun}s`;
}

/**
 * The one-line summary under a book's title in the Library grid:
 * "5 lessons · 3 published · 47 min".
 */
export function bookSummary(book) {
  const counts = book?.counts || {};
  const chapters = counts.chapters || 0;
  const parts = [`${chapters} ${chapterNoun(book, chapters)}`];
  if (counts.published) parts.push(`${counts.published} published`);
  if (counts.archived) parts.push(`${counts.archived} archived`);
  const duration = formatTotalDuration(counts.durationSeconds);
  if (duration) parts.push(duration);
  return parts.join(' · ');
}

/** `Take 3 of 3 · gemini-2.5-flash-preview-tts · 9:12 · 4.4 MB` for the active version. */
export function versionSummary(chapter) {
  const versions = Array.isArray(chapter?.versions) ? chapter.versions : [];
  if (versions.length === 0) return null;
  const index = versions.findIndex((v) => v.id === chapter.activeVersionId || v.active);
  const active = versions[index] || versions[versions.length - 1];
  return [
    `Take ${index === -1 ? versions.length : index + 1} of ${versions.length}`,
    active.speechModel || active.speechProvider,
    formatDuration(active.durationSeconds),
    formatSize(active.audioBytes),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A version's label in the Versions dialog: when it was made and by what. */
export function versionLabel(version) {
  const when = version?.generatedAt ? new Date(version.generatedAt) : null;
  const date = when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : 'Earlier take';
  return [
    date,
    version?.speechModel || version?.speechProvider,
    formatDuration(version?.durationSeconds),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** `Kore & Leda · en-US · Gemini (auto)` for a book's voice line. */
export function voiceSummary(voice) {
  if (!voice) return 'Default voices';
  const hosts = voice.speakers ? `${voice.speakers.Maya} & ${voice.speakers.Elena}` : null;
  const narrator = voice.narrator ? `narrator ${voice.narrator}` : null;
  const provider = voice.provider && voice.provider !== 'auto' ? voice.provider : 'auto';
  const rate = voice.speakingRate && voice.speakingRate !== 1 ? `${voice.speakingRate}×` : null;
  return [hosts, narrator, voice.language, provider, rate].filter(Boolean).join(' · ');
}

/**
 * Listen & Learn is Gemini TTS with Azure AI Speech as the fallback, never
 * ElevenLabs (owner rule 2026-09-09, ADR 0029 §2b); the server enforces it
 * per product, so a 202 cannot name ElevenLabs here. Anything unlisted is
 * shown as sent.
 */
const PROVIDER_LABEL = { gemini: 'Gemini', azure: 'Azure AI Speech' };

/** "Best (gemini-3.1-flash-tts-preview)", or the bare id for a model not in the pair. */
const modelLabel = (model) =>
  GEMINI_TTS_MODEL_TIERS[model] ? `${GEMINI_TTS_MODEL_TIERS[model]} (${model})` : model;

/**
 * "Gemini Best (gemini-3.1-flash-tts-preview)", or — for a run that named
 * no model — "Gemini (the stored default applies; see Platform settings)".
 * The 202 cannot know the stored default, so it says so and prices the
 * dearer model rather than guessing; the toast repeats its sentence.
 */
function voiceLabel(speech) {
  const name = PROVIDER_LABEL[speech.provider] || speech.provider;
  if (speech.model) return `${name} ${modelLabel(speech.model)}`;
  // A 202 cannot know the model: since ADR 0034 slice 5 it is the task's
  // (`task`); an older server said the stored default applied (`stored`).
  if (speech.modelSource === 'task') {
    return `${name} (${speech.modelNote || 'the model is chosen under AI Engine → Tasks'})`;
  }
  if (speech.modelSource === 'stored') {
    return `${name} (${speech.modelNote || 'the stored default model applies'})`;
  }
  return name;
}

/**
 * Why a run will produce no audio, by the reason the server gave. The two
 * causes need different fixes — seeding a key, or correcting
 * `LISTEN_AND_LEARN_TTS_PROVIDER` — so they are worded separately, and a 202
 * from an older server carries no reason at all, which `noProviderMessage`
 * covers with wording true of both.
 */
const NO_PROVIDER = Object.freeze({
  pin_unavailable:
    'Queued — the pinned speech provider (LISTEN_AND_LEARN_TTS_PROVIDER) is not configured, so the audio step will fail and episodes will have transcripts only',
  not_configured:
    'Queued — no speech provider is configured, so episodes will have transcripts only',
});

const NO_PROVIDER_UNKNOWN =
  'Queued — no usable speech provider (none configured, or the pinned one is not), so episodes will have transcripts only';

/** Own properties only: a `reason` of "constructor" must not reach a function. */
function noProviderMessage(reason) {
  return Object.prototype.hasOwnProperty.call(NO_PROVIDER, reason ?? '')
    ? NO_PROVIDER[reason]
    : NO_PROVIDER_UNKNOWN;
}

/**
 * The progress line for a run that has just been accepted.
 *
 * The server's 202 says what the run is expected to spend on speech BEFORE it
 * starts (ADR 0029 §2a). It is a ceiling — every episode priced at
 * `MAX_SCRIPT_BYTES`, the most UTF-8 bytes a script may hold — so it reads
 * "up to", and it names the Gemini model the run will read with, because the
 * two on offer differ by a factor of two. No provider means the run will
 * publish transcripts with no audio; the server says which of the two causes
 * that is, because they call for different fixes — seeding a key, or
 * correcting `LISTEN_AND_LEARN_TTS_PROVIDER` — and a 202 from an older server
 * carries no reason, so the wording without one covers both.
 *
 * @param {{provider?: string|null, model?: string|null, reason?: string|null, estimatedCostUsd?: number|null, episodes?: number, perEpisodeUsd?: number|null}|null|undefined} speech
 */
export function queuedMessage(speech) {
  if (!speech) return 'Queued…';
  if (!speech.provider) return noProviderMessage(speech.reason);
  const voice = voiceLabel(speech);
  if (typeof speech.estimatedCostUsd !== 'number') return `Queued — speech by ${voice}`;
  const perEpisode =
    typeof speech.perEpisodeUsd === 'number' && speech.episodes
      ? ` (${speech.episodes} episodes × ${formatCost(speech.perEpisodeUsd)})`
      : '';
  return `Queued — speech by ${voice}, up to ${formatCost(speech.estimatedCostUsd)}${perEpisode}`;
}

/**
 * The line a chapter regeneration shows while it runs: the 202's estimate
 * for one chapter, by the same rules as a run's.
 */
export function regenerateMessage(speech) {
  if (!speech) return 'Queued…';
  if (!speech.provider)
    return 'Queued — no speech provider is configured, so this take will have no audio';
  const voice = voiceLabel({ ...speech, modelSource: speech.model ? 'run' : 'stored' });
  if (typeof speech.estimatedCostUsd !== 'number') return `Queued — speech by ${voice}`;
  return `Queued — speech by ${voice}, up to ${formatCost(speech.estimatedCostUsd)}`;
}

/** Published / draft / failed / archived counts for a set, for the tab's summary line. */
export function statusCounts(episodes) {
  return episodes.reduce((acc, e) => ({ ...acc, [e.status]: (acc[e.status] || 0) + 1 }), {});
}
