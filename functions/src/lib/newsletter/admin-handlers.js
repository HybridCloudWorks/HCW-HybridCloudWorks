/**
 * admin-handlers.js — reviewing weekly issues (ADR 0030 §2a).
 *
 *   GET   /api/cms/newsletters              editor  the recent issues
 *   GET   /api/cms/newsletters/{id}         editor  one issue, rendered as it would send
 *   PATCH /api/cms/newsletters/{id}         editor  a draft's subject and note
 *   POST  /api/cms/newsletters/{id}/reject  editor  set a draft aside
 *
 * Nothing here sends. Approval — the publisher-level step that schedules an
 * issue through Resend — is its own change, so that the part of the newsletter
 * that emails every subscriber is reviewed on its own.
 *
 * The GET already answers what approval will need: whether the settings a send
 * requires are saved (`missingSettings`) and when an approval now would send
 * (`sendPlan`), so the page can say so before the button exists.
 */
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { presentSetting } from '../platform-settings.js';
import { renderIssue } from './render.js';
import { resolveSendTime } from './schedule.js';
import { NEWSLETTER_SETTINGS_CONFIG_ID, missingForSending } from './settings.js';

export const MAX_CUSTOM_NOTE_LENGTH = 2000;
export const MAX_SUBJECT_LENGTH = 120;
const LIST_LIMIT = 20;

/** What the preview footer shows before an address is set, so it is obvious. */
const ADDRESS_NOT_SET = '[Postal address not set — add it in Newsletter settings]';

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
  'lastError',
];

/** The list reads only what it shows, not every issue's sections. */
const SUMMARY_PROJECTION = SUMMARY_FIELDS.map((field) => `c.${field}`).join(', ');

const pick = (doc, fields) => Object.fromEntries(fields.filter((f) => doc[f] !== undefined).map((f) => [f, doc[f]]));

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, queryDocs: Function, upsertDoc: Function, replaceDocIfMatch: Function }} deps.store
 * @param {() => Date} [deps.now]
 */
export function createNewsletterAdminHandlers({
  guard,
  store,
  now = () => new Date(),
}) {
  async function readSettings() {
    const doc = await store.readDoc('admin_config', NEWSLETTER_SETTINGS_CONFIG_ID, ADMIN_CONFIG_PARTITION);
    return presentSetting('newsletter-settings', doc).value;
  }

  async function readIssue(request) {
    const id = String(request.params?.id ?? '');
    if (!/^issue-\d{4}-\d{2}-\d{2}$/.test(id)) return null;
    const doc = await store.readDoc('newsletters', id, id);
    return doc?.kind === 'weekly_issue' ? doc : null;
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
        intro: issue.intro ?? '',
        introError: issue.introError ?? null,
        customNote: issue.customNote ?? '',
        sections: issue.sections ?? [],
        problems: issue.problems ?? [],
        broadcastId: issue.broadcastId ?? null,
        // Echo this back as `etag` on PATCH or reject; a stale one is a 409.
        etag: issue._etag ?? null,
      },
      preview,
      readyToSend: missing.length === 0,
      missingSettings: missing,
      sendPlan,
    };
  }

  return {
    async list(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const rows = await store.queryDocs(
          'newsletters',
          `SELECT TOP ${LIST_LIMIT} ${SUMMARY_PROJECTION} FROM c WHERE c.kind = 'weekly_issue' ORDER BY c.createdAt DESC`,
          []
        );
        return json(200, { ok: true, issues: (rows || []).map((row) => pick(row, SUMMARY_FIELDS)) });
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
      const unknown = Object.keys(body).filter((key) => !['customNote', 'subject', 'etag'].includes(key));
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

      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        if (issue.status !== 'draft') {
          return json(409, { ok: false, error: `Only a draft can be edited; this issue is ${issue.status}.` });
        }
        if (staleView(body, issue)) return changedElsewhere();
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

    async reject(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      if (missingEtag(body)) return etagRequired();
      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        // Only a draft: nothing in this API moves an issue past draft, so no
        // other state can be set aside here. The send step adds its own.
        if (issue.status !== 'draft') {
          return json(409, { ok: false, error: `Only a draft can be rejected; this issue is ${issue.status}.` });
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
