/**
 * Podcast voices: the owner picks the two hosts' ElevenLabs voices by ear
 * (#725; ADR 0029 §2a, amended 2026-09-26).
 *
 *   GET  cms/podcast/elevenlabs/voices                     every voice the key may
 *                                                          list, marked usable on
 *                                                          the plan or not, and why
 *   GET  cms/podcast/elevenlabs/voices/{voiceId}/preview   that voice's preview MP3
 *   GET/PUT cms/platform-settings/podcast-voices           the saved choice,
 *                                                          { Maya, Elena }
 *
 * The first live check on the free plan was refused because the code's
 * voices were Voice Library voices to this account. So nothing here is
 * hidden: a voice the plan does not allow is listed, disabled, with the
 * reason beside it.
 *
 * ## Why the preview is decoded with Web Audio
 *
 * The site's CSP has no `media-src`, so media falls back to `default-src
 * 'self'`. That admits neither ElevenLabs's preview host (not widened, by
 * design) nor a `blob:` URL, and the preview route needs a bearer token an
 * `<audio src>` cannot send. So the page fetches the bytes with the token
 * and decodes them with `AudioContext.decodeAudioData`, which plays a buffer
 * rather than loading a URL, and no CSP directive governs it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Loader2, Play, RefreshCw, Square } from 'lucide-react';
import { authedFetch, getJSON } from '@/lib/api';
import { SELECT_CLASS, SaveRow, StoredState } from './settingShared';

export const ELEVENLABS_VOICES_ROUTE = 'cms/podcast/elevenlabs/voices';
export const previewRoute = (voiceId) =>
  `${ELEVENLABS_VOICES_ROUTE}/${encodeURIComponent(voiceId)}/preview`;

/** The two hosts every podcast script is written for (functions/.../script.js). */
export const PODCAST_HOSTS = Object.freeze(['Maya', 'Elena']);

/** Where the owner makes a voice of their own when the plan allows none of the listed ones. */
export const MY_VOICES_PAGE = 'https://elevenlabs.io/app/voice-lab';

const TYPE_LABELS = Object.freeze({
  default: 'Default voice',
  own: 'Your voice',
  library: 'Voice Library',
});

/** "Talia — female, american, young": the name and the labels a host is chosen by. */
export function voiceLabel(voice) {
  const labels = voice?.labels ?? {};
  const traits = [labels.gender, labels.accent, labels.age].filter(Boolean).join(', ');
  return traits ? `${voice.name} — ${traits}` : voice.name;
}

/**
 * The voice list. Loads only once the key is known to be configured, and is
 * race-safe the way `useSetting` is: only the newest load writes state.
 * "Loading" is derived (the attempt asked for has not settled) rather than
 * set in the effect, which would render twice for nothing.
 */
