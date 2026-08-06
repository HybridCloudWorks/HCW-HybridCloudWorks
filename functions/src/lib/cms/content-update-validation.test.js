import { describe, it, expect } from 'vitest';
import {
  FORBIDDEN_CONTENT_UPDATE_KEYS,
  validateAndNormalizeUpdateContentItemUpdates,
  normalizeContentUpdatesForBlogOnly,
  normalizeStatusForBlogOnly,
  normalizeCurrentStatusForBlogOnly,
  normalizeProviderName,
} from './content-update-validation.js';

describe('validateAndNormalizeUpdateContentItemUpdates', () => {
  it('rejects non-objects, empty updates, and >80 fields', () => {
    expect(() => validateAndNormalizeUpdateContentItemUpdates(null)).toThrow(/must be an object/);
    expect(() => validateAndNormalizeUpdateContentItemUpdates([])).toThrow(/must be an object/);
    expect(() => validateAndNormalizeUpdateContentItemUpdates({})).toThrow(/at least one field/);
    const many = Object.fromEntries(Array.from({ length: 81 }, (_, i) => [`f${i}`, 1]));
    expect(() => validateAndNormalizeUpdateContentItemUpdates(many)).toThrow(/exceeds 80 fields/);
  });

  it('refuses every protected workflow/identity field', () => {
    for (const field of FORBIDDEN_CONTENT_UPDATE_KEYS) {
      expect(() => validateAndNormalizeUpdateContentItemUpdates({ [field]: 'x' })).toThrow(
        new RegExp(`protected field`)
      );
    }
    // The state machine's fields specifically — the reason the denylist exists.
    for (const f of ['contentStatus', 'Live', 'updatedBy', 'Published At']) {
      expect(FORBIDDEN_CONTENT_UPDATE_KEYS.has(f)).toBe(true);
    }
  });

  it('writes dual-cased pairs for title, summary, tags, and cloud provider', () => {
    const out = validateAndNormalizeUpdateContentItemUpdates({
      title: '  Hello  ',
      summary: 'S',
      tags: [' a ', '', 'b'],
      cloudProvider: 'azure',
    });
    expect(out.title).toBe('Hello');
    expect(out.Title).toBe('Hello');
    expect(out.summary).toBe('S');
    expect(out.Summary).toBe('S');
    expect(out.tags).toEqual(['a', 'b']);
    expect(out.Tags).toEqual(['a', 'b']);
    expect(out.cloudProvider).toBe('Azure');
    expect(out['Cloud Provider']).toBe('Azure');
  });

  it('validates URL-suffixed fields and rejects non-http schemes', () => {
    const out = validateAndNormalizeUpdateContentItemUpdates({
      sourceUrl: ' https://example.com/a ',
      diagramUrl: '',
    });
    expect(out.sourceUrl).toBe('https://example.com/a');
    expect(out.diagramUrl).toBe('');
    expect(() =>
      validateAndNormalizeUpdateContentItemUpdates({ heroImageUrl: 'javascript:alert(1)' })
    ).toThrow(/http\(s\) URL/);
    expect(() => validateAndNormalizeUpdateContentItemUpdates({ docLink: 'not a url' })).toThrow(
      /valid URL/
    );
  });

  it('parses date-like string fields to Dates and rejects garbage', () => {
    const out = validateAndNormalizeUpdateContentItemUpdates({ fetchedAt: '2026-01-01' });
    expect(out.fetchedAt).toBeInstanceOf(Date);
    expect(() =>
      validateAndNormalizeUpdateContentItemUpdates({ scheduledPublishDate: 'yesterdayish' })
    ).toThrow(/valid date/);
  });

  it('enforces the large/small string ceilings by field name', () => {
    const big = 'x'.repeat(13_000);
    expect(() => validateAndNormalizeUpdateContentItemUpdates({ note: big })).toThrow(
      /exceeds 12000 characters/
    );
    // Draft/Html/Code fields get the 120k ceiling.
    expect(validateAndNormalizeUpdateContentItemUpdates({ blogDraft: big }).blogDraft).toBe(big);
  });

  it('rejects an invalid cloud provider and unsupported value types', () => {
    expect(() => validateAndNormalizeUpdateContentItemUpdates({ cloudProvider: 'ibm' })).toThrow(
      /must be one of/
    );
    expect(() => validateAndNormalizeUpdateContentItemUpdates({ fn: () => {} })).toThrow(
      /Unsupported value type/
    );
  });

  it('passes null through and skips undefined, like the source', () => {
    const out = validateAndNormalizeUpdateContentItemUpdates({ heroPrompt: null, gone: undefined, kept: 1 });
    expect(out).toEqual({ heroPrompt: null, kept: 1 });
  });
});

describe('normalizeContentUpdatesForBlogOnly', () => {
  it('re-resolves publishTarget with the doc type fallback only when present', () => {
    expect(
      normalizeContentUpdatesForBlogOnly({ publishTarget: 'nonsense', type: 'framework' })
        .publishTarget
    ).toBe('framework');
    expect(normalizeContentUpdatesForBlogOnly({ Title: 'x' })).not.toHaveProperty('publishTarget');
  });

  it('collapses news-era statuses and forces approvedForNews off', () => {
    expect(normalizeContentUpdatesForBlogOnly({ contentStatus: 'published_news' }).contentStatus).toBe(
      'published'
    );
    expect(normalizeContentUpdatesForBlogOnly({ approvedForNews: true }).approvedForNews).toBe(false);
  });
});

describe('status normalizers', () => {
  it('maps the retired news statuses onto blog equivalents', () => {
    expect(normalizeStatusForBlogOnly('published_news')).toBe('published');
    expect(normalizeStatusForBlogOnly('published_both')).toBe('published');
    expect(normalizeStatusForBlogOnly('approved_news')).toBe('approved');
    expect(normalizeStatusForBlogOnly('editing')).toBe('editing');
  });

  it('defaults an absent current status to ingested', () => {
    expect(normalizeCurrentStatusForBlogOnly(undefined)).toBe('ingested');
    expect(normalizeCurrentStatusForBlogOnly('')).toBe('ingested');
  });
});

describe('normalizeProviderName', () => {
  it('canonicalizes provider spellings and rejects unknowns', () => {
    expect(normalizeProviderName('AWS')).toBe('Aws');
    expect(normalizeProviderName('google cloud')).toBe('Gcp');
    expect(normalizeProviderName('Fin-Ops')).toBe('Finops');
    expect(normalizeProviderName('oracle')).toBe('');
  });
});
