/**
 * render.js — a stored issue as the email readers receive (ADR 0030 §2a).
 *
 * Plain inline-styled tables, because that is what renders the same in Gmail,
 * Outlook and Apple Mail. Every value from the issue is escaped here, once:
 * sections, the AI intro and the owner's note all arrive as plain text, so
 * nothing stored can place markup in someone's inbox.
 *
 * The footer carries what every commercial email must: why the reader is
 * receiving it, the sender's postal address (CAN-SPAM), and an unsubscribe
 * link. `{{{RESEND_UNSUBSCRIBE_URL}}}` is Resend's placeholder; Resend fills it
 * per recipient and handles the unsubscribe, which is why this renderer never
 * builds one of its own.
 *
 * An issue's `preheader` is the inbox preview text: the standard hidden block
 * at the top of the body. The broadcast, the page's preview and the test send
 * all render through this one function, so what was previewed is what sends.
 */
import { SITE_ORIGIN, absoluteUrl } from './sections.js';

export const UNSUBSCRIBE_PLACEHOLDER = '{{{RESEND_UNSUBSCRIBE_URL}}}';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Paragraphs from plain text: blank lines split, single newlines become <br>. */
function paragraphsHtml(text, style) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="${style}">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const formatRange = (issue) => {
  const fmt = (iso) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
  const end = new Date(Date.parse(issue.periodEnd) - 1).toISOString();
  return `${fmt(issue.periodStart)} – ${fmt(end)}`;
};

const COLORS = { ink: '#111827', muted: '#4b5563', rule: '#e5e7eb', accent: '#2563eb', bg: '#f3f4f6' };

/**
 * The sections as they will be rendered: every link re-checked HERE, at the
 * last step, rather than trusting that each collector already did. A stored
 * issue, a future section or a hand-edited document with a `javascript:`,
 * `data:` or malformed URL loses that item, and a section left with no items
 * loses its heading.
 */
function renderableSections(issue) {
  return (issue.sections || [])
    .map((section) => ({
      ...section,
      items: (section.items || [])
        .map((item) => ({ ...item, url: absoluteUrl(item?.url) }))
        .filter((item) => item.url && item.title),
    }))
    .filter((section) => section.items.length > 0);
}

/** What stands in for the unsubscribe link in a test email, which Resend does not fill. */
export const TEST_UNSUBSCRIBE_HREF = '#';
export const TEST_SEND_NOTE =
  'This is a test send to the reply-to address. The unsubscribe link is inactive here; subscribers get a working one.';

/**
 * The inbox preview text: a visually hidden block first in the body, followed
 * by filler so the client does not pull the heading or intro into the preview
 * after it. Escaped like every other stored value; no preheader, no block.
 */
function preheaderHtml(preheader) {
  const text = String(preheader ?? '').trim();
  if (!text) return '';
  const hidden = 'display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all';
  return `<div style="${hidden}">${escapeHtml(text)}</div>
<div style="${hidden}">${'&#847;&zwnj;&nbsp;'.repeat(80)}</div>
`;
}

/**
 * An issue rendered in pieces: the inner body (intro, note and sections,
 * WITHOUT the built-in wrapper, header or footer), the compliance footer's
 * contents and the preheader block. `renderIssue` assembles the built-in
 * document from exactly these; template-layout.js places the same pieces in
 * the owner's Resend template. One renderer, so a template carries the body
 * the built-in design would.
 *
 * @param {object} issue a stored weekly issue
 * @param {{ postalAddress: string, testSend?: boolean }} settings
 */
