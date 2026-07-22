import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Normalize an arbitrary key to our canonical camelCase with special-casing for "Url"
export function canonicalKey(key) {
  if (!key) return '';
  const s = String(key);
  // Insert spaces before capitals (handle PascalCase and acronyms)
  const spaced = s
    .replace(/[_\-\.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, '$1 $2');

  const parts = spaced
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase());

  if (parts.length === 0) return '';
  const [first, ...restParts] = parts;
  const rest = restParts.map((tok) => {
    // Special-case URL -> Url on subsequent words
    const word = tok === 'url' ? 'Url' : tok.charAt(0).toUpperCase() + tok.slice(1);
    return word;
  });
  return [first, ...rest].join('');
}

// Produce a shallow object with canonical keys
export function normalizeObjectKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const ck = canonicalKey(k);
    if (!(ck in out)) out[ck] = v;
  }
  return out;
}
