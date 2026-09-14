/**
 * admin-handlers.js — reviewing and approving weekly issues (ADR 0030 §2a).
 *
 *   GET   /api/cms/newsletters               editor     the recent issues
 *   GET   /api/cms/newsletters/{id}          editor     one issue, rendered as it would send
 *   PATCH /api/cms/newsletters/{id}          editor     a draft's subject, preview text, note and sections
 *   POST  /api/cms/newsletters/{id}/intro    editor     regenerate a draft's AI intro
 *   POST  /api/cms/newsletters/{id}/subjects editor     AI subject-line suggestions (no write)
 *   POST  /api/cms/newsletters/{id}/test     publisher  one test email to the reply-to address
 *   POST  /api/cms/newsletters/{id}/approve  publisher  schedule (or send) it through Resend
 *   POST  /api/cms/newsletters/{id}/reject   editor     set aside a draft, or clear a stuck send
 *   POST  /api/cms/newsletters/{id}/save     editor     keep a draft: it moves to the Drafts tab
 *   DELETE /api/cms/newsletters/{id}         editor     delete a draft or rejected issue
 *
 * The page's three tabs are views of one list: Review holds drafts not yet
 * saved (and rejected issues), Drafts holds saved drafts, and Published shows
 * scheduled and sent issues on a calendar, one month per `?month=YYYY-MM`
 * request. Deleting marks the issue `deleted` with an ETag-conditional write
 * rather than removing the document, so a delete can never race an approval
 * that has already claimed the issue; a deleted issue reads as not found.
 *
 * `approve` is routed in functions/src/functions/newsletter-admin-http.js and called by the
 * Mailing List page's Approve button. It is refused until the owner sets
 * newsletter_sending_enabled in Terraform.
 *
 * Approval is PUBLISHER, not editor: it emails every confirmed subscriber, which
 * is publishing in every sense the role exists for. It is also the owner's
 * decision of 2026-09-13 that nothing sends without it.
 *
 * ## An issue can be sent at most once, and only as the approver saw it
 *
 * Approval requires the `etag` of the issue the approver was looking at, so an
 * issue edited after they opened it is refused (409) rather than sent with
 * content they never read. It then CLAIMS the issue with an ETag-conditional
 * write from `draft` to `sending` before calling Resend, so two approvals racing
 * — a double click, two tabs, a retry — produce one broadcast; the loser gets a
 * 409. The outcome is written back only while the issue is still that claim, so
 * a reject that lands mid-send stands. A refused broadcast returns the issue to
 * `draft` with the reason; an accepted one makes it `scheduled` (or `sent`).
 *
 * An issue left in `sending` means a process died between the claim and
 * Resend's answer. It is never retried automatically, because a broadcast may
 * already exist; the answer says to check Resend's Broadcasts list, and reject is
 * allowed from `sending` so the owner can clear it once they have looked.
 *
 * ## Editing sections never adds content
 *
 * PATCH may drop items, reorder items within a section, reorder sections and
 * drop whole sections. It may not add an item, move one between sections or
 * change any field of one: titles and URLs come from the published site, and
 * the renderer re-checks every link. An item is identified by its section id
 * and its `url` (items carry no id of their own, and a section never lists
 * the same URL twice); the stored item is what is written back, so the page
 * only ever chooses which stored items remain and in what order.
 *
 * ## A test send cannot reach a subscriber
 *
 * `test` emails ONE address, the reply-to from Newsletter settings, through
 * Resend's single-email endpoint. It never reads an address from the request
 * and never touches a segment or a broadcast, which is why it works while
 * NEWSLETTER_SENDING_ENABLED is off.
 */
import { readKey } from '../ai/router.js';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { presentSetting } from '../platform-settings.js';
import { createResendClient } from './resend-client.js';
import { NEWSLETTER_FROM, resolveSegmentId } from './handlers.js';
import { describeAiError, draftIntro, suggestSubjects } from './issue.js';
import { renderIssue } from './render.js';
import { resolveSendTime } from './schedule.js';
import { NEWSLETTER_SETTINGS_CONFIG_ID, missingForSending } from './settings.js';

export const MAX_CUSTOM_NOTE_LENGTH = 2000;
export const MAX_SUBJECT_LENGTH = 120;
export const MAX_PREHEADER_LENGTH = 150;
/** One test email per issue per this long. */
export const TEST_SEND_INTERVAL_MS = 60 * 1000;

const EDITABLE_FIELDS = ['customNote', 'subject', 'preheader', 'sections', 'etag'];
const LIST_LIMIT = 50;
const PUBLISHED_LIMIT = 100;

