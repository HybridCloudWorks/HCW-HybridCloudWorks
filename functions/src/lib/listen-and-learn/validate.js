/**
 * Field checks for the Audio Library bodies (ADR 0033 §4). Each check reads
 * one field of an untrusted body and answers one of three shapes:
 *
 *   { skip: true }     the body did not name the field — write nothing
 *   { error: string }  the sentence a 400 carries
 *   { value }          the normalised value to store
 *
 * `collectFields` folds a list of `[field, check]` pairs into the patch a
 * handler can hand to `patchDoc`, or the first error. Pulled out of
 * library.js in PR #841 so the parsers there read as tables of rules rather
 * than ladders of returns, and so each rule is testable on its own.
 */
export const str = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

export const fail = (error) => ({ error });

/** The message of the first `[holds, message]` rule that holds, or null. */
export const firstError = (rules) => rules.find(([holds]) => holds)?.[1] || null;

/**
 * Free text, whitespace collapsed, bounded. Empty reads as null unless the
 * field is required, in which case it is refused.
 */
export function checkText(value, field, max, { required = false } = {}) {
  if (value === undefined) return { skip: true };
  if (value === null || value === '')
    return required ? fail(`${field} is required`) : { value: null };
  if (typeof value !== 'string') return fail(`${field} must be a string`);
  const text = str(value);
  const error = firstError([
    [required && !text, `${field} is required`],
    [text.length > max, `${field} must be at most ${max} characters`],
  ]);
  return error ? fail(error) : { value: text || null };
}

/** Site-relative media paths (the gallery's) or https; nothing executable. */
const URL_PATTERN = /^(\/[^/\\][^\s]*|https:\/\/[^\s]+)$/;

export function checkUrl(value, field, max) {
  if (value === undefined) return { skip: true };
  if (value === null || value === '') return { value: null };
  if (typeof value !== 'string') return fail(`${field} must be a string`);
  const url = value.trim();
  const error = firstError([
    [url.length > max, `${field} must be at most ${max} characters`],
    [!URL_PATTERN.test(url), `${field} must be an https URL or a site-relative path`],
  ]);
  return error ? fail(error) : { value: url };
}

const TAGS_MESSAGE = 'tags must be an array of strings';

/** What is wrong with one entry of a tag list, or null. */
function tagError(raw, maxTagLength) {
  if (typeof raw !== 'string') return TAGS_MESSAGE;
  return str(raw).length > maxTagLength ? `a tag must be at most ${maxTagLength} characters` : null;
}

/** A list of lower-cased, deduplicated tags; `null` clears the list. */
export function checkTags(value, { maxTags, maxTagLength }) {
  if (value === undefined) return { skip: true };
  if (value === null) return { value: [] };
  if (!Array.isArray(value)) return fail(TAGS_MESSAGE);
  const error =
    value.length > maxTags
      ? `tags must hold at most ${maxTags} entries`
      : value.map((raw) => tagError(raw, maxTagLength)).find(Boolean);
  if (error) return fail(error);
  return { value: [...new Set(value.map((raw) => str(raw).toLowerCase()).filter(Boolean))] };
}

/** One of a fixed list, named in the error. */
export function checkEnum(value, field, allowed) {
  if (value === undefined) return { skip: true };
  return allowed.includes(value)
    ? { value }
    : fail(`${field} must be one of ${allowed.join(', ')}`);
}

export function checkBoolean(value, field) {
  if (value === undefined) return { skip: true };
  return typeof value === 'boolean' ? { value } : fail(`${field} must be true or false`);
}

/** A whole number within `[min, max]`, read from a number or numeric string. */
export function checkInteger(value, field, { min, max }) {
  if (value === undefined) return { skip: true };
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max
    ? { value: n }
    : fail(`${field} must be a whole number between ${min} and ${max}`);
}

/** A string matching `pattern`, with the caller's sentence when it does not. */
export function checkPattern(value, pattern, message) {
  if (value === undefined) return { skip: true };
  return typeof value === 'string' && pattern.test(value) ? { value } : fail(message);
}

/**
 * The patch a list of `[field, check]` pairs produces: only the fields the
 * body named, or the first error in list order, or "Nothing to change" when
 * the body named none of them.
 */
export function collectFields(checks) {
  const out = {};
  for (const [field, checked] of checks) {
    if (checked.error) return fail(checked.error);
    if (!checked.skip) out[field] = checked.value;
  }
  if (Object.keys(out).length === 0) return fail('Nothing to change');
  return { value: out };
}
