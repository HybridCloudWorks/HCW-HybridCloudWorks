/**
 * A weekly issue laid out in the owner's Resend template (#557). What matters:
 * the body lands where the marker is, nothing from an issue becomes markup,
 * every email still carries the postal address and the unsubscribe
 * placeholder, and an unusable template is reported rather than half-used.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_TEMPLATE_BYTES,
  NEWSLETTER_BODY_MARKER,
  applyTemplateLayout,
  renderIssueInTemplate,
  templateUnusableReason,
} from './template-layout.js';
import {
  TEST_SEND_NOTE,
  UNSUBSCRIBE_PLACEHOLDER,
  addressHtml,
  escapeHtml,
  renderIssue,
  renderIssueContent,
} from './render.js';
import { FIXTURE_ADDRESS, FIXTURE_ISSUE } from './render-fixtures.test-helper.js';

const SETTINGS = { postalAddress: FIXTURE_ADDRESS };

const page = (inner) =>
  `<!doctype html><html><head><title>{{{NEWSLETTER_SUBJECT}}}</title></head><body style="background:#fef3c7"><header>Brand</header>${inner}</body></html>`;

const COMPLIANT_FOOTER = `<footer>HybridCloudWorks LLC<br>PO Box 1 &lt;Suite&gt;<br>Austin, TX <a href="${UNSUBSCRIBE_PLACEHOLDER}">Leave</a></footer>`;

const merge = (template, issue = FIXTURE_ISSUE, settings = SETTINGS) =>
  applyTemplateLayout(template, renderIssueContent(issue, settings).parts, settings);

const occurrences = (text, needle) => text.split(needle).length - 1;

describe('applyTemplateLayout', () => {
  it('replaces the body marker with the rendered body, keeping the template around it', () => {
    const { parts } = renderIssueContent(FIXTURE_ISSUE, SETTINGS);
    const result = merge(page(`<main>${NEWSLETTER_BODY_MARKER}</main>${COMPLIANT_FOOTER}`));
    expect(result.ok).toBe(true);
    expect(result.html).toContain(`<main>${parts.bodyHtml}</main>`);
    expect(result.html).toContain('<header>Brand</header>');
    expect(result.html).not.toContain(NEWSLETTER_BODY_MARKER);
    // The body only: not the built-in document, header or footer.
    expect(occurrences(result.html, '<html')).toBe(1);
    expect(result.html).not.toContain('HybridCloudWorks Weekly ·');
  });

  it('fills the optional markers with escaped text, so a hostile subject stays literal', () => {
    const issue = {
      ...FIXTURE_ISSUE,
      subject: '<img src=x onerror=alert(1)>',
      preheader: '"><script>alert(2)</script>',
    };
    const template = page(
      `<h1>{{{NEWSLETTER_SUBJECT}}}</h1><p class="pre">{{{NEWSLETTER_PREHEADER}}}</p><p class="period">{{{NEWSLETTER_PERIOD}}}</p>${NEWSLETTER_BODY_MARKER}${COMPLIANT_FOOTER}`
    );
    const { html } = merge(template, issue);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain(`<h1>${escapeHtml(issue.subject)}</h1>`);
    expect(html).toContain(`<title>${escapeHtml(issue.subject)}</title>`);
    expect(html).toContain(`<p class="pre">${escapeHtml(issue.preheader)}</p>`);
    expect(html).toContain('<p class="period">Sep 7 – Sep 14</p>');
    expect(html).not.toMatch(/\{\{\{NEWSLETTER_/);
  });

  it('adds the hidden preheader block after <body> when the template has no preheader marker', () => {
    const { parts } = renderIssueContent(FIXTURE_ISSUE, SETTINGS);
    const { html } = merge(page(`${NEWSLETTER_BODY_MARKER}${COMPLIANT_FOOTER}`));
    expect(html).toContain(`<body style="background:#fef3c7">${parts.preheaderHtml}<header>`);
  });

  it('rewrites {{{UNSUBSCRIBE_URL}}} to Resend\'s {{{RESEND_UNSUBSCRIBE_URL}}} and adds no second footer', () => {
    const footer = COMPLIANT_FOOTER.replace(UNSUBSCRIBE_PLACEHOLDER, '{{{UNSUBSCRIBE_URL}}}');
    const { html } = merge(page(`${NEWSLETTER_BODY_MARKER}${footer}`));
    expect(html).toContain(`<a href="${UNSUBSCRIBE_PLACEHOLDER}">Leave</a>`);
    expect(html).not.toContain('{{{UNSUBSCRIBE_URL}}}');
    expect(occurrences(html, UNSUBSCRIBE_PLACEHOLDER)).toBe(1);
    expect(html).not.toContain('You are receiving this because');
  });

  it('appends the compliance footer before </body> when the template has no unsubscribe link', () => {
    const { parts } = renderIssueContent(FIXTURE_ISSUE, SETTINGS);
    const { html } = merge(page(NEWSLETTER_BODY_MARKER));
    expect(html).toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(html).toContain(addressHtml(FIXTURE_ADDRESS));
    expect(html.endsWith(`${parts.footerHtml}</div></body></html>`)).toBe(true);
  });

  it('appends the footer at the end of a template with no </body>', () => {
    const { html } = merge(`<div>${NEWSLETTER_BODY_MARKER}</div>`);
    expect(html.endsWith('</div>')).toBe(true);
    expect(html).toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(html).toContain(addressHtml(FIXTURE_ADDRESS));
  });

  it('appends only the address when the template has the unsubscribe link but not the address', () => {
    const { html } = merge(page(`${NEWSLETTER_BODY_MARKER}<a href="${UNSUBSCRIBE_PLACEHOLDER}">Leave</a>`));
    expect(html).toContain(addressHtml(FIXTURE_ADDRESS));
    expect(occurrences(html, UNSUBSCRIBE_PLACEHOLDER)).toBe(1);
    expect(html).not.toContain('You are receiving this because');
  });

  it('does not count the address as present because an issue subject contains it', () => {
    const issue = { ...FIXTURE_ISSUE, subject: FIXTURE_ADDRESS.replace(/\n/g, ' ') };
    const template = page(`<h1>{{{NEWSLETTER_SUBJECT}}}</h1>${NEWSLETTER_BODY_MARKER}<a href="${UNSUBSCRIBE_PLACEHOLDER}">x</a>`);
    const { html } = merge(template, issue);
    expect(html).toContain(addressHtml(FIXTURE_ADDRESS));
  });

  it('makes every unsubscribe link inert on a test send and says so', () => {
    const settings = { ...SETTINGS, testSend: true };
    const own = merge(page(`${NEWSLETTER_BODY_MARKER}${COMPLIANT_FOOTER}`), FIXTURE_ISSUE, settings).html;
    expect(own).not.toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(own).toContain('<a href="#">Leave</a>');
    expect(own).toContain(escapeHtml(TEST_SEND_NOTE));

    const appended = merge(page(NEWSLETTER_BODY_MARKER), FIXTURE_ISSUE, settings).html;
    expect(appended).not.toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(appended).toContain(escapeHtml(TEST_SEND_NOTE));
    expect(occurrences(appended, escapeHtml(TEST_SEND_NOTE))).toBe(1);
  });

  it('inserts body text literally, even text that looks like a replacement pattern or a marker', () => {
    const issue = {
      ...FIXTURE_ISSUE,
      intro: "Costs $& and $' and {{{NEWSLETTER_SUBJECT}}}",
    };
    const { html } = merge(page(`${NEWSLETTER_BODY_MARKER}${COMPLIANT_FOOTER}`), issue);
    expect(html).toContain("Costs $&amp; and $&#39; and {{{NEWSLETTER_SUBJECT}}}");
  });

  describe('unusable templates', () => {
    it('refuses a template with no body marker', () => {
      expect(merge(page(COMPLIANT_FOOTER))).toMatchObject({ ok: false, code: 'TEMPLATE_MARKER_MISSING' });
    });

    it('refuses a template with the body marker twice', () => {
      const result = merge(page(`${NEWSLETTER_BODY_MARKER}<hr>${NEWSLETTER_BODY_MARKER}`));
      expect(result).toMatchObject({ ok: false, code: 'TEMPLATE_MARKER_REPEATED' });
      expect(result.message).toMatch(/2 times/);
    });

    it('refuses an oversized template', () => {
      const big = page(`${NEWSLETTER_BODY_MARKER}${'x'.repeat(MAX_TEMPLATE_BYTES)}`);
      expect(merge(big)).toMatchObject({ ok: false, code: 'TEMPLATE_TOO_LARGE' });
    });

    it('refuses what is not a string', () => {
      for (const bad of [null, undefined, 42, { html: NEWSLETTER_BODY_MARKER }]) {
        expect(templateUnusableReason(bad)).toMatchObject({ code: 'TEMPLATE_NOT_HTML' });
      }
    });
  });
});

describe('renderIssueInTemplate', () => {
  it('uses the template, with the built-in plain text and subject', () => {
    const rendered = renderIssueInTemplate(FIXTURE_ISSUE, SETTINGS, page(`${NEWSLETTER_BODY_MARKER}${COMPLIANT_FOOTER}`));
    const builtIn = renderIssue(FIXTURE_ISSUE, SETTINGS);
    expect(rendered.templateProblem).toBeNull();
    expect(rendered.html).toContain('<header>Brand</header>');
    expect(rendered.text).toBe(builtIn.text);
    expect(rendered.subject).toBe(builtIn.subject);
  });

  it('falls back to the built-in design, unchanged, and says why', () => {
    const rendered = renderIssueInTemplate(FIXTURE_ISSUE, SETTINGS, page('no marker'));
    expect(rendered.html).toBe(renderIssue(FIXTURE_ISSUE, SETTINGS).html);
    expect(rendered.templateProblem).toMatchObject({ code: 'TEMPLATE_MARKER_MISSING' });
  });
});
