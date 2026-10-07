/**
 * Reminders: a Test Telegram button proves the channel and reads Telegram's
 * reason; a form on top adds one reminder and clears when the save took; the
 * pane below lists every reminder with its badge, Edit (the same form, in
 * place), a Done box and a red circle X that cancels after one confirmation;
 * every action PUTs the whole list with the timer's stamps untouched (owner,
 * 2026-10-06; brief #917).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import RemindersTab, {
  NewReminderForm,
  ReminderList,
  RemindersCard,
  TELEGRAM_TEST_ROUTE,
  TestTelegramButton,
  describeDue,
  describeNotified,
  describeTestResult,
  displayOrder,
  newReminder,
  rowProblem,
} from './RemindersTab';
import { settingRoute } from './settingShared';

const getJSON = vi.fn();
const sendJSON = vi.fn();
const postJSON = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
  postJSON: (...args) => postJSON(...args),
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
  postJSON.mockReset().mockResolvedValue({ success: true, sent: true, reason: null, status: null });
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

describe('Test Telegram', () => {
  it('reads the route answer into the owner words, Telegram status first', () => {
    expect(describeTestResult({ sent: true }).ok).toBe(true);
    expect(describeTestResult({ sent: false, reason: 'cooldown' })).toMatchObject({ ok: true });
    expect(describeTestResult({ sent: false, reason: 'not_configured' }).text).toMatch(
      /not configured/
    );
    expect(describeTestResult({ sent: false, reason: 'telegram_error', status: 403 }).text).toMatch(
      /blocked/
    );
    expect(describeTestResult({ sent: false, reason: 'telegram_error', status: 400 }).text).toMatch(
      /cannot find the chat/
    );
    expect(describeTestResult({ sent: false, reason: 'telegram_error', status: 401 }).text).toMatch(
      /token/
    );
    expect(describeTestResult({ sent: false, reason: 'telegram_error', status: 502 }).text).toBe(
      'Telegram refused (502).'
    );
    expect(describeTestResult({ sent: false, reason: 'exception' }).text).toMatch(
      /could not be reached/
    );
  });

  it('posts to the test route and shows the outcome, green for sent and red for a refusal', async () => {
    render(<TestTelegramButton />);
    fireEvent.click(screen.getByRole('button', { name: /Test Telegram/ }));
    await waitFor(() => expect(postJSON).toHaveBeenCalledWith(TELEGRAM_TEST_ROUTE, {}));
    expect((await screen.findByRole('status')).textContent).toMatch(/Sent\. Check Telegram/);

    postJSON.mockResolvedValueOnce({
      success: true,
      sent: false,
      reason: 'telegram_error',
      status: 403,
    });
    fireEvent.click(screen.getByRole('button', { name: /Test Telegram/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/blocked/));

    postJSON.mockRejectedValueOnce(new Error('Network down'));
    fireEvent.click(screen.getByRole('button', { name: /Test Telegram/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Network down'));
  });
});

describe('NewReminderForm', () => {
  it('holds Add until the row has a title and a date, names why, then hands over a trimmed row and clears', async () => {
    const onAdd = vi.fn(async () => true);
    render(<NewReminderForm saving={false} onAdd={onAdd} />);
    const add = screen.getByRole('button', { name: /Add reminder/ });
    expect(add.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Title needed')).toBeTruthy();
    expect(screen.getByText('Delivered by Telegram')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Renew the thing  ' } });
    expect(screen.getByText('Date needed')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('Days before'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Link'), {
      target: { value: ' https://example.test/renew ' },
    });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: ' Do it early. ' } });
    expect(add.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByLabelText('Done')).toBeNull();

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
  const renderList = (over = {}) =>
    render(
      <ReminderList
        reminders={stored.reminders}
        today={TODAY}
        saving={false}
        onEdit={vi.fn(async () => true)}
        onToggleDone={vi.fn()}
        onCancel={vi.fn()}
        {...over}
      />
    );

  it('lists every reminder with its details and badge, nearest open first, done last', () => {
    renderList();
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
    renderList({ reminders: [] });
    expect(screen.getByText(/Nothing here yet. Add the first one above/)).toBeTruthy();
  });

  it('cancels only after the inline confirmation, and Keep backs out', () => {
    const onCancel = vi.fn();
    renderList({ onCancel });
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
    expect(onCancel).toHaveBeenCalledWith(0);
  });

  it('flips Done for the right stored row', () => {
    const onToggleDone = vi.fn();
    renderList({ onToggleDone });
    fireEvent.click(screen.getByLabelText('Done: Re-verify the Learn catalogues'));
    expect(onToggleDone).toHaveBeenCalledWith(1, true);
  });

  it('Edit opens the row into the form in place, prefilled with status, saves it and closes; Keep as it was backs out', async () => {
    const onEdit = vi.fn(async () => true);
    renderList({ onEdit });
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit reminder: Re-verify the Learn catalogues' })
    );
    const form = screen.getByRole('form', {
      name: 'Edit reminder: Re-verify the Learn catalogues',
    });
    expect(within(form).getByLabelText('Title').value).toBe('Re-verify the Learn catalogues');
    expect(within(form).getByLabelText('Due date').value).toBe('2026-10-10');
    expect(within(form).getByLabelText('Done').checked).toBe(false);
    expect(within(form).getByText('Delivered by Telegram')).toBeTruthy();

    fireEvent.change(within(form).getByLabelText('Title'), {
      target: { value: 'Re-verify the Learn catalogues (Q4)' },
    });
    fireEvent.change(within(form).getByLabelText('Days before'), { target: { value: '3' } });
    fireEvent.click(within(form).getByLabelText('Done'));
    fireEvent.submit(form);
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    const [[index, row]] = onEdit.mock.calls;
    expect(index).toBe(1);
    expect(row).toMatchObject({
      id: 'learn-pages',
      title: 'Re-verify the Learn catalogues (Q4)',
      leadDays: 3,
      done: true,
      notified: { ahead: '2026-10-03T13:00:00.000Z' },
    });
    await waitFor(() => expect(screen.queryByRole('form', { name: /Edit reminder/ })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Edit reminder: Already handled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep as it was' }));
    expect(screen.queryByRole('form', { name: /Edit reminder/ })).toBeNull();
    expect(onEdit).toHaveBeenCalledTimes(1);
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

  it('editing replaces that row in the saved list; cancelling removes it; Done flips it', async () => {
    const onSave = vi.fn(async () => true);
    render(
      <RemindersCard value={stored} meta={meta} saving={false} onSave={onSave} today={TODAY} />
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit reminder: Cloudflare DNS token for the lab host expires',
      })
    );
    const form = screen.getByRole('form', { name: /Edit reminder: Cloudflare/ });
    fireEvent.change(within(form).getByLabelText('Notes'), { target: { value: 'Roll it first.' } });
    fireEvent.submit(form);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].reminders[0]).toMatchObject({
      id: 'cf-token',
      notes: 'Roll it first.',
    });
    expect(onSave.mock.calls[0][0].reminders).toHaveLength(3);

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
    expect(screen.getByRole('button', { name: /Test Telegram/ })).toBeTruthy();
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
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4));
    expect(screen.getByLabelText('Title').value).toBe('');
  });
});