function useVoiceList(enabled) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState(-1);
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const mine = ++generation.current;
    const current = () => mine === generation.current;
    getJSON(ELEVENLABS_VOICES_ROUTE)
      .then((response) => {
        if (!current()) return;
        setList(response ?? null);
        setError(null);
      })
      .catch((err) => {
        if (!current()) return;
        setList(null);
        setError(err?.message ?? 'Could not list the ElevenLabs voices.');
      })
      .finally(() => {
        if (current()) setSettled(attempt);
      });
    return () => {
      if (current()) generation.current += 1;
    };
  }, [enabled, attempt]);

  const reload = useCallback(() => {
    generation.current += 1;
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { list, loading: Boolean(enabled) && settled !== attempt, error, reload };
}

const audioContextClass = () =>
  typeof window === 'undefined' ? undefined : window.AudioContext || window.webkitAudioContext;

/**
 * One preview at a time, through Web Audio (see the header). A click on the
 * voice that is playing stops it; a click on another stops the first. A
 * decoded preview is kept for the session, so a second listen fetches
 * nothing. A click superseded by a newer one while it loads plays nothing.
 */
export function usePreviewPlayer() {
  const [playing, setPlaying] = useState(null);
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);
  const contextRef = useRef(null);
  const sourceRef = useRef(null);
  const playingRef = useRef(null);
  const requestRef = useRef(0);
  const buffers = useRef(new Map());

  const stop = useCallback(() => {
    requestRef.current += 1;
    const source = sourceRef.current;
    sourceRef.current = null;
    playingRef.current = null;
    try {
      source?.stop();
    } catch {
      // Already ended.
    }
    setPlaying(null);
    setLoading(null);
  }, []);

  const play = useCallback(
    async (voiceId) => {
      if (playingRef.current === voiceId) {
        stop();
        return;
      }
      stop();
      const AudioContextClass = audioContextClass();
      if (!AudioContextClass) {
        setError('This browser cannot play the preview here (no Web Audio).');
        return;
      }
      const mine = requestRef.current;
      setError(null);
      setLoading(voiceId);
      try {
        contextRef.current ??= new AudioContextClass();
        const context = contextRef.current;
        if (context.state === 'suspended') await context.resume?.();
        let buffer = buffers.current.get(voiceId);
        if (!buffer) {
          const response = await authedFetch(previewRoute(voiceId), {
            method: 'GET',
            headers: { Accept: 'audio/mpeg' },
          });
          buffer = await context.decodeAudioData(await response.arrayBuffer());
          buffers.current.set(voiceId, buffer);
        }
        if (mine !== requestRef.current) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => {
          if (sourceRef.current !== source) return;
          sourceRef.current = null;
          playingRef.current = null;
          setPlaying(null);
        };
        sourceRef.current = source;
        playingRef.current = voiceId;
        source.start();
        setPlaying(voiceId);
      } catch (err) {
        if (mine === requestRef.current) {
          setError(err?.message ?? 'The preview could not be played.');
        }
      } finally {
        if (mine === requestRef.current) setLoading(null);
      }
    },
    [stop]
  );

  useEffect(
    () => () => {
      try {
        sourceRef.current?.stop();
      } catch {
        // Already ended.
      }
      contextRef.current?.close?.();
    },
    []
  );

  return { playing, loading, error, play, stop };
}

function PlayButton({ voice, player, label }) {
  const isPlaying = player.playing === voice.voiceId;
  const isLoading = player.loading === voice.voiceId;
  let icon = <Play className="h-3.5 w-3.5" />;
  if (isLoading) icon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  else if (isPlaying) icon = <Square className="h-3.5 w-3.5" />;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={`${isPlaying ? 'Stop' : 'Play'} ${label}`}
      aria-pressed={isPlaying}
      disabled={!voice.hasPreview}
      title={voice.hasPreview ? undefined : 'ElevenLabs has no preview for this voice'}
      onClick={() => player.play(voice.voiceId)}
    >
      {icon}
    </Button>
  );
}

