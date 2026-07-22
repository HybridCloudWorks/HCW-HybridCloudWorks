import React from 'react';
import { cn } from '@/lib/utils';
import Eyebrow from '@/components/shared/Eyebrow';

/**
 * NumberedSection — section wrapper with a Hyoga-style numbered marker
 * ("01", "02", ...), an uppercase eyebrow label, and a section title.
 *
 * @param {object} props
 * @param {string|number} props.number - Section number; rendered zero-padded (1 -> "01").
 * @param {string} [props.eyebrow] - Optional uppercase eyebrow label.
 * @param {React.ReactNode} [props.title] - Section heading content.
 * @param {React.ReactNode} [props.actions] - Optional right-aligned actions (links/buttons).
 * @param {React.ReactNode} props.children - Section body.
 * @param {string} [props.className] - Extra classes for the <section>.
 * @param {string} [props.id] - Optional anchor id.
 */
export default function NumberedSection({
  number,
  eyebrow,
  title,
  actions,
  children,
  className = '',
  id,
}) {
  const padded = String(number).padStart(2, '0');
  return (
    <section id={id} className={cn('relative', className)}>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div className="flex items-start gap-5">
          <span
            aria-hidden="true"
            className="section-number text-3xl md:text-4xl text-slate-500 dark:text-slate-400 leading-none pt-1 select-none"
          >
            {padded}
          </span>
          <div>
            {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
            {title && (
              <h2 className="display-heading text-2xl md:text-3xl text-slate-900 dark:text-white">
                {title}
              </h2>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
