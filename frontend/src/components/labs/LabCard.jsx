/**
 * One lab from the catalogue (#681, ADR 0033 §4): what it is, how hard it
 * is, how long it takes, what it exercises, which provider hubs list it,
 * and the two ways to run it.
 *
 * "Open lab" goes to the lab's own page on the site under the provider
 * whose list is showing it (`/<provider>/education/labs/<id>`), or under
 * the lab's home provider from the cross-provider index, which opens the
 * workspace in a pane (#751). It is an in-site link, not a link to the
 * workspace host: since #750 that host sends a top-level visit straight back
 * to `/education/labs`, so the pane is the only way in (owner decision
 * 2026-09-28).
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
import { RUN_LOCALLY_COMMANDS, labPanePath, primaryProvider } from '@/data/labs/catalogue';
import CommandLine from './CommandLine';
import LabFacts from './LabFacts';

const MUTED = 'text-slate-600 dark:text-slate-400';

/**
 * @param {object} props
 * @param {object} props.lab a catalogue row
 * @param {string|null} [props.provider] the hub whose list shows the card;
 *   the lab's home provider when the card is on the cross-provider index
 * @param {'h3'|'h4'} [props.headingLevel] h4 inside the index's provider
 *   groups, which are headed by an h3; h3 on a provider's own list
 */
export default function LabCard({ lab, provider = null, headingLevel = 'h3' }) {
  const paneProvider = provider ?? primaryProvider(lab);
  const Heading = headingLevel;
  // Keyed by the hub too, so two lists on one page never share a heading id.
  const titleId = `lab-${paneProvider}-${lab.id}-title`;
  return (
    <li
      data-lab={lab.id}
      className="glass glass-hover rounded-xl p-5 flex flex-col gap-3"
      aria-labelledby={titleId}
    >
      <Heading id={titleId} className="text-base font-bold text-slate-950 dark:text-white">
        {lab.title}
      </Heading>
      <p className="text-sm text-slate-700 dark:text-slate-300">{lab.summary}</p>

      <LabFacts lab={lab} />

      <Link
        to={labPanePath(paneProvider, lab.id)}
        data-testid="open-lab-workspace"
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary self-start"
      >
        Open lab{' '}
        <span className="sr-only">
          {lab.title}: steps, and the workspace; GitHub sign-in required for the workspace
        </span>
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
