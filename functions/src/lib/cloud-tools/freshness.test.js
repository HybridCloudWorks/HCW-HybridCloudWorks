import { describe, expect, it } from 'vitest';

import { cacheAgeMinutes, cacheFreshness, DEFAULT_CACHE_TTL_MINUTES } from './freshness.js';

/**
 * Ported verbatim in intent from Site-Main `functions/cloud-tools-freshness.test.js`
 * (commit 07f3123), converted from CommonJS to ESM. Every assertion is the
 * original's; nothing was relaxed to make the port pass.
 *
 * Cloud Tools Phase 3 RCA, 2026-07-30.
 *
 * The comparison cache never expired. `ensureServiceCache` serves any document
 * that merely exists, and `ttlMinutes`/`refreshedAt` were written on every entry
 * and read by nothing — so production served pricing fetched on 2026-06-27
 * against a 1440-minute TTL, 33 days past it, with no path to ever update.
 *
 * These tests exist because the failure mode was silence. A freshness check that
 * always returns "fresh" looks identical to one that works, from the outside and
 * in the UI, which is exactly how the original bug survived. So the stale case,
 * the missing-stamp case and both timestamp shapes are each asserted.
 */
const MINUTE = 60_000;
const NOW = Date.parse('2026-07-30T12:00:00Z');

const at = (isoOrMs) => (typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs));

describe('cacheAgeMinutes', () => {
  it('reads a Firestore Timestamp, the shape a server-written doc carries', () => {
    const ts = { toMillis: () => NOW - 90 * MINUTE };
    expect(cacheAgeMinutes({ refreshedAt: ts }, NOW)).toBe(90);
  });

  it('reads an ISO string, the shape returned inline by ensureServiceCache', () => {
    // Both shapes are live in this codebase; handling only one is how a
    // freshness check quietly degrades into a constant. Post-migration the ISO
    // string is also what the Cosmos transform writes.
    expect(cacheAgeMinutes({ refreshedAt: '2026-07-30T10:30:00Z' }, NOW)).toBe(90);
  });

  it('reads a Date', () => {
    expect(cacheAgeMinutes({ refreshedAt: new Date(NOW - 30 * MINUTE) }, NOW)).toBe(30);
  });

  it('reads epoch milliseconds', () => {
    // Date.parse() on a number stringifies it and yields NaN, so this shape
    // needs its own branch or it reads as undatable.
    expect(cacheAgeMinutes({ refreshedAt: NOW - 45 * MINUTE }, NOW)).toBe(45);
  });

  it('falls back to updatedAt when refreshedAt is absent', () => {
    expect(cacheAgeMinutes({ updatedAt: '2026-07-30T11:00:00Z' }, NOW)).toBe(60);
  });

  it('returns null rather than 0 when there is no usable stamp', () => {
    // 0 would read as "just refreshed" — the most dangerous possible default.
    expect(cacheAgeMinutes({}, NOW)).toBeNull();
    expect(cacheAgeMinutes({ refreshedAt: 'not a date' }, NOW)).toBeNull();
    expect(cacheAgeMinutes(undefined, NOW)).toBeNull();
  });

  it('never reports a negative age for a clock-skewed future stamp', () => {
    expect(cacheAgeMinutes({ refreshedAt: at('2026-07-30T13:00:00Z') }, NOW)).toBe(0);
  });
});

describe('cacheFreshness', () => {
  it('calls a document inside its TTL fresh', () => {
    const f = cacheFreshness({ ttlMinutes: 1440, refreshedAt: at('2026-07-30T02:00:00Z') }, NOW);
    expect(f).toEqual({ ttlMinutes: 1440, ageMinutes: 600, stale: false });
  });

  it('calls a document past its TTL stale', () => {
    const f = cacheFreshness({ ttlMinutes: 1440, refreshedAt: at('2026-07-28T02:00:00Z') }, NOW);
    expect(f.stale).toBe(true);
    expect(f.ageMinutes).toBe(3480);
  });

  it('flags the exact production state that prompted this', () => {
    // The real cache entry: compute-vm__us-east-1, refreshed 2026-06-27T17:20:46Z,
    // ttlMinutes 1440, still being served on 2026-07-30 — 47,199 minutes, a shade
    // under 32.8 days, against a one-day TTL. Roughly 32x past expiry.
    const f = cacheFreshness({ ttlMinutes: 1440, refreshedAt: at('2026-06-27T17:20:46Z') }, NOW);
    expect(f.stale).toBe(true);
    expect(f.ageMinutes).toBe(47199);
    expect(f.ageMinutes / f.ttlMinutes).toBeGreaterThan(32);
  });

  it('treats an unstamped document as stale, not as fresh', () => {
    // The safe direction: a document we cannot date is one we cannot vouch for.
    expect(cacheFreshness({ ttlMinutes: 1440 }, NOW)).toMatchObject({
      ageMinutes: null,
      stale: true,
    });
  });

  it('applies the default TTL when the document declares none', () => {
    const f = cacheFreshness({ refreshedAt: at('2026-07-30T11:00:00Z') }, NOW);
    expect(f.ttlMinutes).toBe(DEFAULT_CACHE_TTL_MINUTES);
    expect(f.ttlMinutes).toBe(1440);
    expect(f.stale).toBe(false);
  });

  it('is boundary-exclusive: exactly at the TTL is still fresh', () => {
    const f = cacheFreshness({ ttlMinutes: 60, refreshedAt: at('2026-07-30T11:00:00Z') }, NOW);
    expect(f.ageMinutes).toBe(60);
    expect(f.stale).toBe(false);
  });
});
