/**
 * Literal Tailwind class strings, looked up by colour token.
 *
 * The three bespoke architecture galleries this replaced built theirs as
 * `bg-${blueprint.categoryColor}-500/10`. Tailwind's scanner only sees literal
 * class names in source, so every one of those badges rendered unstyled in
 * production and no unit test could catch it — the same failure the education
 * extraction hit in §3.1. Anything colour-driven by data must land here.
 */
const COLOR_CLASSES = {
  blue: { badge: 'bg-blue-500/10 border-blue-500/20 text-blue-400', text: 'text-blue-400' },
  green: { badge: 'bg-green-500/10 border-green-500/20 text-green-400', text: 'text-green-400' },
  emerald: {
    badge: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    text: 'text-emerald-400',
  },
  orange: {
    badge: 'bg-orange-500/10 border-orange-500/20 text-orange-400',
    text: 'text-orange-400',
  },
  purple: {
    badge: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
    text: 'text-purple-400',
  },
  red: { badge: 'bg-red-500/10 border-red-500/20 text-red-400', text: 'text-red-400' },
  yellow: {
    badge: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
    text: 'text-yellow-400',
  },
  pink: { badge: 'bg-pink-500/10 border-pink-500/20 text-pink-400', text: 'text-pink-400' },
  slate: { badge: 'bg-slate-500/10 border-slate-500/20 text-slate-400', text: 'text-slate-400' },
};

/**
 * Accepts both the bare tokens the static blueprints use (`blue`) and the full
 * utility classes some Firestore documents carry (`text-emerald-400`), so a
 * document authored either way still gets a real class.
 */
export function colorClasses(value) {
  const raw = String(value || '').toLowerCase();
  const key = Object.keys(COLOR_CLASSES).find((name) => raw.includes(name)) || 'slate';
  return COLOR_CLASSES[key];
}

export const __testables = { COLOR_CLASSES };

export default colorClasses;
