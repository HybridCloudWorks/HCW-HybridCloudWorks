/**
 * Pure helpers for the cloud pricing comparison (#613, Phase 1) — shared by
 * the public page (pages/tools/ComparisonPage.jsx) and the Integrations Hub's
 * "Cloud pricing cache" card, so the two cannot describe the same cache in
 * different words.
 *
 * Everything here takes the `pricing` object `fetchCloudPricing` returns and
 * touches no network, no DOM and no clock — the age comes from the server's
 * `ageMinutes`, never from `Date.now()`, so a pre-rendered page and the
 * hydrating render cannot disagree about it.
 */

/** The region the API assumes when none is asked for; the page's default too. */
export const DEFAULT_PRICING_REGION = 'us-east-1';

/** Provider columns, in the order every comparison row shows them. */
export const PRICING_PROVIDERS = Object.freeze([
  { id: 'aws', label: 'AWS' },
  { id: 'azure', label: 'Azure' },
  { id: 'gcp', label: 'Google Cloud' },
]);

/**
 * A price to four significant figures with its currency: $0.192, $2.65,
 * $0.085, $6.874. Significant figures rather than decimals because the rows
 * span three orders of magnitude — two decimals would print storage as
 * "$0.02" and hide the difference the table exists to show.
 *
 * Fixed to en-US on purpose: the page pre-renders and hydrates, and a locale
 * that differs between the build runner and the visitor is a hydration
 * mismatch waiting to happen.
 *
 * @param {unknown} value
 * @param {string} [currency]
 * @returns {string|null} null when the value is not a finite number
 */
export function formatPrice(value, currency = 'USD') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currency || 'USD').toUpperCase(),
      minimumSignificantDigits: 1,
      maximumSignificantDigits: 4,
    }).format(amount);
  } catch {
    // An unknown currency code throws RangeError; the number is still worth
    // showing, so fall back to the code beside the figure.
    return `${amount.toPrecision(4).replace(/\.?0+$/, '')} ${currency}`;
  }
}

/**
 * `ageMinutes` as words: "12 minutes ago", "3 hours ago", "2 days ago".
 * Hours are rounded, not truncated, so 25 h 50 min reads as 26 hours rather
 * than 25 — the stale line under-reporting how late a refresh is would be the
 * wrong direction to err.
 *
 * @param {unknown} ageMinutes
 * @returns {string|null} null when the age is unknown
 */
export function describeAge(ageMinutes) {
  const minutes = Number(ageMinutes);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'} ago`;
  if (minutes < 60) return plural(Math.round(minutes), 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 48) return plural(hours, 'hour');
  return plural(Math.round(hours / 24), 'day');
}

/**
 * The `counts` object as one line: "22 live, 0 catalogue, 2 unavailable".
 * "catalogue" rather than "baseline" because that is the word the public
 * page's badge uses; an operator reading both should meet one vocabulary.
 */
export function describeCounts(counts) {
  const n = (key) => Math.max(0, Math.trunc(Number(counts?.[key])) || 0);
  return `${n('live')} live, ${n('baseline')} catalogue, ${n('unavailable')} unavailable`;
}

/**
 * The line under the page title that says how current the prices are.
 *
 * Three states, in the order the reader needs to know them: never refreshed
 * (the table is empty and no amount of waiting fills it), stale (the numbers
 * are real but the daily refresh has missed), fresh.
 *
 * `formatDate` is injected rather than called here because the local date
 * string is browser-only: the page renders this line only once data has
 * arrived, which never happens at pre-render, but the helper stays pure.
 *
 * @param {object|null} pricing
 * @param {(iso: string) => string} formatDate
 * @returns {{ tone: 'never'|'stale'|'fresh', text: string }}
 */
export function asOfLine(pricing, formatDate) {
  if (!pricing?.refreshedAt) {
    return { tone: 'never', text: 'Prices have not been refreshed yet.' };
  }
  const age = describeAge(pricing.ageMinutes);
  if (pricing.stale) {
    return {
      tone: 'stale',
      text: `Stale: last refreshed ${age ?? formatDate(pricing.refreshedAt)}.`,
    };
  }
  return {
    tone: 'fresh',
    text: `Prices as of ${formatDate(pricing.refreshedAt)}, refreshed daily.`,
  };
}

/**
 * The cheapest provider(s) on one service row — every provider whose price
 * equals the lowest priced row, live or catalogue. A row with no priced
 * provider has no cheapest. Ties keep both: highlighting one of two equal
 * prices would be claiming a difference that is not there.
 *
 * @param {Array<{provider: string, pricePerUnit: unknown}>} rows
 * @returns {Set<string>} provider ids
 */
export function cheapestProviders(rows) {
  const priced = (rows ?? [])
    .map((row) => ({ provider: row.provider, price: Number(row.pricePerUnit) }))
    .filter((row) => Number.isFinite(row.price) && row.price >= 0);
  if (priced.length === 0) return new Set();
  const lowest = Math.min(...priced.map((row) => row.price));
  return new Set(priced.filter((row) => row.price === lowest).map((row) => row.provider));
}

/**
 * The rows of one service keyed by provider, so a column can be rendered by
 * looking up its provider rather than searching the array. A provider absent
 * from the rows is "unavailable", and is absent from this map too.
 */
export function rowsByProvider(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    if (row?.provider && !map.has(row.provider)) map.set(row.provider, row);
  }
  return map;
}
