/**
 * The study-guide outlines are generated data with a date on them, and the
 * same rule applies as to the catalogue: a claim with no date attached that
 * nothing ever checks is how #461 happened. These hold the shape the detail
 * page renders from, the freshness stamp, and the join back to the catalogue.
 */
import { describe, expect, it } from 'vitest';
import { DATA_AS_OF, DATA_SOURCE, STUDY_GUIDES, guideKeyFor, outlineFor } from './study-guides';
import { certifications } from './certifications';
import { todayIso } from '@/lib/certStatus';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const keys = Object.keys(STUDY_GUIDES);

describe('Azure study-guide outlines', () => {
  it('stamps the day they were last read from Microsoft Learn', () => {
    expect(DATA_AS_OF).toMatch(ISO_DATE);
    // Local calendar, like every other DATA_AS_OF here: the generator stamps
    // the clock of the machine that must also run this test.
    expect(DATA_AS_OF <= todayIso()).toBe(true);
    expect(DATA_SOURCE.url).toMatch(/^https:\/\/learn\.microsoft\.com\//);
  });

  it('carries an outline for every live catalogue exam that has a study guide', () => {
    // Retired exams are skipped on purpose: Learn redirects their guides to
    // the browse page, and a redirect parses as a valid page with no areas.
    const expected = certifications
      .filter((c) => c.studyGuideUrl && c.status !== 'retired')
      .map((c) => guideKeyFor(c.studyGuideUrl));
    const missing = expected.filter((key) => !STUDY_GUIDES[key]);
    expect(missing, 'exams with a studyGuideUrl but no outline').toEqual([]);
  });

  it('has no outline for an exam the catalogue does not carry', () => {
    // An orphan means a URL was renamed in the catalogue and the outline
    // was not regenerated — stale data that no page can reach.
    const known = new Set(certifications.map((c) => guideKeyFor(c.studyGuideUrl)).filter(Boolean));
    const orphans = keys.filter((key) => !known.has(key));
    expect(orphans).toEqual([]);
  });

  it('gives every outline at least one weighted area, and every area a name and a slug', () => {
    for (const key of keys) {
      const guide = STUDY_GUIDES[key];
      expect(guide.areas.length, `${key} has no areas`).toBeGreaterThan(0);
      expect(guide.sourceUrl, key).toMatch(/^https:\/\/learn\.microsoft\.com\//);
      for (const area of guide.areas) {
        expect(area.name, key).toBeTruthy();
        expect(area.slug, key).toMatch(/^[a-z0-9-]+$/);
        // The anchor is read off the Learn page, never derived, so it is a
        // string or an honest null — never the slug pretending to be one.
        expect(
          area.anchor === null || typeof area.anchor === 'string',
          `${key}/${area.slug} anchor`
        ).toBe(true);
        expect(Array.isArray(area.sections), key).toBe(true);
      }
    }
  });

  it('keeps each area either sectioned or flat, never both', () => {
    // A guide that lists objectives under h4 sub-headings stores them in
    // `sections`; one that lists them flat stores them in `objectives`.
    // Both populated would print every objective twice.
    for (const key of keys) {
      for (const area of STUDY_GUIDES[key].areas) {
        if (area.sections.length > 0) {
          expect(area.objectives, `${key}/${area.slug}`).toEqual([]);
        }
      }
    }
  });

  it('resolves a catalogue URL to its outline and refuses what it does not have', () => {
    const az104 = certifications.find((c) => c.code === 'AZ-104');
    expect(az104?.studyGuideUrl).toBeTruthy();
    const outline = outlineFor(az104.studyGuideUrl);
    expect(outline?.examCode).toBe('AZ-104');
    expect(outline.areas[0].name).toBe('Manage Azure identities and governance');
    expect(outline.areas[0].anchor).toBe('manage-azure-identities-and-governance-2025');

    expect(
      outlineFor(
        'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/zz-000'
      )
    ).toBeNull();
    expect(outlineFor(undefined)).toBeNull();
    expect(outlineFor('')).toBeNull();
  });

  it('keys by the study-guide URL tail, which is unique where exam codes are not', () => {
    // The catalogue's applied-skills entries share site-assigned codes, so
    // `code` cannot be the join. A URL tail can only name one guide.
    expect(
      guideKeyFor(
        'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-104'
      )
    ).toBe('az-104');
    expect(guideKeyFor('https://learn.microsoft.com/.../study-guides/AZ-104/?wt.mc_id=x')).toBe(
      'az-104'
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
