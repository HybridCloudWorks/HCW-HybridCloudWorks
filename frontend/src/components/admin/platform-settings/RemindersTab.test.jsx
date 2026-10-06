/**
 * Reminders: the badge says where each one stands, a new row needs a title
 * and a date before the sheet can be saved, and a save PUTs the body the
 * daily check reads with the timer's stamps untouched (owner, 2026-10-06).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import RemindersTab, {
  RemindersCard,
  describeDue,
  describeNotified,
  displayOrder,
  newReminder,
  rowProblem,
} from './RemindersTab';
import { settingRoute } from './settingShared';

const getJSON = vi.fn();
const sendJSON = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
  postJSON: vi.fn(),
}));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const TODAY = '2026-10-06';
const meta = {
  exists: true,
  stored: 'valid',
  updatedAt: '2026-10-06T12:00:00.000Z',
  problem: null,
};

const stored = {
  reminders: [
    {
      id: 'cf-token',
      title: 'Cloudflare DNS token for the lab host expires',
      dueDate: '2027-01-04',
      leadDays: 7,
      notes: 'Re-scope to the lab zone first.',
      url: 'https://dash.cloudflare.com/profile/api-tokens',
      done: false,
      notified: {},
    },
    {
      id: 'learn-pages',
      title: 'Re-verify the Learn catalogues',
      dueDate: '2026-10-10',
      leadDays: 7,
      notes: '',
      url: '',
      done: false,
      notified: { ahead: '2026-10-03T13:00:00.000Z' },
    },
    {
      id: 'done-one',
      title: 'Already handled',
      dueDate: '2026-09-01',
      leadDays: 7,
      notes: '',
      url: '',
      done: true,
      notified: { due: '2026-09-01T13:00:00.000Z' },
    },
  ],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T15:00:00.000Z`));
  getJSON.mockReset().mockResolvedValue({
    success: true,
    setting: 'reminders',
    value: stored,
    exists: true,
    stored: 'valid',
    updatedAt: meta.updatedAt,
  });
  sendJSON.mockReset().mockImplementation(async (_route, _method, body) => ({
    success: true,
    value: body,
    exists: true,
    stored: 'valid',
    updatedAt: '2026-10-06T15:00:01.000Z',
  }));
  toast.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('where a reminder stands', () => {
  it('names the window, the day, the overdue count and done', () => {
    const r = (over) => ({ dueDate: '2026-10-13', leadDays: 7, done: false, ...over });
    expect(describeDue(r({ dueDate: '2026-10-20' }), TODAY)).toEqual({
      label: 'In 14 days',
      tone: 'muted',
    });
    expect(describeDue(r(), TODAY)).toEqual({
      label: 'In 7 days · Telegram window open',
      tone: 'warning',
    });
    expect(describeDue(r({ dueDate: '2026-10-07' }), TODAY).label).toBe(
      'In 1 day · Telegram window open'
    );
    expect(describeDue(r({ dueDate: TODAY }), TODAY)).toEqual({
      label: 'Due today',
      tone: 'warning',
    });
    expect(describeDue(r({ dueDate: '2026-10-01' }), TODAY)).toEqual({
      label: '5 days overdue',
      tone: 'destructive',
    });
    expect(describeDue(r({ dueDate: '2026-10-05' }), TODAY).label).toBe('1 day overdue');
    expect(describeDue(r({ done: true }), TODAY)).toEqual({ label: 'Done', tone: 'muted' });
    expect(describeDue(r({ dueDate: '' }), TODAY)).toEqual({ label: 'No date yet', tone: 'muted' });
  });

  it('says what Telegram has said, and nothing when it has not', () => {
    expect(describeNotified({})).toBeNull();
    expect(describeNotified(undefined)).toBeNull();
    expect(describeNotified({ ahead: '2026-10-03T13:00:00.000Z' })).toMatch(
      /^Telegram said: coming up · last 3 d ago$/
    );
    expect(
      describeNotified({ ahead: '2026-10-01T13:00:00.000Z', overdue: '2026-10-05T13:00:00.000Z' })
    ).toMatch(/coming up · overdue · last 1 d ago/);
  });

  it('orders undated first, then open by date, then done', () => {
    const list = [
      { id: 'a', dueDate: '2027-01-04', done: false },
      { id: 'b', dueDate: '', done: false },
      { id: 'c', dueDate: '2026-10-10', done: false },
      { id: 'd', dueDate: '2026-01-01', done: true },
    ];
    expect(displayOrder(list)).toEqual([1, 2, 0, 3]);
  });

  it('refuses a row without a title or a date, as the server would', () => {
    expect(rowProblem({ title: '', dueDate: '2026-10-10', leadDays: 7 })).toBe('Title needed');
    expect(rowProblem({ title: 'T', dueDate: '', leadDays: 7 })).toBe('Date needed');
    expect(rowProblem({ title: 'T', dueDate: '2026-10-10', leadDays: '400' })).toMatch(/0 to 365/);
    expect(rowProblem({ title: 'T', dueDate: '2026-10-10', leadDays: '7' })).toBeNull();
    const fresh = newReminder();
    expect(fresh).toMatchObject({ title: '', dueDate: '', leadDays: 7, done: false, notified: {} });
    expect(fresh.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});

describe('RemindersCard', () => {
  it('shows every stored row with its badge, the overdue and done ones included', () => {
    render(
      <RemindersCard
        value={stored}
        meta={meta}
        saving={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByLabelText('Title 1').value).toBe(
      'Cloudflare DNS token for the lab host expires'
    );
    expect(screen.getByText('In 90 days')).toBeTruthy();
    expect(screen.getByText('In 4 days · Telegram window open')).toBeTruthy();
    expect(screen.getByText('Done', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText(/2 open reminders, 1 done/)).toBeTruthy();
    expect(screen.getByText(/Telegram said: coming up/)).toBeTruthy();
    // The undated-first order puts the nearest open date before the far one.
    const titles = screen.getAllByLabelText(/^Title \d$/).map((input) => input.value);
    expect(titles[0]).toBe('Re-verify the Learn catalogues');
  });

  it('adds a row at the top, and holds Save until it has a title and a date', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RemindersCard
        value={{ reminders: [] }}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={vi.fn()}
        today={TODAY}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Add reminder/ }));
    const [[next]] = onChange.mock.calls;
    expect(next.reminders).toHaveLength(1);
    expect(next.reminders[0]).toMatchObject({
      title: '',
      dueDate: '',
      leadDays: 7,
      done: false,
      notified: {},
    });

    rerender(
      <RemindersCard
        value={next}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/1 row need a title and a date/)).toBeTruthy();
    expect(screen.getByText('No date yet')).toBeTruthy();
  });

  it('edits a row in place and marks it done without touching the stamps', () => {
    const onChange = vi.fn();
    render(
      <RemindersCard
        value={stored}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={vi.fn()}
        today={TODAY}
      />
    );
    fireEvent.change(screen.getByLabelText('Days before 2'), { target: { value: '14' } });
    expect(onChange.mock.calls.at(-1)[0].reminders[1]).toMatchObject({
      id: 'learn-pages',
      leadDays: '14',
      notified: { ahead: '2026-10-03T13:00:00.000Z' },
    });
    fireEvent.click(screen.getByLabelText('Done 2'));
    expect(onChange.mock.calls.at(-1)[0].reminders[1].done).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove reminder 3' }));
    expect(onChange.mock.calls.at(-1)[0].reminders.map((r) => r.id)).toEqual([
      'cf-token',
      'learn-pages',
    ]);
  });
});

describe('RemindersTab', () => {
  it('loads the sheet and PUTs it back with the stamps the timer wrote', async () => {
    render(<RemindersTab />);
    await screen.findByText('Reminders');
    expect(getJSON).toHaveBeenCalledWith(settingRoute('reminders'));
    fireEvent.change(screen.getByLabelText('Notes 1'), {
      target: { value: 'Re-scope to the lab zone first. Then rotate.' },
    });
    fireEvent.submit(screen.getByLabelText('Notes 1').closest('form'));
    await waitFor(() => expect(sendJSON).toHaveBeenCalledTimes(1));
    const [[route, method, body]] = sendJSON.mock.calls;
    expect(route).toBe(settingRoute('reminders'));
    expect(method).toBe('PUT');
    expect(body.reminders[0].notes).toBe('Re-scope to the lab zone first. Then rotate.');
    expect(body.reminders[1].notified).toEqual({ ahead: '2026-10-03T13:00:00.000Z' });
    expect(body.reminders[2].done).toBe(true);
  });
});
