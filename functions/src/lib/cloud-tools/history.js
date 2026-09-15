/**
 * Price history and change detection (#613 Phase 3).
 *
 * Every pricing refresh (refresh.js) cuts one snapshot per region per UTC day
 * into `tool_price_history` — `history:<region>:<YYYY-MM-DD>`, a flat map of
 * `<serviceId>:<provider>` cells — and then diffs the day just written against
 * the newest snapshot at least 7 and at least 30 days old. The result is one
 * `price-changes:<region>` document in `tool_service_cache`, which the public
 * read (public-price-changes.js) serves and the newsletter section
 * (newsletter/sections.js) turns into "AWS · Virtual machines: $0.192 → $0.201
 * per hour (+4.7%)".
 *
 * Three rules, each the reason for a line below:
 *
 *   - **Point reads only.** The comparison day is found by walking day ids —
 *     N, N+1 … N+6 days ago — and reading each by id, stopping at the first
 *     hit. A cross-partition query would cost more RU than the whole refresh
 *     and would need an index nothing else uses; a missed day (a failed run)
 *     is absorbed by the six-day tolerance instead.
 *   - **Live against live, or nothing.** A cell that flipped between a live
 *     price and the catalogue baseline has not changed price; it changed
 *     source. `diffPricing` ignores any cell whose source is not `live` on
 *     BOTH days, and any cell whose unit differs between them, because a
 *     number in a different unit is not a comparable number.
 *   - **A history failure never fails the cache refresh.** The page's prices
 *     come first; refresh.js catches anything thrown here, logs it and records
 *     it in the run summary, and the cache document it already wrote stands.
 *
 * This module is pure apart from `computePriceChanges`, which takes a store
 * with `readDoc` and nothing else. Both container names live here — not in
 * refresh.js — so the newsletter and the public routes can read a document
 * id without importing the refresh and the three provider SDKs behind it.
 */

import { SERVICE_LABELS } from './pricing/regions.js';

/** The container the pricing refresh writes and the public reads read. */
export const CACHE_CONTAINER = 'tool_service_cache';
/** One document per region per UTC day; 400-day TTL (migration-manifest.mjs). */
export const HISTORY_CONTAINER = 'tool_price_history';

/** The comparison windows, in days, in the order the document lists them. */
export const CHANGE_WINDOWS = Object.freeze({ '7d': 7, '30d': 30 });

/**
 * How many days PAST a window's edge the lookup walks before giving up. A
 * refresh that failed for a week still leaves a comparison day; one that
 * failed for longer leaves `sampleDay: null`, which the page renders as "no
 * comparison yet" rather than as "no changes".
 */
export const LOOKBACK_TOLERANCE_DAYS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC calendar day of an ISO string, Date or epoch ms, as YYYY-MM-DD. */
export function utcDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export function historyDocId(region, day) {
  return `history:${region}:${day}`;
}

export function priceChangesDocId(region) {
  return `price-changes:${region}`;
}

/** The map key of one (service × provider) cell. Neither id contains a colon. */
export function cellKey(serviceId, provider) {
  return `${serviceId}:${provider}`;
}

function splitCellKey(key) {
  const at = key.lastIndexOf(':');
  return [key.slice(0, at), key.slice(at + 1)];
}

/**
 * A row's provenance as the history records it: `live` for a price read from
 * the provider (`model: 'retail'`, pricing/index.js), `baseline` for the
 * catalogue fallback. Two values on purpose — the diff only asks one question.
 */
export function rowSource(row) {
  return row?.model === 'retail' ? 'live' : 'baseline';
}

/**
 * The cells of one region's cache document, flattened for the diff.
 *
 * @param {Array<{serviceId: string, rows: object[]}>} services
 * @returns {Record<string, {pricePerUnit: number, unit: string, sku: string, currency: string, source: 'live'|'baseline'}>}
 */
export function historyCells(services) {
  const cells = {};
  for (const service of Array.isArray(services) ? services : []) {
    for (const row of Array.isArray(service?.rows) ? service.rows : []) {
      cells[cellKey(service.serviceId, row.provider)] = {
        pricePerUnit: row.pricePerUnit,
        unit: row.unit,
        sku: row.sku,
        currency: row.currency ?? 'USD',
        source: rowSource(row),
      };
    }
  }
  return cells;
}

