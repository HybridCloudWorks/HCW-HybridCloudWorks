/**
 * The Certifications Hub's pure helpers: the numbers and lists every tab
 * renders are computed here, so the page tests only check they are shown.
 * Dates are calendar days throughout (ADR 0033, Spotlight slice).
 */
import { describe, it, expect } from 'vitest';

import {
  computeStats,
  daysToExpiry,
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
  validateCertForm,
  verificationCounts,
  verificationSource,
} from './certView';

// Local noon, so "today" is the same calendar day in every zone the test runs in.
const NOW = new Date(2026, 8, 14, 12).getTime();
const inDays = (n) => {
  const d = new Date(2026, 8, 14 + n, 12);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const cert = (over) => ({ _docId: over.id || over._docId, display: true, ...over });

describe('reading a cert document', () => {
  it('reads issuer from a string or the first of an array', () => {
    expect(issuerOf({ issuer: 'Microsoft' })).toBe('Microsoft');
    expect(issuerOf({ issuer: ['AWS', 'Other'] })).toBe('AWS');
    expect(issuerOf({ issuer: [] })).toBe('Unknown');
    expect(issuerOf({})).toBe('Unknown');
  });

  it('reads the calendar day of strings, Timestamps and seconds, and writes a plain day', () => {
    expect(toIso('2026-10-01T00:00:00.000Z')).toBe('2026-10-01');
    // The leading day as written, whatever offset follows — never a day early.
    expect(toIso('2026-10-01T23:30:00-06:00')).toBe('2026-10-01');
    expect(toIso('2026-10-01')).toBe('2026-10-01');
    expect(toIso({ seconds: Date.UTC(2026, 8, 14) / 1000 })).toBe('2026-09-14');
    expect(toIso({ toDate: () => new Date(Date.UTC(2026, 8, 14)) })).toBe('2026-09-14');
    expect(toIso(null)).toBe('');
    expect(toIso('junk')).toBe('');
    expect(fromIso('2026-10-01')).toBe('2026-10-01');
    expect(fromIso('2026-02-30')).toBeNull();
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

  it('flags expired (today past the expiry day) and expiring-within-90-days', () => {
    expect(expiryFlags({ expDate: inDays(-1) }, NOW)).toEqual({
      isExpired: true,
      isExpiringSoon: false,
    });
    // Valid through its last day: on the day itself it is expiring, not expired.
    expect(expiryFlags({ expDate: inDays(0) }, NOW)).toEqual({
      isExpired: false,
      isExpiringSoon: true,
    });
    expect(expiryFlags({ expDate: inDays(30) }, NOW)).toEqual({
      isExpired: false,
      isExpiringSoon: true,
    });
    expect(expiryFlags({ expDate: inDays(120) }, NOW).isExpiringSoon).toBe(false);
    expect(expiryFlags({}, NOW)).toEqual({ isExpired: false, isExpiringSoon: false });
    expect(daysToExpiry({ expDate: `${inDays(3)}T00:00:00.000Z` }, NOW)).toBe(3);
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

  it('orders featured by the global display order, missing order last', () => {
    expect(featuredCerts(items).map((c) => c.id)).toEqual(['d', 'b', 'c']);
  });

  it('lists hidden certs as anything not display: true', () => {
    expect(hiddenCerts([...items, { _docId: 'x' }]).map((c) => c._docId)).toEqual(['c', 'x']);
  });
});

describe('renewalRows', () => {
  it('keeps expired and within-180-days certs, soonest first, with calendar days left', () => {
    const rows = renewalRows(
      [
        cert({ id: 'later', expDate: inDays(150), renewalDate: inDays(120) }),
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
    expect(rows[0].due).toBe(inDays(-3));
    expect(rows[2].renewalDate).toBe(inDays(120));
    // Expired yesterday reads as one day ago, never zero.
    expect(renewalRows([cert({ id: 'y', expDate: inDays(-1) })], NOW)[0].daysLeft).toBe(-1);
  });
});

describe('validateCertForm', () => {
  const base = { name: 'X', issueDate: '', expDate: '', renewalDate: '', display_order: 1 };

  it('names the field at fault, and passes a correct form', () => {
    expect(validateCertForm(base)).toEqual({});
    expect(validateCertForm({ ...base, name: ' ' }).name).toMatch(/required/);
    expect(
      validateCertForm({ ...base, issueDate: '2026-05-01', expDate: '2026-04-30' }).expDate
    ).toMatch(/on or after/);
    expect(validateCertForm({ ...base, expDate: '2026-02-30' }).expDate).toMatch(/real date/);
    expect(validateCertForm({ ...base, verifyUrl: 'credly.com/x' }).verifyUrl).toMatch(/http/);
    expect(
      validateCertForm({ ...base, imageUrl: '/api/public/media/certifications/c/images/b.png' })
    ).toEqual({});
    expect(validateCertForm({ ...base, display_order: 0 })).toEqual({});
    expect(validateCertForm({ ...base, display_order: -1 }).display_order).toBeDefined();
    expect(validateCertForm({ ...base, display_order: '2.5' }).display_order).toBeDefined();
    expect(
      validateCertForm({ ...base, evidence: [{ label: 'T', url: 'ftp://x' }] })['evidence.0']
    ).toMatch(/http/);
  });
});

describe('verification', () => {
  it('classifies the source the re-verify timer can use', () => {
    expect(verificationSource({ verifyUrl: 'https://www.credly.com/badges/x' })).toBe('credly');
    expect(verificationSource({ verifyUrl: 'https://example.com/verify' })).toBe('link');
    expect(verificationSource({})).toBe('none');
    expect(
      verificationCounts([
        { verifyUrl: 'https://credly.com/a' },
        { verifyUrl: 'https://other/b' },
        {},
        {},
      ])
    ).toEqual({ credly: 1, link: 1, none: 2 });
  });
});

describe('diffSnapshot', () => {
  it('reports added, changed (by public field, featured included) and removed', () => {
    const items = [
      cert({ id: 'a', name: 'A', issuer: 'MS', display_order: 1, featured: true }),
      cert({ id: 'b', name: 'B', issuer: 'MS', display_order: 2 }),
      cert({ id: 'c', name: 'C', issuer: 'MS', display: false }),
    ];
    const snapshot = [
      { id: 'a', name: 'A', issuer: 'MS', displayOrder: 1 },
      { id: 'c', name: 'C', issuer: 'MS' },
    ];
    const diff = diffSnapshot(items, snapshot);
    expect(diff.added.map((c) => c._docId)).toEqual(['b']);
    expect(diff.changed).toEqual([{ cert: items[0], fields: ['featured'] }]);
    expect(diff.removed.map((s) => s.id)).toEqual(['c']);
    expect(diff.total).toBe(3);
  });
});
