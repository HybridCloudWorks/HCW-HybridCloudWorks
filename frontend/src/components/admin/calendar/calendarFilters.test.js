/**
 * The toolbar's narrowing rules (ADR 0033 §4). What must hold: empty filters
 * pass everything; kind, status and channel each narrow on their own and
 * together; the channel match is case-insensitive and reads both a content
 * provider and a social platform; the channel list is distinct and sorted.
 */
import { describe, it, expect } from 'vitest';
import { applyFilters, channelsOf } from './calendarFilters';

const items = [
  { id: 'c1', kind: 'content', status: 'scheduled', meta: { provider: 'Azure' } },
  { id: 's1', kind: 'social', status: 'failed', meta: { platforms: ['linkedin', 'x'] } },
  { id: 'n1', kind: 'newsletter', status: 'sent', meta: {} },
  { id: 'c2', kind: 'content', status: 'scheduled', meta: { provider: 'azure' } },
];
const ids = (list) => list.map((i) => i.id);

describe('applyFilters', () => {
  it('passes everything when no filter is set, and tolerates a missing list', () => {
    expect(ids(applyFilters(items, {}))).toEqual(['c1', 's1', 'n1', 'c2']);
    expect(ids(applyFilters(items))).toEqual(['c1', 's1', 'n1', 'c2']);
    expect(applyFilters(undefined, { kinds: ['content'] })).toEqual([]);
  });

  it('narrows by kind, by status and by channel, each on its own', () => {
    expect(ids(applyFilters(items, { kinds: ['social', 'newsletter'] }))).toEqual(['s1', 'n1']);
    expect(ids(applyFilters(items, { status: 'failed' }))).toEqual(['s1']);
    expect(ids(applyFilters(items, { channel: 'AZURE' }))).toEqual(['c1', 'c2']);
    expect(ids(applyFilters(items, { channel: ' linked ' }))).toEqual(['s1']);
  });

  it('applies every filter together', () => {
    expect(
      ids(applyFilters(items, { kinds: ['content'], status: 'scheduled', channel: 'az' }))
    ).toEqual(['c1', 'c2']);
    expect(ids(applyFilters(items, { kinds: ['content'], channel: 'linkedin' }))).toEqual([]);
  });
});

describe('channelsOf', () => {
  it('lists every provider and platform once, sorted, keeping the spelling the items use', () => {
    const channels = channelsOf(items);
    expect(new Set(channels)).toEqual(new Set(['Azure', 'azure', 'linkedin', 'x']));
    // Sorted by localeCompare, whichever way the locale orders case.
    expect(channels).toEqual([...channels].sort((a, b) => a.localeCompare(b)));
    expect(channelsOf([])).toEqual([]);
    expect(channelsOf(undefined)).toEqual([]);
  });
});
