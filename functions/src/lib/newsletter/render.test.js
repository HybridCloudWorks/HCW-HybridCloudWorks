/**
 * The built-in design must not change when render.js is split into parts for
 * templates (#557). The digests below are of renderIssue's output BEFORE that
 * split, taken from the previous render.js with these same fixtures; any byte
 * of difference in the HTML or the plain text fails here.
 */
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { renderIssue, renderIssueParts } from './render.js';
import { FIXTURE_ADDRESS, FIXTURE_ISSUE, MINIMAL_ISSUE } from './render-fixtures.test-helper.js';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const PINNED = [
  {
    name: 'full issue',
    issue: FIXTURE_ISSUE,
    testSend: false,
    html: '46e551bfcab275c91987f8a03627949f711e1c63279074bcbd6d1432ccac50cc',
    text: 'df88c975df05c546ec8c92f754b5e4dec83842b668eac8e1fdaab6a7a7554265',
  },
  {
    name: 'full issue, test send',
    issue: FIXTURE_ISSUE,
    testSend: true,
    html: '9bc447e04bcdd6a4c258623899e8755578f093c2e8965f9c45bc44b616b2dc49',
    text: '2e7e3ff5fa1141905800b387f9f6336eb4edbb744121e27e33468e493a594997',
  },
  {
    name: 'minimal issue',
    issue: MINIMAL_ISSUE,
    testSend: false,
    html: '4695e016b68aef5fa76434db14acd5d6bcf007d6daca46145a57a9b7ca0b72dd',
    text: 'b6c4e806fc00a9542cdffd01ab2514be274c1853cb6dfb1d2968ff7ff96d4edf',
  },
  {
    name: 'minimal issue, test send',
    issue: MINIMAL_ISSUE,
    testSend: true,
    html: '8141b25c863eb4953e6f50eae3c9d0bcffbe09c0d5d27e9834d23ba25e564b5e',
    text: '781dc7c047098f40d97368c471179b7172f90d7ed4b4fd0ac6a051fadc5aa357',
  },
];

describe('renderIssue: the built-in design', () => {
  for (const pinned of PINNED) {
    it(`is byte-identical to the design before templates: ${pinned.name}`, () => {
      const { subject, html, text } = renderIssue(pinned.issue, {
        postalAddress: FIXTURE_ADDRESS,
        testSend: pinned.testSend,
      });
      expect(subject).toBe(pinned.issue.subject);
      expect(sha256(html)).toBe(pinned.html);
      expect(sha256(text)).toBe(pinned.text);
    });
  }

  it('is assembled from the same body, footer and preheader a template receives', () => {
    const settings = { postalAddress: FIXTURE_ADDRESS };
    const parts = renderIssueParts(FIXTURE_ISSUE, settings);
    const { html } = renderIssue(FIXTURE_ISSUE, settings);
    expect(html).toContain(parts.bodyHtml);
    expect(html).toContain(parts.footerHtml);
    expect(html).toContain(parts.preheaderHtml);
    // The body alone carries no document, header or footer.
    expect(parts.bodyHtml).not.toMatch(/<html|<body|<h1|Unsubscribe/);
    expect(parts.bodyHtml).toContain('A &quot;quoted&quot; &lt;title&gt;');
  });
});
