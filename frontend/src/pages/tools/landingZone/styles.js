/**
 * Shared looks for the Landing Zone Builder (#668): the native-control classes
 * the pricing pages established, and one fill per diagram node kind so the
 * SVG, its legend and the teaches panel say "spoke" in the same blue.
 *
 * Tailwind classes rather than inline colours, so every fill has a dark
 * variant and the theming lint rule has nothing to object to. `fill-*` and
 * `stroke-*` are Tailwind utilities that apply to SVG the way `bg-*` applies
 * to boxes.
 */
export { NATIVE_INPUT_CLASS, NATIVE_SELECT_CLASS } from '../scenario/styles';

export const LABEL_CLASS = 'text-sm font-medium';
export const HINT_CLASS = 'text-[11px] text-slate-600 dark:text-slate-400';

/** Rect classes by diagram node kind (lib/landingZone/diagram.js). */
export const NODE_CLASS = Object.freeze({
  'management-group': 'fill-slate-100 stroke-slate-400 dark:fill-slate-800 dark:stroke-slate-500',
  policy: 'fill-amber-100 stroke-amber-500 dark:fill-amber-950 dark:stroke-amber-400',
  workspace: 'fill-emerald-100 stroke-emerald-500 dark:fill-emerald-950 dark:stroke-emerald-400',
  vnet: 'fill-sky-200 stroke-sky-600 dark:fill-sky-900 dark:stroke-sky-400',
  spoke: 'fill-sky-50 stroke-sky-400 dark:fill-sky-950 dark:stroke-sky-500',
  firewall: 'fill-rose-100 stroke-rose-500 dark:fill-rose-950 dark:stroke-rose-400',
  dns: 'fill-violet-100 stroke-violet-500 dark:fill-violet-950 dark:stroke-violet-400',
});

/** The same kinds as legend swatches (a box, not an SVG). */
export const SWATCH_CLASS = Object.freeze({
  'management-group': 'bg-slate-100 border-slate-400 dark:bg-slate-800 dark:border-slate-500',
  policy: 'bg-amber-100 border-amber-500 dark:bg-amber-950 dark:border-amber-400',
  workspace: 'bg-emerald-100 border-emerald-500 dark:bg-emerald-950 dark:border-emerald-400',
  vnet: 'bg-sky-200 border-sky-600 dark:bg-sky-900 dark:border-sky-400',
  spoke: 'bg-sky-50 border-sky-400 dark:bg-sky-950 dark:border-sky-500',
  firewall: 'bg-rose-100 border-rose-500 dark:bg-rose-950 dark:border-rose-400',
  dns: 'bg-violet-100 border-violet-500 dark:bg-violet-950 dark:border-violet-400',
});

/** What each kind is, for the legend under the diagram. */
export const KIND_LABEL = Object.freeze({
  'management-group': 'Management group',
  policy: 'Policy baseline',
  workspace: 'Log Analytics workspace',
  vnet: 'Hub virtual network',
  spoke: 'Spoke virtual network',
  firewall: 'Azure Firewall',
  dns: 'Private DNS zones',
});

export const KINDS = Object.freeze(Object.keys(KIND_LABEL));

export const NODE_TEXT_CLASS = 'fill-slate-900 dark:fill-white';
export const CONTAINS_EDGE_CLASS = 'stroke-slate-400 dark:stroke-slate-500';
export const PEERING_EDGE_CLASS = 'stroke-sky-500 dark:stroke-sky-400';
