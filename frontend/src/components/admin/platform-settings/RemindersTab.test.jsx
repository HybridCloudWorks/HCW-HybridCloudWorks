/**
 * Reminders: a form on top adds one reminder and clears when the save took;
 * the pane below lists every reminder with its badge, a Done box and a red
 * circle X that cancels after one confirmation; every action PUTs the whole
 * list with the timer's stamps untouched (owner, 2026-10-06, both requests).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import RemindersTab, {
  NewReminderForm,
  ReminderList,
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

describe('NewReminderForm', () => {
  it('holds Add until the row has a title and a date, names why, then hands over a trimmed row and clears', async () => {
    const onAdd = vi.fn(async () => true);
    render(<NewReminderForm saving={false} onAdd={onAdd} />);
    const add = screen.getByRole('button', { name: /Add reminder/ });
    expect(add.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Title needed')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Renew the thing  ' } });
    expect(screen.getByText('Date needed')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('Days before'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Link'), {
      target: { value: ' https://example.test/renew ' },
    });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: ' Do it early. ' } });
    expect(add.hasAttribute('disabled')).toBe(false);

    fireEvent.submit(screen.getByRole('form', { name: 'New reminder' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const [[row]] = onAdd.mock.calls;
    expect(row).toMatchObject({
      title: 'Renew the thing',
      dueDate: '2026-12-01',
      leadDays: 14,
      url: 'https://example.test/renew',
      notes: 'Do it early.',
      done: false,
      notified: {},
    });
    expect(row.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    await waitFor(() => expect(screen.getByLabelText('Title').value).toBe(''));
    expect(screen.getByLabelText('Due date').value).toBe('');
  });

  it('keeps the draft when the save was refused', async () => {
    const onAdd = vi.fn(async () => false);
    render(<NewReminderForm saving={false} onAdd={onAdd} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Kept' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-01' } });
    fireEvent.submit(screen.getByRole('form', { name: 'New reminder' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Title').value).toBe('Kept');
  });
});

describe('ReminderList', () => {
  it('lists every reminder with its details and badge, nearest open first, done last', () => {
    render(
      <ReminderList
        reminders={stored.reminders}
        today={TODAY}
        saving={false}
        onToggleDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText('Re-verify the Learn catalogues')).toBeTruthy();
    expect(within(items[0]).getByText('In 4 days · Telegram window open')).toBeTruthy();
    expect(within(items[0]).getByText(/Telegram said: coming up/)).toBeTruthy();
    expect(within(items[1]).getByText('In 90 days')).toBeTruthy();
    expect(within(items[1]).getByText(/Due 2027-01-04 · 7 days before/)).toBeTruthy();
    expect(within(items[1]).getByRole('link', { name: /Link/ }).getAttribute('href')).toBe(
      'https://dash.cloudflare.com/profile/api-tokens'
    );
    expect(within(items[1]).getByText('Re-scope to the lab zone first.')).toBeTruthy();
    expect(within(items[2]).getByText('Done', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText(/2 open reminders, 1 done/)).toBeTruthy();
  });

  it('shows the empty pane when there is nothing', () => {
    render(
      <ReminderList
        reminders={[]}
        today={TODAY}
        saving={false}
        onToggleDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/Nothing here yet. Add the first one above/)).toBeTruthy();
  });

  it('cancels only after the inline confirmation, and Keep backs out', () => {
    const onCancel = vi.fn();
    render(
      <ReminderList
        reminders={stored.reminders}
        today={TODAY}
        saving={false}
        onToggleDone={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Cancel reminder: Cloudflare DNS token for the lab host expires',
      })
    );
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText('Cancel this reminder?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByText('Cancel this reminder?')).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Cancel reminder: Cloudflare DNS token for the lab host expires',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    // Index into the stored list, not the display order.
    expect(onCancel).toHaveBeenCalledWith(0);
  });

  it('flips Done for the right stored row', () => {
    const onToggleDone = vi.fn();
    render(
      <ReminderList
        reminders={stored.reminders}
        today={TODAY}
        saving={false}
        onToggleDone={onToggleDone}
        onCancel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText('Done: Re-verify the Learn catalogues'));
    expect(onToggleDone).toHaveBeenCalledWith(1, true);
  });
});

describe('RemindersCard and the tab', () => {
  it('adding from the form saves the list with the new row appended, stamps untouched', async () => {
    const onSave = vi.fn(async () => true);
    render(
      <RemindersCard value={stored} meta={meta} saving={false} onSave={onSave} today={TODAY} />
    );
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New one' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-11-01' } });
    fireEvent.submit(screen.getByRole('form', { name: 'New reminder' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [[saved]] = onSave.mock.calls;
    expect(saved.reminders).toHaveLength(4);
    expect(saved.reminders[3]).toMatchObject({
      title: 'New one',
      dueDate: '2026-11-01',
      leadDays: 7,
    });
    expect(saved.reminders[1].notified).toEqual({ ahead: '2026-10-03T13:00:00.000Z' });
  });

  it('cancelling saves the list without that row; Done saves it flipped', async () => {
    const onSave = vi.fn(async () => true);
    render(
      <RemindersCard value={stored} meta={meta} saving={false} onSave={onSave} today={TODAY} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reminder: Already handled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    expect(onSave).toHaveBeenLastCalledWith({
      reminders: stored.reminders.filter((r) => r.id !== 'done-one'),
    });
    fireEvent.click(screen.getByLabelText('Done: Re-verify the Learn catalogues'));
    const [last] = onSave.mock.calls.at(-1);
    expect(last.reminders.find((r) => r.id === 'learn-pages')).toMatchObject({
      done: true,
      notified: { ahead: '2026-10-03T13:00:00.000Z' },
    });
  });

  it('loads the sheet, and an Add PUTs the whole list to the reminders route', async () => {
    render(<RemindersTab />);
    await screen.findByText('Your reminders');
    expect(getJSON).toHaveBeenCalledWith(settingRoute('reminders'));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Foundry review' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-01' } });
    fireEvent.submit(screen.getByRole('form', { name: 'New reminder' }));
    await waitFor(() => expect(sendJSON).toHaveBeenCalledTimes(1));
    const [[route, method, body]] = sendJSON.mock.calls;
    expect(route).toBe(settingRoute('reminders'));
    expect(method).toBe('PUT');
    expect(body.reminders).toHaveLength(4);
    expect(body.reminders[3].title).toBe('Foundry review');
    // The saved list is what the pane shows, and the form is clear again.
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4));
    expect(screen.getByLabelText('Title').value).toBe('');
  });
});
