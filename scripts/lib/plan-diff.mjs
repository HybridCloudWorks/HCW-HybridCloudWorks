/**
 * Attribute-level differences in one `terraform show -json` resource change
 * (#719): what differs between `before` and `after`, named by path. Pure; no
 * I/O. How a difference is printed is lib/plan-report.mjs; what is expected is
 * scripts/assert-expected-plan.mjs, which re-exports both.
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

const isContainer = (value) => value !== null && typeof value === 'object';

const isPlainObject = (value) => isContainer(value) && !Array.isArray(value);

/**
 * A child of a value or marker tree, read only if it is the node's own. A map
 * key such as `__proto__` would otherwise read as Object.prototype on the side
 * that lacks it, and walk as an empty object.
 */
export const own = (node, key) => (isContainer(node) && Object.hasOwn(node, key) ? node[key] : undefined);

/**
 * Whether a marker is set at this point. Terraform writes `true`; anything
 * else that is neither empty nor a subtree (`"true"`, `1`) is read as set
 * too, so a malformed marker masks rather than reveals.
 */
export const isSet = (marker) =>
  marker !== undefined && marker !== null && marker !== false && typeof marker !== 'object';

/** Whether a marker is set at or beneath this point. */
export function marked(marker) {
  if (isSet(marker)) return true;
  return isContainer(marker) && Object.values(marker).some(marked);
}

/** The three marker trees, one level down. */
const markersAt = (markers, key) => ({
  beforeSensitive: own(markers.beforeSensitive, key),
  afterSensitive: own(markers.afterSensitive, key),
  afterUnknown: own(markers.afterUnknown, key),
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
 * Returns `{ path, root, before, after, sensitive, unknown }` for each, where
 * `root` is the top-level attribute (`app_settings` for
 * `app_settings.RUNTIME_CONFIG_WRITER`). The raw values are kept for matching
 * declarations; print them only through lib/plan-report.mjs, which reads the
 * flags first.
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
      root: path[0],
      before,
      after,
      sensitive: marked(markers.beforeSensitive) || marked(markers.afterSensitive),
      unknown,
    });

  const walk = (before, after, markers, path) => {
    if (isSet(markers.afterUnknown)) {
      record(before, after, markers, path, true);
      return;
    }
    const sensitiveHere = isSet(markers.beforeSensitive) || isSet(markers.afterSensitive);
    const keys = sensitiveHere ? null : childKeys(before, after, markers.afterUnknown);
    if (keys) {
      for (const key of keys) walk(own(before, key), own(after, key), markersAt(markers, key), [...path, key]);
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
