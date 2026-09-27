/**
 * The two spend bounds of POST public/cloud-tools/explain (#613 Phase 3; the
 * route's header is in handler.js): 5 per hour per client, 200 per UTC day
 * across every client.
 *
 * The per-client limit is `enforceSubmissionQuota` on `submission_quota`,
 * the same Cloudflare-verified hashed identity and the same compare-and-
 * increment counter the anonymous submission and newsletter routes use. The
 * daily cap is a counter document of its own, `explain-quota:<day>` in
 * tool_service_cache, incremented with `incrementIf` so a burst cannot
 * read-then-write its way past it.
 */

import { takeDailyCap } from '../../daily-cap.js';
import { enforceSubmissionQuota } from '../../submissions.js';
import { CACHE_CONTAINER } from '../history.js';

export const EXPLAIN_PER_CLIENT_PER_HOUR = 5;
export const EXPLAIN_PER_DAY = 200;
export const EXPLAIN_QUOTA_TTL_SECONDS = 2 * 24 * 60 * 60;

export function explainQuotaId(day) {
  return `explain-quota:${day}`;
}

/**
 * Count one call against the client, or say no.
 *
 * @returns {Promise<boolean>} true when the call may proceed
 */
export async function takeClientQuota(
  store,
  { clientKey, now, limit = EXPLAIN_PER_CLIENT_PER_HOUR }
) {
  try {
    await enforceSubmissionQuota(store, `explain-caller:${clientKey}`, { now, limit });
    return true;
  } catch (error) {
    if (error?.code !== 'SUBMISSION_RATE_LIMIT') throw error;
    return false;
  }
}

/**
 * Take one of today's 200, or say no. The counter is the shared daily cap in
 * lib/daily-cap.js (extracted from this file for the public lab submission,
 * #672, with its behaviour unchanged): `explain-quota:<day>` in
 * tool_service_cache, taken with `incrementIf` and created with `createDoc`
 * on the first call of the day. 404 means no counter yet, 412 is the cap,
 * 409 is a lost race to create it, and anything else propagates.
 *
 * @returns {Promise<boolean>} true when the call may proceed
 */
export async function takeDailyQuota(store, { day, nowIso, limit = EXPLAIN_PER_DAY }) {
  return takeDailyCap(store, {
    container: CACHE_CONTAINER,
    id: explainQuotaId(day),
    kind: 'explain-quota',
    day,
    nowIso,
    limit,
    ttlSeconds: EXPLAIN_QUOTA_TTL_SECONDS,
  });
}
