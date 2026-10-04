/**
 * A headed section on the labs pages (#681). It started as a placeholder
 * that printed "Coming soon." while #676 and #677 were built; both have
 * landed (the agent recipe on /docker/sandboxes, the article list from the
 * catalogue's `articleSlugs`, ADR 0033 "Labs"), so a slot now renders only
 * what it is given and nothing when given nothing, rather than a heading
 * over a promise. The `<id>-heading` id is kept because links to
 * `/education/labs#agent-heading` were written against it.
 */
import React from 'react';
import SectionHeading from '@/components/education/SectionHeading';

export default function LabsSlot({ id, title, children }) {
  if (children === null || children === undefined || children === false) return null;
  return (
    <section aria-labelledby={`${id}-heading`} data-testid={`labs-slot-${id}`}>
      <SectionHeading id={`${id}-heading`} className="mb-3">
        {title}
      </SectionHeading>
      {children}
    </section>
  );
}
