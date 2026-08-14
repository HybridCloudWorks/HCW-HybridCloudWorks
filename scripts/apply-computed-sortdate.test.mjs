/**
 * The computed-property definition, pinned. The query string IS the behavior —
 * it runs inside Cosmos, out of reach of every other test — so what can be
 * checked here is that it expresses exactly the five-alias fallback the server
 * and frontend resolve in JS, in the same priority order, and that the
 * ISO gate the --inspect step applies matches what lexicographic order needs.
 */
import { describe, it, expect } from 'vitest';
import { sortDateQuery, COMPUTED_PROPERTY, isSortableIso } from './apply-computed-sortdate.mjs';

describe('sortDateQuery', () => {
  it('falls through the five aliases in resolvePublishedDateValue order', () => {
    const q = sortDateQuery();
    const order = [
      'c.publishedDate',
      'c.datePublished',
      'c["Published At"]',
      'c.blogPublishedAt',
      'c.publishedAt',
    ].map((a) => q.indexOf(`IS_STRING(${a})`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('is total: the final fallback is the empty string, not undefined', () => {
    // Presence on every document is the entire point — an undefined fallback
    // would recreate the drops-missing-documents behavior this fixes.
    expect(sortDateQuery()).toMatch(/: ""\)+ FROM c$/);
  });

  it('names the property the endpoint orders by', () => {
    expect(COMPUTED_PROPERTY.name).toBe('cp_sortDate');
  });
});

describe('isSortableIso — the --inspect gate', () => {
  it('admits ISO-8601 date prefixes', () => {
    expect(isSortableIso('2026-08-14T17:00:00Z')).toBe(true);
    expect(isSortableIso('2026-08-14')).toBe(true);
  });

  it('rejects the formats that would silently mis-sort', () => {
    for (const bad of ['April 20, 2026', '08/14/2026', '', 1734567890, null]) {
      expect(isSortableIso(bad)).toBe(false);
    }
  });
});
