/**
 * The Certifications Hub's pure helpers: the numbers and lists every tab
 * renders are computed here, so the page tests only check they are shown.
 */
import { describe, it, expect } from 'vitest';

import {
  computeStats,
  diffSnapshot,
  expiryFlags,
  featuredCerts,
  filterCatalog,
  hiddenCerts,
  issuerList,
  issuerOf,
  renewalRows,
  resolveImages,
  toIso,
  fromIso,
  verificationCounts,
  verificationSource,
} from './certView';

const NOW = Date.parse('2026-09-14T00:00:00Z');
const inDays = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);

const cert = (over) => ({ _docId: over.id || over._docId, display: true, ...over });

describe('reading a cert document', () => {
  it('reads issuer from a string or the first of an array', () => {
    expect(issuerOf({ issuer: 'Microsoft' })).toBe('Microsoft');
    expect(issuerOf({ issuer: ['AWS', 'Other'] })).toBe('AWS');
    expect(issuerOf({ issuer: [] })).toBe('Unknown');
    expect(issuerOf({})).toBe('Unknown');
  });

  it('normalises dates from strings, Timestamps and seconds', () => {
    expect(toIso('2026-10-01T00:00:00.000Z')).toBe('2026-10-01');
    expect(toIso({ seconds: NOW / 1000 })).toBe('2026-09-14');
    expect(toIso({ toDate: () => new Date(NOW) })).toBe('2026-09-14');
    expect(toIso(null)).toBe('');
    expect(fromIso('2026-10-01')).toBe('2026-10-01T00:00:00.000Z');
    expect(fromIso('')).toBeNull();
  });

  it('lists image URLs imageUrl first, then uploaded copies, without repeats', () => {
    expect(
      resolveImages({
        imageUrl: 'https://img/a.png',
        image: [{ downloadURL: 'https://img/a.png' }, { downloadURL: 'https://img/b.png' }, {}],
      })
    ).toEqual(['https://img/a.png', 'https://img/b.png']);
  });

  it('flags expired and expiring-within-90-days', () => {
    expect(expiryFlags({ expDate: inDays(-1) }, NOW)).toEqual({
      isExpired: true,
      isExpiringSoon: false,
    });
    expect(expiryFlags({ expDate: inDays(30) }, NOW)).toEqual({
      isExpired: false,
      isExpiringSoon: true,
    });
    expect(expiryFlags({ expDate: inDays(120) }, NOW).isExpiringSoon).toBe(false);
    expect(expiryFlags({}, NOW)).toEqual({ isExpired: false, isExpiringSoon: false });
  });
});

describe('lists', () => {
  const items = [
    cert({ id: 'a', name: 'Azure Admin', code: 'AZ-104', issuer: 'Microsoft', display_order: 2 }),
    cert({ id: 'b', name: 'SAA', issuer: 'AWS', featured: true, display_order: 5 }),
    cert({ id: 'c', name: 'Terraform', issuer: 'HashiCorp', display: false, featured: true }),
    cert({ id: 'd', name: 'Old', issuer: 'Microsoft', featured: true, display_order: 1 }),
  ];

  it('computes the stats strip', () => {
    const stats = computeStats(
      [...items, cert({ id: 'e', issuer: 'AWS', expDate: inDays(10) })],
      NOW
    );
    expect(stats).toMatchObject({ total: 5, shown: 4, featured: 3, expiringSoon: 1 });
    expect(stats.topIssuer[1]).toBe(2);
  });

  it('filters the catalog by search text across name, code and issuer, and by issuer', () => {
    expect(filterCatalog(items, { search: 'az-104', issuer: '' }).map((c) => c.id)).toEqual(['a']);
    expect(filterCatalog(items, { search: 'hashi', issuer: '' }).map((c) => c.id)).toEqual(['c']);
    expect(filterCatalog(items, { search: '', issuer: 'Microsoft' }).map((c) => c.id)).toEqual([
      'a',
      'd',
    ]);
    expect(issuerList(items)).toEqual(['AWS', 'HashiCorp', 'Microsoft']);
  });

  it('orders featured by display order, missing order last', () => {
    expect(featuredCerts(items).map((c) => c.id)).toEqual(['d', 'b', 'c']);
  });

  it('lists hidden certs as anything not display: true', () => {
    expect(hiddenCerts([...items, { _docId: 'x' }]).map((c) => c._docId)).toEqual(['c', 'x']);
  });
});

