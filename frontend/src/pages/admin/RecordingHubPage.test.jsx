import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecordingHubPage from './RecordingHubPage';
import { SCRIPT_QUEUED_TOAST } from '@/components/admin/recording-hub/PlaudTab';

const postJSON = vi.fn();
const getJSON = vi.fn();
const sendJSON = vi.fn();
const mcpTool = vi.fn();
const toast = vi.fn();

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: (...args) => toast(...args) }),
}));

vi.mock('@/hooks/useAuthReady', () => ({
  useAuthReady: () => ({ authReady: true }),
}));

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
}));

vi.mock('@/lib/aiEngine', () => ({
  aiEngine: {
    mcpTool: (...args) => mcpTool(...args),
    syncMcpTools: vi.fn(async () => ({ ok: true, tools: [] })),
    testProvider: vi.fn(async () => ({})),
  },
  setMcpOAuthToken: vi.fn(),
}));

const transcripts = [
  {
    id: 'article_picking-a-state-backend',
    sourceKind: 'article',
    sourceId: 'content-1',
    sourceSlug: 'picking-a-state-backend',
    sourceTitle: 'Picking a state backend',
    sourceProvider: 'azure',
    title: 'State backends, spoken',
    status: 'draft',
    truncated: true,
    audioUrl: '/api/public/media/podcast/article/picking-a-state-backend.mp3',
    audioError: null,
    generatedAt: '2026-09-08T12:00:00.000Z',
    host: null,
  },
  {
    id: 'plaud_rec-1',
    sourceKind: 'plaud',
    sourceId: 'rec-1',
    sourceTitle: 'Landing zone review',
    title: 'Landing zones, retold',
    status: 'published',
    truncated: false,
    audioUrl: null,
    audioError: 'No speech provider is configured',
    generatedAt: '2026-09-08T13:00:00.000Z',
    host: { rsscom: { episodeId: null, error: { status: 502, message: 'host said no' } } },
  },
];

const detail = {
  ...transcripts[1],
  summary: 'What the session decided.',
  transcript: [
    { speaker: 'Maya', text: 'Welcome back.' },
    { speaker: 'Elena', text: 'Speaker 2 said the hub owns DNS.' },
  ],
  attributionLeaks: ['Speaker 2'],
  source: {
    kind: 'plaud',
    recordingId: 'rec-1',
    durationMs: 120000,
    segmentCount: 40,
    segmentsIncluded: 40,
  },
};

/** The routes the page reads on mount and on demand. */
function routeGets({ items = transcripts, connected = true, stored = [] } = {}) {
  getJSON.mockImplementation(async (route) => {
    if (route === 'cms/podcast/transcripts') return { success: true, items, total: items.length };
    if (route.startsWith('cms/podcast/transcripts/')) return { success: true, item: detail };
    if (route === 'public/podcasts?provider=main') {
      return {
        items: [{ id: 'ep-1', title: 'Episode one', publishedAt: '2026-09-01T00:00:00.000Z' }],
        mainFeedUrl: 'https://media.rss.com/hcw/feed.xml',
      };
    }
    if (route === 'cms/config/mcp-servers') {
      return {
        items: [
          { id: 'plaud', status: connected ? 'connected' : 'untested', hasOauthToken: connected },
        ],
      };
    }
    if (route.startsWith('cms/recordings')) return { success: true, items: stored };
    throw new Error(`unexpected GET ${route}`);
  });
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <RecordingHubPage />
    </MemoryRouter>
  );

const openPlaudTab = () => fireEvent.click(screen.getByRole('tab', { name: 'Plaud' }));

beforeEach(() => {
  vi.clearAllMocks();
  routeGets();
  mcpTool.mockResolvedValue({
    ok: true,
    result: JSON.stringify([
      {
        id: 'rec-1',
        name: 'Landing zone review',
        start_at: '2026-08-06T09:35:00.000Z',
        duration: 93010,
      },
    ]),
  });
  postJSON.mockResolvedValue({ ok: true, jobId: 'job-1' });
});

