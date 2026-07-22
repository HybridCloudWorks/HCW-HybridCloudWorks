import React from 'react';
import { cn } from '@/lib/utils';

/**
 * StatBlock — glassy stat tile ("Global Reach 35+" style) from the Hyoga
 * design language. Number renders in the provider accent (text-primary);
 * the glass surface comes from the tokenized `.glass` base.
 *
 * @param {object} props
 * @param {React.ReactNode} props.value - The stat value (string, number, or AnimatedNumber).
 * @param {string} [props.suffix] - Optional suffix rendered after the value (e.g. "+", "%").
 * @param {string} props.label - Small uppercase label under the value.
 * @param {string} [props.className] - Extra classes.
 */
export default function StatBlock({ value, suffix, label, className = '' }) {
  return (
    <div className={cn('glass rounded-xl px-5 py-4 flex flex-col gap-1', className)}>
      <span className="text-2xl md:text-3xl font-light tracking-tight text-primary dark:text-(--slate-blue)">
        {value}
        {suffix && <span className="font-light">{suffix}</span>}
      </span>
      <span className="eyebrow-label text-slate-600 dark:text-slate-400">{label}</span>
    </div>
  );
}
