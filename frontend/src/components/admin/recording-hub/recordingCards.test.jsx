/**
 * The route-to-pipeline modal (ADR 0033 §1 Amplify). What must hold: after
 * the draft is created the recording is PATCHed to `routed` with the content
 * id — the call that threw `sendJSON is not defined` until 2026-10-03, so the
 * recording was never marked routed — no provider is hard-coded into the
 * request, and a refused create reports rather than patches.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { RouteModal } from './recordingCards';

const postJSON = vi.fn();
const sendJSON = vi.fn();
const toast = vi.fn();
vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
}));
vi.mock('@/lib/aiEngine', () => ({ aiEngine: { mcpTool: vi.fn() } }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const recording = {
  id: 'rec-1',
  title: 'Landing zone review',
  transcript: 'We talked about hubs.',
};

beforeEach(() => {
  postJSON.mockReset();
  sendJSON.mockReset();
  toast.mockReset();
});

describe('RouteModal', () => {
  it('creates the draft without naming a provider, marks the recording routed, and hands back the content id', async () => {
    postJSON.mockResolvedValue({ contentId: 'content-9' });
    sendJSON.mockResolvedValue({ success: true });
    const onRouted = vi.fn();
    render(<RouteModal recording={recording} onClose={vi.fn()} onRouted={onRouted} />);

    fireEvent.click(screen.getByRole('button', { name: /Create Draft/ }));

    await waitFor(() => expect(onRouted).toHaveBeenCalledWith('content-9'));
    expect(postJSON).toHaveBeenCalledWith('createContentFromRecording', {
      recordingId: 'rec-1',
      transcript: 'We talked about hubs.',
      title: 'Landing zone review',
      contentType: 'blog_post',
    });
    expect(postJSON.mock.calls[0][1]).not.toHaveProperty('provider');
    expect(sendJSON).toHaveBeenCalledWith('cms/recordings/rec-1', 'PATCH', {
      status: 'routed',
      contentId: 'content-9',
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/Sent to pipeline/) })
    );
  });

  it('reports a create that returned no content id and patches nothing', async () => {
    postJSON.mockResolvedValue({ error: 'The drafter refused' });
    const onRouted = vi.fn();
    render(<RouteModal recording={recording} onClose={vi.fn()} onRouted={onRouted} />);

    fireEvent.click(screen.getByRole('button', { name: /Create Draft/ }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive', description: 'The drafter refused' })
      )
    );
    expect(sendJSON).not.toHaveBeenCalled();
    expect(onRouted).not.toHaveBeenCalled();
  });
});
