/**
 * The Learn pages' section heading: an `<h2>` with the primary-colour bar the
 * `/education` index introduced. Extracted for `/education/labs` (#681) so a
 * page adding a section writes one line rather than repeating the markup.
 */
import React from 'react';
import { cn } from '@/lib/utils';

export default function SectionHeading({ id, className = 'mb-6', children }) {
  return (
    <h2
      id={id}
      className={cn(
        'text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2',
        className
      )}
    >
      <span className="w-1 h-6 bg-primary rounded-full" aria-hidden="true"></span>
      {children}
    </h2>
  );
}
