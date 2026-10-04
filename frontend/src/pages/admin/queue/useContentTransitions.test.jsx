/**
 * The shared transitions hook (ADR 0033 §2): canonical statuses, per-item
 * state, no client-side duplicate of the server's audit row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/api', () => ({ postJSON: vi.fn() }));
vi.mock('@/lib/auditLog', () => ({ logAdminAction: vi.fn(async () => {}) }));
vi.mock('@/lib/contentWorkflow', () => ({ unpublishToInspected: vi.fn(async () => ({})) }));

const { postJSON } = await import('@/lib/api');
const { logAdminAction } = await import('@/lib/auditLog');
const { unpublishToInspected } = await import('@/lib/contentWorkflow');
const { useContentTransitions } = await import('./useContentTransitions.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('approve', () => {
  it('sends the canonical `approved` with the item’s publish target, never approved_blog', async () => {
    postJSON.mockResolvedValue({ success: true, from: 'inspected', to: 'approved' });
    const onTransitioned = vi.fn();
    const { result } = renderHook(() => useContentTransitions({ onTransitioned }));

    let answer;
    await act(async () => {
      answer = await result.current.approve({ id: 'a', type: 'framework' });
    });

    expect(postJSON).toHaveBeenCalledWith('transitionContentStatus', {
      contentId: 'a',
      newStatus: 'approved',
      reviewNotes: 'Approved for the publish stage',
      publishTarget: 'framework',
      markLive: false,
    });
    expect(answer).toMatchObject({ to: 'approved' });
    expect(onTransitioned).toHaveBeenCalledWith('a', expect.objectContaining({ to: 'approved' }));
    expect(result.current.loading.a).toBeNull();
    expect(result.current.errors.a).toBeNull();
  });

  it('writes no client audit row: the server already records the transition', async () => {
    postJSON.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useContentTransitions());
    await act(() => result.current.approve('a'));
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it('puts a failure under the item and resolves null, so a caller can branch', async () => {
    postJSON.mockRejectedValue(new Error('Invalid transition: rejected → approved'));
    const onTransitioned = vi.fn();
    const { result } = renderHook(() => useContentTransitions({ onTransitioned }));

    let answer;
    await act(async () => {
      answer = await result.current.approve('a');
    });

    expect(answer).toBeNull();
    expect(result.current.errors.a).toBe('Approve failed: Invalid transition: rejected → approved');
    expect(onTransitioned).not.toHaveBeenCalled();
  });
});

describe('reject, restore, recall', () => {
  it('reject sends rejected with markLive false and the given notes', async () => {
    postJSON.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useContentTransitions());
    await act(() => result.current.reject('b', { reviewNotes: 'Bulk rejected from queue' }));
    expect(postJSON).toHaveBeenCalledWith('transitionContentStatus', {
      contentId: 'b',
      newStatus: 'rejected',
      reviewNotes: 'Bulk rejected from queue',
      markLive: false,
    });
  });

  it('restore sends inspected without a publish target — the server clears rejectedAt itself', async () => {
    postJSON.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useContentTransitions());
    await act(() => result.current.restore({ id: 'c', type: 'blog' }));
    expect(postJSON).toHaveBeenCalledWith('transitionContentStatus', {
      contentId: 'c',
      newStatus: 'inspected',
      reviewNotes: 'Restored from rejected',
    });
    // One request: the second updateContentItem the old copies made is gone.
    expect(postJSON).toHaveBeenCalledTimes(1);
  });

  it('recall goes through the publisher-only unpublish route', async () => {
    const { result } = renderHook(() => useContentTransitions());
    await act(() => result.current.recall('d', { currentStatus: 'published' }));
    expect(unpublishToInspected).toHaveBeenCalledWith(
      'd',
      'published',
      'Returned to the review queue'
    );
    expect(postJSON).not.toHaveBeenCalled();
  });

  it('tracks the verb in flight per item, so one card spinning leaves its neighbours alone', async () => {
    let release;
    postJSON.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { result } = renderHook(() => useContentTransitions());

    let pending;
    act(() => {
      pending = result.current.reject('e');
    });
    expect(result.current.loading.e).toBe('rejecting');
    expect(result.current.loading.f).toBeUndefined();

    await act(async () => {
      release({ success: true });
      await pending;
    });
    expect(result.current.loading.e).toBeNull();
  });
});
