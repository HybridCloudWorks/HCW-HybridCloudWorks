/**
 * Shared looks for the scenario card (#613, Phase 2): the native-control class
 * Phase 1's region select established, and one colour per bar segment so the
 * bars, the legend and the breakdown table say "backup" in the same blue.
 *
 * Tailwind classes rather than inline colours, so each segment has a dark
 * variant and the theming lint rule has nothing to object to. The DR levels
 * share a hue at three depths — they are one choice at three sizes.
 */

/** Native <select>, styled like components/ui/select.jsx's trigger. */
export const NATIVE_SELECT_CLASS =
  'h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const NATIVE_INPUT_CLASS =
  'h-9 w-28 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2';

/** The base bill, and the fill for each extra's segment. */
export const SEGMENT_CLASS = Object.freeze({
  base: 'bg-slate-500 dark:bg-slate-400',
  backup: 'bg-sky-500 dark:bg-sky-400',
  'dr-pilot-light': 'bg-violet-400 dark:bg-violet-300',
  'dr-warm-standby': 'bg-violet-500 dark:bg-violet-400',
  'dr-active-active': 'bg-violet-700 dark:bg-violet-500',
  'zone-redundancy': 'bg-amber-500 dark:bg-amber-400',
});

/**
 * A commitment is money taken off, so it is drawn as an outline at the end of
 * the bar rather than a fill: the dashed box is the part of the gross bill
 * that the discount removes.
 */
export const REDUCTION_CLASS =
  'border-2 border-dashed border-emerald-600 bg-emerald-100/40 dark:border-emerald-400 dark:bg-emerald-900/30';

export function segmentClass(extraId) {
  return SEGMENT_CLASS[extraId] ?? REDUCTION_CLASS;
}
