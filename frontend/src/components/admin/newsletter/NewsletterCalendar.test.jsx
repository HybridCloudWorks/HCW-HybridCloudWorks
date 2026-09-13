/**
 * The Published calendar. What must hold: it asks for one month at a time,
 * places each issue on the viewer's local day by when it went (or goes) out,
 * counts sent and scheduled apart, and shows the email in an empty sandbox.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import NewsletterCalendar, { groupByDay, localDayKey } from './NewsletterCalendar';

const getJSON = vi.fn();
vi.mock('@/lib/api', () => ({ getJSON: (...args) => getJSON(...args) }));

/** Noon local time, so the local day is unambiguous in any test time zone. */
const localNoon = (year, month, day) => new Date(year, month, day, 12).toISOString();

const TODAY = new Date(2026, 8, 20, 12); // 20 September 2026, local

const sent = {
  id: 'issue-2026-09-14',
  status: 'sent',
  subject: 'Landing zones',
  sentAt: localNoon(2026, 8, 15),
};
const alsoSent = {
  id: 'issue-2026-09-15',
  status: 'sent',
  subject: 'Networking',
  sentAt: new Date(2026, 8, 15, 18).toISOString(),
};
const scheduled = {
  id: 'issue-2026-09-21',
  status: 'scheduled',
  subject: 'Identity',
  scheduledAt: localNoon(2026, 8, 22),
};

const detailFor = (row) => ({
  ok: true,
  issue: { ...row, etag: 'e1' },
  preview: { subject: row.subject, html: `<p>${row.subject}</p>`, text: row.subject },
});

beforeEach(() => {
  getJSON.mockReset();
  getJSON.mockImplementation(async (route) => {
    if (route.startsWith('cms/newsletters?month=')) {
      return { ok: true, issues: route.endsWith('2026-09') ? [sent, alsoSent, scheduled] : [] };
    }
    const id = route.split('/').pop();
    return detailFor([sent, alsoSent, scheduled].find((row) => row.id === id));
  });
});

describe('groupByDay', () => {
  it('places issues on local days inside the month, by sentAt or scheduledAt', () => {
    const outside = { id: 'x', status: 'sent', sentAt: localNoon(2026, 9, 1) };
    const days = groupByDay([sent, alsoSent, scheduled, outside], 2026, 8);
    expect([...days.keys()].sort()).toEqual(['2026-09-15', '2026-09-22']);
    expect(days.get('2026-09-15').map((row) => row.id)).toEqual([sent.id, alsoSent.id]);
  });

  it('ignores a row with no usable date', () => {
    expect(groupByDay([{ id: 'y', status: 'sent', sentAt: 'nope' }], 2026, 8).size).toBe(0);
    expect(localDayKey(undefined)).toBeNull();
  });
});

describe('NewsletterCalendar', () => {
  it('loads the current month and counts sent and scheduled apart', async () => {
    render(<NewsletterCalendar today={TODAY} />);
    expect(await screen.findByText('2 sent, 1 scheduled in September 2026')).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith('cms/newsletters?month=2026-09');
    expect(
      screen.getByRole('button', { name: 'September 15: 2 sent, 0 scheduled' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'September 22: 0 sent, 1 scheduled' })
    ).toBeInTheDocument();
  });

  it('opens a single-issue day straight to its email, in an empty sandbox', async () => {
    render(<NewsletterCalendar today={TODAY} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'September 22: 0 sent, 1 scheduled' })
    );
    const frame = await screen.findByTitle('Published newsletter');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe('<p>Identity</p>');
    expect(getJSON).toHaveBeenCalledWith(`cms/newsletters/${scheduled.id}`);
  });

  it('lists a busy day, then shows the issue chosen', async () => {
    render(<NewsletterCalendar today={TODAY} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'September 15: 2 sent, 0 scheduled' })
    );
    const list = screen.getByRole('list', { name: 'Issues on this day' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.queryByTitle('Published newsletter')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Networking/ }));
    const frame = await screen.findByTitle('Published newsletter');
    expect(frame.getAttribute('srcdoc')).toBe('<p>Networking</p>');
  });

  it('moves between months and says when nothing went out', async () => {
    render(<NewsletterCalendar today={TODAY} />);
    await screen.findByText('2 sent, 1 scheduled in September 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(getJSON).toHaveBeenCalledWith('cms/newsletters?month=2026-08'));
    expect(await screen.findByText('Nothing was published in August 2026.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => expect(getJSON).toHaveBeenCalledWith('cms/newsletters?month=2026-10'));
  });

  it('crosses a year boundary', async () => {
    render(<NewsletterCalendar today={new Date(2026, 0, 10, 12)} />);
    await waitFor(() => expect(getJSON).toHaveBeenCalledWith('cms/newsletters?month=2026-01'));
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(getJSON).toHaveBeenCalledWith('cms/newsletters?month=2025-12'));
  });

  it('clears a failed preview once another issue loads', async () => {
    const base = getJSON.getMockImplementation();
    getJSON.mockImplementation(async (route) => {
      if (route === `cms/newsletters/${sent.id}`)
        throw new Error('Failed to read the newsletter issue');
      return base(route);
    });
    render(<NewsletterCalendar today={TODAY} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'September 15: 2 sent, 0 scheduled' })
    );
    fireEvent.click(screen.getByRole('button', { name: /Landing zones/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read the newsletter issue'
    );

    fireEvent.click(screen.getByRole('button', { name: /Networking/ }));
    expect(await screen.findByTitle('Published newsletter')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says why when the month cannot be loaded', async () => {
    getJSON.mockRejectedValue(new Error('Failed to list newsletter issues'));
    render(<NewsletterCalendar today={TODAY} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to list newsletter issues');
  });
});
