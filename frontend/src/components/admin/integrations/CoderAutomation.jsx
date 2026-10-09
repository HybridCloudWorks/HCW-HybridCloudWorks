/**
 * "Automatic renewal" under Coder on the Hybrid Lab card (2026-10-08): what
 * the lab host last reported about renewing the status token and publishing
 * the template. The sentences and the status are coderAutomationView.js's;
 * this only loads the report and lays it out.
 *
 * Loads itself, like SessionizeSetting: once auth is ready, one GET of
 * `cms/labs/coder-automation`, behind a generation guard so an answer that
 * lands after unmount sets nothing. A failed read says so in muted text and
 * leaves the rest of the card alone; it is a read of a report, not a verdict
 * on Coder, which the card's Test gives.
 *
 * Colour is never the only signal: the status is a StatusBadge (word, icon
 * and colour), and each problem line carries its own icon.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';
import { getJSON } from '@/lib/api';
import { useAuthReady } from '@/hooks/useAuthReady';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { CODER_AUTOMATION_ROUTE, describeCoderAutomation } from './coderAutomationView';

/** The report, loaded once auth is ready. */
export function useCoderAutomation() {
  const { authReady } = useAuthReady();
  const [state, setState] = useState({ loading: true, read: null, error: null });
  const generation = useRef(0);

  useEffect(() => {
    if (!authReady) return undefined;
    const mine = ++generation.current;
    getJSON(CODER_AUTOMATION_ROUTE)
      .then((read) => {
        if (mine === generation.current) setState({ loading: false, read, error: null });
      })
      .catch((err) => {
        if (mine === generation.current) {
          setState({ loading: false, read: null, error: err?.message || 'The read failed.' });
        }
      });
    return () => {
      generation.current += 1;
    };
  }, [authReady]);

  return state;
}

const PROBLEM_TONES = {
  critical: { className: 'text-destructive', Icon: XCircle },
  degraded: { className: 'text-amber-700 dark:text-amber-400', Icon: AlertTriangle },
};

function Problem({ problem }) {
  const tone = PROBLEM_TONES[problem.status] ?? PROBLEM_TONES.degraded;
  const { Icon } = tone;
  return (
    <p
      className={`mt-1 flex items-start gap-1.5 ${tone.className}`}
      data-testid="coder-automation-problem"
      data-status={problem.status}
    >
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 wrap-break-word">{problem.text}</span>
    </p>
  );
}

export default function CoderAutomation() {
  const { loading, read, error } = useCoderAutomation();
  const view = describeCoderAutomation(read);

  return (
    <div className="border-t border-border/60 py-2" data-testid="coder-automation">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Automatic renewal</span>
        {view.status ? <StatusBadge system={view.status} size="xs" /> : null}
      </div>
      {loading ? (
        <p className="mt-1 text-muted-foreground">Reading what the lab host last reported…</p>
      ) : null}
      {!loading && error ? (
        <p className="mt-1 text-muted-foreground">
          What the lab host last reported could not be read: {error}
        </p>
      ) : null}
      {!loading && !error && !view.setUp ? (
        <p className="mt-1 text-muted-foreground">{view.note}</p>
      ) : null}
      {view.setUp ? (
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {view.rows.map((row) => (
            <li key={row.id} data-row={row.id}>
              {row.text}
            </li>
          ))}
        </ul>
      ) : null}
      {view.problems.map((problem) => (
        <Problem key={problem.text} problem={problem} />
      ))}
    </div>
  );
}
