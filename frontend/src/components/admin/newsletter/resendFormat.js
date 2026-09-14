/**
 * Shared by the Audience tab and the metrics on Published (#504): what a
 * failed Newsletter Hub call says, and how Resend's numbers are shown.
 *
 * The routes behind these (functions/src/lib/newsletter/insights-handlers.js)
 * answer 503 when RESEND_API_KEY is not set, 429 with `retryAfterSeconds` when
 * Resend is rate limiting, and 502 with Resend's own reason for any other
 * refusal. `lib/api.js` puts the status, the wait and the reason on the thrown
 * error, so only the message needs choosing here.
 */

/** A sentence for a failed call: the wait on a 429, the setup on a 503, else the server's reason. */
export function describeResendError(err) {
  if (err?.status === 503) {
    return 'Resend is not configured: the RESEND_API_KEY secret is not set on the API.';
  }
  if (err?.status === 429) {
    const seconds = Number.isFinite(err.retryAfterSeconds) ? err.retryAfterSeconds : 1;
    return `Resend is rate limiting requests. Wait ${seconds} second${seconds === 1 ? '' : 's'}, then try again.`;
  }
  return err?.message || 'The Newsletter Hub request failed.';
}

const numberFormat = new Intl.NumberFormat('en-US');

/** A count, or an em dash when Resend did not send one. */
export function formatCount(value) {
  return Number.isFinite(value) ? numberFormat.format(value) : '—';
}

/**
 * A percentage for `part` of `base`, e.g. unique opens of delivered.
 *
 * Worked from the counts when both are there, because Resend's documentation
 * does not say whether its `*_rate` fields are fractions or percentages. The
 * rate field is the fallback, read as a fraction when it is at most 1 (the
 * API's own test fixture sends `open_rate: 0.5`).
 */
export function formatRate(part, base, rate) {
  let value = null;
  if (Number.isFinite(part) && Number.isFinite(base) && base > 0) value = (part / base) * 100;
  else if (Number.isFinite(rate)) value = rate <= 1 ? rate * 100 : rate;
  if (value === null) return null;
  return `${value.toFixed(value >= 10 || value === 0 ? 0 : 1)}%`;
}

/** A date and time to the minute in the viewer's time zone, or '' for anything unparseable. */
export function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** A calendar date in the viewer's time zone, or '' for anything unparseable. */
export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