describe('renewalRows', () => {
  it('keeps expired and within-180-days certs, soonest first, with days left', () => {
    const rows = renewalRows(
      [
        cert({ id: 'later', expDate: inDays(150) }),
        cert({ id: 'past', expDate: inDays(-3) }),
        cert({ id: 'far', expDate: inDays(400) }),
        cert({ id: 'none' }),
        cert({ id: 'soon', expDate: inDays(17) }),
      ],
      NOW
    );
    expect(rows.map((r) => [r.cert.id, r.daysLeft, r.expired])).toEqual([
      ['past', -3, true],
      ['soon', 17, false],
      ['later', 150, false],
    ]);
    expect(rows[1].due).toBe(inDays(17));
  });

  it('never reports 0 days for a cert that expired less than a day ago', () => {
    // Expiry is a calendar date (midnight). At noon, a cert that expired at
    // midnight is half a day past: it must read 1 day ago, not 0, and one due
    // at the next midnight has 1 day left.
    const noon = NOW + 12 * 3600000;
    const rows = renewalRows(
      [
        cert({ id: 'todayMidnight', expDate: inDays(0) }),
        cert({ id: 'tomorrow', expDate: inDays(1) }),
      ],
      noon
    );
    expect(rows.map((r) => [r.cert.id, r.daysLeft, r.expired])).toEqual([
      ['todayMidnight', -1, true],
      ['tomorrow', 1, false],
    ]);
  });
});

describe('verification source', () => {
  it('tells Credly badges from other links and none', () => {
    expect(verificationSource({ verifyUrl: 'https://www.credly.com/badges/1' })).toBe('credly');
    expect(verificationSource({ verifyUrl: 'https://credly.com.evil.test/x' })).toBe('link');
    expect(verificationSource({ verifyUrl: 'http://www.credly.com/badges/1' })).toBe('link');
    expect(verificationSource({})).toBe('none');
    expect(
      verificationCounts([
        { verifyUrl: 'https://credly.com/b' },
        { verifyUrl: 'https://learn.microsoft.com/x' },
        {},
        {},
      ])
    ).toEqual({ credly: 1, link: 1, none: 2 });
  });
});

describe('diffSnapshot', () => {
  it('reports added, changed and removed against the published items', () => {
    const items = [
      cert({ id: 'same', name: 'Same', issuer: 'AWS', expDate: '2027-01-01T00:00:00.000Z' }),
      cert({ id: 'renamed', name: 'New name', issuer: 'AWS', display_order: 3 }),
      cert({ id: 'new', name: 'Brand new', issuer: 'AWS' }),
      cert({ id: 'hidden', name: 'Hidden now', issuer: 'AWS', display: false }),
    ];
    const snapshot = [
      { id: 'same', name: 'Same', issuer: 'AWS', expDate: '2027-01-01T00:00:00.000Z' },
      { id: 'renamed', name: 'Old name', issuer: 'AWS', displayOrder: 3 },
      { id: 'hidden', name: 'Hidden now', issuer: 'AWS' },
      { id: 'deleted', name: 'Gone', issuer: 'AWS' },
    ];
    const diff = diffSnapshot(items, snapshot);
    expect(diff.added.map((c) => c._docId)).toEqual(['new']);
    expect(diff.changed).toEqual([{ cert: items[1], fields: ['name'] }]);
    expect(diff.removed.map((s) => s.id)).toEqual(['hidden', 'deleted']);
    expect(diff.total).toBe(4);
  });

  it('is empty when the snapshot matches', () => {
    const items = [cert({ id: 'a', name: 'A', issuer: 'AWS', certState: true })];
    expect(
      diffSnapshot(items, [{ id: 'a', name: 'A', issuer: 'AWS', certState: true }]).total
    ).toBe(0);
  });
});
