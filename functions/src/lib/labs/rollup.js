/**
 * The daily labs rollup (#665, Phase 5 of #656): one document per UTC day in
 * `tool_service_cache`, written by the `labsWeeklyRollup` timer
 * (functions/labs-jobs.js) and read back a week at a time by the newsletter's
 * "Lab this week" section (newsletter/sections.js).
 *
 * ## Why a rollup exists
 *
 * The estate read (labs/estate.js, #664) caches the lab host's state for one
 * minute and then lets Cosmos delete it; the Coder status proxy (#680) does
 * the same. Nothing keeps a history, and the newsletter must never call Azure
 * or Coder on its render path — a Monday build that reached Resource Graph
 * would be one more anonymous-adjacent caller of the management plane. So a
 * timer folds what the two caches hold, and what `lab_jobs` recorded, into a
 * document per day, and the section reads seven of those by point read.
 *
 * ## The day document
 *
 *   id            `labs:day:<YYYY-MM-DD>`
 *   kind          'labs-day'
 *   day           the UTC day the document describes
 *   arcConnected  true | false | null
 *   jobsByType    { [type]: { succeeded, failed, timeout } }
 *   coderRunningMax  number | null
 *   asOf          when the rollup last wrote it
 *   ttl           60 days
 *
 * NULL MEANS NOT OBSERVED, NOT DOWN. `arcConnected` is a boolean only when a
 * `labs:estate` document stamped that day was present at rollup time and
 * described a configured estate; otherwise nobody looked at the estate that
 * day, and the section counts it as unobserved rather than as downtime. The
 * same rule gives `coderRunningMax`: a number only when a cache document
 * carried one.
 *
 * ## Reads, bounded
 *
 * Three point reads — the estate cache, the Coder cache, and the day document
 * a previous run may have written — and ONE query of `lab_jobs`:
 *
 *   SELECT c.type, c.status, COUNT(1) FROM c
 *    WHERE c.createdAt >= @from AND c.createdAt < @to AND c.status IN (…)
 *    GROUP BY c.type, c.status
 *
 * Bounded on `createdAt`, which `lab_jobs` indexes (infra/cosmos-containers.json
 * lists `/status`, `/type`, `/createdAt`, `/agentId`); `finishedAt` has no index
 * path, so "jobs run that day" means jobs CREATED that day that had reached a
 * terminal state by the time the rollup ran. The result is at most one row per
 * (type × terminal status), whatever the job volume — a GROUP BY count is the
 * bounded query, and there is no per-job read anywhere in this file.
 *
 * ## A rerun merges
 *
 * The timer runs once a day at 23:55 UTC, but a host restart can replay a
 * missed schedule, and an operator may run it by hand. A second write for the
 * same day therefore keeps what the first saw: Arc "connected" once that day
 * stays connected, the Coder peak is the larger of the two samples, and the
 * job counts are recomputed from the query, which covers the whole day so far.
 */

import { CACHE_CONTAINER, utcDay } from '../cloud-tools/history.js';

/** The two minute-cache documents this reads (labs/estate.js, labs/coder-status.js). */
export const ESTATE_CACHE_ID = 'labs:estate';
export const CODER_STATUS_CACHE_ID = 'labs:coder-status';

export const LABS_DAY_KIND = 'labs-day';
export const LABS_DAY_PREFIX = 'labs:day:';
/** Sixty days: eight newsletter weeks, with room for a late build. */
export const LABS_DAY_TTL_SECONDS = 60 * 24 * 60 * 60;
/** The week the section reports. */
export const LABS_WEEK_DAYS = 7;

/** The terminal statuses the rollup counts (labs.js JOB_STATUSES). */
export const ROLLUP_STATUSES = Object.freeze(['succeeded', 'failed', 'timeout']);
/** Job types kept per day; the allowlist has three, so this is a guard, not a limit. */
export const MAX_JOB_TYPES = 20;

