// @vitest-environment node
/**
 * The About page's certification normaliser, over the shapes the published
 * snapshot and the build-time JSON actually produce: three spellings per
 * field, four shapes of date, three of boolean, and a badge image that is an
 * upload object, an array of them, or a bare URL.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanUrl,
  firstDefined,
  normalizeCertification,
  normalizeIssuer,
  resolveImageUrl,
  toBool,
  toDate,
} from './certifications';

describe('firstDefined', () => {
  it('takes the first key that is neither undefined nor null, in order', () => {
    expect(firstDefined({ Name: 'b', name: 'a' }, ['name', 'Name'])).toBe('a');
    expect(firstDefined({ name: null, Name: 'b' }, ['name', 'Name'])).toBe('b');
    expect(firstDefined({ name: 0 }, ['name'])).toBe(0);
    expect(firstDefined({}, ['name'])).toBeUndefined();
  });
});

describe('toDate', () => {
  it('reads a calendar day at local noon, so the day shown is the day named', () => {
    const d = toDate('2026-10-01');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 1, 12]);
  });

  it('takes the leading day of a timestamp string the same way', () => {
    const d = toDate('2026-10-01T23:30:00.000Z');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 1, 12]);
  });

  it('parses any other date string with Date, and drops one Date cannot read', () => {
    expect(toDate('Oct 1, 2026').getFullYear()).toBe(2026);
    expect(toDate('not a date')).toBeUndefined();
  });

  it('accepts epoch milliseconds and a Firestore Timestamp', () => {
    expect(toDate(86400000).getTime()).toBe(86400000);
    const stamp = { toDate: () => new Date(5000) };
    expect(toDate(stamp).getTime()).toBe(5000);
  });

  it('is undefined for nothing, and for a shape it does not know', () => {
    expect(toDate(undefined)).toBeUndefined();
    expect(toDate(null)).toBeUndefined();
    expect(toDate('')).toBeUndefined();
    expect(toDate(0)).toBeUndefined();
    expect(toDate(true)).toBeUndefined();
    expect(toDate({ seconds: 1 })).toBeUndefined();
  });
});

describe('toBool', () => {
  it('reads booleans, the strings "true"/"TRUE", and non-zero numbers', () => {
    expect(toBool(true)).toBe(true);
    expect(toBool(false)).toBe(false);
    expect(toBool('true')).toBe(true);
    expect(toBool('TRUE')).toBe(true);
    expect(toBool('false')).toBe(false);
    expect(toBool('yes')).toBe(false);
    expect(toBool(1)).toBe(true);
    expect(toBool(0)).toBe(false);
  });

  it('is undefined for nothing and for any other type', () => {
    expect(toBool(undefined)).toBeUndefined();
    expect(toBool(null)).toBeUndefined();
    expect(toBool({})).toBeUndefined();
    expect(toBool([])).toBeUndefined();
  });
});

describe('normalizeIssuer', () => {
  it('takes the first of an array, and "Other" for an empty one or nothing', () => {
    expect(normalizeIssuer(['Microsoft', 'Google'])).toBe('Microsoft');
    expect(normalizeIssuer([])).toBe('Other');
    expect(normalizeIssuer(undefined)).toBe('Other');
    expect(normalizeIssuer('')).toBe('Other');
  });

  it('fixes the spellings the data has carried', () => {
    expect(normalizeIssuer('Microsft')).toBe('Microsoft');
    expect(normalizeIssuer('Google Cloud Partners')).toBe('Google Cloud Partners');
    expect(normalizeIssuer(' google cloud partner ')).toBe('Google Cloud Partners');
    expect(normalizeIssuer('GOOGLE CLOUD')).toBe('Google Cloud');
  });

  it('passes any other issuer through untouched, including non-strings', () => {
    expect(normalizeIssuer('HashiCorp')).toBe('HashiCorp');
    expect(normalizeIssuer(' Amazon ')).toBe(' Amazon ');
    expect(normalizeIssuer(42)).toBe(42);
  });
});

describe('cleanUrl', () => {
  it('keeps absolute, rooted and data URLs, case-insensitively', () => {
    expect(cleanUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(cleanUrl('HTTPS://example.com/a.png')).toBe('HTTPS://example.com/a.png');
    expect(cleanUrl('/img/a.png')).toBe('/img/a.png');
    expect(cleanUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('roots a bare path and trims whitespace', () => {
    expect(cleanUrl(' img/a.png ')).toBe('/img/a.png');
  });

  it('drops the decommissioned storage hosts (#518), blanks and non-strings', () => {
    expect(cleanUrl('https://storage.googleapis.com/b/a.png')).toBeUndefined();
    expect(cleanUrl('http://firebasestorage.googleapis.com/v0/b/a.png')).toBeUndefined();
    expect(cleanUrl('')).toBeUndefined();
    expect(cleanUrl('   ')).toBeUndefined();
    expect(cleanUrl(undefined)).toBeUndefined();
    expect(cleanUrl({ url: 'x' })).toBeUndefined();
  });
});

describe('resolveImageUrl', () => {
  it('falls past a dead legacy upload to the published plain URL (an edited, migrated row)', () => {
    expect(
      resolveImageUrl({
        image: [
          {
            downloadURL:
              'https://firebasestorage.googleapis.com/v0/b/b.appspot.com/o/certifications%2Fc1%2Fimages%2Fold.png?alt=media',
          },
        ],
        credentialImage: '/api/public/media/certifications/c1/images/new.png',
      })
    ).toBe('/api/public/media/certifications/c1/images/new.png');
  });

  it('prefers the upload object, reading its first URL-ish field', () => {
    expect(resolveImageUrl({ image: { downloadURL: '/a.png' }, imageUrl: '/b.png' })).toBe(
      '/a.png'
    );
    expect(resolveImageUrl({ badge: { url: 'x/c.png' } })).toBe('/x/c.png');
    expect(resolveImageUrl({ CredentialImage: { src: '/d.png' } })).toBe('/d.png');
  });

  it('unwraps an array of uploads, taking the first', () => {
    expect(resolveImageUrl({ image: [{ downloadUrl: '/e.png' }, { downloadUrl: '/f.png' }] })).toBe(
      '/e.png'
    );
    expect(resolveImageUrl({ image: [], imageUrl: '/g.png' })).toBe('/g.png');
  });

  it('falls back to a plain URL field when the upload yields nothing', () => {
    expect(
      resolveImageUrl({
        image: { downloadURL: 'https://storage.googleapis.com/x' },
        image_url: '/h.png',
      })
    ).toBe('/h.png');
    expect(resolveImageUrl({ credentialImage: '/i.png' })).toBe('/i.png');
    expect(resolveImageUrl({})).toBeUndefined();
  });
});

describe('normalizeCertification', () => {
  it('reads the camelCase shape the published snapshot carries', () => {
    const row = normalizeCertification({
      id: 'c1',
      name: 'Azure Solutions Architect Expert',
      issuer: 'Microsoft',
      issueDate: '2024-03-15',
      expDate: '2026-03-15',
      certState: true,
      code: 'AZ-305',
      verifyUrl: 'https://learn.microsoft.com/verify/1',
      image: { downloadURL: '/badges/az-305.png' },
      displayOrder: 2,
      tags: ['azure', 'architecture'],
      display: true,
      featured: true,
    });
    expect(row).toEqual({
      id: 'c1',
      name: 'Azure Solutions Architect Expert',
      issuer: 'Microsoft',
      issue_date: new Date(2024, 2, 15, 12),
      exp_date: new Date(2026, 2, 15, 12),
      certState: true,
      code: 'AZ-305',
      verify_url: 'https://learn.microsoft.com/verify/1',
      image_url: '/badges/az-305.png',
      display_order: 2,
      tags: ['azure', 'architecture'],
      display: true,
      featured: true,
    });
  });

  it('reads the snake_case and PascalCase spellings the build-time JSON has used', () => {
    const snake = normalizeCertification({
      id: 'c2',
      Name: 'Terraform Associate',
      Issuer: 'HashiCorp',
      issue_date: '2023-01-02',
      is_valid: 'true',
      Code: 'TA-003',
      verify_url: '/verify/2',
      image_url: 'badges/ta.png',
      display_order: 7,
      Tags: ['iac'],
      Display: true,
    });
    expect(snake.name).toBe('Terraform Associate');
    expect(snake.issuer).toBe('HashiCorp');
    expect(snake.issue_date).toEqual(new Date(2023, 0, 2, 12));
    expect(snake.exp_date).toBeUndefined();
    expect(snake.certState).toBe(true);
    expect(snake.code).toBe('TA-003');
    expect(snake.verify_url).toBe('/verify/2');
    expect(snake.image_url).toBe('/badges/ta.png');
    expect(snake.display_order).toBe(7);
    expect(snake.tags).toEqual(['iac']);
    expect(snake.display).toBe(true);
    expect(snake.featured).toBe(false);
  });

  it('fills the defaults a sparse row leaves open', () => {
    const row = normalizeCertification({ id: 'c3' });
    expect(row).toEqual({
      id: 'c3',
      name: undefined,
      issuer: 'Other',
      issue_date: undefined,
      exp_date: undefined,
      certState: undefined,
      code: undefined,
      verify_url: undefined,
      image_url: undefined,
      display_order: 999,
      tags: [],
      display: false,
      featured: false,
    });
  });

  it('treats display and featured as flags only when literally true', () => {
    expect(normalizeCertification({ display: 'true', featured: 1 })).toMatchObject({
      display: false,
      featured: false,
    });
  });
});