export function renderIssueParts(issue, { postalAddress, testSend = false }) {
  const subject = issue.subject;
  const unsubscribe = testSend ? TEST_UNSUBSCRIBE_HREF : UNSUBSCRIBE_PLACEHOLDER;
  const range = formatRange(issue);
  const p = `margin:0 0 14px;font-size:16px;line-height:1.6;color:${COLORS.ink}`;
  const sections = renderableSections(issue);

  const sectionHtml = sections
    .map((section) => {
      const items = section.items
        .map(
          (item) => `<tr><td style="padding:0 0 18px">
<a href="${escapeHtml(item.url)}" style="font-size:17px;font-weight:600;color:${COLORS.accent};text-decoration:none">${escapeHtml(item.title)}</a>
${item.label ? `<div style="font-size:12px;letter-spacing:.02em;text-transform:uppercase;color:${COLORS.muted};margin-top:4px">${escapeHtml(item.label)}</div>` : ''}
${item.summary ? `<div style="font-size:15px;line-height:1.55;color:${COLORS.muted};margin-top:6px">${escapeHtml(item.summary)}</div>` : ''}
</td></tr>`
        )
        .join('');
      return `<tr><td style="padding:24px 0 8px;border-top:1px solid ${COLORS.rule}">
<h2 style="margin:0 0 16px;font-size:20px;color:${COLORS.ink}">${escapeHtml(section.title)}</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>
</td></tr>`;
    })
    .join('');

  const note = issue.customNote
    ? `<tr><td style="padding:0 0 8px">${paragraphsHtml(issue.customNote, p)}</td></tr>`
    : '';
  const intro = issue.intro ? `<tr><td style="padding:0 0 8px">${paragraphsHtml(issue.intro, p)}</td></tr>` : '';

  const bodyHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${intro}${note}${sectionHtml}
</table>`;

  const footerHtml = `You are receiving this because you subscribed at <a href="${SITE_ORIGIN}" style="color:${COLORS.muted}">hybridcloudworks.com</a>.<br>
${addressHtml(postalAddress)}<br>
<a href="${unsubscribe}" style="color:${COLORS.muted}">Unsubscribe</a>${testSend ? `<br>${escapeHtml(TEST_SEND_NOTE)}` : ''}`;

  return {
    subject,
    range,
    sections,
    unsubscribe,
    bodyHtml,
    footerHtml,
    preheader: String(issue.preheader ?? '').trim(),
    preheaderHtml: preheaderHtml(issue.preheader),
  };
}

/** The postal address as HTML: escaped, one `<br>` per line. */
export function addressHtml(postalAddress) {
  return escapeHtml(postalAddress).replace(/\n/g, '<br>');
}

/** The built-in footer's text colour, for the footer a template is given. */
export const FOOTER_COLOR = COLORS.muted;

/** The plain-text part. Every design sends this one: a template shapes only the HTML. */
function renderIssueText(issue, { subject, range, sections, unsubscribe }, { postalAddress, testSend = false }) {
  const textSections = sections.map((section) =>
    [
      section.title.toUpperCase(),
      ...section.items.map((item) =>
        [`- ${item.title}`, item.label ? `  ${item.label}` : null, item.summary ? `  ${item.summary}` : null, `  ${item.url}`]
          .filter(Boolean)
          .join('\n')
      ),
    ].join('\n\n')
  );
  return [
    `HybridCloudWorks Weekly · ${range}`,
    subject,
    issue.intro,
    issue.customNote,
    ...textSections,
    '--',
    `You are receiving this because you subscribed at ${SITE_ORIGIN}.`,
    postalAddress,
    `Unsubscribe: ${unsubscribe}`,
    testSend ? TEST_SEND_NOTE : null,
  ]
    .filter((part) => typeof part === 'string' && part.trim())
    .join('\n\n');
}

/**
 * The parts and the plain text, for a caller that lays the HTML out itself
 * (template-layout.js).
 */
export function renderIssueContent(issue, settings) {
  const parts = renderIssueParts(issue, settings);
  return { parts, text: renderIssueText(issue, parts, settings) };
}

/**
 * The issue in the built-in design.
 *
 * @param {object} issue a stored weekly issue
 * @param {{ postalAddress: string, testSend?: boolean }} settings
 *   `testSend` renders the one-off test email: `{{{RESEND_UNSUBSCRIBE_URL}}}`
 *   is only filled in for a broadcast, so it becomes a harmless `#` and the
 *   footer says so. The broadcast path never passes it.
 * @returns {{ subject: string, html: string, text: string }}
 */
export function renderIssue(issue, settings) {
  const { parts, text } = renderIssueContent(issue, settings);
  const { subject, range, bodyHtml, footerHtml } = parts;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
${parts.preheaderHtml}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px">
<tr><td style="padding:32px 32px 8px">
<div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${COLORS.muted}">HybridCloudWorks Weekly · ${escapeHtml(range)}</div>
<h1 style="margin:8px 0 20px;font-size:26px;line-height:1.25;color:${COLORS.ink}">${escapeHtml(subject)}</h1>
</td></tr>
<tr><td style="padding:0 32px 8px">${bodyHtml}</td></tr>
<tr><td style="padding:24px 32px 32px;border-top:1px solid ${COLORS.rule};font-size:13px;line-height:1.6;color:${COLORS.muted}">
${footerHtml}
</td></tr>
</table></td></tr></table>
</body></html>`;

  return { subject, html, text };
}
