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
 * Take one of today's 200, or say no. `incrementIf` is the compare-and-
 * increment cosmos-client.js documents: 404 means today's counter does not
 * exist yet and `createDoc` races to make it (409: someone else did, go
 * round); 412 means the predicate failed, which for `count < limit` is the
 * cap. Anything else is a fault and propagates.
 *
 * @returns {Promise<boolean>} true when the call may proceed
 */
export async function takeDailyQuota(store, { day, nowIso, limit = EXPLAIN_PER_DAY }) {
  const id = explainQuotaId(day);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const incremented = await increment(store, id, limit);
    if (incremented !== 'missing') return incremented;
    if (await create(store, { id, day, nowIso })) return true;
  }
  return false;
}

/** true: counted; false: at the cap; 'missing': no counter yet. */
async function increment(store, id, limit) {
  try {
    await store.incrementIf(CACHE_CONTAINER, id, {
      path: '/count',
      value: 1,
      condition: 'FROM c WHERE c.count < @limit',
      conditionValues: { limit },
    });
    return true;
  } catch (error) {
    if (error?.code === 412) return false;
    if (error?.code === 404) return 'missing';
    throw error;
  }
}

/** true: created with count 1; false: another instance created it first. */
async function create(store, { id, day, nowIso }) {
  try {
    await store.createDoc(CACHE_CONTAINER, {
      id,
      kind: 'explain-quota',
      day,
      count: 1,
      createdAt: nowIso,
      ttl: EXPLAIN_QUOTA_TTL_SECONDS,
    });
    return true;
  } catch (error) {
    if (error?.code !== 409) throw error;
    return false;
  }
}
