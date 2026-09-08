/**
 * Fixing the key has to fix the page, without a reload.
 *
 * The profile probe is not a health check that happens to also fetch — it IS
 * the profile resolve, because every posts and analytics path on this page is
 * profile-scoped. So while it has not answered, Links and Analytics have
 * nothing to query and stay disabled.
 *
 * It was keyed on `authReady` alone, which is true exactly once. An operator
 * who arrived with a broken key, fixed it in the Connection tab and pressed
 * Test Connection therefore got a green header over a page that still could
 * not do anything — because `profiles` was still the empty array the failed
 * probe left, and only a reload would refill it. That is a worse state than
 * the honest failure it replaced: the page now claims to work.
 *
 * Caught in review on PR #429.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

import LinkiePage from './LinkiePage';

const postJSON = vi.fn();
const getJSON = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  getJSON: (...args) => getJSON(...args),
}));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));
// Rendered already on the Connection tab. The setter is a no-op here, so
// clicking a tab would not move `activeTab` — starting there tests the same
// thing without needing a stateful router mock.
vi.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams('tab=connection'), vi.fn()],
}));

/** The proxy's envelope, which is HTTP 200 whatever the upstream said. */
const envelope = (ok, status, data) => ({ ok, status, data });

const REFUSED = envelope(false, 401, { message: 'Unauthorized' });
const ONE_PROFILE = envelope(true, 200, {
  data: { profiles: [{ _id: 'p1', username: 'hcw' }] },
});

beforeEach(() => {
  postJSON.mockReset();
  getJSON.mockReset();
  toast.mockReset();
  // The published-content panel; irrelevant here and must not reject.
  getJSON.mockResolvedValue({ items: [] });
});

describe('a Connection test that succeeds re-resolves the profile', () => {
  it('re-runs the probe, so a fixed key does not need a page reload', async () => {
    // First call is the mount probe and it is refused. Every later call
    // succeeds — the operator has fixed the key in between.
    postJSON.mockResolvedValueOnce(REFUSED).mockResolvedValue(ONE_PROFILE);

    render(<LinkiePage />);

    // The mount probe has run and failed.
    await waitFor(() => expect(postJSON).toHaveBeenCalledTimes(1));
    const afterMount = postJSON.mock.calls.length;

    fireEvent.click(await screen.findByRole('button', { name: /Test Connection/i }));

    // The test call itself, and then the probe again — which is the fix. Two
    // more calls, not one: without the re-run this stays at afterMount + 1.
    await waitFor(() => expect(postJSON.mock.calls.length).toBeGreaterThan(afterMount + 1));
  });

  it('does not re-run the probe when the test fails', async () => {
    // Nothing was learned, so there is nothing to re-ask.
    postJSON.mockResolvedValue(REFUSED);

    render(<LinkiePage />);
    await waitFor(() => expect(postJSON).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole('button', { name: /Test Connection/i }));

    // The test call, and no probe after it.
    await waitFor(() => expect(postJSON).toHaveBeenCalledTimes(2));

    // A negative assertion needs the pending work to have run, or it passes
    // while the call it forbids is still queued. This flushes React's pending
    // effects and microtasks deterministically — a wall-clock sleep would do
    // the same job by guessing, and guess wrong under CI load. Raised in
    // review on PR #429.
    await act(async () => {});
    expect(postJSON).toHaveBeenCalledTimes(2);
  });
});
