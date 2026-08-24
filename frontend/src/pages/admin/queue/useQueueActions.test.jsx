/**
 * The review queue's mutating actions.
 *
 * These are the tests the decomposition (TODO.md T-412) existed to make
 * possible: before it, every one of these paths could only be reached by
 * rendering four hundred lines of card markup.
 *
 * The partial-failure behaviour is the point. A bulk run over forty documents
 * transitions them one at a time, and each failure has to be attributed back to
 * its own card — so a run that half-works must remove exactly the documents
 * that moved, leave exactly the ones that did not, and put a reason under each.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/api', () => ({ postJSON: vi.fn() }));
vi.mock('@/lib/auditLog', () => ({ logAdminAction: vi.fn(async () => {}) }));
vi.mock('@/lib/contentWorkflow', () => ({ requestContentInspection: vi.fn(async () => {}) }));
vi.mock('@/lib/contentModel', () => ({ getPublishTargetForItem: vi.fn(() => 'blog') }));

const { postJSON } = await import('@/lib/api');
const { logAdminAction } = await import('@/lib/auditLog');
const { requestContentInspection } = await import('@/lib/contentWorkflow');
const { useQueueActions } = await import('./useQueueActions.js');

const ITEMS = [
  { id: 'a', Title: 'Alpha' },
  { id: 'b', Title: 'Bravo' },
  { id: 'c', Title: 'Charlie' },
];

/**
 * Drives the hook with a real `items` array that `setItems` updates, so the
 * optimistic removals are observable exactly as the page sees them.
 */
