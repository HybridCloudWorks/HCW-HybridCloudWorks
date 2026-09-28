/**
 * A section on `/education/labs` that a later pull request fills (#681).
 *
 * The page's layout is fixed now so the PRs that add content — the agent
 * section (#676) and the article list (#677) — change what is inside a
 * section rather than where sections sit. Until then a slot renders its
 * heading and "Coming soon.", and nothing that could be read as content
 * that exists. Not the issue that builds it: that is the team's to-do, not
 * the visitor's (owner direction 2026-09-28).
 */
import React from 'react';
import SectionHeading from '@/components/education/SectionHeading';

export default function LabsSlot({ id, title, children }) {
  return (
    <section aria-labelledby={`${id}-heading`} data-testid={`labs-slot-${id}`}>
      <SectionHeading id={`${id}-heading`} className="mb-3">
        {title}
      </SectionHeading>
      {children ?? <p className="text-sm text-slate-600 dark:text-slate-400">Coming soon.</p>}
    </section>
  );
}
