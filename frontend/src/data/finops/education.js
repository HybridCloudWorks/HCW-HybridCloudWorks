/**
 * FinOps Foundation certification catalogue for /finops/education (#461,
 * item 11).
 *
 * Extracted from src/pages/finops/EducationPage.jsx, which carried the four
 * rows hard-coded with no record of when anyone had checked them. Verified
 * 2026-09-09 against learn.finops.org, where finops.org/certification/ now
 * redirects (301):
 *
 *   FinOps Certified Practitioner — listed, active, "Valid for 24 months",
 *     no formal prerequisites, self-paced course + exam $500, exam only $325
 *     (50 questions, 1 hour, 75% to pass).
 *     https://learn.finops.org/path/finops-certified-practitioner-self-paced
 *     https://learn.finops.org/finops-certified-practitioner-certification-exam
 *   FinOps Certified Professional — listed, active, Advanced, $500, "Valid
 *     for 24 Months"; enrolment requires a Practitioner or Engineer
 *     certification and six months of FinOps experience, and the exam
 *     requires the AI Value and Technology Value certifications plus a
 *     Professional Contribution.
 *     https://learn.finops.org/path/finops-certified-professional
 *   FinOps Certified Engineer — listed, active, Intermediate, "Self-paced +
 *     Exam Bundle: 10 hours; Exam only: 1 hour", exam only $325. This file
 *     used to call it "FinOps Engineer".
 *     https://learn.finops.org/page/finops-certified-engineer
 *   "FinOps for Platform Engineers" — no such certification is listed. The
 *     nearest thing, the "FinOps for Engineers" training course (a course,
 *     never a certification), reads "Not currently available" on
 *     https://learn.finops.org/path/finops-for-engineers and is absent from
 *     the catalogue. Kept as `retired` with that evidence rather than
 *     deleted; the Foundation publishes no retirement date for it. Its
 *     replacement on this page is the Engineer certification.
 *
 * The Foundation publishes no exam codes. `FOCP` is its own abbreviation
 * for the Practitioner credential (its badge assets are named `focpicon`);
 * the other `code` values are this site's labels, kept for the card layout
 * and the learning-path keys, not vendor identifiers.
 *
 * Not carried here yet, though listed by the Foundation on the same day:
 * FinOps Certified FOCUS Analyst, FinOps Certified: AI Value and FinOps
 * Certified: Technology Value.
 *
 * `status` and any dates are read through `@/lib/certStatus` at render time;
 * `src/data/education-catalogues.test.js` fails when a dated row is past.
 */
export const DATA_AS_OF = '2026-09-09';

export const DATA_SOURCE = {
  label: 'FinOps Foundation training catalogue',
  url: 'https://learn.finops.org/',
};

export const certifications = [
  {
    id: 'focp',
    slug: 'focp',
    code: 'FOCP',
    title: 'FinOps Certified Practitioner',
    level: 'Practitioner',
    status: 'active',
    description:
      'Demonstrate foundational knowledge of FinOps principles, cloud cost management, the FOCUS specification, allocation, and optimization patterns.',
    topics: ['Cloud Cost Management', 'FOCUS', 'Allocation', 'Optimization'],
    hours: 20,
    prepTime: '~4 weeks',
    featured: true,
    learnUrl: 'https://learn.finops.org/path/finops-certified-practitioner-self-paced',
  },
  {
    id: 'fopa',
    slug: 'fopa',
    code: 'FOPA',
    title: 'FinOps for Engineers',
    level: 'Practitioner',
    status: 'retired',
    replacement: { code: 'FOCE', slug: 'foce' },
    description:
      'A training course, not a certification, for engineers working with FinOps teams. The Foundation lists it as not currently available; the FinOps Certified Engineer credential covers this ground.',
    topics: ['Tagging', 'Budgets', 'Alerts', 'Showback', 'Chargeback'],
    hours: 15,
    prepTime: '~3 weeks',
    featured: false,
    learnUrl: 'https://learn.finops.org/path/finops-for-engineers',
  },
  {
    id: 'focb',
    slug: 'focb',
    code: 'FOCB',
    title: 'FinOps Certified Professional',
    level: 'Professional',
    status: 'active',
    description:
      'Lead FinOps strategy and governance across multi-cloud environments with benchmarking and executive-level reporting. Requires a Practitioner or Engineer certification and six months of FinOps experience.',
    topics: ['Strategy', 'Governance', 'Multi-Cloud', 'Benchmarking'],
    hours: 40,
    prepTime: '~3 months',
    featured: false,
    learnUrl: 'https://learn.finops.org/path/finops-certified-professional',
  },
  {
    id: 'foce',
    slug: 'foce',
    code: 'FOCE',
    title: 'FinOps Certified Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Implement FinOps tooling, FOCUS schema pipelines, and automation to operationalize cloud financial management. The Foundation rates it Intermediate and sizes the self-paced course plus exam at about ten hours.',
    topics: ['FOCUS Schema', 'Data Pipelines', 'FinOps Tooling', 'Automation'],
    hours: 10,
    prepTime: '~2 weeks',
    featured: false,
    learnUrl: 'https://learn.finops.org/page/finops-certified-engineer',
  },
];