export const LAB_JOBS_CONTAINER = 'lab_jobs';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The bounded, grouped count. Status literals are inlined: Cosmos IN takes no array parameter. */
export const DAY_JOBS_QUERY = `SELECT c.type, c.status, COUNT(1) AS n FROM c WHERE c.createdAt >= @from AND c.createdAt < @to AND c.status IN (${ROLLUP_STATUSES.map((s) => `'${s}'`).join(', ')}) GROUP BY c.type, c.status`;

export function labsDayDocId(day) {
  if (typeof day !== 'string' || !DAY_RE.test(day)) throw new Error(`labs rollup: not a UTC day: ${day}`);
  return `${LABS_DAY_PREFIX}${day}`;
}

/** `[from, to)` as ISO strings for one UTC day. */
export function dayBounds(day) {
  const from = new Date(`${labsDayDocId(day).slice(LABS_DAY_PREFIX.length)}T00:00:00.000Z`);
  return { from: from.toISOString(), to: new Date(from.getTime() + DAY_MS).toISOString() };
}

/** The UTC day `days` before `day`. */
export function shiftDay(day, days) {
  const ms = Date.parse(dayBounds(day).from);
  return utcDay(ms - days * DAY_MS);
}

/** A minute-cache document written on `day`, or null: a stale or missing one says nothing about that day. */
function cachedOn(doc, day) {
  if (!doc || doc.value === undefined) return null;
  const at = Date.parse(String(doc.cachedAt ?? ''));
  return Number.isFinite(at) && utcDay(at) === day ? doc : null;
}

/**
 * Arc's state from the estate cache: true/false for a configured estate, null
 * for an absent, stale, unavailable (503) or unconfigured one.
 */
export function arcConnectedFrom(estateDoc, day) {
  const doc = cachedOn(estateDoc, day);
  const body = doc?.value?.status === 200 ? doc.value.body : null;
  if (!body || body.configured !== true) return null;
  const status = body.arc?.status;
  return typeof status === 'string' && status.trim().toLowerCase() === 'connected';
}

const intOrNull = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

/** The larger of the two caches' running-workspace counts, or null when neither carries one. */
export function coderRunningFrom(estateDoc, coderDoc, day) {
  const estate = cachedOn(estateDoc, day);
  const coder = cachedOn(coderDoc, day);
  const samples = [
    estate?.value?.status === 200 ? intOrNull(estate.value.body?.coder?.running) : null,
    coder?.value?.configured === true ? intOrNull(coder.value.capacity?.running) : null,
  ].filter((n) => n !== null);
  return samples.length ? Math.max(...samples) : null;
}

const emptyCounts = () => ({ succeeded: 0, failed: 0, timeout: 0 });

/**
 * One grouped row as `{ type, status, n }`, or null when it cannot be counted:
 * a blank type, a status the rollup does not count, or an `n` that is not a
 * non-negative integer (Cosmos counts are numbers; anything else is not one).
 */
export function readJobRow(row) {
  const type = typeof row?.type === 'string' ? row.type.trim() : '';
  const status = typeof row?.status === 'string' ? row.status : '';
  const n = row?.n;
  if (!type || !ROLLUP_STATUSES.includes(status) || !Number.isInteger(n) || n < 0) return null;
  return { type, status, n };
}

/** Add one readable row to the map, opening a new type only while there is room for it. */
function foldJobRow(out, { type, status, n }) {
  if (!Object.hasOwn(out, type)) {
    if (Object.keys(out).length >= MAX_JOB_TYPES) return out;
    out[type] = emptyCounts();
  }
  out[type][status] += n;
  return out;
}

/** `{ [type]: { succeeded, failed, timeout } }` from the grouped rows, sorted by type; unknown statuses and unreadable rows are dropped. */
export function jobsByTypeFrom(rows) {
  const readable = (Array.isArray(rows) ? rows : []).map(readJobRow).filter(Boolean);
  const out = readable.reduce(foldJobRow, {});
  return Object.fromEntries(Object.keys(out).sort().map((type) => [type, out[type]]));
}

