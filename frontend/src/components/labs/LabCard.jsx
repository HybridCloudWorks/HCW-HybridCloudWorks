/**
 * One lab from the catalogue (#681): what it is, what it exercises, how long
 * it takes, and the two ways to run it.
 *
 * "Open in Coder" is a plain external link to the workspace deep link: Coder
 * shows its consent screen after GitHub sign-in, then creates the workspace
 * with `param.lab` set. Through `safeUrl` like every other data-fed `href` in
 * this app, even though the origin is a constant — the sink is guarded on its
 * own terms (see lib/safeUrl.js).
 *
 * "Run it locally" is the same image on the learner's own machine, mounting
 * the current directory. Two lines, PowerShell then bash, each labelled with
 * its shell, because the quoting is the only difference and it is the one
 * that bites when pasted at the wrong prompt. The lines hold commands only —
 * explanation lives in the prose above them.
 */
import React from 'react';
import { RUN_LOCALLY_COMMANDS, coderWorkspaceUrl } from '@/data/labs/catalogue';
import { safeUrl } from '@/lib/safeUrl';
import { plural } from './labsWords';

const MUTED = 'text-slate-600 dark:text-slate-400';

function CommandLine({ shell, command }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-[10px] uppercase tracking-wider ${MUTED}`}>{shell}</span>
      <pre className="overflow-x-auto rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-950 text-slate-100 px-3 py-2 text-xs">
        <code data-shell={shell}>{command}</code>
      </pre>
    </div>
  );
}

export default function LabCard({ lab }) {
  const href = safeUrl(coderWorkspaceUrl(lab));
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

      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="open-in-coder"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary self-start"
        >
          Open in Coder
          <span className="sr-only">
            {' '}
            (opens {lab.title} in a new tab; GitHub sign-in required)
          </span>
        </a>
      ) : null}

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
