/**
 * An issue's metrics on the Published tab. What must hold: a sent issue with a
 * broadcast reads metrics by issue id and shows the API's totals, the top
 * links come from the broadcast, the recipients viewer asks for the type
 * chosen, a scheduled issue says metrics come later, and failures say why.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import NewsletterMetrics, { metricTiles } from './NewsletterMetrics';
import { formatRate } from './resendFormat';

const getJSON = vi.fn();
vi.mock('@/lib/api', () => ({ getJSON: (...args) => getJSON(...args) }));

const BROADCAST = 'b-0001';
const SENT = { id: 'issue-2026-09-14', status: 'sent', broadcastId: BROADCAST };

const METRICS = {
  ok: true,
  broadcast_id: BROADCAST,
  totals: {
    sent: 210,
    delivered: 200,
    opened: 150,
    unique_opened: 90,
    clicked: 40,
    unique_clicked: 25,
    bounced: 3,
    complained: 1,
    unsubscribed: 2,
    open_rate: 0.45,
    click_rate: 0.125,
  },
  data: [],
};
const LINKS = {
  ok: true,
  links: [
    { url: 'https://example.com/a', clicks: 30, unique_clicks: 20 },
    { url: 'https://example.com/b', clicks: 10, unique_clicks: 5 },
  ],
  has_more: false,
  next_after: null,
};

beforeEach(() => {
  getJSON.mockReset();
  getJSON.mockImplementation(async (route) => {
    if (route.startsWith('cms/mailing-list/metrics?')) return METRICS;
    if (route.includes('/clicked-links')) return LINKS;
    if (route.includes('/recipients')) {
      const type = new URLSearchParams(route.split('?')[1]).get('type');
      return {
        ok: true,
        type,
        recipients: [{ email: `${type}@example.com`, count: 2, bounce_type: null }],
        has_more: false,
        next_after: null,
      };
    }
    throw new Error(`unexpected ${route}`);
  });
});

describe('formatRate and metricTiles', () => {
  it('works the rate from the counts, and falls back to the rate as a fraction', () => {
    expect(formatRate(90, 200, 0.9)).toBe('45%');
    expect(formatRate(undefined, undefined, 0.5)).toBe('50%');
    expect(formatRate(1, 400)).toBe('0.3%');
    expect(formatRate(undefined, 0)).toBeNull();
  });

  it('maps the API totals onto the six tiles', () => {
    expect(metricTiles(METRICS.totals).map((tile) => [tile.label, tile.value])).toEqual([
      ['Delivered', 200],
      ['Opened (unique)', 90],
      ['Clicked (unique)', 25],
      ['Bounced', 3],
      ['Unsubscribed', 2],
      ['Complaints', 1],
    ]);
  });
});

describe('NewsletterMetrics', () => {
  it('shows the tiles for a sent issue, read by issue id', async () => {
    render(<NewsletterMetrics issue={SENT} />);
    expect(await screen.findByText('45% open rate')).toBeInTheDocument();
    expect(screen.getByText('13% click rate')).toBeInTheDocument();
    expect(screen.getByText('Delivered').nextSibling).toHaveTextContent('200');
    expect(screen.getByText('Complaints').nextSibling).toHaveTextContent('1');
    expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/metrics?issue_id=issue-2026-09-14');
    expect(screen.getByText(/about every 15 minutes/)).toBeInTheDocument();
  });

  it('lists the top links from the broadcast', async () => {
    render(<NewsletterMetrics issue={SENT} />);
    expect(await screen.findByText('https://example.com/a')).toBeInTheDocument();
    expect(screen.getByText('30 clicks, 20 unique')).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith(
      `cms/mailing-list/broadcasts/${BROADCAST}/clicked-links?limit=10`
    );
  });

  it('re-reads on Refresh', async () => {
    render(<NewsletterMetrics issue={SENT} />);
    await screen.findByText('45% open rate');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(
        getJSON.mock.calls.filter(([route]) => route.startsWith('cms/mailing-list/metrics?'))
      ).toHaveLength(2)
    );
  });

  it('reads recipients only when opened, for the type chosen', async () => {
    render(<NewsletterMetrics issue={SENT} />);
    await screen.findByText('45% open rate');
    expect(getJSON.mock.calls.some(([route]) => route.includes('/recipients'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Who opened/ }));
    expect(await screen.findByText('opened@example.com')).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith(
      `cms/mailing-list/broadcasts/${BROADCAST}/recipients?type=opened&limit=25`
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bounced' } });
    expect(await screen.findByText('bounced@example.com')).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith(
      `cms/mailing-list/broadcasts/${BROADCAST}/recipients?type=bounced&limit=25`
    );
    expect(screen.queryByText('opened@example.com')).not.toBeInTheDocument();
  });

  it('says metrics come after a scheduled issue sends, and reads nothing', () => {
    render(<NewsletterMetrics issue={{ id: 'issue-2026-09-21', status: 'scheduled' }} />);
    expect(screen.getByText('Metrics appear after it sends.')).toBeInTheDocument();
    expect(getJSON).not.toHaveBeenCalled();
  });

  it('shows nothing for a sent issue with no broadcast', () => {
    const { container } = render(
      <NewsletterMetrics issue={{ id: 'issue-2026-09-07', status: 'sent' }} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(getJSON).not.toHaveBeenCalled();
  });

  it('says how long to wait when Resend is rate limiting', async () => {
    getJSON.mockRejectedValue(
      Object.assign(new Error('rate_limit_exceeded'), { status: 429, retryAfterSeconds: 3 })
    );
    render(<NewsletterMetrics issue={SENT} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait 3 seconds');
  });

  it('shows Resend’s reason on a 502, and not-configured on a 503', async () => {
    getJSON.mockRejectedValue(
      Object.assign(new Error('not_found: Broadcast not found'), { status: 502 })
    );
    const { unmount } = render(<NewsletterMetrics issue={SENT} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('not_found: Broadcast not found');
    unmount();

    getJSON.mockRejectedValue(Object.assign(new Error('x'), { status: 503 }));
    render(<NewsletterMetrics issue={SENT} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Resend is not configured');
  });
});
