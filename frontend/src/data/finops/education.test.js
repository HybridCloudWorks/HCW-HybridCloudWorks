/**
 * The FinOps Foundation catalogue is complete (#469 item 2).
 *
 * `education-catalogues.test.js` checks every provider against the calendar —
 * that no row's stored status has been overtaken by its own dates. It cannot
 * check the opposite failure, which is what actually happened here: a
 * certification the vendor offers and this file does not carry. Nothing about
 * four correct rows looks wrong, so the FinOps page advertised four of the
 * Foundation's six credentials for as long as anyone cared to look.
 *
 * So this names the six. A seventh appearing at the Foundation still needs a
 * human to notice, but one of these six quietly disappearing from the file
 * cannot happen silently again.
 *
 * Verified 2026-09-09 against https://learn.finops.org/ — the module header
 * carries the price, exam level and validity read from each row's own page.
 */
import { describe, it, expect } from 'vitest';
import { certifications, DATA_AS_OF, DATA_SOURCE } from './education';

/** Every credential the Foundation's catalogue listed on DATA_AS_OF. */
const FOUNDATION_CERTIFICATIONS = [
  'FinOps Certified Practitioner',
  'FinOps Certified Professional',
  'FinOps Certified Engineer',
  'FinOps Certified FOCUS Analyst',
  'FinOps Certified: AI Value',
  'FinOps Certified: Technology Value',
];

describe('the FinOps catalogue carries every certification the Foundation offers', () => {
  const active = certifications.filter((cert) => cert.status === 'active');

  it.each(FOUNDATION_CERTIFICATIONS)('lists %s', (title) => {
    expect(active.map((cert) => cert.title)).toContain(title);
  });

  it('lists exactly those six as active, so a course cannot creep in as a certification', () => {
    // The reason this is an equality and not a subset: "FinOps for Engineers"
    // was carried as a certification for months and is a training course. It
    // stays in the file as `retired` with that evidence, and it must not come
    // back as active.
    expect(active.map((cert) => cert.title).sort()).toEqual([...FOUNDATION_CERTIFICATIONS].sort());
  });

  it('points every row at the Foundation, not at a summary of it', () => {
    for (const cert of certifications) {
      expect(cert.learnUrl, cert.title).toMatch(/^https:\/\/learn\.finops\.org\//);
    }
    expect(DATA_SOURCE.url).toBe('https://learn.finops.org/');
  });

  it('states a price and a validity for every active row, since that is why a reader is here', () => {
    // The Foundation publishes both on every certification page and this file
    // is the only place the site records them; a row without them is a card
    // that cannot answer "what does it cost and how long does it last".
    for (const cert of active) {
      expect(cert.description, `${cert.title} price`).toMatch(/\$\d/);
      expect(cert.description, `${cert.title} validity`).toMatch(/\d+ months/);
    }
  });

  it('uses only the levels the page can colour and filter', () => {
    // `EducationPage` indexes LEVEL_META by `level` and would throw on a value
    // it does not know — the Foundation's own Beginner/Intermediate/Advanced
    // grades belong in the description, not here.
    for (const cert of certifications) {
      expect(['Practitioner', 'Professional', 'Expert'], cert.title).toContain(cert.level);
    }
  });

  it('has exactly one featured row for the hero card', () => {
    expect(certifications.filter((cert) => cert.featured)).toHaveLength(1);
  });

  it('was verified no earlier than the day the three missing rows were added', () => {
    expect(DATA_AS_OF >= '2026-09-09').toBe(true);
  });
});
