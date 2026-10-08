import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link } from 'react-router';

const postJSON = vi.fn();
// `api.postJSON` is swappable so the error-path test can install a plain
// rejecting function: a vi.fn that rejects is reported by vitest 4 as an
// unhandled error even when the caller catches it.
const api = { postJSON: (...args) => postJSON(...args) };
vi.mock('@/lib/api', () => ({ postJSON: (...args) => api.postJSON(...args) }));

import useDashboardCounts, { countsFromSnapshot, sumBucket } from './useDashboardCounts';

describe('countsFromSnapshot', () => {
  it('sums the same buckets the sidebar and dashboard used to sum separately', () => {
    const stats = {
      blog: { needsReview: 2, inProgress: 1, published: 5, total: 9 },
      news: { needsReview: 1, inProgress: 7, published: 1 },
      framework: { inProgress: 3, published: 2 },
      rejected: 4,
    };
    const counts = countsFromSnapshot({ stats });
    expect(counts.queue).toBe(3);
    // News counts in every bucket now: the old sidebar excluded it from
    // the editor sum and the dashboard excluded it from live, for no reason
    // either comment recorded.
    expect(counts.editor).toBe(11);
    expect(counts.live).toBe(8);
    expect(counts.rejected).toBe(4);
    expect(counts.byType.blog.total).toBe(9);
    expect(sumBucket(stats, 'published', ['blog'])).toBe(5);
  });

  it('takes the Publish count from the snapshot, not from a stats bucket', () => {
    // readyToPublish is its own COUNT (approved, forge_ready, published and
    // not live); summing a bucket would count the Editor's items again.
    expect(countsFromSnapshot({ stats: {}, readyToPublish: 5 }).publish).toBe(5);
    // An API that predates the field: no badge rather than a wrong one.
    expect(countsFromSnapshot({ stats: {} }).publish).toBe(0);
  });

  it('is all zeros for nothing', () => {
    expect(countsFromSnapshot(null)).toMatchObject({
      queue: 0,
      editor: 0,
      live: 0,
      publish: 0,
      rejected: 0,
    });
  });
});

function Probe() {
  const { counts, loading, error } = useDashboardCounts();
  return (
    <div>
      <span data-testid="queue">{counts.queue}</span>
      <span data-testid="state">{loading ? 'loading' : error || 'ready'}</span>
      <Link to="/admin/other">go</Link>
    </div>
  );
}

describe('useDashboardCounts', () => {
  beforeEach(() => {
    postJSON.mockReset();
    api.postJSON = (...args) => postJSON(...args);
  });

  it('loads once on mount and again on navigation', async () => {
    postJSON.mockResolvedValue({ stats: { blog: { needsReview: 2 } } });
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin/*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByTestId('state')).toHaveTextContent('ready');
    expect(postJSON).toHaveBeenCalledTimes(1);
    postJSON.mockResolvedValue({ stats: { blog: { needsReview: 5 } } });
    screen.getByRole('link', { name: 'go' }).click();
    await waitFor(() => expect(postJSON).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('5')).toBeInTheDocument();
  });

  it('reports a failed read without throwing', async () => {
    api.postJSON = async () => {
      throw new Error('boom');
    };
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Probe />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('boom'));
    expect(screen.getByTestId('queue')).toHaveTextContent('0');
  });
});
