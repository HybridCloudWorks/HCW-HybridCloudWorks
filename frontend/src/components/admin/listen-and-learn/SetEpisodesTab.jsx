/**
 * Review — the chapters of one book that are not live yet, with their
 * transcripts and an audio preview, and the approval that publishes them.
 * Failed chapters belong here rather than in the Library's published view:
 * they are work in progress that needs a decision, and the card explains the
 * failure. A chapter whose regeneration failed while published is NOT here
 * — it is still live, and its row in the Library offers Retry and Keep
 * current (ADR 0033 §4).
 *
 * Until ADR 0033 §4 a Published tab sat beside this one over the same list;
 * the Library's book view shows each chapter's status now, so the published
 * slice lives there.
 */
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { statusCounts } from './episodeView';
import { SetPicker, EpisodeList, CountsLine } from './shared';

const needsReview = (episode) => episode.status !== 'published' && episode.status !== 'archived';

export function ReviewTab({ hub }) {
  const {
    sets,
    selected,
    episodes,
    loading,
    busySlugs,
    openSet,
    review,
    regenerate,
    patchChapter,
  } = hub;
  const shown = episodes.filter(needsReview);

  return (
    <div className="space-y-6 pt-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Books and courses</CardTitle>
        </CardHeader>
        <CardContent>
          <SetPicker sets={sets} selected={selected} onOpen={openSet} />
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {hub.book?.title || selected.examCode}
              <CountsLine counts={statusCounts(episodes)} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EpisodeList
              loading={loading}
              episodes={shown}
              busySlugs={busySlugs}
              onReview={review}
              onRetry={(episode) => regenerate(episode.id)}
              onKeepCurrent={(episode) => patchChapter(episode.id, { clearError: true })}
              emptyLabel={
                episodes.length > 0
                  ? 'Every chapter in this book is published or archived — see the Library.'
                  : 'No chapters in this book yet.'
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default ReviewTab;
