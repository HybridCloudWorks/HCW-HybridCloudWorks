/**
 * The podcast page as the one audio surface (#349): both sources in one
 * list, one player, and a source filter the player follows.
 *
 * Behavioural assertions only: what matters is which episode the player
 * shows, since a selection the filter hides is invisible in the list and
 * would otherwise play silently from above it.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));

vi.mock('@/context/ProviderContext', () => ({
  useProvider: () => 'azure',
  useProviderConfig: () => ({ podcast: { feedUrl: null, subscribeLinks: {} } }),
}));

const episodes = [
  {
    id: 'host:h-new',
    source: 'host',
    sourceLabel: 'Podcast feed',
    title: 'Host new',
    description: 'From the feed',
    mediaUrl: 'https://cdn.example/new.mp3',
    durationSeconds: 600,
    publishedAtISO: '2026-09-05T00:00:00.000Z',
    publishedAtString: '9/5/2026',
  },
  {
    id: 'listen-and-learn:azure_az-104/a',
    source: 'listen-and-learn',
    sourceLabel: 'Listen & Learn · AZ-104',
    title: 'Identities and governance',
    description: 'Study episode',
    mediaUrl: 'https://fn.example/api/public/media/listenandlearn/azure/az-104/a.mp3',
    durationSeconds: 540,
    link: '/azure/education/az-104',
    publishedAtISO: '2026-09-03T00:00:00.000Z',
    publishedAtString: '9/3/2026',
  },
  {
    id: 'host:h-old',
    source: 'host',
    sourceLabel: 'Podcast feed',
    title: 'Host old',
    description: 'Older feed episode',
    mediaUrl: 'https://cdn.example/old.mp3',
    durationSeconds: 300,
    publishedAtISO: '2026-08-01T00:00:00.000Z',
    publishedAtString: '8/1/2026',
  },
];

vi.mock('@/hooks/useAudioEpisodes', () => ({
  default: () => ({ episodes, feedUrl: 'https://feeds.example/azure.xml', loading: false }),
}));

import SharedPodcastPage from './PodcastPage';

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/azure/podcast']}>
      <SharedPodcastPage provider="azure" />
    </MemoryRouter>
  );

const playerTitle = () =>
  within(screen.getByTestId('episode-player')).getByRole('heading', { level: 2 });

describe('SharedPodcastPage', () => {
  it('lists both sources newest first and plays the newest by default', () => {
    mount();
    expect(playerTitle()).toHaveTextContent('Host new');
    expect(screen.getAllByText('Podcast feed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Listen & Learn · AZ-104').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the RSS button with the feed the ingest reads', () => {
    mount();
    expect(screen.getByRole('link', { name: /RSS feed/ })).toHaveAttribute(
      'href',
      'https://feeds.example/azure.xml'
    );
  });

  it('moves the player to the first visible episode when the filter hides the selection', () => {
    mount();
    // Select an older feed episode, then filter to Listen & Learn: the
    // selection is no longer in the list, so the player must not keep it.
    fireEvent.click(screen.getByRole('button', { name: /Host old/ }));
    expect(playerTitle()).toHaveTextContent('Host old');

    fireEvent.click(screen.getByRole('button', { name: 'Listen & Learn' }));
    expect(playerTitle()).toHaveTextContent('Identities and governance');
    expect(screen.queryByRole('button', { name: /Host old/ })).toBeNull();

    // Widening the filter again restores the selection, which is still held.
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(playerTitle()).toHaveTextContent('Host old');
  });

  it('keeps a selection that survives the filter', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Identities and governance/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Listen & Learn' }));
    expect(playerTitle()).toHaveTextContent('Identities and governance');
  });
});
