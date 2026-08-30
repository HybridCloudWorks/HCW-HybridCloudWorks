/**
 * The manifest route, and the field list it must not let drift.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ARTICLE_FIELDS,
  PUBLISHED_PREDICATE,
  PUBLISHED_QUERY,
  createPublicContentManifestHandlers,
  projectArticle,
} from './public-content-manifest.js';

const REPO = join(fileURLToPath(new URL('../../..', import.meta.url)));

describe('ARTICLE_FIELDS stays in step with scripts/', () => {
  /**
   * Read as TEXT rather than imported: `scripts/` is a separate npm package
   * with its own dependencies, and importing across that boundary from a
   * functions test coupled two installs that are otherwise independent.
   */
  function scriptsFieldList() {
    const source = readFileSync(join(REPO, 'scripts', 'build-content-manifest.mjs'), 'utf8');
    const block = source.match(/ARTICLE_FIELDS = Object\.freeze\(\[([\s\S]*?)\]\)/);
    if (!block) throw new Error('ARTICLE_FIELDS not found in scripts/build-content-manifest.mjs');
    return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }

  it('finds a plausible list at all — a silent parse failure would pass everything', () => {
    expect(scriptsFieldList().length).toBeGreaterThan(30);
  });

  it('is exactly the list scripts/ projects with, in the same order', () => {
    // Drift here is invisible: a field added there but not here is simply
    // absent from every pre-rendered article, which presents as a rendering
    // bug in the static HTML and nowhere else.
    expect([...ARTICLE_FIELDS]).toEqual(scriptsFieldList());
  });
});

describe('projectArticle', () => {
  it('keeps allowlisted fields and drops everything else', () => {
    const out = projectArticle({
      id: 'a1',
      slug: 'x',
      cloudProvider: 'azure',
      Title: 'T',
      internalReviewNotes: 'SECRET',
      forgeGrade: { overall: 9 },
      _etag: 'etag',
    });
    expect(out).toEqual({ id: 'a1', slug: 'x', cloudProvider: 'azure', Title: 'T' });
    expect(out.internalReviewNotes).toBeUndefined();
    expect(out.forgeGrade).toBeUndefined();
    expect(out._etag).toBeUndefined();
  });

  it('omits absent fields rather than emitting undefined', () => {
    expect(Object.keys(projectArticle({ id: 'a1' }))).toEqual(['id']);
  });

  it('survives null and undefined without throwing', () => {
    expect(projectArticle(null)).toEqual({});
    expect(projectArticle(undefined)).toEqual({});
  });
});

describe('getManifest', () => {
  const handlers = (queryDocs) => createPublicContentManifestHandlers({ store: { queryDocs } });

  it('asks for published documents in the query, not by filtering after', () => {
    // The distinction is the safety property: a filter applied after the fact
    // is one refactor away from being dropped, and the failure mode is an
    // unpublished article on a public URL.
    //
    // COMPARED WHOLE, against a string rebuilt from ARTICLE_FIELDS. Shape
    // assertions are not enough and this test learned it twice: substring
    // checks passed a query with the clause commented out (`-- WHERE ...`),
    // and the hardened version still passed `... OR true`. Nothing short of
    // comparing the entire string catches every permissive predicate, and this
    // is the string that decides whether an unpublished document reaches a
    // public URL.
    //
    // Rebuilding the expectation rather than pasting it keeps the field list
    // as the single source — a field added to ARTICLE_FIELDS updates both
    // sides — while still failing on any edit to the predicate or the shape.
    const projection = ARTICLE_FIELDS.map((f) => `c["${f}"]`).join(', ');
    expect(PUBLISHED_QUERY).toBe(
      `SELECT ${projection} FROM c WHERE ${PUBLISHED_PREDICATE}`
    );
    expect(PUBLISHED_PREDICATE).toBe(
      "c.contentStatus = 'published' OR c.Status = 'Published' OR c.status = 'published'"
    );
    expect(PUBLISHED_QUERY).not.toMatch(/--/);
    expect(PUBLISHED_QUERY).not.toMatch(/\/\*/);
  });

  it('projects in SQL so unlisted fields never leave Cosmos', () => {
    // The JS projection is defence in depth; this is the part that stops whole
    // documents — article bodies and internal fields alike — crossing the wire
    // for a daily bulk read.
    expect(PUBLISHED_QUERY).not.toMatch(/SELECT \*/);
    for (const field of ARTICLE_FIELDS) {
      expect(PUBLISHED_QUERY, `${field} missing from the projection`).toContain(`c["${field}"]`);
    }
    // Bracket quoting is what makes the spaced and cased names legal SQL.
    for (const spaced of ['Published At', 'Cloud Provider', 'Source URL', 'CD Url']) {
      expect(PUBLISHED_QUERY).toContain(`c["${spaced}"]`);
    }
  });

  it('projects every row and reports the count', async () => {
    const queryDocs = vi.fn().mockResolvedValue([
      { id: '1', slug: 'a', Title: 'A', internalNote: 'no' },
      { id: '2', slug: 'b', Title: 'B' },
    ]);
    const res = await handlers(queryDocs).getManifest({}, {});
    expect(res.status).toBe(200);
    expect(res.jsonBody.count).toBe(2);
    expect(res.jsonBody.items[0].internalNote).toBeUndefined();
    expect(queryDocs).toHaveBeenCalledWith('content', PUBLISHED_QUERY, []);
  });

  it('is uncacheable — a cached copy pre-renders yesterday’s corpus', () => {
    // Asserted on the constant rather than a live call so it cannot regress
    // behind a mocked store.
    return handlers(vi.fn().mockResolvedValue([])).getManifest({}, {}).then((res) => {
      expect(res.headers['Cache-Control']).toBe('no-store');
    });
  });

  it('returns an empty list rather than throwing when the store returns nothing', async () => {
    for (const empty of [[], null, undefined]) {
      const res = await handlers(vi.fn().mockResolvedValue(empty)).getManifest({}, {});
      expect(res.status).toBe(200);
      expect(res.jsonBody.items).toEqual([]);
    }
  });

  it('answers 500 without leaking the error, and logs it', async () => {
    const error = vi.fn();
    const res = await handlers(vi.fn().mockRejectedValue(new Error('cosmos exploded'))).getManifest(
      {},
      { error }
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.jsonBody)).not.toContain('cosmos exploded');
    expect(error).toHaveBeenCalled();
  });

  it('tolerates a bare invocation, as route-inventory makes', async () => {
    await expect(
      handlers(vi.fn().mockResolvedValue([])).getManifest(undefined, undefined)
    ).resolves.toMatchObject({ status: 200 });
  });
});
