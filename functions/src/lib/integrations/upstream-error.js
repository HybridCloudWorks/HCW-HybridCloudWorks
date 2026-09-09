/**
 * upstream-error.js — the one sentence an upstream REST API gave us for a
 * failure, pulled out of whichever shape it arrived in.
 *
 * Written for #463 item 4. A rejected Publer credential had been reported as
 * `HTTP 401` and nothing else for two days, through a timer, a proxy and an
 * admin page — while Publer was answering
 * `{"errors":["Missing or invalid Authorization header"]}`, which is the
 * sentence that separates "the header we built is wrong" from "the key is
 * revoked". One of those is our bug and the other is the owner's account, and
 * the status code alone cannot tell an operator which of the two they are
 * looking at. Two days of reminting a key were spent on that distinction.
 *
 * Deliberately generic rather than Publer-specific: `rest-proxy.js` carries
 * Klaviyo and Linkie through the same code path, and an error reader that
 * only understood one vendor would leave the other two exactly as blind.
 * Publer answers `{ errors: [...] }`, Klaviyo `{ errors: [{ detail }] }`,
 * and a plain `{ message }` or `{ error }` is common enough to be worth the
 * two extra lines.
 *
 * Never throws, and never returns anything but a short string: it runs inside
 * an error path, and a reader that can fail turns a reported failure into an
 * unreported one.
 */

/** Longer than any useful message and short enough for a log line and a Cosmos field. */
const MAX_DETAIL_LENGTH = 300;

function firstString(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  // Klaviyo's `errors[]` holds objects; JSON:API calls the human sentence
  // `detail`, and `title` is its heading.
  for (const key of ['detail', 'message', 'title', 'error']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key];
  }
  return '';
}

/**
 * The first human-readable sentence in a parsed error body.
 *
 * @param {unknown} data the parsed JSON body, or whatever `JSON.parse` produced
 * @returns {string} the message, trimmed and capped, or `''` when the body
 *   carried none — callers append it only when it is non-empty, so an API that
 *   answers with an empty body reads exactly as it did before.
 */
export function readUpstreamError(data) {
  if (!data || typeof data !== 'object') return '';
  const candidates = Array.isArray(data) ? data : [data.errors, data.error, data.message, data.detail, data.raw];
  for (const candidate of candidates.flat?.() ?? candidates) {
    const found = firstString(candidate);
    if (found.trim()) return found.trim().slice(0, MAX_DETAIL_LENGTH);
  }
  return '';
}

/**
 * `HTTP 401` on its own, or `HTTP 401 — Missing or invalid Authorization header`.
 *
 * The em dash is the same separator `describePublerFailure` uses on the
 * browser side, so the operator reads one sentence whichever surface showed it.
 *
 * @param {number} status
 * @param {unknown} data
 * @returns {string}
 */
export function describeUpstreamFailure(status, data) {
  const detail = readUpstreamError(data);
  return detail ? `HTTP ${status} — ${detail}` : `HTTP ${status}`;
}