/** Only these can be deleted: anything else was approved, and Resend has it. */
const DELETABLE = new Set(['draft', 'rejected']);

/** What the preview footer shows before an address is set, so it is obvious. */
const ADDRESS_NOT_SET = '[Postal address not set — add it in Newsletter settings before approving]';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Stored fields the page may see. The issue holds nothing private, but a list is a projection. */
const SUMMARY_FIELDS = [
  'id',
  'status',
  'subject',
  'periodStart',
  'periodEnd',
  'itemCount',
  'createdAt',
  'updatedAt',
  'approvedAt',
  'scheduledAt',
  'sentAt',
  'rejectedAt',
  'savedAt',
  'lastError',
];

/** The list reads only what it shows, not every issue's sections. */
const SUMMARY_PROJECTION = SUMMARY_FIELDS.map((field) => `c.${field}`).join(', ');

const pick = (doc, fields) => Object.fromEntries(fields.filter((f) => doc[f] !== undefined).map((f) => [f, doc[f]]));

/** A list row: the summary plus the etag, so a card can be deleted without opening it. */
const summarise = (row) => ({ ...pick(row, SUMMARY_FIELDS), etag: row._etag ?? null });

/**
 * The `?month=YYYY-MM` window, padded a day each side: the calendar places an
 * issue by the viewer's local date, which can fall in the neighbouring UTC
 * month. The page drops what is outside the month it shows.
 */
function monthWindow(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = 24 * 60 * 60 * 1000;
  return {
    from: new Date(Date.UTC(year, monthNumber - 1, 1) - day).toISOString(),
    to: new Date(Date.UTC(year, monthNumber, 1) + day).toISOString(),
  };
}

/**
 * An error for an approval LOG LINE: its name and code only. SDK messages can
 * carry request details such as the document id, so they are never logged.
 */
const errorMeta = (error) => {
  const name = typeof error?.name === 'string' ? error.name : 'Error';
  const code = typeof error?.code === 'string' || typeof error?.code === 'number' ? ` code ${error.code}` : '';
  return `${name}${code}`;
};

/** Resend's refusal for a LOG LINE: status and error name only, never its message. */
const describeForLog = (result) => {
  const name = typeof result?.data?.name === 'string' ? ` ${result.data.name}` : '';
  return `HTTP ${result?.status ?? 0}${name}`;
};

/**
 * Resend's refusal for the OWNER: the log summary plus Resend's own sentence,
 * which is what says what to fix. It can echo the broadcast (subject, body,
 * postal address), so it is stored on the issue and returned to the page, and
 * never logged.
 */
const describeForOwner = (result) => {
  const message = typeof result?.data?.message === 'string' ? `: ${result.data.message.slice(0, 200)}` : '';
  return `${describeForLog(result)}${message}`;
};

/**
 * The stored sections, filtered and reordered as the page submitted them, or
 * `{ error }`. Only removal and reordering pass: see "Editing sections never
 * adds content" above. Returns the STORED items, so nothing submitted beyond
 * identity is ever written.
 */
function applySectionEdit(storedSections, submitted) {
  if (!Array.isArray(submitted)) return { error: 'sections must be an array' };
  const stored = new Map((storedSections || []).map((section) => [section.id, section]));
  const seenSections = new Set();
  const sections = [];
  for (const entry of submitted) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string') {
      return { error: 'each section must be an object with the id of a section in this issue' };
    }
    const original = stored.get(entry.id);
    if (!original) return { error: 'sections may only be removed or reordered; a section was added' };
    if (seenSections.has(entry.id)) return { error: 'a section is listed more than once' };
    seenSections.add(entry.id);
    if (entry.title !== undefined && entry.title !== original.title) {
      return { error: 'a section title cannot be edited' };
    }
    if (!Array.isArray(entry.items)) return { error: 'each section needs an items array' };
    const byUrl = new Map((original.items || []).map((item) => [item.url, item]));
    const seenItems = new Set();
    const items = [];
    for (const item of entry.items) {
      const url = item && typeof item === 'object' && !Array.isArray(item) ? item.url : undefined;
      const match = typeof url === 'string' ? byUrl.get(url) : undefined;
      if (!match) {
        return { error: 'items may only be removed or reordered within their section; an item was added or moved' };
      }
      if (seenItems.has(url)) return { error: 'an item is listed more than once' };
      seenItems.add(url);
      // Any field the page sends back must be the stored value: this is a
      // subset check, not an editor for titles, summaries or labels.
      const edited = Object.keys(item).some((key) => item[key] !== match[key]);
      if (edited) return { error: 'item fields cannot be edited; they come from the site' };
      items.push(match);
    }
    // A section left with nothing is a removed section.
    if (items.length) sections.push({ ...original, items });
  }
  const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  if (itemCount === 0) return { error: 'at least one item must remain in the issue' };
  return { sections, itemCount };
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, queryDocs: Function, upsertDoc: Function, replaceDocIfMatch: Function }} deps.store
 * @param {Record<string, string|undefined>} [deps.env]
 * @param {typeof fetch} [deps.fetch]
 * @param {() => Date} [deps.now]
 * @param {{ generateDraft: Function } | null} [deps.drafter] the builder's drafter; null refuses the AI routes
 */
