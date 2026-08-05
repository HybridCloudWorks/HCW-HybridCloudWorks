/**
 * Cache freshness for the Cloud Tools service cache.
 *
 * Ported from Site-Main `functions/cloud-tools.js:533-607` (commit 07f3123).
 * Behaviour is deliberately unchanged — the accompanying test suite came across
 * with it, so any drift shows up as a test failure rather than as silence.
 *
 * Why this module exists at all, from the original RCA (2026-07-30): the
 * comparison cache never expired. `ensureServiceCache` served any document that
 * merely existed, and `ttlMinutes`/`refreshedAt` were written on every entry and
 * read by nothing. Production served pricing fetched on 2026-06-27 against a
 * 1,440-minute TTL — 33 days past it, with no path to ever update. The failure
 * mode was silence: a freshness check that always returns "fresh" looks
 * identical to one that works.
 *
 * One migration note. On Firestore the stamp arrived as a Timestamp with
 * `.toMillis()`; on Cosmos it arrives as the ISO string the migration transform
 * writes (scripts/lib/firestore-transform.mjs converts every Timestamp at any
 * depth). Both shapes are still handled, plus Date and epoch-milliseconds,
 * because `tool_service_cache` is a `regenerate` collection — it is NOT
 * migrated, and the scheduled refresh repopulates it on the far side. During
 * the overlap both writers exist.
 */

/** Applied when a cache document declares no TTL of its own. */
export const DEFAULT_CACHE_TTL_MINUTES = 1440;

/**
 * Age of a cache document in whole minutes, or null if it cannot be dated.
 *
 * Each timestamp shape is spelled out rather than chained, because the failure
 * mode of getting one wrong is a silent null — which reads as "cannot date
 * this" and is indistinguishable from a genuinely unstamped document.
 *
 * @param {object|undefined} data
 * @param {number} [now] epoch ms
 * @returns {number|null}
 */
export function cacheAgeMinutes(data, now = Date.now()) {
  const stamp = data?.refreshedAt ?? data?.updatedAt;
  if (!stamp) return null;

  let ms = null;

  if (typeof stamp?.toMillis === 'function') {
    // Firestore Timestamp, as stored server-side pre-migration.
    ms = stamp.toMillis();
  } else if (stamp instanceof Date) {
    ms = stamp.getTime();
  } else if (typeof stamp === 'number') {
    // Explicit: `Date.parse(1785000000000)` stringifies its argument and yields
    // NaN, so an epoch-ms stamp would otherwise read as undatable.
    ms = stamp;
  } else if (typeof stamp === 'string') {
    // ISO — what ensureServiceCache returns inline, and what the Cosmos
    // transform writes.
    const parsed = Date.parse(stamp);
    ms = Number.isFinite(parsed) ? parsed : null;
  }

  if (ms === null || !Number.isFinite(ms)) return null;

  // Clamped at zero: a clock-skewed future stamp must not report a negative age.
  return Math.max(0, Math.round((now - ms) / 60000));
}

/**
 * Freshness of one cache document, for the wire.
 *
 * The read path deliberately does NOT refresh on expiry. `getToolComparisonData`
 * is public and unauthenticated and takes `serviceIds`/`region` straight from
 * the body, so refreshing there would let any anonymous caller drive live
 * pricing-API traffic by naming a region. Staleness is reported instead, and
 * the scheduled refresh is what keeps it from occurring.
 *
 * @param {object|undefined} data
 * @param {number} [now] epoch ms
 * @returns {{ ttlMinutes: number, ageMinutes: number|null, stale: boolean }}
 */
export function cacheFreshness(data, now = Date.now()) {
  const ttlMinutes = Number(data?.ttlMinutes) || DEFAULT_CACHE_TTL_MINUTES;
  const ageMinutes = cacheAgeMinutes(data, now);

  return {
    ttlMinutes,
    ageMinutes,
    // No usable stamp means we cannot claim it is fresh. Boundary-exclusive:
    // exactly at the TTL is still fresh.
    stale: ageMinutes === null ? true : ageMinutes > ttlMinutes,
  };
}
