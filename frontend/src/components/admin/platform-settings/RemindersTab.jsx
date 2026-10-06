/**
 * Reminders — the owner's dated things not to forget, said on Telegram.
 *
 *   Reminders   admin_config/reminders   read by timers/reminders.js, daily
 *
 * Owner request 2026-10-06: a token expiry, a re-verification date and the
 * like had been living in notes rather than anywhere the platform could act
 * on. Each row here is one reminder; the daily check says it on Telegram
 * once within its lead days, once on the day, then weekly while overdue,
 * until it is marked done. The `notified` stamps the timer writes ride along
 * on every save unchanged, so saving the sheet never makes a reminder fire
 * twice; nothing on this tab edits them.
 *
 * Rows are shown with the undated first (a new row lands at the top), then
 * open reminders by date, then done ones; the stored order is the order
 * rows were added, which the server keeps as given.
 */

import React, { useMemo } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BellRing, Plus, Trash2 } from 'lucide-react';
import {
  SETTING_LABELS,
  SaveRow,
  SettingSection,
  StoredState,
  relativeTime,
  useSetting,
} from './settingShared';

export const DEFAULT_LEAD_DAYS = 7;
export const MAX_LEAD_DAYS = 365;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Today as the server's calendar sees it: the UTC day. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Whole days from today to `dueDate`; null when the date is not yet a date. */
export function daysUntil(dueDate, today = todayIso()) {
  if (!DATE_PATTERN.test(dueDate || '')) return null;
  const due = Date.parse(`${dueDate}T00:00:00.000Z`);
  const from = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(due) || !Number.isFinite(from)) return null;
  return Math.round((due - from) / DAY_MS);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Where a reminder stands, as the badge says it. `tone` picks the colour:
 * muted for nothing to do yet, warning inside the Telegram window or on the
 * day, destructive once past.
 */
export function describeDue(reminder, today = todayIso()) {
  if (reminder.done) return { label: 'Done', tone: 'muted' };
  const days = daysUntil(reminder.dueDate, today);
  if (days === null) return { label: 'No date yet', tone: 'muted' };
  if (days < 0) return { label: `${plural(-days, 'day')} overdue`, tone: 'destructive' };
  if (days === 0) return { label: 'Due today', tone: 'warning' };
  const lead = Number(reminder.leadDays);
  if (Number.isFinite(lead) && days <= lead) {
    return { label: `In ${plural(days, 'day')} · Telegram window open`, tone: 'warning' };
  }
  return { label: `In ${plural(days, 'day')}`, tone: 'muted' };
}

/** A fresh row; the id is the server's identity for the stamps, never shown. */
export const newReminder = () => ({
  id: crypto.randomUUID(),
  title: '',
  dueDate: '',
  leadDays: DEFAULT_LEAD_DAYS,
  notes: '',
  url: '',
  done: false,
  notified: {},
});

/** Why a row cannot be saved as it stands, or null. The server refuses the same. */
export function rowProblem(reminder) {
  if (!String(reminder.title ?? '').trim()) return 'Title needed';
  if (!DATE_PATTERN.test(reminder.dueDate || '')) return 'Date needed';
  const lead = Number(reminder.leadDays);
  if (!Number.isInteger(lead) || lead < 0 || lead > MAX_LEAD_DAYS) {
    return `Days before must be 0 to ${MAX_LEAD_DAYS}`;
  }
  return null;
}

/** Display order over the stored list: undated, then open by date, then done; as indices. */
export function displayOrder(reminders) {
  const rank = (r) => {
    if (r.done) return 2;
    return DATE_PATTERN.test(r.dueDate || '') ? 1 : 0;
  };
  return reminders
    .map((reminder, index) => ({ reminder, index }))
    .sort((a, b) => {
      const byRank = rank(a.reminder) - rank(b.reminder);
      if (byRank !== 0) return byRank;
      const byDate = String(a.reminder.dueDate).localeCompare(String(b.reminder.dueDate));
      return byDate !== 0 ? byDate : a.index - b.index;
    })
    .map((entry) => entry.index);
}

const TONE_CLASS = {
  muted: 'border-border text-muted-foreground',
  warning: 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  destructive: 'border-destructive/40 bg-destructive/5 text-destructive',
};

/** "Telegram: coming up · due · last said 3 d ago", or nothing when never said. */
export function describeNotified(notified) {
  const stages = [
    ['ahead', 'coming up'],
    ['due', 'on the day'],
    ['overdue', 'overdue'],
  ].filter(([stage]) => notified?.[stage]);
  if (stages.length === 0) return null;
  const latest = stages
    .map(([stage]) => notified[stage])
    .sort()
    .at(-1);
  return `Telegram said: ${stages.map(([, word]) => word).join(' · ')} · last ${relativeTime(latest)}`;
}

