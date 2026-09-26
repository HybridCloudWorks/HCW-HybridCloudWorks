/**
 * A voice's preview, played by ear in the Podcast voices picker (#725; ADR
 * 0029 §2a, amended 2026-09-26).
 *
 *   GET  cms/podcast/elevenlabs/voices/{voiceId}/preview   that voice's preview MP3,
 *                                                          proxied by the server
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Play, Square } from 'lucide-react';
import { authedFetch } from '@/lib/api';

export const ELEVENLABS_VOICES_ROUTE = 'cms/podcast/elevenlabs/voices';
export const previewRoute = (voiceId) =>
  `${ELEVENLABS_VOICES_ROUTE}/${encodeURIComponent(voiceId)}/preview`;

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

export function PlayButton({ voice, player, label }) {
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
