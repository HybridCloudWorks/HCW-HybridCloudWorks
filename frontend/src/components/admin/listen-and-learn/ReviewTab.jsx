/**
 * Review — generated episodes that are not live yet, with their transcripts and
 * an audio preview, and the approval that publishes them.
 *
 * Failed episodes belong here rather than on Published: they are work in
 * progress that needs a decision, and the card already explains the failure.
 */
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { statusCounts } from './episodeView';
import { SetPicker, EpisodeList, CountsLine } from './shared';

export default function ReviewTab({ hub }) {
  const { sets, selected, episodes, loading, busySlugs, openSet, review } = hub;
  const pending = episodes.filter((e) => e.status !== 'published');

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
              episodes={pending}
              busySlugs={busySlugs}
              onReview={review}
              emptyLabel={
                episodes.length > 0
                  ? 'Every episode in this set is published — see the Published tab.'
                  : 'No episodes in this set.'
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