function ReminderRow({ reminder, n, today, saving, onEdit, onRemove }) {
  const due = describeDue(reminder, today);
  const problem = rowProblem(reminder);
  const said = describeNotified(reminder.notified);
  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={`Title ${n}`}
          value={reminder.title}
          disabled={saving}
          placeholder="What must not be forgotten"
          onChange={(event) => onEdit({ title: event.target.value })}
          className="w-full sm:w-80"
        />
        <Input
          aria-label={`Due date ${n}`}
          type="date"
          value={reminder.dueDate}
          disabled={saving}
          onChange={(event) => onEdit({ dueDate: event.target.value })}
          className="w-44"
        />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Days before</span>
          <Input
            aria-label={`Days before ${n}`}
            type="number"
            min={0}
            max={MAX_LEAD_DAYS}
            step={1}
            value={reminder.leadDays}
            disabled={saving}
            onChange={(event) => onEdit({ leadDays: event.target.value })}
            className="w-20"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label={`Done ${n}`}
            checked={Boolean(reminder.done)}
            disabled={saving}
            onChange={(event) => onEdit({ done: event.target.checked })}
            className="h-4 w-4"
          />
          Done
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          aria-label={`Remove reminder ${n}`}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${TONE_CLASS[due.tone]}`}>
          {due.label}
        </span>
      </div>
      <Input
        aria-label={`Link ${n}`}
        value={reminder.url}
        disabled={saving}
        spellCheck={false}
        placeholder="https:// where to go when it fires (optional)"
        onChange={(event) => onEdit({ url: event.target.value })}
        className="font-mono text-xs"
      />
      <Textarea
        aria-label={`Notes ${n}`}
        value={reminder.notes}
        disabled={saving}
        rows={2}
        placeholder="What to do, in a line or two (optional; sent with the message)"
        onChange={(event) => onEdit({ notes: event.target.value })}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{said ?? 'Telegram has not said this one yet.'}</span>
        {problem ? <span className="text-destructive">{problem}</span> : null}
      </div>
    </li>
  );
}

export function RemindersCard({ value, onChange, onSave, saving, meta, today = todayIso() }) {
  const reminders = useMemo(() => value?.reminders ?? [], [value]);
  const order = useMemo(() => displayOrder(reminders), [reminders]);
  const problems = reminders.filter((reminder) => rowProblem(reminder)).length;

  const update = (next) => onChange({ reminders: next });
  const edit = (index, patch) =>
    update(reminders.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const remove = (index) => update(reminders.filter((_row, i) => i !== index));
  const add = () => update([...reminders, newReminder()]);

  const open = reminders.filter((reminder) => !reminder.done).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <BellRing className="h-5 w-5" /> Reminders
        </CardTitle>
        <CardDescription>
          Dated things not to forget: a token that expires, a renewal, a date to re-check something.
          Each one is said on Telegram once within its days-before window, once on the day, and
          weekly after that until it is marked done. The check runs once a day, in the morning
          Central time. Notes and the link travel with the message, so write them for your phone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <StoredState meta={meta} />
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (problems === 0) onSave();
          }}
        >
          {reminders.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing here yet. Add the first one, give it a title and a date, and save.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {plural(open, 'open reminder')}
              {reminders.length - open > 0 ? `, ${reminders.length - open} done` : ''}.
            </p>
          )}
          <ul className="space-y-3">
            {order.map((index) => (
              <ReminderRow
                key={reminders[index].id}
                reminder={reminders[index]}
                n={index + 1}
                today={today}
                saving={saving}
                onEdit={(patch) => edit(index, patch)}
                onRemove={() => remove(index)}
              />
            ))}
          </ul>
          <SaveRow saving={saving} disabled={problems > 0}>
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={add}>
              <Plus className="mr-2 h-3.5 w-3.5" /> Add reminder
            </Button>
            {problems > 0 ? (
              <span className="text-xs text-destructive">
                {plural(problems, 'row')} need a title and a date before saving.
              </span>
            ) : null}
          </SaveRow>
        </form>
      </CardContent>
    </Card>
  );
}

export default function RemindersTab() {
  const { authReady } = useAuthReady();
  const setting = useSetting('reminders', authReady);
  return (
    <div className="space-y-6">
      <SettingSection
        setting={setting}
        label={SETTING_LABELS.reminders}
        render={(s) => (
          <RemindersCard
            value={s.value}
            meta={s.meta}
            saving={s.saving}
            onChange={s.setValue}
            onSave={() => s.save(s.value)}
          />
        )}
      />
    </div>
  );
}
