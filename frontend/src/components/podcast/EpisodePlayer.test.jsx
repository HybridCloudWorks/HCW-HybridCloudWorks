/**
 * The podcast page's one player (#349). Behavioural assertions: the seek
 * control must be a real, operable input that moves the element's position,
 * and the source label must say which system an episode came from.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EpisodePlayer from './EpisodePlayer';

const meta = {
  border: 'border-x',
  badge: 'badge-x',
  placeholder: 'ph-x',
  placeholderIcon: 'phi-x',
  progressBar: 'pb-x',
  playBtn: 'play-x',
};

const episode = {
  id: 'listen-and-learn:azure_az-104/a',
  source: 'listen-and-learn',
  sourceLabel: 'Listen & Learn · AZ-104',
  title: 'Identities and governance',
  description: 'Short',
  longDescription: 'Azure Administrator — Manage identities',
  mediaUrl: 'https://fn.example/api/public/media/listenandlearn/azure/az-104/a.mp3',
  durationSeconds: 540,
  image: null,
  link: '/azure/education/az-104',
  publishedAtISO: '2026-09-03T00:00:00.000Z',
  publishedAtString: '9/3/2026',
};

describe('EpisodePlayer', () => {
  it('labels the source and links a Listen & Learn episode to its certification', () => {
    render(<EpisodePlayer episode={episode} meta={meta} />);
    expect(screen.getByText('Listen & Learn · AZ-104')).toBeInTheDocument();
    const cert = screen.getByRole('link', { name: /Certification/ });
    expect(cert).toHaveAttribute('href', '/azure/education/az-104');
    // Same-site: no new tab.
    expect(cert).not.toHaveAttribute('target');
  });

  it('opens a host episode page in a new tab', () => {
    render(
      <EpisodePlayer
        episode={{
          ...episode,
          source: 'host',
          sourceLabel: 'Podcast feed',
          link: 'https://host.example/ep',
        }}
        meta={meta}
      />
    );
    const open = screen.getByRole('link', { name: /Open/ });
    expect(open).toHaveAttribute('href', 'https://host.example/ep');
    expect(open).toHaveAttribute('target', '_blank');
  });

  it('seeks by moving the audio element, through a keyboard-operable slider', () => {
    const { container } = render(<EpisodePlayer episode={episode} meta={meta} />);
    const slider = screen.getByRole('slider', { name: 'Seek' });
    const audio = container.querySelector('audio');

    // Metadata has not arrived; the known duration from the document sizes
    // the slider so a seek is possible before the first byte plays.
    expect(slider).toHaveAttribute('max', '540');
    expect(slider).not.toBeDisabled();

    fireEvent.change(slider, { target: { value: '120' } });
    expect(audio.currentTime).toBe(120);
    expect(screen.getByText('2:00')).toBeInTheDocument();
  });

  it('never lets the progress bar exceed the track when playback outruns the known duration', () => {
    // durationSeconds on the document can be shorter than the real file.
    const { container } = render(<EpisodePlayer episode={episode} meta={meta} />);
    const audio = container.querySelector('audio');
    audio.currentTime = 9999;
    fireEvent.timeUpdate(audio);

    expect(screen.getByTestId('episode-progress').style.width).toBe('100%');
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveValue('540');
  });

  it('renders a feed description as text, never as markup', () => {
    // Host feeds wrap descriptions in <p> and sometimes worse.
    const { container } = render(
      <EpisodePlayer
        episode={{
          ...episode,
          longDescription: '<p>Wrapped <b>bold</b></p><scr<script>ipt>alert(1)</script>',
        }}
        meta={meta}
      />
    );
    const text = screen.getByText(/Wrapped bold/);
    expect(text.textContent).not.toContain('<');
    expect(text.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('shows keyboard focus on the track even though the input itself is transparent', () => {
    render(<EpisodePlayer episode={episode} meta={meta} />);
    const slider = screen.getByRole('slider', { name: 'Seek' });
    slider.focus();
    expect(document.activeElement).toBe(slider);
    const track = screen.getByTestId('episode-track');
    expect(track).toContainElement(slider);
    expect(track.className).toMatch(/focus-within:ring-2/);
  });

  it('renders the placeholder, not an <img>, for an unsafe image URL', () => {
    // The decision is made on the sanitised value: a javascript: URL must not
    // become an <img> with no src.
    const { container } = render(
      <EpisodePlayer episode={{ ...episode, image: 'javascript:alert(1)' }} meta={meta} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('article .material-symbols-outlined')).toHaveTextContent(
      'podcasts'
    );
  });

  it('asks for metadata only until play is pressed', () => {
    const { container } = render(<EpisodePlayer episode={episode} meta={meta} />);
    expect(container.querySelector('audio')).toHaveAttribute('preload', 'metadata');
  });

  it('reports play state to the page and survives a play() that returns nothing', () => {
    const onPlayingChange = vi.fn();
    render(<EpisodePlayer episode={episode} meta={meta} onPlayingChange={onPlayingChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('renders no <audio>, disables Play and withholds Download for an unsafe media URL', () => {
    // An enclosure URL is third-party text; the decision is made once, on
    // the sanitised value, and every control follows it.
    const { container } = render(
      <EpisodePlayer episode={{ ...episode, mediaUrl: 'javascript:alert(1)' }} meta={meta} />
    );
    expect(container.querySelector('audio')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /Download/ })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('Media URL not playable');
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('keeps a valid https media URL on the element and the Download link', () => {
    const { container } = render(<EpisodePlayer episode={episode} meta={meta} />);
    expect(container.querySelector('audio')).toHaveAttribute('src', episode.mediaUrl);
    expect(screen.getByRole('link', { name: /Download/ })).toHaveAttribute(
      'href',
      episode.mediaUrl
    );
    expect(screen.getByRole('button', { name: 'Play' })).not.toBeDisabled();
    expect(screen.queryByRole('note')).toBeNull();
  });

  describe('the episode link comes from feed data and is decided on the sanitised value', () => {
    const noLinkRendered = () =>
      screen.queryByRole('link', { name: /Certification|Open/ }) === null;

    it('renders without a link, and without throwing, when link is null', () => {
      expect(() =>
        render(<EpisodePlayer episode={{ ...episode, link: null }} meta={meta} />)
      ).not.toThrow();
      expect(noLinkRendered()).toBe(true);
    });

    it('renders without a link when link is not a string at all', () => {
      expect(() =>
        render(<EpisodePlayer episode={{ ...episode, link: { href: '/x' } }} meta={meta} />)
      ).not.toThrow();
      expect(noLinkRendered()).toBe(true);
    });

    it('renders no link for a javascript: value', () => {
      const { container } = render(
        <EpisodePlayer episode={{ ...episode, link: 'javascript:alert(1)' }} meta={meta} />
      );
      expect(noLinkRendered()).toBe(true);
      expect(container.innerHTML).not.toContain('javascript:');
    });

    it('keeps an internal path as a same-tab Certification link', () => {
      render(<EpisodePlayer episode={{ ...episode, link: '/azure/podcast/x' }} meta={meta} />);
      const cert = screen.getByRole('link', { name: /Certification/ });
      expect(cert).toHaveAttribute('href', '/azure/podcast/x');
      expect(cert).not.toHaveAttribute('target');
    });

    it('keeps an https link as a new-tab Open link', () => {
      render(
        <EpisodePlayer episode={{ ...episode, link: 'https://host.example/ep' }} meta={meta} />
      );
      const open = screen.getByRole('link', { name: /Open/ });
      expect(open).toHaveAttribute('href', 'https://host.example/ep');
      expect(open).toHaveAttribute('target', '_blank');
      expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  it('disables play and seek when there is nothing to play', () => {
    render(<EpisodePlayer episode={{ ...episode, mediaUrl: null }} meta={meta} />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /Download/ })).toBeNull();
  });
});
