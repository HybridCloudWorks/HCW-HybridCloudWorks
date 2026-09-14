/**
 * The Published header's month figures (#504): delivered, and the open rate
 * over the month, from `GET cms/mailing-list/metrics` with the month's local
 * bounds (the API's default `dimensions=period`).
 *
 * Decoration, not content: it loads after the calendar, never blocks it, and
 * a failure leaves nothing behind rather than an error beside the counts.
 * Asked for only when the month has a sent issue, since a month with none has
 * no newsletter numbers to show. Resend's metrics cover every email the
 * account sent in the window, signup confirmations included, and the title
 * says so.
 */
import React, { useEffect, useState } from 'react';
import { getJSON } from '@/lib/api';
import { formatCount, formatRate } from './resendFormat';

/** The metrics route for a local month, its end clamped to now; null for a month not yet begun. */
export function monthMetricsRoute(year, month, now = new Date()) {
  const start = new Date(year, month, 1);
  if (start.getTime() > now.getTime()) return null;
  const monthEnd = new Date(year, month + 1, 1);
  const end = monthEnd.getTime() > now.getTime() ? now : monthEnd;
  const params = new URLSearchParams({
    start_date: start.toISOString(),
    end_date: end.toISOString(),
    granularity: 'monthly',
  });
  return `cms/mailing-list/metrics?${params.toString()}`;
}

export default function MonthMetricsSummary({ year, month, today, enabled }) {
  // "Now" is fixed when the calendar mounts. A fresh Date each render would
  // change the route every render and refetch without end.
  const [now] = useState(() => today ?? new Date());
  const [loaded, setLoaded] = useState({ route: null, totals: null });
  const route = enabled ? monthMetricsRoute(year, month, now) : null;
  // Totals for another month (or none) are never shown under this one.
  const totals = loaded.route === route ? loaded.totals : null;

  useEffect(() => {
    if (!route) return;
    let current = true;
    getJSON(route)
      .then((res) => {
        if (current && res?.totals) setLoaded({ route, totals: res.totals });
      })
      .catch(() => {
        // Omitted on failure: the calendar is the content, these figures are not.
      });
    return () => {
      current = false;
    };
  }, [route]);

  if (!totals || !Number.isFinite(totals.delivered)) return null;
  const rate = formatRate(totals.unique_opened, totals.delivered, totals.open_rate);
  return (
    <p
      className="text-xs text-muted-foreground"
      title="From Resend, across every email the account sent this month"
      data-testid="month-metrics"
    >
      {formatCount(totals.delivered)} delivered{rate ? `, ${rate} average open rate` : ''}
    </p>
  );
}
