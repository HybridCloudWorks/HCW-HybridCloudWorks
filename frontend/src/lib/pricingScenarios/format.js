/**
 * Fixed en-US formatting for the scenario card (#613, Phase 2) — fixed for
 * the same hydration reason `formatPrice` in lib/cloudPricing.js gives: a
 * locale that differs between the build runner and the visitor is a mismatch
 * waiting to happen.
 */

export const fmtInt = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);

export const pct = (factor) => `${Math.round(factor * 100)}%`;

const numberOrNaN = (value) => (value === null || value === '' ? NaN : Number(value));

/**
 * A monthly or yearly cost: "$1,234.56", "−$120.00" for a discount. Two
 * decimals rather than `formatPrice`'s four significant figures, because a
 * total is money owed, not a rate.
 */
export function formatCost(value, currency = 'USD') {
  const amount = numberOrNaN(value);
  if (!Number.isFinite(amount)) return null;
  const abs = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  return amount < 0 ? `−${abs}` : abs;
}

/** "+12%" for a provider's distance from the cheapest; "" for the cheapest. */
export function formatDelta(delta) {
  if (!Number.isFinite(delta) || delta <= 0) return '';
  return `+${Math.round(delta * 100)}%`;
}

/** An assumption's value in the format its row declares. */
export function formatAssumption(value, format) {
  if (!Number.isFinite(Number(value))) return '—';
  if (format === 'percent') return pct(Number(value));
  if (format === 'factor') return `×${Number(value)}`;
  return fmtInt(Number(value));
}

/** A quantity for a label: "1,460", "0.5". */
export function formatQuantity(value) {
  const n = numberOrNaN(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}
