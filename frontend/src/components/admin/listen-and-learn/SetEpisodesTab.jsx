/**
 * Review and Published are the same panel over a different slice of the same
 * set, so they are one component and two configurations of it.
 *
 * Written this way on purpose: the first draft of #574 was two files that
 * differed in a filter, an empty-state sentence and a doc comment, and were
 * otherwise identical for thirty-five lines. That is the duplication #588
 * counts, and — worse — it is two places to change the approve button.
 */
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { statusCounts } from './episodeView';
import { SetPicker, EpisodeList, CountsLine } from './shared';

const isPublished = (episode) => episode.status === 'published';

function SetEpisodesTab({ hub, keep, emptyLabel }) {
  const { sets, selected, episodes, loading, busySlugs, openSet, review } = hub;
  const shown = episodes.filter(keep);

  return (
    <div className="space-y-6 pt-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generated sets</CardTitle>
        </CardHeader>
        <CardContent>
          <SetPicker sets={sets} selected={selected} onOpen={openSet} />
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {selected.examCode}
              <CountsLine counts={statusCounts(episodes)} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EpisodeList
              loading={loading}
              episodes={shown}
              busySlugs={busySlugs}
              onReview={review}
              emptyLabel={emptyLabel(episodes)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Review — generated episodes that are not live yet, with their transcripts and
 * an audio preview, and the approval that publishes them. Failed episodes
 * belong here rather than on Published: they are work in progress that needs a
 * decision, and the card already explains the failure.
 */
export function ReviewTab({ hub }) {
  return (
    <SetEpisodesTab
      hub={hub}
      keep={(episode) => !isPublished(episode)}
      emptyLabel={(all) =>
        all.length > 0
          ? 'Every episode in this set is published — see the Published tab.'
          : 'No episodes in this set.'
      }
    />
  );
}

/**
 * Published — what is live on the certification pages, per set, with the same
 * card Review uses so an episode can be withdrawn from where it is visible.
 */
export function PublishedTab({ hub }) {
  return (
    <SetEpisodesTab
      hub={hub}
      keep={isPublished}
      emptyLabel={() =>
        'Nothing from this set is published yet — approve episodes on the Review tab.'
      }
    />
  );
}
