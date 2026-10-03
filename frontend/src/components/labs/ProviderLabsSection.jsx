/**
 * "Labs in your browser" on a provider's Learn page (ADR 0033 §8: labs
 * appear under each provider's Learn section). One line per lab the
 * catalogue lists under the provider — title, difficulty, duration, and the
 * link to the lab's own page under this hub — and a link to the hub's lab
 * list. Renders nothing for a provider with no labs, so a Learn page never
 * carries a heading over an empty list.
 */
import React from 'react';
import { Link } from 'react-router';
import { DIFFICULTY_LABELS, labPanePath, labsForProvider, labsPath } from '@/data/labs/catalogue';
import { plural, providerName } from './labsWords';

const MUTED = 'text-slate-600 dark:text-slate-400';

export default function ProviderLabsSection({ provider, className = '' }) {
  const labs = labsForProvider(provider);
  if (labs.length === 0) return null;
  return (
    <section
      aria-labelledby="provider-labs-heading"
      data-testid="provider-labs"
      className={className}
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
        <div>
          <h2
            id="provider-labs-heading"
            className="text-2xl font-bold text-slate-950 dark:text-white flex items-center gap-2"
          >
            <span className="text-primary text-[24px] material-symbols-outlined" aria-hidden="true">
              science
            </span>
            Labs in your browser
          </h2>
          <p className={`text-sm ${MUTED} mt-1 max-w-2xl`}>
            Hands-on {providerName(provider)} exercises on this site: each opens VS Code in your
            browser with the tools installed, with objectives, steps and a check the lab runner can
            perform. No subscription needed.
          </p>
        </div>
        <Link
          to={labsPath(provider)}
          className="text-sm font-semibold text-slate-900 dark:text-slate-100 underline underline-offset-4 hover:text-primary whitespace-nowrap"
        >
          All {providerName(provider)} labs
        </Link>
      </div>
      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0 m-0">
        {labs.map((lab) => (
          <li key={lab.id} data-lab={lab.id}>
            <Link
              to={labPanePath(provider, lab.id)}
              className="group glass glass-hover rounded-xl p-5 flex flex-col gap-2 h-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="text-base font-bold text-slate-950 dark:text-white group-hover:text-primary transition-colors">
                {lab.title}
              </span>
              <span className={`text-xs ${MUTED}`}>
                {DIFFICULTY_LABELS[lab.difficulty]} · about {plural(lab.estimatedMinutes, 'minute')}{' '}
                · {plural(lab.steps.length, 'step')}
              </span>
              <span className="text-sm text-slate-700 dark:text-slate-300 line-clamp-3">
                {lab.summary}
              </span>
              <span className="mt-auto pt-2 text-sm font-semibold text-primary">Open lab</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
