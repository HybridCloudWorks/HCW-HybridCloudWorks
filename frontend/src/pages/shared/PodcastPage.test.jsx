/**
 * The podcast page as the one audio surface (#349): both sources in one
 * list, one player, and a source filter the player follows.
 *
 * Behavioural assertions only: what matters is which episode the player
 * shows, since a selection the filter hides is invisible in the list and
 * would otherwise play silently from above it.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));

// The subscribe links a provider config offers on the next render; a `let`
// so one test can hand the page an unsafe one.
let subscribeLinks = {};

vi.mock('@/context/ProviderContext', () => ({
  useProvider: () => 'azure',
  useProviderConfig: () => ({ podcast: { feedUrl: null, subscribeLinks } }),
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
    image: 'javascript:alert(1)',
    mediaUrl: 'https://cdn.example/old.mp3',
    durationSeconds: 300,
    publishedAtISO: '2026-08-01T00:00:00.000Z',
    publishedAtString: '8/1/2026',
  },
];

// What the hook answers on the next render. A `let`, because the two sources
// answer independently and the list can re-sort after the page has settled —
// the case the pinning test below drives.
let episodesNow = episodes;

vi.mock('@/hooks/useAudioEpisodes', () => ({
  default: () => ({
    episodes: episodesNow,
    feedUrl: 'https://feeds.example/azure.xml',
    loading: false,
  }),
}));

// A player that reports state only when played, never on mount. The page
// must not rely on the real player announcing "paused" after it remounts —
// that arrives a render late, and the list indicator would flash meanwhile.
// EpisodePlayer has its own tests.
vi.mock('@/components/podcast/EpisodePlayer', () => ({
  default: ({ episode, onPlayingChange }) => (
    <article data-testid="episode-player">
      <h2>{episode.title}</h2>
      <button type="button" onClick={() => onPlayingChange?.(true)}>
        Play
      </button>
    </article>
  ),
}));

import SharedPodcastPage from './PodcastPage';

const page = () => (
  <MemoryRouter initialEntries={['/azure/podcast']}>
    <SharedPodcastPage provider="azure" />
  </MemoryRouter>
);

const mount = () => render(page());

/** An episode that sorts above every fixture row, as a late source would. */
const newest = {
  ...episodes[0],
  id: 'host:h-newest',
  title: 'Host newest',
  publishedAtISO: '2026-09-09T00:00:00.000Z',
  publishedAtString: '9/9/2026',
};

beforeEach(() => {
  episodesNow = episodes;
  subscribeLinks = {};
});

const playerTitle = () =>
  within(screen.getByTestId('episode-player')).getByRole('heading', { level: 2 });

describe('SharedPodcastPage', () => {
  it('lists both sources newest first and plays the newest by default', () => {
    mount();
    expect(playerTitle()).toHaveTextContent('Host new');
    expect(screen.getAllByText('Podcast feed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Listen & Learn · AZ-104').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the episode being played when a late source re-sorts the list', () => {
    // Nothing is selected until a row is clicked, so the featured episode is
    // just the first visible one. A source answering late puts a newer
    // episode on top; without pinning, the player would follow it, remount,
    // and stop the audio the listener is hearing.
    const { rerender } = mount();
    expect(playerTitle()).toHaveTextContent('Host new');
    fireEvent.click(
      within(screen.getByTestId('episode-player')).getByRole('button', { name: 'Play' })
    );

    episodesNow = [newest, ...episodes];
    rerender(page());

    // Exact text, not toHaveTextContent: "Host newest" contains "Host new",
    // so a substring assertion here would pass with the pinning removed.
    expect(playerTitle().textContent).toBe('Host new');
    expect(screen.getByRole('button', { name: /Host newest/ })).toBeInTheDocument();
  });

  it('follows the newest episode when the list re-sorts before anything is played', () => {
    // The other half of the same rule: with no audio running, the page is
    // free to feature whatever arrives at the top.
    const { rerender } = mount();
    episodesNow = [newest, ...episodes];
    rerender(page());
    expect(playerTitle()).toHaveTextContent('Host newest');
  });

  it('shows the RSS button with the feed the ingest reads', () => {
    mount();
    expect(screen.getByRole('link', { name: /RSS feed/ })).toHaveAttribute(
      'href',
      'https://feeds.example/azure.xml'
    );
  });

  it('offers no subscribe button for a platform whose configured URL is unsafe', () => {
    // The values go straight into an href, so an unsafe scheme in a provider
    // config must remove the button rather than become a clickable link.
    subscribeLinks = { spotify: 'javascript:alert(1)', apple: 'https://apple.example/show' };
    const { container } = mount();
    expect(screen.queryByRole('link', { name: /Spotify/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Apple Podcasts/ })).toHaveAttribute(
      'href',
      'https://apple.example/show'
    );
    expect(container.innerHTML).not.toContain('javascript:');
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

  it('renders the placeholder rather than an <img> for a row whose image URL is unsafe', () => {
    // `Host old` carries a javascript: image in the fixture; nothing on the
    // page may turn it into an <img>, with or without a src.
    const { container } = mount();
    const imgs = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(imgs.some((src) => !src || /^javascript:/i.test(src))).toBe(false);
    const row = screen.getByRole('button', { name: /Host old/ });
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('.material-symbols-outlined')).toHaveTextContent('podcasts');
  });

  it('drops the playing indicator the moment a different episode is selected', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    // The selected row shows the indicator while the player reports playing.
    const playingRow = screen.getByRole('button', { name: /Host new/ });
    expect(playingRow).toHaveTextContent('graphic_eq');

    fireEvent.click(screen.getByRole('button', { name: /Identities and governance/ }));
    // A different episode mounts a paused player; no row may claim otherwise,
    // not even for the render before the new player reports its state.
    expect(screen.queryByText('graphic_eq')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(playerTitle()).toHaveTextContent('Identities and governance');
  });

  it('keeps the playing indicator when a filter leaves the featured episode in place', () => {
    // The player is stateful and cannot be paused from the page: if the
    // filter does not remount it, audio keeps playing and the list must say so.
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByRole('button', { name: 'Podcast feed' }));
    expect(playerTitle()).toHaveTextContent('Host new');
    expect(screen.getByRole('button', { name: /Host new/ })).toHaveTextContent('graphic_eq');
  });

  it('clears the playing indicator when a filter switches the featured episode', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByRole('button', { name: 'Listen & Learn' }));
    expect(playerTitle()).toHaveTextContent('Identities and governance');
    expect(screen.queryByText('graphic_eq')).toBeNull();
  });

  it('keeps the indicator when the row already playing is clicked again', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByRole('button', { name: /Host new/ }));
    expect(screen.getByRole('button', { name: /Host new/ })).toHaveTextContent('graphic_eq');
  });

  it('keeps a selection that survives the filter', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Identities and governance/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Listen & Learn' }));
    expect(playerTitle()).toHaveTextContent('Identities and governance');
  });
});
