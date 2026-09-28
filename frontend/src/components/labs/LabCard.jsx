/**
 * One lab from the catalogue (#681): what it is, what it exercises, how long
 * it takes, and the two ways to run it.
 *
 * "Open lab workspace" goes to the lab's own page on the site,
 * `/education/labs/<id>`, which opens the workspace in a pane (#751). It is
 * an in-site link, not a link to the workspace host: since #750 that host
 * sends a top-level visit straight back to `/education/labs`, so the pane is
 * the only way in (owner decision 2026-09-28).
 *
 * "Run it locally" is the same image on the learner's own machine, mounting
 * the current directory. Two lines, PowerShell then bash, each labelled with
 * its shell, because the quoting is the only difference and it is the one
 * that bites when pasted at the wrong prompt. The lines hold commands only —
 * explanation lives in the prose above them. `CommandLine` is shared with the
 * agent section (#676), which prints the same shape.
 */
import React from 'react';
import { Link } from 'react-router';
import { RUN_LOCALLY_COMMANDS, labPanePath } from '@/data/labs/catalogue';
import CommandLine from './CommandLine';
import { plural } from './labsWords';

const MUTED = 'text-slate-600 dark:text-slate-400';

export default function LabCard({ lab }) {
  return (
    <li
      data-lab={lab.id}
      className="glass glass-hover rounded-xl p-5 flex flex-col gap-3"
      aria-labelledby={`lab-${lab.id}-title`}
    >
      <h3 id={`lab-${lab.id}-title`} className="text-base font-bold text-slate-950 dark:text-white">
        {lab.title}
      </h3>
      <p className="text-sm text-slate-700 dark:text-slate-300">{lab.summary}</p>

      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <span className={`uppercase tracking-wider ${MUTED}`}>Tools</span>
        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
          {lab.tools.join(', ')}
        </span>
        <span aria-hidden="true" className={MUTED}>
          ·
        </span>
        <span className={MUTED} data-testid="lab-minutes">
          about {plural(lab.estimatedMinutes, 'minute')}
        </span>
      </p>

      <Link
        to={labPanePath(lab.id)}
        data-testid="open-lab-workspace"
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary self-start"
      >
        Open lab workspace <span className="sr-only">for {lab.title}; GitHub sign-in required</span>
      </Link>

      <details className="mt-auto">
        <summary
          className={`cursor-pointer text-sm font-semibold ${MUTED} hover:text-slate-950 dark:hover:text-white`}
        >
          Run it locally
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <p className={`text-xs ${MUTED}`}>
            Change into the folder that holds your files first; the container mounts it at
            /workspace. Pick the line for the shell you are in.
          </p>
          {RUN_LOCALLY_COMMANDS.map((entry) => (
            <CommandLine key={entry.shell} shell={entry.shell} command={entry.command} />
          ))}
        </div>
      </details>
    </li>
  );
}
