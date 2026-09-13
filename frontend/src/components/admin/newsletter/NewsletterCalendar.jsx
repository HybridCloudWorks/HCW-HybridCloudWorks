/**
 * NewsletterCalendar — the Published tab of the Mailing List page (#504).
 *
 * Scheduled and sent issues on a month calendar, so how often and when the
 * newsletter went out reads at a glance (the owner's layout of 2026-09-13).
 * A day with issues is a button; choosing it lists that day's issues, and
 * choosing one shows the email as it was sent.
 *
 * Days are the viewer's LOCAL dates. The API pads its month window a day each
 * side for exactly this, and anything outside the month on screen is dropped.
 * The preview iframe has an EMPTY sandbox, as on the review panel.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { getJSON } from '@/lib/api';
import { formatWhen } from './NewsletterIssues';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n) => String(n).padStart(2, '0');

/** `YYYY-MM` for the API, from a local year and zero-based month. */
export const monthKey = (year, month) => `${year}-${pad(month + 1)}`;

/** `YYYY-MM-DD` of an instant in the viewer's time zone. */
export function localDayKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** When an issue went (or goes) out: sentAt for sent, scheduledAt for scheduled. */
const publishedAt = (row) => (row.status === 'sent' ? row.sentAt : row.scheduledAt);

/** Issues grouped by local day, only for days inside the month on screen. */
export function groupByDay(issues, year, month) {
  const prefix = `${monthKey(year, month)}-`;
  const days = new Map();
  for (const row of issues) {
    const key = localDayKey(publishedAt(row));
    if (!key || !key.startsWith(prefix)) continue;
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(row);
  }
  for (const list of days.values()) {
    list.sort((a, b) => String(publishedAt(a)).localeCompare(String(publishedAt(b))));
  }
  return days;
}

export default function NewsletterCalendar({ today = new Date() }) {
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async ({ year, month }) => {
    setLoading(true);
    setError('');
    try {
      const res = await getJSON(`cms/newsletters?month=${monthKey(year, month)}`);
      setIssues(res.issues || []);
    } catch (err) {
      setIssues([]);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      load(cursor);
    });
  }, [cursor, load]);

  useEffect(() => {
    if (!selectedId) return;
    queueMicrotask(() => {
      getJSON(`cms/newsletters/${selectedId}`)
        .then(setDetail)
        .catch((err) => setError(err.message));
    });
  }, [selectedId]);

  const days = useMemo(
    () => groupByDay(issues, cursor.year, cursor.month),
    [issues, cursor.year, cursor.month]
  );
  const counts = useMemo(() => {
    let sent = 0;
    let scheduled = 0;
    for (const list of days.values()) {
      for (const row of list) {
        if (row.status === 'sent') sent += 1;
        else scheduled += 1;
      }
    }
    return { sent, scheduled };
  }, [days]);

  const move = (delta) => {
    setSelectedDay(null);
    setSelectedId(null);
    setDetail(null);
    setCursor(({ year, month }) => {
      const next = new Date(year, month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  const chooseDay = (key) => {
    setSelectedDay(key);
    const list = days.get(key) || [];
    setDetail(null);
    setSelectedId(list.length === 1 ? list[0].id : null);
  };

  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(cursor.year, cursor.month, 1)
  );
  const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay();
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const todayKey = localDayKey(today.toISOString());
  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const dayIssues = selectedDay ? days.get(selectedDay) || [] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Published</h3>
          <p className="text-xs text-muted-foreground">
            {counts.sent} sent, {counts.scheduled} scheduled in {monthLabel}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => move(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-medium" aria-live="polite">
            {monthLabel}
          </span>
          <Button variant="ghost" size="sm" onClick={() => move(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <div className="grid min-w-[20rem] grid-cols-7 gap-1 text-sm" aria-busy={loading}>
          {WEEKDAYS.map((day) => (
            <div key={day} className="py-1 text-center text-xs font-medium text-muted-foreground">
              {day}
            </div>
          ))}
          {cells.map((day, index) => {
            if (day === null) return <div key={`blank-${index}`} />;
            const key = `${monthKey(cursor.year, cursor.month)}-${pad(day)}`;
            const list = days.get(key) || [];
            const sent = list.filter((row) => row.status === 'sent').length;
            const scheduled = list.length - sent;
            const dateLabel = new Intl.DateTimeFormat('en-US', {
              month: 'long',
              day: 'numeric',
            }).format(new Date(cursor.year, cursor.month, day));
            const base = `flex h-14 flex-col items-start rounded-md border p-1 text-left ${
              key === selectedDay ? 'border-primary' : 'border-border'
            } ${key === todayKey ? 'bg-muted' : ''}`;
            if (!list.length) {
              return (
                <div key={key} className={`${base} text-muted-foreground`}>
                  {day}
                </div>
              );
            }
            return (
              <button
                key={key}
                type="button"
                onClick={() => chooseDay(key)}
                aria-pressed={key === selectedDay}
                aria-label={`${dateLabel}: ${sent} sent, ${scheduled} scheduled`}
                className={`${base} hover:border-primary`}
              >
                <span className="font-medium">{day}</span>
                <span className="mt-auto flex gap-1">
                  {sent > 0 && (
                    <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] text-white">
                      {sent}
                    </span>
                  )}
                  {scheduled > 0 && (
                    <span className="rounded-full border border-violet-500 px-1.5 text-[10px] text-violet-600">
                      {scheduled}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600" /> Sent
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-violet-500" />{' '}
          Scheduled
        </span>
      </p>

      {!loading && !error && days.size === 0 && (
        <p className="text-sm text-muted-foreground">Nothing was published in {monthLabel}.</p>
      )}

      {selectedDay && dayIssues.length > 1 && (
        <ul className="flex flex-wrap gap-2" aria-label="Issues on this day">
          {dayIssues.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setSelectedId(row.id)}
                aria-pressed={row.id === selectedId}
                className={`rounded-lg border px-3 py-2 text-left text-sm ${row.id === selectedId ? 'border-primary' : 'border-border'}`}
              >
                <span className="block font-medium">{row.subject || row.id}</span>
                <span className="text-xs text-muted-foreground">
                  {formatWhen(publishedAt(row))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedId && !detail && !error && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the newsletter…
        </p>
      )}

      {detail?.issue && detail.issue.id === selectedId && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge>{detail.issue.status === 'sent' ? 'Sent' : 'Scheduled'}</Badge>
            <span className="font-medium">{detail.issue.subject}</span>
            <span className="text-muted-foreground">
              {detail.issue.status === 'sent'
                ? `Sent ${formatWhen(detail.issue.sentAt)}`
                : `Sends ${formatWhen(detail.issue.scheduledAt)}`}
            </span>
          </div>
          <iframe
            title="Published newsletter"
            sandbox=""
            srcDoc={detail.preview.html}
            className="w-full rounded-lg border bg-white"
            style={{ height: 720 }}
          />
        </Card>
      )}
    </div>
  );
}
