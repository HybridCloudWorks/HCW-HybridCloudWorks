/**
 * Attribute-level differences in one `terraform show -json` resource change
 * (#719): what differs between `before` and `after`, named by path, and how to
 * print it without printing a secret. Pure; no I/O. The policy (what is
 * expected, what is declared) lives in scripts/assert-expected-plan.mjs, which
 * re-exports all of it. That file's header says why values are printed the
 * way they are.
 */

import { isDeepStrictEqual } from 'node:util';

/** A map key that prints bare after a dot. Anything else is quoted. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * An attribute path, written the way Terraform writes one:
 * `site_config[0].http2_enabled`, `app_settings["AzureWebJobs.x.Disabled"]`.
 * A key holding a dot is quoted, because printed bare it would read as two
 * levels.
 */
export function formatPath(segments) {
  let text = '';
  for (const segment of segments) {
    if (typeof segment === 'number') text += `[${segment}]`;
    else if (IDENTIFIER.test(segment)) text += text ? `.${segment}` : segment;
    else text += `[${JSON.stringify(segment)}]`;
  }
  return text || '(the whole resource)';
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** One level down a marker tree (`before_sensitive`, `after_sensitive`, `after_unknown`). */
const markerAt = (marker, key) =>
  marker !== null && typeof marker === 'object' ? marker[key] : undefined;

/** Whether anything at or beneath this point of a marker tree is set. */
function marked(marker) {
  if (marker === true) return true;
  if (marker === null || typeof marker !== 'object') return false;
  return Object.values(marker).some(marked);
}

/** The three marker trees, one level down. */
const markersAt = (markers, key) => ({
  beforeSensitive: markerAt(markers.beforeSensitive, key),
  afterSensitive: markerAt(markers.afterSensitive, key),
  afterUnknown: markerAt(markers.afterUnknown, key),
});

/** Object keys from all three sides, sorted so the report is stable. */
function objectKeys(before, after, afterUnknown) {
  const unknownKeys = isPlainObject(afterUnknown) ? Object.keys(afterUnknown) : [];
  return [...new Set([...Object.keys(before), ...Object.keys(after), ...unknownKeys])].sort();
}

/** Every index present on any side. */
function arrayIndexes(before, after, afterUnknown) {
  const unknownLength = Array.isArray(afterUnknown) ? afterUnknown.length : 0;
  const length = Math.max(before.length, after.length, unknownLength);
  return Array.from({ length }, (_, i) => i);
}

/**
 * The keys to descend into, or null when this point is compared whole: a
 * leaf, or a block that appeared, vanished or changed type.
 */
function childKeys(before, after, afterUnknown) {
  if (isPlainObject(before) && isPlainObject(after)) return objectKeys(before, after, afterUnknown);
  if (Array.isArray(before) && Array.isArray(after)) return arrayIndexes(before, after, afterUnknown);
  return null;
}

/**
 * Whether this point differs, when it is compared whole. A point with
 * anything unknown beneath it differs even if the known parts match, because
 * Terraform omits the unknown part from `after`.
 */
const differsWhole = (before, after, afterUnknown) =>
  marked(afterUnknown) || !isDeepStrictEqual(before, after);

/**
 * Every difference between one change's `before` and `after`, leaf by leaf.
 *
 * Returns `{ path, before, after, sensitive, unknown }` for each. The raw
 * values are kept for matching declarations; print them only through
 * `describeDifference`, which reads the two flags first.
 *
 * The walk stops at the first sensitive or unknown point rather than
 * descending past it. Below a sensitive marker the keys of a map can be as
 * telling as its values. Below an unknown one there is nothing to compare,
 * because Terraform omits an unknown value from `after`.
 */
export function attributeChanges(change) {
  const found = [];

  const record = (before, after, markers, path, unknown) =>
    found.push({
      path: formatPath(path),
      before,
      after,
      sensitive: marked(markers.beforeSensitive) || marked(markers.afterSensitive),
      unknown,
    });

  const walk = (before, after, markers, path) => {
    if (markers.afterUnknown === true) {
      record(before, after, markers, path, true);
      return;
    }
    const sensitiveHere = markers.beforeSensitive === true || markers.afterSensitive === true;
    const keys = sensitiveHere ? null : childKeys(before, after, markers.afterUnknown);
    if (keys) {
      for (const key of keys) walk(before[key], after[key], markersAt(markers, key), [...path, key]);
      return;
    }
    if (!differsWhole(before, after, markers.afterUnknown)) return;
    // A sensitive point prints as (sensitive) whatever is unknown beneath it.
    // Elsewhere, anything unknown beneath means `after` is missing that part.
    record(before, after, markers, path, !sensitiveHere && marked(markers.afterUnknown));
  };

  walk(
    change?.before,
    change?.after,
    {
      beforeSensitive: change?.before_sensitive,
      afterSensitive: change?.after_sensitive,
      afterUnknown: change?.after_unknown,
    },
    []
  );
  return found;
}

const SENSITIVE = '(sensitive)';
const UNKNOWN = '(known after apply)';

/** A value for the report. `undefined` is an attribute or element that is not there. */
export const render = (value) => (value === undefined ? '(absent)' : JSON.stringify(value));

/** A list or object by its size, for a value that is about to be recomputed. */
function sizeOf(value) {
  if (Array.isArray(value)) return `(a list of ${value.length} item${value.length === 1 ? '' : 's'})`;
  const keys = Object.keys(value).length;
  return `(an object with ${keys} key${keys === 1 ? '' : 's'})`;
}

/**
 * `before -> after` for one difference, masked by its flags. A list or object
 * whose new value is unknown prints by size; the header of
 * scripts/assert-expected-plan.mjs says why.
 */
export function describeDifference({ before, after, sensitive, unknown }) {
  if (sensitive) return `${SENSITIVE} -> ${unknown ? UNKNOWN : SENSITIVE}`;
  if (!unknown) return `${render(before)} -> ${render(after)}`;
  const composite = before !== null && typeof before === 'object';
  return `${composite ? sizeOf(before) : render(before)} -> ${UNKNOWN}`;
}