function HostSelect({ host, value, usable, unavailable, byId, disabled, onChange, player }) {
  const chosen = byId.get(value);
  return (
    <div className="space-y-1">
      <Label htmlFor={`podcast-voice-${host}`}>{host}</Label>
      <div className="flex items-center gap-2">
        <select
          id={`podcast-voice-${host}`}
          className={SELECT_CLASS}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose a voice…</option>
          {value && !chosen ? (
            <option value={value}>{`${value} (saved; not in this key's list)`}</option>
          ) : null}
          {usable.length > 0 ? (
            <optgroup label="Usable on this plan">
              {usable.map((voice) => (
                <option key={voice.voiceId} value={voice.voiceId}>
                  {voiceLabel(voice)}
                </option>
              ))}
            </optgroup>
          ) : null}
          {unavailable.length > 0 ? (
            <optgroup label="Not available on this plan">
              {unavailable.map((voice) => (
                <option key={voice.voiceId} value={voice.voiceId} disabled>
                  {`${voiceLabel(voice)} — ${voice.unavailableReason}`}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        {chosen ? <PlayButton voice={chosen} player={player} label={`${host}'s voice`} /> : null}
      </div>
    </div>
  );
}

function VoiceRow({ voice, player }) {
  const traits = [voice.labels?.gender, voice.labels?.accent, voice.labels?.age]
    .filter(Boolean)
    .join(', ');
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 space-y-0.5 text-sm">
        <p className={voice.usable ? 'font-medium' : 'font-medium text-muted-foreground'}>
          {voice.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {[TYPE_LABELS[voice.type] ?? voice.type, traits, voice.labels?.description]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {voice.usable ? null : (
          <p className="text-xs text-amber-700">{`Not available: ${voice.unavailableReason}`}</p>
        )}
      </div>
      <PlayButton voice={voice} player={player} label={voice.name} />
    </li>
  );
}

function ListState({ configured, voices }) {
  if (!configured) {
    return (
      <p className="text-xs text-muted-foreground">
        Seed the ElevenLabs key first; the voices are the account&apos;s own list.
      </p>
    );
  }
  if (voices.loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the voices this key may use…
      </p>
    );
  }
  if (voices.error) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
      >
        <span>Voices: {voices.error}</span>
        <Button type="button" size="sm" variant="outline" onClick={voices.reload}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }
  return null;
}

function ListNotes({ list, usableCount }) {
  if (!list) return null;
  return (
    <>
      {list.voicesError ? <p className="text-xs text-amber-700">{list.voicesError}</p> : null}
      {list.subscriptionError ? (
        <p className="text-xs text-amber-700">
          The plan could not be read, so Voice Library voices are shown as unavailable:{' '}
          {list.subscriptionError}
        </p>
      ) : null}
      {!list.voicesError && list.voices?.length > 0 && usableCount === 0 ? (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            None of these voices can be used through the API on this plan. Make one of your own
            under My Voices at {MY_VOICES_PAGE} (Voice Design), then retry.
          </span>
        </p>
      ) : null}
      {list.truncated ? (
        <p className="text-xs text-muted-foreground">
          Only the first 500 voices of each kind are listed.
        </p>
      ) : null}
    </>
  );
}

/**
 * The picker, inside the ElevenLabs card. `setting` is the card's
 * `useSetting('podcast-voices')`, so the live check below it knows what is
 * saved; `configured` is whether the key is seeded.
 */
export default function PodcastVoices({ setting, configured }) {
  const voices = useVoiceList(configured);
  const player = usePreviewPlayer();
  const all = useMemo(
    () => (Array.isArray(voices.list?.voices) ? voices.list.voices : []),
    [voices.list]
  );
  const byId = useMemo(() => new Map(all.map((voice) => [voice.voiceId, voice])), [all]);
  const usable = useMemo(() => all.filter((voice) => voice.usable), [all]);
  const unavailable = useMemo(() => all.filter((voice) => !voice.usable), [all]);

  const value = setting.value ?? {};
  const chosen = PODCAST_HOSTS.map((host) => value[host] ?? '');
  const same = chosen[0] !== '' && chosen[0] === chosen[1];
  const complete = chosen.every(Boolean);
  const update = (host, voiceId) => setting.setValue({ ...value, [host]: voiceId });

  return (
    <section
      aria-labelledby="podcast-voices-heading"
      className="space-y-3 rounded-md border border-input p-3"
    >
      <div className="space-y-1">
        <p id="podcast-voices-heading" className="text-sm font-medium">
          Podcast voices
        </p>
        <p className="text-xs text-muted-foreground">
          Choose a voice for each host by ear, then Save. Episodes and the live check use the saved
          pair; there is no default. {voices.list?.rule ?? ''}
        </p>
      </div>
      <ListState configured={configured} voices={voices} />
      <ListNotes list={voices.list} usableCount={usable.length} />
      {setting.loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the saved voices…
        </p>
      ) : null}
      {!setting.loading && setting.error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
        >
          <span>Podcast voices: {setting.error}</span>
          <Button type="button" size="sm" variant="outline" onClick={setting.reload}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : null}
      {!setting.loading && !setting.error ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (complete && !same) setting.save({ Maya: chosen[0], Elena: chosen[1] });
          }}
        >
          <StoredState meta={setting.meta} />
          <div className="grid gap-3 sm:grid-cols-2">
            {PODCAST_HOSTS.map((host, index) => (
              <HostSelect
                key={host}
                host={host}
                value={chosen[index]}
                usable={usable}
                unavailable={unavailable}
                byId={byId}
                disabled={setting.saving}
                onChange={(voiceId) => update(host, voiceId)}
                player={player}
              />
            ))}
          </div>
          {same ? (
            <p className="text-xs text-destructive">
              Maya and Elena need different voices, so a listener can tell the hosts apart.
            </p>
          ) : null}
          <SaveRow saving={setting.saving} disabled={!complete || same} />
        </form>
      ) : null}
      {player.error ? <p className="text-xs text-destructive">Preview: {player.error}</p> : null}
      {all.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">
            {`All voices: ${usable.length} usable, ${unavailable.length} not available on this plan`}
          </p>
          <ul
            aria-label="ElevenLabs voices"
            className="max-h-72 divide-y overflow-y-auto rounded-md border border-input px-3"
          >
            {all.map((voice) => (
              <VoiceRow key={voice.voiceId} voice={voice} player={player} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
