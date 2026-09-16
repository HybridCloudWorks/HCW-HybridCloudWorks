/**
 * The parts Review and Published both need: choosing a set, and rendering the
 * episodes of the chosen one.
 *
 * Shared rather than copied because the two tabs differ only in which episodes
 * they pass — #588 counts 61-line copies as real duplication, and this is
 * exactly that shape.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import EpisodeCard from './EpisodeCard';

/** The generated sets, as one button each. `null` selection selects nothing. */
export function SetPicker({ sets, selected, onOpen }) {
  if (sets.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing generated yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {sets.map((set) => (
        <Button
          key={set.id}
          size="sm"
          variant={
            selected?.examCode === set.examCode && selected?.platform === set.provider
              ? 'default'
              : 'outline'
          }
          onClick={() => onOpen(set.provider, set.examCode)}
        >
          {set.examCode}
          <span className="ml-1.5 text-[10px] opacity-70">{set.provider}</span>
        </Button>
      ))}
    </div>
  );
}

/**
 * The chosen set's episodes, or the reason there are none to show. `emptyLabel`
 * differs per tab: an empty Review means everything is approved, while an empty
 * Published means nothing is live yet.
 */
export function EpisodeList({ loading, episodes, busySlugs, onReview, emptyLabel }) {
  if (loading) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading episodes…
      </p>
    );
  }
  if (episodes.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-3">
      {episodes.map((episode) => (
        <EpisodeCard
          key={episode.areaSlug}
          episode={episode}
          busy={busySlugs.has(episode.areaSlug)}
          onReview={onReview}
        />
      ))}
    </div>
  );
}

/** "3 published · 2 draft · 0 failed" for the chosen set. */
export function CountsLine({ counts }) {
  return (
    <span className="text-xs font-normal text-muted-foreground">
      {counts.published || 0} published · {counts.draft || 0} draft · {counts.failed || 0} failed
    </span>
  );
}