describe('Podcast tab', () => {
  it('lists transcripts with their source chip, status, badges and player, then the episodes', async () => {
    renderPage();

    expect(await screen.findByText('State backends, spoken')).toBeInTheDocument();
    // Article chip links to the editor and to the public page.
    expect(screen.getByRole('link', { name: 'Picking a state backend' })).toHaveAttribute(
      'href',
      '/admin/editor?id=content-1'
    );
    expect(
      screen.getByRole('link', { name: 'Open Picking a state backend on the site' })
    ).toHaveAttribute('href', '/azure/blog/picking-a-state-backend');
    expect(screen.getByText('truncated')).toBeInTheDocument();
    expect(screen.getByLabelText('Audio: State backends, spoken')).toHaveAttribute(
      'src',
      '/api/public/media/podcast/article/picking-a-state-backend.mp3'
    );

    // Recording chip carries the recording title; the audio failure is a badge.
    expect(screen.getByText('plaud')).toBeInTheDocument();
    expect(screen.getByText('Landing zone review')).toBeInTheDocument();
    expect(screen.getByText('audio failed')).toBeInTheDocument();
    expect(screen.getByText('published')).toBeInTheDocument();

    // The show's episodes, read-only.
    expect(await screen.findByText('Episode one')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /RSS feed/ })).toHaveAttribute(
      'href',
      'https://media.rss.com/hcw/feed.xml'
    );
  });

  it('approves a draft through the review route and reloads', async () => {
    renderPage();
    await screen.findByText('State backends, spoken');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('cms/podcast/transcripts/review', {
        id: 'article_picking-a-state-backend',
        status: 'published',
      })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Transcript approved' }))
    );
    // Reloaded after the review.
    expect(getJSON.mock.calls.filter(([r]) => r === 'cms/podcast/transcripts')).toHaveLength(2);
  });

  it('returns a published transcript to draft and shows the API refusal verbatim', async () => {
    postJSON.mockRejectedValueOnce(new Error('Forbidden'));
    renderPage();
    await screen.findByText('Landing zones, retold');
    fireEvent.click(screen.getByRole('button', { name: 'Return to draft' }));
    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('cms/podcast/transcripts/review', {
        id: 'plaud_rec-1',
        status: 'draft',
      })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Review not saved', description: 'Forbidden' })
      )
    );
  });

  it('shows the host error with a Retry that treats a 404 as "not deployed yet"', async () => {
    postJSON.mockRejectedValueOnce(
      new Error(
        'cms/podcast/transcripts/plaud_rec-1/publish failed with HTTP 404. Try again or check the logs.'
      )
    );
    renderPage();
    expect(await screen.findByText('Host: host said no')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('cms/podcast/transcripts/plaud_rec-1/publish', {})
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Host retry is not available yet' })
      )
    );
    // A plain toast, not a destructive one.
    expect(toast.mock.calls.at(-1)[0].variant).toBeUndefined();
  });

  it('opens the review view with the source beside the transcript and the attribution warning', async () => {
    renderPage();
    await screen.findByText('Landing zones, retold');
    fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[1]);

    expect(await screen.findByText('Welcome back.')).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith('cms/podcast/transcripts/plaud_rec-1');
    expect(screen.getByText('rec-1')).toBeInTheDocument();
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent('repeats 1 speaker label');
    expect(within(warning).getByText('Speaker 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to transcripts' }));
    expect(await screen.findByText('State backends, spoken')).toBeInTheDocument();
  });
});

describe('Plaud tab', () => {
  it('lists the library through the MCP proxy and queues a script for one recording', async () => {
    renderPage();
    await screen.findByText('State backends, spoken');
    openPlaudTab();

    expect(await screen.findByText('Landing zone review')).toBeInTheDocument();
    expect(mcpTool).toHaveBeenCalledWith('plaud', 'list_files', { page: 1, page_size: 20 });

    fireEvent.click(screen.getByRole('button', { name: 'Script this: Landing zone review' }));
    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('cms/podcast/transcripts/generate-from-recording', {
        recordingId: 'rec-1',
      })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Podcast script queued',
          description: SCRIPT_QUEUED_TOAST,
        })
      )
    );
  });

  it('lists stored recordings under the library with their own Script this', async () => {
    routeGets({
      stored: [
        {
          id: 'u1',
          title: 'Uploaded stand-up',
          source: 'plaud-embedded',
          status: 'new',
          durationMs: 120000,
        },
      ],
    });
    renderPage();
    await screen.findByText('State backends, spoken');
    openPlaudTab();

    expect(await screen.findByText('Uploaded stand-up')).toBeInTheDocument();
    expect(screen.getByText('Plaud Embedded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Script this: Uploaded stand-up' }));
    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('cms/podcast/transcripts/generate-from-recording', {
        storedRecordingId: 'u1',
      })
    );
  });

  it('shows the door refusal verbatim when scripting is not queued', async () => {
    postJSON.mockRejectedValueOnce(
      new Error('Plaud is not connected, or its authorization was revoked')
    );
    renderPage();
    await screen.findByText('State backends, spoken');
    openPlaudTab();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Script this: Landing zone review' })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Not queued',
          description: 'Plaud is not connected, or its authorization was revoked',
          variant: 'destructive',
        })
      )
    );
  });

  it('asks for the Connect tab when Plaud is not connected, and still lists stored recordings', async () => {
    routeGets({
      connected: false,
      stored: [{ id: 'p1', title: 'Pasted notes', source: 'manual_upload' }],
    });
    renderPage();
    await screen.findByText('State backends, spoken');
    openPlaudTab();
    expect(await screen.findByText('Connect your Plaud account first.')).toBeInTheDocument();
    expect(await screen.findByText('Pasted notes')).toBeInTheDocument();
    expect(mcpTool).not.toHaveBeenCalled();
  });

  it('uploads audio as base64 and shows the queued state', async () => {
    postJSON.mockResolvedValueOnce({ ok: true, jobId: 'job-9', uploadPath: 'uploads/u.mp3' });
    renderPage();
    await screen.findByText('State backends, spoken');
    openPlaudTab();
    fireEvent.click(screen.getByRole('tab', { name: 'Upload' }));

    const file = new File(['abc'], 'standup.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByLabelText('Audio file'), { target: { files: [file] } });
    // The title defaults to the file name, minus the extension.
    expect(screen.getByLabelText('Title')).toHaveValue('standup');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Stand-up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload & transcribe' }));

    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('cms/podcast/recordings/upload', {
        title: 'Stand-up',
        fileName: 'standup.mp3',
        contentType: 'audio/mpeg',
        dataBase64: Buffer.from('abc').toString('base64'),
      })
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Queued: Stand-up (standup.mp3) — job job-9'
    );
  });

  it('keeps the manual transcript paste as a sub-section of Upload', async () => {
    renderPage();
    await screen.findByText('State backends, spoken');
    openPlaudTab();
    fireEvent.click(screen.getByRole('tab', { name: 'Upload' }));
    expect(screen.getByText('Paste a transcript')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Recording' })).toBeInTheDocument();
  });
});
