/**
 * Reminders — the owner's dated things not to forget, said on Telegram.
 *
 *   Reminders   admin_config/reminders   read by timers/reminders.js, daily
 *
 * Owner request 2026-10-06: a token expiry, a re-verification date and the
 * like had been living in notes rather than anywhere the platform could act
 * on. The daily check says each one on Telegram once within its lead days,
 * once on the day, then weekly while overdue, until it is marked done.
 *
 * Owner request the same evening, on seeing the first cut: a form at the top
 * to add ONE reminder, and on Save it lands in a pane below listing every
 * reminder with its details and a red circle X to cancel it. So the tab is
 * two parts over one document: the form, which saves the list with the new
 * row appended and then clears; and the list, where each row can be marked
 * done or cancelled (removed), each a save of its own. Nothing is edited in
 * place — to change a reminder, cancel it and add it again — which keeps
 * every save a single intention. Cancel asks once, inline, before it removes.
 *
 * The `notified` stamps the timer writes ride along on every save unchanged
 * and the server merges any stamp written while the page was open, so saving
 * from here never makes a reminder fire twice.
 */

import React, { useMemo, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BellRing, ExternalLink, Plus, X } from 'lucide-react';
import {
  SETTING_LABELS,
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
  const days = reminder.done ? null : daysUntil(reminder.dueDate, today);
  const lead = Number(reminder.leadDays);
  let label = 'No date yet';
  let tone = 'muted';
  if (reminder.done) {
    label = 'Done';
  } else if (days !== null && days < 0) {
    label = `${plural(-days, 'day')} overdue`;
    tone = 'destructive';
  } else if (days === 0) {
    label = 'Due today';
    tone = 'warning';
  } else if (days !== null && Number.isFinite(lead) && days <= lead) {
    label = `In ${plural(days, 'day')} · Telegram window open`;
    tone = 'warning';
  } else if (days !== null) {
    label = `In ${plural(days, 'day')}`;
  }
  return { label, tone };
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

/** "Telegram said: coming up · on the day · last 3 d ago", or nothing when never said. */
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

/**
 * The form: one reminder, saved on Add and cleared. The Add button is held
 * back until the row would pass the server, and the reason is shown.
 */
export function NewReminderForm({ saving, onAdd }) {
  const [draft, setDraft] = useState(newReminder);
  const problem = rowProblem(draft);
  const edit = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async (event) => {
    event.preventDefault();
    if (problem) return;
    const added = await onAdd({
      ...draft,
      title: draft.title.trim(),
      leadDays: Number(draft.leadDays),
      notes: draft.notes.trim(),
      url: draft.url.trim(),
    });
    if (added) setDraft(newReminder());
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-border p-3"
      aria-label="New reminder"
    >
      <p className="text-sm font-medium">New reminder</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Title"
          value={draft.title}
          disabled={saving}
          placeholder="What must not be forgotten"
          onChange={(event) => edit({ title: event.target.value })}
          className="w-full sm:w-80"
        />
        <Input
          aria-label="Due date"
          type="date"
          value={draft.dueDate}
          disabled={saving}
          onChange={(event) => edit({ dueDate: event.target.value })}
          className="w-44"
        />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Days before</span>
          <Input
            aria-label="Days before"
            type="number"
            min={0}
            max={MAX_LEAD_DAYS}
            step={1}
            value={draft.leadDays}
            disabled={saving}
            onChange={(event) => edit({ leadDays: event.target.value })}
            className="w-20"
          />
        </label>
      </div>
      <Input
        aria-label="Link"
        value={draft.url}
        disabled={saving}
        spellCheck={false}
        placeholder="https:// where to go when it fires (optional)"
        onChange={(event) => edit({ url: event.target.value })}
        className="font-mono text-xs"
      />
      <Textarea
        aria-label="Notes"
        value={draft.notes}
        disabled={saving}
        rows={2}
        placeholder="What to do, in a line or two (optional; sent with the message)"
        onChange={(event) => edit({ notes: event.target.value })}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {problem ?? 'Telegram says it once in the window, once on the day, weekly while overdue.'}
        </span>
        <Button type="submit" size="sm" disabled={saving || Boolean(problem)}>
          <Plus className="mr-2 h-3.5 w-3.5" /> Add reminder
        </Button>
      </div>
    </form>
  );
}

/** One listed reminder: its details, Done, and the red X that cancels it after one confirmation. */
function ReminderItem({ reminder, today, saving, onToggleDone, onCancel }) {
  const [confirming, setConfirming] = useState(false);
  const due = describeDue(reminder, today);
  const said = describeNotified(reminder.notified);
  return (
    <li className="flex flex-wrap items-start gap-3 rounded-md border border-border p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`font-medium ${reminder.done ? 'text-muted-foreground line-through' : ''}`}
          >
            {reminder.title}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${TONE_CLASS[due.tone]}`}>
            {due.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Due {reminder.dueDate} · {plural(Number(reminder.leadDays) || 0, 'day')} before
          {reminder.url ? (
            <>
              {' · '}
              <a
                href={reminder.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                Link <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </>
          ) : null}
        </p>
        {reminder.notes ? <p className="whitespace-pre-wrap text-sm">{reminder.notes}</p> : null}
        <p className="text-xs text-muted-foreground">
          {said ?? 'Telegram has not said this one yet.'}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label={`Done: ${reminder.title}`}
            checked={Boolean(reminder.done)}
            disabled={saving}
            onChange={(event) => onToggleDone(event.target.checked)}
            className="h-4 w-4"
          />
          Done
        </label>
        {confirming ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-destructive">Cancel this reminder?</span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={saving}
              onClick={onCancel}
            >
              Yes, cancel
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Cancel reminder: ${reminder.title}`}
            title="Cancel this reminder"
            disabled={saving}
            onClick={() => setConfirming(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

/** The pane: every reminder, undated first, then open by date, then done. */
export function ReminderList({ reminders, today, saving, onToggleDone, onCancel }) {
  const order = useMemo(() => displayOrder(reminders), [reminders]);
  const open = reminders.filter((reminder) => !reminder.done).length;
  return (
    <section aria-label="Your reminders" className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Your reminders</p>
        <p className="text-xs text-muted-foreground">
          {reminders.length === 0
            ? '0 reminders.'
            : `${plural(open, 'open reminder')}${reminders.length - open > 0 ? `, ${reminders.length - open} done` : ''}.`}
        </p>
      </div>
      {reminders.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Nothing here yet. Add the first one above; it appears here when saved.
        </p>
      ) : (
        <ul className="space-y-2">
          {order.map((index) => (
            <ReminderItem
              key={reminders[index].id}
              reminder={reminders[index]}
              today={today}
              saving={saving}
              onToggleDone={(done) => onToggleDone(index, done)}
              onCancel={() => onCancel(index)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The card: form on top, list below, one stored document. Every action is
 * its own save of the whole list — append, flip done, remove — and `onSave`
 * resolves true when the server took it, which is when the form clears.
 */
export function RemindersCard({ value, onSave, saving, meta, today = todayIso() }) {
  const reminders = useMemo(() => value?.reminders ?? [], [value]);
  const saveList = (next) => onSave({ reminders: next });

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
          Central time. Notes and the link travel with the message, so write them for your phone. To
          change a reminder, cancel it and add it again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        <StoredState meta={meta} />
        <NewReminderForm saving={saving} onAdd={(reminder) => saveList([...reminders, reminder])} />
        <ReminderList
          reminders={reminders}
          today={today}
          saving={saving}
          onToggleDone={(index, done) =>
            saveList(reminders.map((row, i) => (i === index ? { ...row, done } : row)))
          }
          onCancel={(index) => saveList(reminders.filter((_row, i) => i !== index))}
        />
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
          <RemindersCard value={s.value} meta={s.meta} saving={s.saving} onSave={s.save} />
        )}
      />
    </div>
  );
}