function setup({ items = ITEMS, statusFilter = 'needs_review' } = {}) {
  const state = { items: [...items] };
  const setItems = vi.fn((next) => {
    state.items = typeof next === 'function' ? next(state.items) : next;
  });

  const view = renderHook(
    ({ filter }) =>
      useQueueActions({
        items: state.items,
        setItems,
        statusFilter: filter,
        contentTypeFilter: 'all',
      }),
    { initialProps: { filter: statusFilter } }
  );

  return { ...view, state, setItems };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Silence the deliberate console.error in each failure path.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('selection', () => {
  it('toggles an id on and off', () => {
    const { result } = setup();

    act(() => result.current.toggleSelected('a'));
    expect([...result.current.selectedIds]).toEqual(['a']);

    act(() => result.current.toggleSelected('a'));
    expect([...result.current.selectedIds]).toEqual([]);
  });

  it('clears the selection when the filter changes', async () => {
    // A selection made against one filter would otherwise bulk-act on items
    // the admin can no longer see.
    const { result, rerender } = setup();
    act(() => result.current.toggleSelected('a'));
    expect(result.current.selectedIds.size).toBe(1);

    rerender({ filter: 'rejected' });
    await waitFor(() => expect(result.current.selectedIds.size).toBe(0));
  });
});

describe('bulk reject', () => {
  const selectAll = (result, ids) =>
    act(() => {
      ids.forEach((id) => result.current.toggleSelected(id));
    });

  it('needs two selected items before it will open the confirmation', () => {
    const { result } = setup();
    selectAll(result, ['a']);
    act(() => result.current.handleBulkReject());
    expect(result.current.confirmTarget).toBeNull();

    selectAll(result, ['b']);
    act(() => result.current.handleBulkReject());
    expect(result.current.confirmTarget).toEqual({ type: 'bulkReject', ids: ['a', 'b'] });
  });

  it('ignores selected ids that are no longer on screen', () => {
    const { result } = setup();
    selectAll(result, ['a', 'b', 'zzz']);
    act(() => result.current.handleBulkReject());
    expect(result.current.confirmTarget.ids).toEqual(['a', 'b']);
  });

  it('removes every rejected item and reports the count', async () => {
    postJSON.mockResolvedValue({ success: true });
    const { result, state } = setup();
    selectAll(result, ['a', 'b']);
    act(() => result.current.handleBulkReject());
    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(state.items.map((i) => i.id)).toEqual(['c']);
    expect(result.current.bulkDeleteMessage).toBe('Rejected 2 items.');
    expect(result.current.selectedIds.size).toBe(0);
    expect(logAdminAction).toHaveBeenCalledWith('content_rejected', { contentId: 'a', bulk: true });
  });

  it('does not stop at the first failure, and keeps only what failed', async () => {
    // The run must continue: the spend and the work on the items that already
    // transitioned is real, and a half-applied bulk that silently aborts is
    // indistinguishable from one that worked.
    // postJSON(name, body) — the payload is the SECOND argument.
    postJSON.mockImplementation(async (_name, { contentId }) => {
      if (contentId === 'b') throw new Error('conflict');
      return { success: true };
    });

    const { result, state } = setup();
    selectAll(result, ['a', 'b', 'c']);
    act(() => result.current.handleBulkReject());
    await act(async () => {
      await result.current.handleConfirm();
    });

    // a and c transitioned and are gone; b failed and is still on screen.
    expect(state.items.map((i) => i.id)).toEqual(['b']);
    expect(postJSON).toHaveBeenCalledTimes(3);
  });

  it('attributes each failure to its own card', async () => {
    // postJSON(name, body) — the payload is the SECOND argument.
    postJSON.mockImplementation(async (_name, { contentId }) => {
      if (contentId === 'b') throw new Error('conflict');
      return { success: true };
    });

    const { result } = setup();
    selectAll(result, ['a', 'b', 'c']);
    act(() => result.current.handleBulkReject());
    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(result.current.actionError.b).toBe('Reject failed: conflict');
    expect(result.current.actionError.a).toBeUndefined();
    expect(result.current.bulkDeleteMessage).toMatch(/Rejected 2 items\./);
    expect(result.current.bulkDeleteMessage).toMatch(/1 failed/);
  });

  it('says "item" for one and "items" for many', async () => {
    postJSON.mockImplementation(async (_name, { contentId }) =>
      contentId === 'a' ? { success: true } : Promise.reject(new Error('no'))
    );
    const { result } = setup();
    selectAll(result, ['a', 'b']);
    act(() => result.current.handleBulkReject());
    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(result.current.bulkDeleteMessage).toMatch(/^Rejected 1 item\./);
  });

  it('clears the in-flight flag even when every call fails', async () => {
    postJSON.mockRejectedValue(new Error('down'));
    const { result } = setup();
    selectAll(result, ['a', 'b']);
    act(() => result.current.handleBulkReject());
    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(result.current.bulkRejecting).toBe(false);
  });
});

describe('bulk soft-delete of rejected items', () => {
  it('refuses unless the rejected filter is showing', () => {
    // The call deletes by status, not by selection, so running it from another
    // filter would delete items the admin is not looking at.
    const { result } = setup({ statusFilter: 'needs_review' });
    act(() => result.current.handleDeleteRejectedNow());

    expect(result.current.confirmTarget).toBeNull();
    expect(result.current.bulkDeleteError).toMatch(/Switch the filter to Rejected/);
  });

  it('opens the confirmation on the rejected filter', () => {
    const { result } = setup({ statusFilter: 'rejected' });
    act(() => result.current.handleDeleteRejectedNow());
    expect(result.current.confirmTarget).toEqual({ type: 'bulkDelete' });
  });

  it('pages until the server says there is no more', async () => {
    postJSON
      .mockResolvedValueOnce({ deletedCount: 100, hasMore: true })
      .mockResolvedValueOnce({ deletedCount: 40, hasMore: false });

    const { result, state } = setup({ statusFilter: 'rejected' });
    act(() => result.current.handleDeleteRejectedNow());
    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(postJSON).toHaveBeenCalledTimes(2);
    expect(result.current.bulkDeleteMessage).toMatch(/Soft-deleted 140 rejected items/);
    expect(state.items).toEqual([]);
  });

  it('stops paging when a page deletes nothing, rather than looping forever', async () => {
    // hasMore true with a zero count is the shape that would spin.
    postJSON.mockResolvedValue({ deletedCount: 0, hasMore: true });

    const { result } = setup({ statusFilter: 'rejected' });
    act(() => result.current.handleDeleteRejectedNow());
    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(postJSON).toHaveBeenCalledTimes(1);
  });

  it('reports a failure without leaving the flag set', async () => {
    postJSON.mockRejectedValue(new Error('timeout'));
    const { result } = setup({ statusFilter: 'rejected' });
    act(() => result.current.handleDeleteRejectedNow());
    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(result.current.bulkDeleteError).toBe('Delete rejected failed: timeout');
    expect(result.current.bulkDeletingRejected).toBe(false);
  });
});

describe('single-item actions', () => {
  it('approves an item into the publish stage and drops it from the queue', async () => {
    postJSON.mockResolvedValue({ success: true });
    const { result, state } = setup();

    await act(async () => {
      await result.current.handleApprove({ id: 'a' });
    });

    expect(postJSON).toHaveBeenCalledWith(
      'transitionContentStatus',
      expect.objectContaining({ contentId: 'a', newStatus: 'approved_blog', markLive: false })
    );
    expect(state.items.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('leaves a failed approve on screen with a reason and no spinner', async () => {
    postJSON.mockRejectedValue(new Error('nope'));
    const { result, state } = setup();

    await act(async () => {
      await result.current.handleApprove({ id: 'a' });
    });

    expect(state.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.actionError.a).toBeTruthy();
    expect(result.current.actionLoading.a).toBeNull();
  });

  it('routes a single reject through the confirmation rather than acting on click', async () => {
    // Every destructive path goes through the confirm-target state machine.
    postJSON.mockResolvedValue({ success: true });
    const { result, state } = setup();

    act(() => result.current.handleReject('a'));
    expect(result.current.confirmTarget).toEqual({ type: 'reject', id: 'a' });
    expect(postJSON).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleConfirm();
    });
    expect(state.items.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('closes the modal before running, so a second click cannot double-fire', async () => {
    postJSON.mockResolvedValue({ success: true });
    const { result } = setup();
    act(() => result.current.handleReject('a'));

    await act(async () => {
      await result.current.handleConfirm();
    });
    expect(result.current.confirmTarget).toBeNull();

    // A confirm with no target is a no-op rather than an error.
    await act(async () => {
      await result.current.handleConfirm();
    });
    expect(postJSON).toHaveBeenCalledTimes(1);
  });

  it('re-inspects an item and removes it from the review list', async () => {
    const { result, state } = setup();
    await act(async () => {
      await result.current.handleReinspect('a');
    });

    expect(requestContentInspection).toHaveBeenCalledWith('a');
    expect(state.items.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('keeps a failed re-inspection visible with its reason', async () => {
    requestContentInspection.mockRejectedValueOnce(new Error('worker busy'));
    const { result, state } = setup();

    await act(async () => {
      await result.current.handleReinspect('a');
    });

    expect(state.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.actionError.a).toBe('Reinspect failed: worker busy');
  });

  it('updates only the generated item, in place', async () => {
    // Hero generation is the one action that does not remove the card.
    postJSON.mockResolvedValue({ success: true, imageUrl: 'https://cdn/x.png' });
    const { result, state } = setup();

    await act(async () => {
      await result.current.handleGenerateHero('b');
    });

    expect(state.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(state.items[1].altCoverImage).toBe('https://cdn/x.png');
    expect(state.items[0].altCoverImage).toBeUndefined();
  });

  it('treats a success:false hero response as a failure', async () => {
    postJSON.mockResolvedValue({ success: false, error: 'quota' });
    const { result } = setup();

    await act(async () => {
      await result.current.handleGenerateHero('a');
    });

    expect(result.current.actionError.a).toBe('Image generation failed: quota');
  });
});
