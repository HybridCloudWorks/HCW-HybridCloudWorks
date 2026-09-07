/**
 * The podcast page's one episode shape (#349). Two stores, two documents,
 * one list: these pin what each source contributes and that the merge is
 * date-ordered regardless of origin.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/functionsBase', () => ({
  // A cross-origin deployment, so the rewrite is observable.
  resolveMediaUrl: (url) => (url.startsWith('/api/') ? `https://fn.example${url}` : url),
}));

import {
  formatSeconds,
  mergeAudioEpisodes,
  normalizeHostEpisode,
  normalizeListenAndLearnEpisode,
  parseDurationSeconds,
  SOURCE,
} from './audioEpisodes';

describe('parseDurationSeconds', () => {
  it.each([
    [540, 540],
    ['540', 540],
    ['9:00', 540],
    ['1:02:03', 3723],
    ['00:05', 5],
    [' 9:00 ', 540],
  ])('reads %j as %d seconds', (raw, expected) => {
    expect(parseDurationSeconds(raw)).toBe(expected);
  });

  it.each([null, undefined, '', 0, -3, 'soon', '1:2:3:4', 'a:b', NaN])(
    'is null for %j rather than pretending 0:00',
    (raw) => {
      expect(parseDurationSeconds(raw)).toBeNull();
    }
  );
});

describe('normalizeHostEpisode', () => {
  const row = {
    id: 'ep-42',
    title: 'Episode 42',
    description: 'Short',
    longDescription: '<p>Long</p>',
    mediaUrl: 'https://cdn.example/ep-42.mp3',
    duration: '12:34',
    image: 'https://cdn.example/ep-42.jpg',
    link: 'https://host.example/ep-42',
    publishedAt: '2026-09-01T10:00:00.000Z',
  };

  it('labels the row as the feed and keeps the host media URL as stored', () => {
    const out = normalizeHostEpisode(row);
    expect(out).toMatchObject({
      id: 'host:ep-42',
      source: SOURCE.host,
      sourceLabel: 'Podcast feed',
      mediaUrl: 'https://cdn.example/ep-42.mp3',
      durationSeconds: 754,
      link: 'https://host.example/ep-42',
      publishedAtISO: '2026-09-01T10:00:00.000Z',
    });
    expect(out.publishedAtString).toBeTruthy();
  });

  it('strips feed HTML from both descriptions, repeatedly', () => {
    const out = normalizeHostEpisode({
      ...row,
      description: '<p>Short</p>',
      longDescription: '<p>Long <scr<script>ipt>x</script></p>',
    });
    expect(out.description).toBe('Short');
    // The overlapping construct leaves a harmless `ipt>` residue; what the
    // stripper promises is that no `<…>` tag survives, not pretty output.
    expect(out.longDescription).not.toMatch(/<[^>]*>/);
    expect(out.longDescription).not.toContain('<');
    expect(out.longDescription.startsWith('Long ')).toBe(true);
  });

  it('leaves the date fields null when the row has no usable date', () => {
    const out = normalizeHostEpisode({ ...row, publishedAt: 'junk' });
    expect(out.publishedAtISO).toBeNull();
    expect(out.publishedAtString).toBeNull();
  });
});

describe('normalizeListenAndLearnEpisode', () => {
  const row = {
    id: 'manage-identities',
    setId: 'azure_az-104',
    provider: 'azure',
    examCode: 'AZ-104',
    areaName: 'Manage identities and governance',
    title: 'Identities and governance',
    summary: 'What the exam asks',
    audioUrl: '/api/public/media/listenandlearn/azure/az-104/manage-identities.mp3',
    durationSeconds: 512.6,
    approvedAt: '2026-09-03T00:00:00.000Z',
    generatedAt: '2026-08-30T00:00:00.000Z',
    certTitle: 'Azure Administrator Associate',
    certSlug: 'az-104',
  };

  it('labels the row with the exam and links to the certification page', () => {
    const out = normalizeListenAndLearnEpisode(row);
    expect(out).toMatchObject({
      id: 'listen-and-learn:azure_az-104/manage-identities',
      source: SOURCE.listenAndLearn,
      sourceLabel: 'Listen & Learn · AZ-104',
      title: 'Identities and governance',
      description: 'What the exam asks',
      longDescription: 'Azure Administrator Associate — Manage identities and governance',
      durationSeconds: 513,
      link: '/azure/education/az-104',
      publishedAtISO: '2026-09-03T00:00:00.000Z',
      image: null,
    });
  });

  it('resolves the site-relative audio path against the Functions origin', () => {
    // Stored relative so a topology change cannot invalidate every episode;
    // played absolute so a cross-origin deployment does not hand <audio> the
    // SPA's index.html.
    expect(normalizeListenAndLearnEpisode(row).mediaUrl).toBe(
      'https://fn.example/api/public/media/listenandlearn/azure/az-104/manage-identities.mp3'
    );
  });

  it('dates by approval, falling back to generation', () => {
    const out = normalizeListenAndLearnEpisode({ ...row, approvedAt: null });
    expect(out.publishedAtISO).toBe('2026-08-30T00:00:00.000Z');
  });

  it('has no link without a certification slug and no media without audio', () => {
    const out = normalizeListenAndLearnEpisode({ ...row, certSlug: null, audioUrl: null });
    expect(out.link).toBeNull();
    expect(out.mediaUrl).toBeNull();
  });
});

describe('mergeAudioEpisodes', () => {
  it('interleaves both sources newest first, undated last', () => {
    const out = mergeAudioEpisodes({
      host: [
        { id: 'h-old', title: 'Host old', publishedAt: '2026-08-01T00:00:00Z' },
        { id: 'h-undated', title: 'Host undated' },
        { id: 'h-new', title: 'Host new', publishedAt: '2026-09-05T00:00:00Z' },
      ],
      listenAndLearn: [
        { id: 'll-mid', setId: 's', title: 'LL mid', approvedAt: '2026-09-02T00:00:00Z' },
      ],
    });
    expect(out.map((e) => e.id)).toEqual([
      'host:h-new',
      'listen-and-learn:s/ll-mid',
      'host:h-old',
      'host:h-undated',
    ]);
  });

  it('never collides ids across sources', () => {
    const out = mergeAudioEpisodes({
      host: [{ id: 'same' }],
      listenAndLearn: [{ id: 'same', setId: 'same' }],
    });
    expect(new Set(out.map((e) => e.id)).size).toBe(2);
  });

  it('is empty for nothing', () => {
    expect(mergeAudioEpisodes()).toEqual([]);
  });
});

describe('formatSeconds', () => {
  it('formats minutes and hours and admits ignorance', () => {
    expect(formatSeconds(0)).toBe('0:00');
    expect(formatSeconds(65)).toBe('1:05');
    expect(formatSeconds(3723)).toBe('1:02:03');
    expect(formatSeconds(null)).toBe('—');
    expect(formatSeconds(NaN)).toBe('—');
  });
});
