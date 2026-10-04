/**
 * The facts every lab states on its card and its page (ADR 0033 §4):
 * difficulty, how long it takes, the tools it exercises, and the provider
 * hubs it is listed under. Words, never colour alone; the provider chips
 * link to each hub's lab list so a lab shared by two hubs (the landing zone,
 * under Azure and Terraform) is reachable from either.
 */
import React from 'react';
import { Link } from 'react-router';
import { DIFFICULTY_LABELS, labsPath } from '@/data/labs/catalogue';
import { plural, providerName } from './labsWords';

const MUTED = 'text-slate-600 dark:text-slate-400';
const CHIP =
  'inline-flex items-center rounded-full border border-slate-300 dark:border-slate-600 px-2 py-px text-[11px] font-semibold text-slate-800 dark:text-slate-200';

/**
 * @param {object} props
 * @param {object} props.lab a catalogue row
 * @param {boolean} [props.showTools] the tools line, which the card prints
 *   and the page prints elsewhere
 */
export default function LabFacts({ lab, showTools = true }) {
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="lab-facts">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className="font-semibold text-slate-900 dark:text-slate-100"
          data-testid="lab-difficulty"
        >
          {DIFFICULTY_LABELS[lab.difficulty]}
        </span>
        <span aria-hidden="true" className={MUTED}>
          ·
        </span>
        <span className={MUTED} data-testid="lab-minutes">
          about {plural(lab.estimatedMinutes, 'minute')}
        </span>
        {showTools ? (
          <>
            <span aria-hidden="true" className={MUTED}>
              ·
            </span>
            <span className={`uppercase tracking-wider ${MUTED}`}>Tools</span>
            <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
              {lab.tools.join(', ')}
            </span>
          </>
        ) : null}
      </p>
      <ul className="flex flex-wrap gap-1.5 list-none p-0 m-0" aria-label="Listed under">
        {lab.providers.map((provider) => (
          <li key={provider}>
            <Link
              to={labsPath(provider)}
              aria-label={`${providerName(provider)} labs`}
              className={`${CHIP} hover:border-primary hover:text-primary`}
            >
              {providerName(provider)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
