/**
 * Published — what is live on the certification pages, per set, with the same
 * card Review uses so an episode can be withdrawn from where it is visible.
 */
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { statusCounts } from './episodeView';
import { SetPicker, EpisodeList, CountsLine } from './shared';

export default function PublishedTab({ hub }) {
  const { sets, selected, episodes, loading, busySlugs, openSet, review } = hub;
  const live = episodes.filter((e) => e.status === 'published');

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
              episodes={live}
              busySlugs={busySlugs}
              onReview={review}
              emptyLabel="Nothing from this set is published yet — approve episodes on the Review tab."
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
