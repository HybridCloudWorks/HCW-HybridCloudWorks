/**
 * The source-grounding form and the review-side source list (#433).
 *
 * What carries the weight: a line is classified as it is typed and a bad one
 * blocks the button, so the owner never learns of a refused URL from a
 * failed job; the payload sent is exactly the classified list; and a source
 * episode's card shows what it was built from, with links.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const generateSourceEpisode = vi.fn();
vi.mock('@/lib/sourceEpisode', () => ({
  generateSourceEpisode: (...args) => generateSourceEpisode(...args),
}));

const { SourceGroundingPanel, EpisodeSources } = await import('./SourceGroundingPanel');

const type = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const button = () => screen.getByRole('button', { name: /Generate from sources/ });

describe('SourceGroundingPanel', () => {
  beforeEach(() => {
    generateSourceEpisode.mockReset();
  });

  it('classifies each line as typed and stays disabled until the list is clean', () => {
    render(<SourceGroundingPanel platform="azure" examCode="AZ-104" />);

    expect(button()).toBeDisabled();
    type('Episode title', 'Entra ID basics');
    expect(button()).toBeDisabled();

    type(
      'Sources, one URL per line',
      'https://example.com/entra\nhttps://www.youtube.com/watch?v=abc123\nhttps://www.youtube.com/playlist?list=PL1'
    );
    expect(screen.getByText('page')).toBeInTheDocument();
    expect(screen.getByText('video')).toBeInTheDocument();
    expect(screen.getByText(/is a YouTube page that is not a video/)).toBeInTheDocument();
    expect(screen.getByText('1 page, 1 video, 1 refused')).toBeInTheDocument();
    // A refused line blocks the run: the server would refuse it too, and the
    // form says so before spending anything.
    expect(button()).toBeDisabled();

    type('Sources, one URL per line', 'https://example.com/entra\nhttps://youtu.be/abc123');
    expect(screen.getByText('1 page, 1 video')).toBeInTheDocument();
    expect(button()).toBeEnabled();
  });

  it('needs an exam code, which comes from the page form', () => {
    render(<SourceGroundingPanel platform="azure" examCode="" />);
    type('Episode title', 'T');
    type('Sources, one URL per line', 'https://example.com/a');
    expect(button()).toBeDisabled();
    expect(screen.getByText(/the exam code above/)).toBeInTheDocument();
  });

  it('posts the classified list and reports the result, then asks the page to reload', async () => {
    generateSourceEpisode.mockResolvedValue({
      status: 'succeeded',
      result: { sourceCount: 2, audioError: null, costUsd: 0.0312 },
    });
    const onDone = vi.fn(async () => {});
    render(
      <SourceGroundingPanel
        platform="azure"
        examCode=" AZ-104 "
        certTitle="Azure Administrator"
        onDone={onDone}
      />
    );
    type('Episode title', ' Entra ID basics ');
    type('Sources, one URL per line', 'https://example.com/entra\nhttps://youtu.be/abc123');
    fireEvent.click(button());

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(generateSourceEpisode).toHaveBeenCalledTimes(1);
    const [[call]] = generateSourceEpisode.mock.calls;
    expect(call).toMatchObject({
      platform: 'azure',
      examCode: 'AZ-104',
      certTitle: 'Azure Administrator',
      title: 'Entra ID basics',
      sources: [
        { kind: 'page', url: 'https://example.com/entra' },
        { kind: 'video', url: 'https://youtu.be/abc123' },
      ],
    });
    expect(typeof call.onUpdate).toBe('function');
    expect(screen.getByText('Drafted from 2 sources · $0.03')).toBeInTheDocument();
  });

  it('shows the route sentence when the list is refused, and does not reload', async () => {
    generateSourceEpisode.mockRejectedValue(
      new Error("Source 1 (https://example.com/a) is a YouTube URL given as kind 'page'")
    );
    const onDone = vi.fn();
    render(<SourceGroundingPanel platform="azure" examCode="AZ-104" onDone={onDone} />);
    type('Episode title', 'T');
    type('Sources, one URL per line', 'https://example.com/a');
    fireEvent.click(button());

    expect(await screen.findByText(/is a YouTube URL given as kind 'page'/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(button()).toBeEnabled();
  });

  it('shows the job error when the run fails after being queued — Gemini refused, a source unread', async () => {
    generateSourceEpisode.mockResolvedValue({
      status: 'failed',
      error: 'Source grounding needs Gemini; it is disabled in the admin portal.',
    });
    const onDone = vi.fn();
    render(<SourceGroundingPanel platform="azure" examCode="AZ-104" onDone={onDone} />);
    type('Episode title', 'T');
    type('Sources, one URL per line', 'https://youtu.be/abc123');
    fireEvent.click(button());

    expect(await screen.findByText(/Source grounding needs Gemini/)).toBeInTheDocument();
    // The set is reloaded anyway: a failure marker may have been written.
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('EpisodeSources', () => {
  it('renders nothing for a guide episode', () => {
    const { container } = render(<EpisodeSources episode={{ kind: 'guide', sources: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a source episode’s sources with links, titled where a title was given', () => {
    render(
      <EpisodeSources
        episode={{
          kind: 'source',
          sources: [
            { kind: 'page', url: 'https://example.com/entra', title: 'Entra overview' },
            { kind: 'video', url: 'https://youtu.be/abc123' },
          ],
        }}
      />
    );
    expect(screen.getByText('Source-grounded')).toBeInTheDocument();
    expect(screen.getByText('Built from 2 sources')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/entra',
      'https://youtu.be/abc123',
    ]);
    expect(links[0]).toHaveTextContent('Entra overview');
    expect(links[1]).toHaveTextContent('https://youtu.be/abc123');
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('tolerates a source episode with no list', () => {
    render(<EpisodeSources episode={{ kind: 'source' }} />);
    expect(screen.getByText('Built from 0 sources')).toBeInTheDocument();
  });
});
