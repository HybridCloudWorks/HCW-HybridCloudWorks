/**
 * value-marker.js — "has this value already been processed?" for triggers that
 * used to compare a field's previous value against its new one.
 *
 * Ported from Site-Main `lib/triggers/value-marker.js` (088f458). The Cosmos
 * change feed delivers the current item only, so the previous *value* is
 * stored on the document as a marker, written AFTER the work succeeds: these
 * triggers are idempotent mirrors (re-downloading writes the same bytes,
 * re-pushing sends the same body), so running twice is nearly free and not
 * running is the harmful outcome.
 *
 * Two-tier check: the feed item already carries the marker, and for most
 * writes it agrees with the value (an unrelated edit to a document whose image
 * was mirrored long ago). Only when it disagrees is the live document read,
 * which is what catches a redelivery whose first handling already wrote the
 * marker. Pure: no store, no clock; the live read is injected.
 */
import { createHash } from 'node:crypto';

export const PROCESS_REASONS = Object.freeze({
  CHANGED: 'changed',
  UNCHANGED_IN_EVENT: 'unchanged_in_event',
  UNCHANGED_IN_LIVE_STATE: 'unchanged_in_live_state',
});

/**
 * A fixed-size marker for a set of field values. Per-field JSON.stringify, so
 * an absent field and an explicit null stay distinct and array order counts —
 * faithful to the comparison it replaces.
 * @returns {string} 32 hex characters
 */
export function markerForFields(data, fields) {
  const serialized = JSON.stringify(fields.map((field) => JSON.stringify(data?.[field])));
  return createHash('sha256').update(serialized).digest('hex').slice(0, 32);
}

/**
 * @param {object} spec
 * @param {string} spec.value - the value to process (a source URL, or a markerForFields hash)
 * @param {string|null|undefined} spec.snapshotMarker - the marker in the feed item
 * @param {() => Promise<string|null|undefined>} spec.readLiveMarker - reads the live marker; called only when the snapshot disagrees
 * @returns {Promise<{ process: boolean, reason: string }>}
 */
export async function shouldProcessValue({ value, snapshotMarker, readLiveMarker }) {
  if (value === snapshotMarker)
    return { process: false, reason: PROCESS_REASONS.UNCHANGED_IN_EVENT };
  const liveMarker = await readLiveMarker();
  if (value === liveMarker)
    return { process: false, reason: PROCESS_REASONS.UNCHANGED_IN_LIVE_STATE };
  return { process: true, reason: PROCESS_REASONS.CHANGED };
}