export function createNewsletterAdminHandlers({
  guard,
  store,
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
  drafter = null,
}) {
  async function readSettings() {
    const doc = await store.readDoc('admin_config', NEWSLETTER_SETTINGS_CONFIG_ID, ADMIN_CONFIG_PARTITION);
    return presentSetting('newsletter-settings', doc).value;
  }

  async function readIssue(request) {
    const id = String(request.params?.id ?? '');
    if (!/^issue-\d{4}-\d{2}-\d{2}$/.test(id)) return null;
    const doc = await store.readDoc('newsletters', id, id);
    return doc?.kind === 'weekly_issue' && doc.status !== 'deleted' ? doc : null;
  }

  const notFound = () => json(404, { ok: false, error: 'Issue not found' });

  /**
   * The caller's view of the issue is stale: it read a version that is no
   * longer stored. Checked BEFORE writing, against the `etag` the caller got
   * from GET, because the server's own read is fresh by definition; comparing
   * only that would let an editor working from an old view overwrite another
   * editor's change without either of them knowing. The etag is REQUIRED on
   * every write: an optional one protects only the callers that remember it.
   */
  const staleView = (body, issue) => body.etag !== issue._etag;
  /** A write without the version it was made against cannot be checked, so it is refused. */
  const missingEtag = (body) => typeof body?.etag !== 'string' || body.etag.length === 0;
  const etagRequired = () =>
    json(400, {
      ok: false,
      code: 'ETAG_REQUIRED',
      error: 'etag is required: send the issue.etag from the last read of this issue.',
    });
  const changedElsewhere = () =>
    json(409, {
      ok: false,
      code: 'ISSUE_CHANGED',
      error: 'This issue changed since you opened it. Reload it and try again.',
    });

  // Terraform's newsletter_sending_enabled. Anything but the exact string
  // "true" is off, so a missing or mistyped setting cannot send.
  const sendingEnabled = () => env?.NEWSLETTER_SENDING_ENABLED === 'true';

  function present(issue, settings) {
    const preview = renderIssue(issue, {
      postalAddress: settings.postalAddress || ADDRESS_NOT_SET,
    });
    const missing = missingForSending(settings);
    let sendPlan = null;
    try {
      sendPlan = resolveSendTime(now(), settings);
    } catch {
      sendPlan = null;
    }
    return {
      ok: true,
      issue: {
        ...pick(issue, SUMMARY_FIELDS),
        preheader: issue.preheader ?? '',
        intro: issue.intro ?? '',
        introError: issue.introError ?? null,
        customNote: issue.customNote ?? '',
        sections: issue.sections ?? [],
        problems: issue.problems ?? [],
        broadcastId: issue.broadcastId ?? null,
        // Echo this back as `etag` on PATCH, approve or reject; a stale one is a 409.
        etag: issue._etag ?? null,
      },
      preview,
      readyToSend: missing.length === 0,
      missingSettings: missing,
      sendingEnabled: sendingEnabled(),
      sendPlan,
    };
  }

  return {
    async list(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const month = request.query?.get?.('month') ?? null;
      if (month !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return json(400, { ok: false, error: 'month must be YYYY-MM' });
      }
      try {
        let rows;
        if (month) {
          // Published: what went out, or will, in that month.
          const { from, to } = monthWindow(month);
          rows = await store.queryDocs(
            'newsletters',
            `SELECT TOP ${PUBLISHED_LIMIT} ${SUMMARY_PROJECTION}, c._etag FROM c WHERE c.kind = 'weekly_issue' AND ((c.status = 'sent' AND c.sentAt >= @from AND c.sentAt < @to) OR (c.status = 'scheduled' AND c.scheduledAt >= @from AND c.scheduledAt < @to)) ORDER BY c.createdAt DESC`,
            [
              { name: '@from', value: from },
              { name: '@to', value: to },
            ]
          );
        } else {
          rows = await store.queryDocs(
            'newsletters',
            `SELECT TOP ${LIST_LIMIT} ${SUMMARY_PROJECTION}, c._etag FROM c WHERE c.kind = 'weekly_issue' AND c.status != 'deleted' ORDER BY c.createdAt DESC`,
            []
          );
        }
        return json(200, { ok: true, issues: (rows || []).map(summarise) });
      } catch (error) {
        context.error?.(`listNewsletters failed: ${error?.message ?? error}`);
        return json(500, { ok: false, error: 'Failed to list newsletter issues' });
      }
    },

    async get(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        return json(200, present(issue, await readSettings()));
      } catch (error) {
        context.error?.(`getNewsletter failed: ${error?.message ?? error}`);
        return json(500, { ok: false, error: 'Failed to read the newsletter issue' });
      }
    },

    async update(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      // No body, or not an object, is a write with no etag: the same structured
      // answer reject gives, so a client handles one error shape for both.
      if (!body || typeof body !== 'object' || Array.isArray(body)) return etagRequired();
      const unknown = Object.keys(body).filter((key) => !EDITABLE_FIELDS.includes(key));
      if (unknown.length) return json(400, { ok: false, error: `Unknown field(s): ${unknown.join(', ')}` });
      if (missingEtag(body)) return etagRequired();

      const patch = {};
      if (body.customNote !== undefined) {
        if (typeof body.customNote !== 'string') return json(400, { ok: false, error: 'customNote must be a string' });
        const note = body.customNote.replace(/\r\n/g, '\n').trim();
        if (note.length > MAX_CUSTOM_NOTE_LENGTH) {
          return json(400, { ok: false, error: `customNote must be at most ${MAX_CUSTOM_NOTE_LENGTH} characters` });
        }
        patch.customNote = note;
      }
      if (body.subject !== undefined) {
        const subject = typeof body.subject === 'string' ? body.subject.replace(/\s+/g, ' ').trim() : '';
        if (!subject || subject.length > MAX_SUBJECT_LENGTH) {
          return json(400, { ok: false, error: `subject must be 1 to ${MAX_SUBJECT_LENGTH} characters` });
        }
        patch.subject = subject;
      }
      if (body.preheader !== undefined) {
        if (typeof body.preheader !== 'string') return json(400, { ok: false, error: 'preheader must be a string' });
        // One line in an inbox list, so whitespace collapses like the subject's.
        const preheader = body.preheader.replace(/\s+/g, ' ').trim();
        if (preheader.length > MAX_PREHEADER_LENGTH) {
          return json(400, { ok: false, error: `preheader must be at most ${MAX_PREHEADER_LENGTH} characters` });
        }
        patch.preheader = preheader;
      }

      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        if (issue.status !== 'draft') {
          return json(409, { ok: false, error: `Only a draft can be edited; this issue is ${issue.status}.` });
        }
        if (staleView(body, issue)) return changedElsewhere();
        if (body.sections !== undefined) {
          // Checked against the stored issue, which is the version the etag names.
          const edit = applySectionEdit(issue.sections, body.sections);
          if (edit.error) return json(400, { ok: false, code: 'SECTIONS_INVALID', error: edit.error });
          patch.sections = edit.sections;
          patch.itemCount = edit.itemCount;
        }
        const updated = { ...issue, ...patch, updatedAt: now().toISOString() };
        let written;
        try {
          written = await store.replaceDocIfMatch('newsletters', updated);
        } catch (error) {
          if (error?.code === 412) return changedElsewhere();
          throw error;
        }
        // The stored document, so the response carries the NEW etag.
        return json(200, present(written ?? updated, await readSettings()));
      } catch (error) {
        context.error?.(`updateNewsletter failed: ${error?.message ?? error}`);
        return json(500, { ok: false, error: 'Failed to save the newsletter issue' });
      }
    },

    /**
     * Regenerate a draft's intro with the builder's own drafter and
     * instruction (issue.js draftIntro). Only the intro is written, never the
     * subject, which the owner may have edited. An AI failure writes nothing.
     */
    async intro(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      if (missingEtag(body)) return etagRequired();
      const ref = `[invocation ${context?.invocationId ?? 'unknown'}]`;
      if (!drafter) return json(503, { ok: false, error: 'AI drafting is not configured for newsletters.' });
      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        if (issue.status !== 'draft') {
          return json(409, { ok: false, error: `Only a draft's intro can be regenerated; this issue is ${issue.status}.` });
        }
        if (staleView(body, issue)) return changedElsewhere();

        let intro;
        try {
          ({ intro } = await draftIntro({ drafter, sections: issue.sections ?? [], subject: issue.subject }));
        } catch (error) {
          context.error?.(`regenerateNewsletterIntro AI failed ${ref}: ${errorMeta(error)}`);
          return json(502, { ok: false, code: 'AI_FAILED', error: `The intro was not regenerated: ${describeAiError(error)}` });
        }
        if (!intro) {
          return json(502, { ok: false, code: 'AI_FAILED', error: 'The intro was not regenerated: the AI returned an empty intro. Try again.' });
        }

        // Conditional on the version read above, so an edit that landed while
        // the model was writing is not overwritten.
        const updated = { ...issue, intro, introError: null, updatedAt: now().toISOString() };
        let written;
        try {
          written = await store.replaceDocIfMatch('newsletters', updated);
        } catch (error) {
          if (error?.code === 412) return changedElsewhere();
          throw error;
        }
        return json(200, present(written ?? updated, await readSettings()));
      } catch (error) {
        context.error?.(`regenerateNewsletterIntro failed ${ref}: ${errorMeta(error)}`);
        return json(500, { ok: false, error: 'Failed to regenerate the intro' });
      }
    },

    /** Subject-line suggestions for the page to offer. Writes nothing, so no etag. */
    async subjects(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const ref = `[invocation ${context?.invocationId ?? 'unknown'}]`;
      if (!drafter) return json(503, { ok: false, error: 'AI drafting is not configured for newsletters.' });
      let issue;
      try {
        issue = await readIssue(request);
      } catch (error) {
        context.error?.(`suggestNewsletterSubjects read failed ${ref}: ${errorMeta(error)}`);
        return json(500, { ok: false, error: 'Failed to read the newsletter issue' });
      }
      if (!issue) return notFound();
      try {
        const subjects = await suggestSubjects({ drafter, sections: issue.sections ?? [], subject: issue.subject });
        return json(200, { ok: true, subjects });
      } catch (error) {
        context.error?.(`suggestNewsletterSubjects AI failed ${ref}: ${errorMeta(error)}`);
        return json(502, { ok: false, code: 'AI_FAILED', error: `No subject lines were suggested: ${describeAiError(error)}` });
      }
    },

    /**
     * Email ONE test copy of a draft to the reply-to address in Newsletter
     * settings.
     *
     * This cannot reach a subscriber, which is why it is NOT gated on
     * NEWSLETTER_SENDING_ENABLED: the recipient is read from settings, never
     * from the request body, and the call is Resend's single-email endpoint,
     * not a broadcast to the segment. Publisher, because it still sends mail
     * from the newsletter's address.
     *
     * One test per issue per minute: `lastTestAt` is written with an
     * ETag-conditional replace BEFORE Resend is called, so a double click
     * sends once and the loser gets 429. A refused send still counts toward the
     * minute. The write changes the issue's etag, so the answer carries the
     * new one for the page to keep editing with.
     */
    async test(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      if (missingEtag(body)) return etagRequired();
      // Log lines carry this, never the issue id or an address (content-free telemetry).
      const ref = `[invocation ${context?.invocationId ?? 'unknown'}]`;

      const apiKey = readKey(env, 'RESEND_API_KEY');
      if (!apiKey) return json(503, { ok: false, error: 'Resend is not configured: RESEND_API_KEY is not set' });

      let settings;
      let issue;
      try {
        settings = await readSettings();
        issue = await readIssue(request);
      } catch (error) {
        context.error?.(`testNewsletter read failed ${ref}: ${errorMeta(error)}`);
        return json(500, { ok: false, error: 'Failed to read the newsletter issue' });
      }
      if (!issue) return notFound();

      const missing = missingForSending(settings);
      if (missing.length) {
        return json(409, {
          ok: false,
          code: 'SETTINGS_INCOMPLETE',
          missingSettings: missing,
          error: `Add the ${missing.join(' and ')} in Newsletter settings before sending a test.`,
        });
      }
      if (issue.status !== 'draft') {
        return json(409, { ok: false, error: `Only a draft can be test-sent; this issue is ${issue.status}.` });
      }

      const at = now();
      const tooSoon = (doc) => {
        const last = Date.parse(doc?.lastTestAt ?? '');
        if (!Number.isFinite(last) || at.getTime() - last >= TEST_SEND_INTERVAL_MS) return null;
        const retryAfterSeconds = Math.max(1, Math.ceil((last + TEST_SEND_INTERVAL_MS - at.getTime()) / 1000));
        return json(429, {
          ok: false,
          code: 'TEST_RATE_LIMITED',
          retryAfterSeconds,
          error: `A test of this issue was sent under a minute ago. Try again in ${retryAfterSeconds} seconds.`,
        });
      };
      // Before the stale check: a second press inside the minute is "too soon"
      // whichever etag it carries.
      const limited = tooSoon(issue);
      if (limited) return limited;
      if (staleView(body, issue)) return changedElsewhere();

      let rendered;
      try {
        rendered = renderIssue(issue, { postalAddress: settings.postalAddress, testSend: true });
      } catch (error) {
        context.error?.(`testNewsletter render failed ${ref}: ${errorMeta(error)}`);
        return json(500, { ok: false, error: 'Failed to render the newsletter issue' });
      }

      let claimed;
      try {
        claimed = await store.replaceDocIfMatch('newsletters', { ...issue, lastTestAt: at.toISOString() });
      } catch (error) {
        if (error?.code === 412) {
          // Another test (or an edit) got there first; say which.
          const current = await store.readDoc('newsletters', issue.id, issue.id).catch(() => null);
          return tooSoon(current) ?? changedElsewhere();
        }
        context.error?.(`testNewsletter claim failed ${ref}: ${errorMeta(error)}`);
        return json(500, { ok: false, error: 'Failed to send the test email' });
      }

      const sentTo = settings.replyTo;
      const client = createResendClient({ apiKey, fetch: fetchImpl });
      const sent = await client.sendEmail({
        from: NEWSLETTER_FROM,
        to: [sentTo],
        subject: `[TEST] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
      });
      const etag = claimed?._etag ?? null;
      if (!sent.ok) {
        context.error?.(`testNewsletter not sent ${ref}: ${describeForLog(sent)}`);
        return json(502, { ok: false, etag, error: `Resend did not accept the test email: ${describeForOwner(sent)}` });
      }
      context.log?.(`testNewsletter sent ${ref}`);
      return json(200, { ok: true, sentTo, etag });
    },

    async approve(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      if (missingEtag(body)) return etagRequired();
      // Log lines carry this, never the issue or broadcast id (content-free telemetry).
      const ref = `[invocation ${context?.invocationId ?? 'unknown'}]`;

      // The owner's switch comes first: while it is off, nothing is read,
      // claimed or sent, whatever the issue or settings say.
      if (!sendingEnabled()) {
        return json(503, {
          ok: false,
          code: 'NEWSLETTER_SENDING_DISABLED',
          error: 'Sending is switched off. Set newsletter_sending_enabled to true in Terraform to allow approval.',
        });
      }

      const apiKey = readKey(env, 'RESEND_API_KEY');
      if (!apiKey) return json(503, { ok: false, error: 'Resend is not configured: RESEND_API_KEY is not set' });

      let settings;
      let issue;
      try {
        settings = await readSettings();
        issue = await readIssue(request);
      } catch (error) {
        context.error?.(`approveNewsletter read failed ${ref}: ${errorMeta(error)}`);
        return json(500, { ok: false, error: 'Failed to read the newsletter issue' });
      }
      if (!issue) return notFound();

      const missing = missingForSending(settings);
      if (missing.length) {
        return json(409, {
          ok: false,
          code: 'SETTINGS_INCOMPLETE',
          missingSettings: missing,
          error: `Add the ${missing.join(' and ')} in Newsletter settings before approving.`,
        });
      }
      if (issue.status !== 'draft') {
        return json(409, { ok: false, error: `Only a draft can be approved; this issue is ${issue.status}.` });
      }
      // Approve what the approver saw: an issue edited since they opened it is
      // not sent with content they never read.
      if (staleView(body, issue)) return changedElsewhere();

      // Everything that can fail on the site's own data is worked out BEFORE the
      // claim, so a bad settings document refuses the approval instead of
      // leaving the issue stuck in `sending` with nothing sent.
      let plan;
      try {
        plan = resolveSendTime(now(), settings);
      } catch (error) {
        context.error?.(`approveNewsletter send slot invalid ${ref}: ${errorMeta(error)}`);
        return json(409, {
          ok: false,
          code: 'SETTINGS_INVALID',
          error: 'The send day, time or time zone in Newsletter settings is not valid. Save them again, then approve.',
        });
      }
      let rendered;
      try {
        rendered = renderIssue(issue, { postalAddress: settings.postalAddress });
      } catch (error) {
        context.error?.(`approveNewsletter render failed ${ref}: ${errorMeta(error)}`);
        return json(500, { ok: false, error: 'Failed to render the newsletter issue' });
      }

      const approvedAt = now().toISOString();
      const approvedBy = auth.user?.oid || auth.user?.sub || null;
      const claimed = { ...issue, status: 'sending', approvedAt, approvedBy, lastError: null, updatedAt: approvedAt };
      try {
        await store.replaceDocIfMatch('newsletters', claimed);
      } catch (error) {
        if (error?.code === 412) return changedElsewhere();
        context.error?.(`approveNewsletter claim failed ${ref}: ${errorMeta(error)}`);
        return json(500, { ok: false, error: 'Failed to approve the newsletter issue' });
      }

      const client = createResendClient({ apiKey, fetch: fetchImpl });

      /**
       * Write the claim's outcome ONLY if the issue is still the claim. Reject is
       * allowed from `sending` (to clear a stuck send), so an owner can reject
       * while this request is between the claim and Resend's answer; an
       * unconditional write here would silently undo that. The fresh read
       * supplies the ETag the conditional replace needs.
       *
       * @returns {Promise<{ written: true, doc: object } | { written: false, current: object|null }>}
       */
      const settle = async (next) => {
        const current = await store.readDoc('newsletters', issue.id, issue.id);
        if (current?.status !== 'sending' || current?.approvedAt !== approvedAt) {
          return { written: false, current };
        }
        try {
          const doc = await store.replaceDocIfMatch('newsletters', { ...next, _etag: current._etag });
          return { written: true, doc: doc ?? next };
        } catch (error) {
          if (error?.code === 412) return { written: false, current: null };
          throw error;
        }
      };

      // `reason` reaches the issue and the page; `logSummary` is all that is logged.
      const revert = async (reason, logSummary) => {
        context.error?.(`approveNewsletter not sent ${ref}: ${logSummary}`);
        await settle({
          ...claimed,
          status: 'draft',
          // Not approved after all: nothing was scheduled, so the issue must not
          // read as approved in the list or the preview.
          approvedAt: null,
          approvedBy: null,
          lastError: reason,
          updatedAt: now().toISOString(),
        }).catch((error) =>
          context.error?.(`approveNewsletter could not revert ${ref}: ${errorMeta(error)}`)
        );
        return json(502, { ok: false, error: `Resend did not accept the newsletter: ${reason}` });
      };

      let segmentId;
      try {
        segmentId = await resolveSegmentId(client);
      } catch (error) {
        return revert(error.message, errorMeta(error));
      }

      const { subject, html, text } = rendered;
      const created = await client.createBroadcast({
        segmentId,
        from: NEWSLETTER_FROM,
        replyTo: settings.replyTo,
        subject,
        html,
        text,
        name: `HybridCloudWorks Weekly ${issue.id.slice('issue-'.length)}`,
        scheduledAt: plan.sendNow ? undefined : plan.scheduledAt,
      });
      if (created.status === 0) {
        // No answer at all (timeout, connection reset): Resend may have accepted
        // the broadcast. Returning to draft would invite a second approval and a
        // second send, so the issue stays `sending` for the owner to check.
        context.error?.(`approveNewsletter no answer from Resend ${ref}`);
        await settle({
          ...claimed,
          lastError: 'No answer from Resend; it may or may not have accepted the broadcast.',
          updatedAt: now().toISOString(),
        }).catch((error) => context.error?.(`approveNewsletter could not record ${ref}: ${errorMeta(error)}`));
        return json(502, {
          ok: false,
          code: 'SEND_OUTCOME_UNKNOWN',
          error:
            "Resend did not answer, so it may have accepted the newsletter. Check Resend's Broadcasts list before anything else; reject this issue here only once you have.",
        });
      }
      if (!created.ok || !created.data?.id) return revert(describeForOwner(created), describeForLog(created));

      const done = {
        ...claimed,
        status: plan.sendNow ? 'sent' : 'scheduled',
        broadcastId: created.data.id,
        ...(plan.sendNow ? { sentAt: now().toISOString() } : { scheduledAt: plan.scheduledAt }),
        updatedAt: now().toISOString(),
      };
      let outcome;
      try {
        outcome = await settle(done);
      } catch (error) {
        // The broadcast exists; the record of it did not save. Say so rather
        // than report a failure that would invite a second approval.
        context.error?.(`approveNewsletter sent but not recorded ${ref}: ${errorMeta(error)}`);
        // Same shape as every other success (issue, preview, sendPlan...), plus
        // `warning`, so a caller handles one payload. The issue is re-read so it
        // shows `sending`, which offers no second approval; the claim stands in
        // if even that read fails.
        let latest = claimed;
        try {
          latest = (await store.readDoc('newsletters', issue.id, issue.id)) ?? claimed;
        } catch (readError) {
          context.error?.(`approveNewsletter re-read failed ${ref}: ${errorMeta(readError)}`);
        }
        return json(200, {
          ...present(latest, settings),
          warning: `Resend accepted broadcast ${created.data.id}, but the site could not record it. Do not approve again.`,
        });
      }
      if (!outcome.written) {
        // Rejected (or otherwise changed) while Resend was being asked. The
        // broadcast exists and the owner's reject stands, so the only honest
        // answer names the broadcast and what to do about it.
        context.error?.(
          `approveNewsletter broadcast created but issue changed to ${outcome.current?.status ?? 'unknown'} meanwhile ${ref}`
        );
        return json(409, {
          ok: false,
          code: 'CHANGED_DURING_SEND',
          broadcastId: created.data.id,
          error: `Resend accepted broadcast ${created.data.id}, but this issue was changed while it was being sent. If it should not go out, cancel it in Resend's Broadcasts page.`,
        });
      }
      context.log?.(`approveNewsletter ${done.status} ${ref}`);
      return json(200, present(outcome.doc, settings));
    },

    async save(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      if (missingEtag(body)) return etagRequired();
      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        if (issue.status !== 'draft') {
          return json(409, { ok: false, error: `Only a draft can be saved to Drafts; this issue is ${issue.status}.` });
        }
        if (staleView(body, issue)) return changedElsewhere();
        // Already saved: nothing to write, and saying so is not an error.
        if (issue.savedAt) return json(200, present(issue, await readSettings()));
        const savedAt = now().toISOString();
        const saved = {
          ...issue,
          savedAt,
          savedBy: auth.user?.oid || auth.user?.sub || null,
          updatedAt: savedAt,
        };
        let written;
        try {
          written = await store.replaceDocIfMatch('newsletters', saved);
        } catch (error) {
          if (error?.code === 412) return changedElsewhere();
          throw error;
        }
        return json(200, present(written ?? saved, await readSettings()));
      } catch (error) {
        context.error?.(`saveNewsletter failed: ${error?.message ?? error}`);
        return json(500, { ok: false, error: 'Failed to save the issue to Drafts' });
      }
    },

    async remove(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      if (missingEtag(body)) return etagRequired();
      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        if (!DELETABLE.has(issue.status)) {
          return json(409, {
            ok: false,
            error: `A ${issue.status} issue cannot be deleted: it was approved, so Resend has it.`,
          });
        }
        if (staleView(body, issue)) return changedElsewhere();
        const deletedAt = now().toISOString();
        const deleted = {
          ...issue,
          status: 'deleted',
          deletedAt,
          deletedBy: auth.user?.oid || auth.user?.sub || null,
          updatedAt: deletedAt,
        };
        try {
          await store.replaceDocIfMatch('newsletters', deleted);
        } catch (error) {
          if (error?.code === 412) return changedElsewhere();
          throw error;
        }
        return json(200, { ok: true, id: issue.id });
      } catch (error) {
        context.error?.(`deleteNewsletter failed: ${error?.message ?? error}`);
        return json(500, { ok: false, error: 'Failed to delete the newsletter issue' });
      }
    },

    async reject(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      if (missingEtag(body)) return etagRequired();
      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        // A draft, or an issue stuck in `sending` once Resend's Broadcasts list
        // has been checked. Never one that was scheduled or sent.
        if (!['draft', 'sending'].includes(issue.status)) {
          return json(409, { ok: false, error: `A ${issue.status} issue cannot be rejected.` });
        }
        if (staleView(body, issue)) return changedElsewhere();
        const rejectedAt = now().toISOString();
        const rejected = { ...issue, status: 'rejected', rejectedAt, updatedAt: rejectedAt };
        let written;
        try {
          written = await store.replaceDocIfMatch('newsletters', rejected);
        } catch (error) {
          if (error?.code === 412) return changedElsewhere();
          throw error;
        }
        return json(200, present(written ?? rejected, await readSettings()));
      } catch (error) {
        context.error?.(`rejectNewsletter failed: ${error?.message ?? error}`);
        return json(500, { ok: false, error: 'Failed to reject the newsletter issue' });
      }
    },
  };
}