/** Once connected that day, connected; observed and never connected, false; never observed, null. */
export function mergeArc(previous, current) {
  if (previous === true || current === true) return true;
  if (previous === false || current === false) return false;
  return null;
}

/** The larger sample, or whichever exists. */
export function mergeMax(previous, current) {
  const a = intOrNull(previous);
  const b = intOrNull(current);
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * The day document, computed. Pure: every input is a value the caller read.
 *
 * @param {object} input
 * @param {string} input.day - YYYY-MM-DD
 * @param {object|null} input.estateDoc - the `labs:estate` cache document
 * @param {object|null} input.coderDoc - the `labs:coder-status` cache document
 * @param {object[]} input.jobRows - rows from DAY_JOBS_QUERY
 * @param {object|null} input.previous - the day document a previous run wrote
 * @param {string} input.asOf - ISO timestamp of this run
 */
export function computeDayRollup({ day, estateDoc, coderDoc, jobRows, previous, asOf }) {
  return {
    id: labsDayDocId(day),
    kind: LABS_DAY_KIND,
    day,
    arcConnected: mergeArc(previous?.arcConnected ?? null, arcConnectedFrom(estateDoc, day)),
    jobsByType: jobsByTypeFrom(jobRows),
    coderRunningMax: mergeMax(previous?.coderRunningMax ?? null, coderRunningFrom(estateDoc, coderDoc, day)),
    asOf,
    ttl: LABS_DAY_TTL_SECONDS,
  };
}

/**
 * The timer's work: read, compute, upsert. Throws on a store failure so the
 * host records the run as failed; there is nothing to degrade to.
 *
 * @param {object} deps
 * @param {{ readDoc: Function, upsertDoc: Function, queryDocs: Function }} deps.store
 * @param {() => Date} [deps.now]
 */
export function createLabsDayRollup({ store, now = () => new Date() }) {
  return {
    async run() {
      const at = now();
      const day = utcDay(at);
      const dayId = labsDayDocId(day);
      const { from, to } = dayBounds(day);
      const [estateDoc, coderDoc, previous, jobRows] = await Promise.all([
        store.readDoc(CACHE_CONTAINER, ESTATE_CACHE_ID, ESTATE_CACHE_ID),
        store.readDoc(CACHE_CONTAINER, CODER_STATUS_CACHE_ID, CODER_STATUS_CACHE_ID),
        store.readDoc(CACHE_CONTAINER, dayId, dayId),
        store.queryDocs(LAB_JOBS_CONTAINER, DAY_JOBS_QUERY, [
          { name: '@from', value: from },
          { name: '@to', value: to },
        ]),
      ]);
      const doc = computeDayRollup({
        day,
        estateDoc,
        coderDoc,
        jobRows,
        previous,
        asOf: at.toISOString(),
      });
      await store.upsertDoc(CACHE_CONTAINER, doc);
      const jobs = Object.values(doc.jobsByType).reduce(
        (sum, c) => sum + c.succeeded + c.failed + c.timeout,
        0
      );
      return {
        id: doc.id,
        day,
        arcConnected: doc.arcConnected,
        jobs,
        coderRunningMax: doc.coderRunningMax,
        merged: Boolean(previous),
      };
    },
  };
}

/**
 * The last seven day documents before `until`'s UTC day, newest first, by
 * point read — today's document is not written until 23:55, so the week ends
 * yesterday. Days with no document are left out; the caller decides what an
 * empty list means.
 *
 * @param {object} deps
 * @param {{ readDoc: Function }} deps.store
 * @param {Date} [deps.until]
 * @param {number} [deps.days]
 * @returns {Promise<object[]>}
 */
export async function readLabsWeek({ store, until = new Date(), days = LABS_WEEK_DAYS }) {
  const end = shiftDay(utcDay(until), 1);
  const ids = Array.from({ length: days }, (_, i) => labsDayDocId(shiftDay(end, i)));
  const docs = await Promise.all(ids.map((id) => store.readDoc(CACHE_CONTAINER, id, id)));
  return docs.filter((doc) => doc && doc.kind === LABS_DAY_KIND);
}