/**
 * The snapshot document for one refresh. Keyed by UTC day, so a second
 * refresh the same day (the admin button after the timer) overwrites rather
 * than duplicates, and the day's last word is the one the diff reads.
 */
export function buildHistoryDoc({ region, refreshedAt, services }) {
  const day = utcDay(refreshedAt);
  return {
    id: historyDocId(region, day),
    region,
    day,
    refreshedAt,
    cells: historyCells(services),
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * The cells whose LIVE price differs between two snapshots.
 *
 * Skipped, deliberately: a cell absent on either day; a cell whose source is
 * not `live` on both days (a live↔baseline flip is a source change, not a
 * price change); a cell whose unit differs (not comparable); a previous price
 * of zero or less (no percentage exists); and an unchanged price. What is
 * left is sorted largest move first, then by service id and provider, so the
 * order is stable for a given pair of snapshots.
 *
 * @param {Record<string, object>} current  cells of the newer snapshot
 * @param {Record<string, object>} previous cells of the older snapshot
 * @returns {Array<{serviceId: string, label: string, provider: string, unit: string, sku: string, from: number, to: number, deltaPct: number}>}
 */
export function diffPricing(current, previous) {
  const items = [];
  for (const [key, now] of Object.entries(current ?? {})) {
    const then = previous?.[key];
    if (!then || now?.source !== 'live' || then.source !== 'live') continue;
    if (now.unit !== then.unit) continue;
    const from = Number(then.pricePerUnit);
    const to = Number(now.pricePerUnit);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to === from) continue;
    const [serviceId, provider] = splitCellKey(key);
    items.push({
      serviceId,
      label: SERVICE_LABELS[serviceId] ?? serviceId,
      provider,
      unit: now.unit,
      sku: now.sku,
      from,
      to,
      deltaPct: round1(((to - from) / from) * 100),
    });
  }
  items.sort(
    (a, b) =>
      Math.abs(b.deltaPct) - Math.abs(a.deltaPct) ||
      a.serviceId.localeCompare(b.serviceId) ||
      a.provider.localeCompare(b.provider)
  );
  return items;
}

/** The document the public read answers before any changes document exists. */
export function emptyPriceChanges(region) {
  return {
    region,
    asOf: null,
    windows: Object.fromEntries(
      Object.keys(CHANGE_WINDOWS).map((name) => [name, { since: null, sampleDay: null, items: [] }])
    ),
    sampleDays: 0,
  };
}

/**
 * Diff today's cells against the newest snapshot at least N days old, for
 * each window, and shape the `price-changes:<region>` document.
 *
 * `sampleDays` is the number of comparison snapshots that were found (0, 1
 * or 2): a reader can tell "no changes" from "nothing to compare against"
 * without inspecting each window. Point reads by id only — see the header.
 *
 * @param {object} args
 * @param {{ readDoc: Function }} args.store
 * @param {string} args.region
 * @param {Record<string, object>} args.cells today's cells (historyCells)
 * @param {string} args.refreshedAt ISO stamp of the refresh, the document's `asOf`
 */
export async function computePriceChanges({ store, region, cells, refreshedAt }) {
  const asOfMs = Date.parse(refreshedAt);
  const windows = {};
  let sampleDays = 0;

  for (const [name, days] of Object.entries(CHANGE_WINDOWS)) {
    const since = utcDay(asOfMs - days * DAY_MS);
    let sample = null;
    for (let back = days; back <= days + LOOKBACK_TOLERANCE_DAYS && !sample; back += 1) {
      const id = historyDocId(region, utcDay(asOfMs - back * DAY_MS));
      sample = (await store.readDoc(HISTORY_CONTAINER, id, id)) ?? null;
    }
    if (sample) sampleDays += 1;
    windows[name] = {
      since,
      sampleDay: sample?.day ?? null,
      items: sample ? diffPricing(cells, sample.cells) : [],
    };
  }

  return { id: priceChangesDocId(region), region, asOf: refreshedAt, windows, sampleDays };
}
