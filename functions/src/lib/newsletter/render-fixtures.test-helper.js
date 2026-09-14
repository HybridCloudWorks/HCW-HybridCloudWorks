/**
 * Fixtures shared by render.test.js and template-layout.test.js: issues that
 * exercise every branch of the built-in renderer (intro, note, preheader,
 * labels, summaries, a dropped unsafe link, a multi-line address).
 */
export const FIXTURE_ISSUE = Object.freeze({
  id: 'issue-2026-09-14',
  subject: 'Landing <zones> & more',
  preheader: 'Five things <worth> reading',
  periodStart: '2026-09-07T12:00:00.000Z',
  periodEnd: '2026-09-14T12:00:00.000Z',
  intro: 'We covered a lot.\n\nSecond paragraph.\nWith a break.',
  customNote: "See you at <Ignite>, it's soon.",
  sections: [
    {
      id: 'articles',
      title: 'New on HybridCloudWorks',
      items: [
        { title: 'A "quoted" <title>', summary: 'Summary & more', url: 'https://hybridcloudworks.com/a?x=1&y=2', label: 'Azure' },
        { title: 'Relative link', url: '/blog/b' },
        { title: 'Unsafe', url: 'javascript:alert(1)' },
      ],
    },
    { id: 'episodes', title: 'Listen & learn', items: [{ title: 'Only unsafe', url: 'data:text/html,x' }] },
  ],
});

export const MINIMAL_ISSUE = Object.freeze({
  id: 'issue-2026-09-21',
  subject: 'Quiet week',
  periodStart: '2026-09-14T12:00:00.000Z',
  periodEnd: '2026-09-21T12:00:00.000Z',
  sections: [{ id: 'articles', title: 'New', items: [{ title: 'One', url: 'https://hybridcloudworks.com/one' }] }],
});

export const FIXTURE_ADDRESS = 'HybridCloudWorks LLC\nPO Box 1 <Suite>\nAustin, TX';
