import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Eyebrow — small uppercase label used above display headlines and
 * section titles (Hyoga design language). The accent dot/text pick up
 * the active provider theme via --slate-blue / text-primary tokens.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Label text (rendered uppercase).
 * @param {boolean} [props.dot=true] - Show the small accent dot before the label.
 * @param {string} [props.className] - Extra classes.
 */
export default function Eyebrow({ children, dot = true, className = '' }) {
  return (
    <p
      className={cn(
        'eyebrow-label flex items-center gap-2 text-slate-600 dark:text-slate-400',
        className
      )}
    >
      {dot && (
        <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
      )}
      {children}
    </p>
  );
}
