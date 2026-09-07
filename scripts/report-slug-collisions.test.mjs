import { describe, it, expect } from 'vitest';
import { parseDuplicateSkips, slugCollisions, formatReport } from './report-slug-collisions.mjs';

/** The two entries the 2026-09-07 manifest actually carries (issue #400). */
const SKIPPED = [
  'enable-ai-powered-discovery-of-azure-updates-with-microsoft-release-communicatio: duplicate slug (item 7MCkl1cSf7GGCgJxlCwZ); first occurrence kept',
  'enable-ai-powered-discovery-of-azure-updates-with-microsoft-release-communicatio: duplicate slug (item 7ZCmiOEIlWMg99xQHY0A); first occurrence kept',
];
const SLUG = 'enable-ai-powered-discovery-of-azure-updates-with-microsoft-release-communicatio';

describe('report-slug-collisions', () => {
  it('reads only the duplicate-slug skips, not the other two shapes', () => {
    expect(
      parseDuplicateSkips([
        ...SKIPPED,
        'abc123: no slug',
        'some-slug: no recognised provider (unset)',
        'not a skip line at all',
      ])
    ).toEqual([
      { slug: SLUG, id: '7MCkl1cSf7GGCgJxlCwZ' },
      { slug: SLUG, id: '7ZCmiOEIlWMg99xQHY0A' },
    ]);
    expect(parseDuplicateSkips()).toEqual([]);
  });

  it('groups a contested slug into the article that serves it and the ones that do not', () => {
    const rows = slugCollisions({
      routes: [`/azure/blog/${SLUG}`, '/azure/blog/something-else'],
      data: {
        [`article:${SLUG}`]: { id: '1k5ayjbEdYdo7NzvXIWW', title: 'Enable AI-Powered Discovery' },
        'article:something-else': { id: 'zzz', title: 'Fine' },
      },
      skipped: SKIPPED,
    });
    expect(rows).toEqual([
      {
        slug: SLUG,
        url: `/azure/blog/${SLUG}`,
        holder: { id: '1k5ayjbEdYdo7NzvXIWW', title: 'Enable AI-Powered Discovery' },
        unreachable: ['7MCkl1cSf7GGCgJxlCwZ', '7ZCmiOEIlWMg99xQHY0A'],
      },
    ]);
    expect(slugCollisions({})).toEqual([]);
  });

  it('says so plainly when the winner is not in the manifest either', () => {
    const [row] = slugCollisions({ skipped: SKIPPED });
    expect(row.holder).toBeNull();
    expect(row.url).toBeNull();
    expect(formatReport([row], { generatedAt: 'T', articles: 0 })).toContain(
      '_not in this manifest_'
    );
  });

  it('formats a paste-ready report, and a clean one when there is nothing to report', () => {
    const rows = slugCollisions({
      routes: [`/azure/blog/${SLUG}`],
      data: { [`article:${SLUG}`]: { id: '1k5ayjbEdYdo7NzvXIWW', title: 'Enable AI' } },
      skipped: SKIPPED,
    });
    const report = formatReport(rows, { generatedAt: '2026-09-07T07:01:12.492Z', articles: 22 });
    expect(report).toContain('22 published articles, 1 URL(s) claimed by more than one');
    expect(report).toContain('2 article(s) published with no URL at all');
    expect(report).toContain(`| \`/azure/blog/${SLUG}\` |`);
    expect(report).toContain('`1k5ayjbEdYdo7NzvXIWW` — Enable AI');
    expect(report).toContain('`7ZCmiOEIlWMg99xQHY0A`');

    const clean = formatReport([], { generatedAt: 'T', articles: 22, otherSkips: 3 });
    expect(clean).toContain('22 published articles, every one on its own URL');
    expect(clean).toContain('3 further manifest skip(s) are not slug collisions');
    expect(clean).not.toContain('| --- |');
  });
});
