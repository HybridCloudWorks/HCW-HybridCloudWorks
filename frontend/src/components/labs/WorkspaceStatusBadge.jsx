/**
 * The one-word state of the lab workspaces on the public pages, from the
 * same read the Coder status card uses (`GET public/labs/coder-status`,
 * #680), in the shared status vocabulary (lib/status.js, ADR 0033 §2):
 *
 *   healthy      configured, reachable, and the detail (running count) read
 *   degraded     reachable, but the detail could not be read
 *   offline      not configured, not reachable, the route missing, or the
 *                read failed: to a visitor, all four mean the workspaces
 *                cannot be opened, and which one is not theirs to know
 *                (it was `unavailable` until 2026-10-08)
 *   unknown      nothing has arrived yet
 *
 * A badge, not a card: the pane page and the provider lists want the word
 * beside the heading, and the card with the templates and capacity stays on
 * the cross-provider index. Colour plus the word, so the state reads without
 * colour; the title carries the vocabulary's help sentence.
 */
import React from 'react';
import { toSystemStatus } from '@/lib/status';

/**
 * The vocabulary word for a status read. `status` is `undefined` while
 * nothing has arrived, `null` when the route answered 404, otherwise the
 * body (LabsLearnPage's `settle`).
 */
export function workspaceStatusWord({ status, loading, error }) {
  if (error) return 'offline';
  if (status === undefined) return loading ? 'unknown' : 'offline';
  if (status === null || status.configured !== true || status.reachable !== true) {
    return 'offline';
  }
  return typeof status.capacity?.running === 'number' ? 'healthy' : 'degraded';
}

const TONE_CLASSES = {
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  bad: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  // Offline (lib/status.js `down`): the shared StatusBadge's dark chip.
  down: 'border-zinc-600 bg-zinc-700 text-zinc-50 dark:border-zinc-300 dark:bg-zinc-200 dark:text-zinc-900',
  muted:
    'border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
};

/**
 * @param {object} props
 * @param {object|null|undefined} props.status the status read's body
 * @param {boolean} props.loading
 * @param {Error|null} props.error
 */
export default function WorkspaceStatusBadge({ status, loading, error }) {
  const info = toSystemStatus(workspaceStatusWord({ status, loading, error }));
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
      data-testid="workspace-status"
      data-status={info.id}
      title={info.help}
    >
      <span className="text-slate-600 dark:text-slate-400 font-normal">Workspaces</span>
      <span
        className={`rounded-full border px-2 py-px ${TONE_CLASSES[info.tone] || TONE_CLASSES.muted}`}
      >
        {info.label}
      </span>
    </span>
  );
}
