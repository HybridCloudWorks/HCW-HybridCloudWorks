/**
 * One episode row: what it says, whether it has audio, and the approval.
 *
 * Moved out of ListenAndLearnPage by #574 unchanged. Review and Published both
 * render it — the only difference is which episodes they pass in — so the
 * approve and withdraw buttons stay one piece of code rather than two that can
 * drift.
 */
import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  VolumeX,
} from 'lucide-react';
import { resolveMediaUrl } from '@/lib/functionsBase';
import { EpisodeSources } from '@/pages/admin/SourceGroundingPanel';
import { formatDuration, formatSize } from './episodeView';

const STATUS_BADGE = {
  published: { variant: 'default', label: 'Published', icon: CheckCircle2 },
  draft: { variant: 'outline', label: 'Draft', icon: null },
  failed: { variant: 'destructive', label: 'Failed', icon: AlertTriangle },
};

export function StatusBadge({ status }) {
  const spec = STATUS_BADGE[status] || STATUS_BADGE.draft;
  const Icon = spec.icon;
  return (
    <Badge variant={spec.variant} className="gap-1">
      {Icon && <Icon className="h-3 w-3" />}
      {spec.label}
    </Badge>
  );
}

/**
 * The player, or an honest explanation of why there isn't one.
 *
 * Its own component because a missing key is a normal state here rather than an
 * error, so both branches carry real content and inlining them pushed the card
 * past the complexity budget.
 */
function EpisodeAudio({ episode }) {
  if (!episode.audioUrl) {
    // Not a failure: the script generated and the transcript is reviewable.
    // Saying which setting is missing turns "no player" into a task.
    if (!episode.audioError) return null;
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <VolumeX className="h-3.5 w-3.5 shrink-0" />
        No audio — {episode.audioError}
      </p>
    );
  }

  // Which voice read it. Provenance for AI-generated study content, and the
  // only thing that answers "why does this one sound different" after a
  // provider or model change.
  const meta = [
    episode.speechModel || episode.speechProvider,
    formatDuration(episode.durationSeconds),
    formatSize(episode.audioBytes),
  ].filter(Boolean);

  return (
    <>
      <audio
        controls
        preload="none"
        src={resolveMediaUrl(episode.audioUrl)}
        className="w-full h-10"
        aria-label={`Preview: ${episode.title || episode.areaName}`}
      >
        <track kind="captions" />
      </audio>
      {meta.length > 0 && <p className="text-[11px] text-muted-foreground">{meta.join(' · ')}</p>}
    </>
  );
}

export default function EpisodeCard({ episode, busy, onReview }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const transcript = Array.isArray(episode.transcript) ? episode.transcript : [];
  const published = episode.status === 'published';

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{episode.title || episode.areaName}</p>
          <p className="text-xs text-muted-foreground">
            {episode.areaName}
            {episode.weightLabel ? ` · ${episode.weightLabel} of exam` : ''}
          </p>
        </div>
        <StatusBadge status={episode.status} />
      </div>

      {episode.summary && <p className="text-xs text-muted-foreground">{episode.summary}</p>}

      <EpisodeSources episode={episode} />

      {episode.status === 'failed' && episode.error && (
        <p className="text-xs text-destructive">{episode.error}</p>
      )}

      <EpisodeAudio episode={episode} />

      {transcript.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowTranscript((open) => !open)}
            aria-expanded={showTranscript}
            className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {showTranscript ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {showTranscript ? 'Hide transcript' : `Read transcript (${transcript.length} turns)`}
          </button>
          {showTranscript && (
            <div className="mt-2 space-y-2 max-h-96 overflow-y-auto pr-2">
              {transcript.map((turn, i) => (
                <p key={`${turn.speaker}-${i}`} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{turn.speaker}: </span>
                  {turn.text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {episode.status !== 'failed' && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={published ? 'outline' : 'default'}
            disabled={busy}
            onClick={() => onReview(episode, published ? 'draft' : 'published')}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {published ? 'Withdraw to draft' : 'Approve and publish'}
          </Button>
          {published && episode.approvedAt && (
            <span className="text-[11px] text-muted-foreground">
              Approved {new Date(episode.approvedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
