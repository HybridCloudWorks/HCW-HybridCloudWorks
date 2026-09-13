/**
 * admin-handlers.js — reviewing and approving weekly issues (ADR 0030 §2a).
 *
 *   GET   /api/cms/newsletters              editor    the recent issues
 *   GET   /api/cms/newsletters/{id}         editor    one issue, rendered as it would send
 *   PATCH /api/cms/newsletters/{id}         editor    a draft's subject and note
 *   POST  /api/cms/newsletters/{id}/approve publisher schedule (or send) it through Resend
 *   POST  /api/cms/newsletters/{id}/reject  editor    set a draft aside
 *
 * Approval is PUBLISHER, not editor: it emails every confirmed subscriber, which
 * is publishing in every sense the role exists for. It is also the owner's
 * decision of 2026-09-13 that nothing sends without it.
 *
 * ## An issue can be sent at most once
 *
 * Two approvals racing — a double click, two tabs, a retry after a slow
 * response — must not produce two broadcasts. So approval CLAIMS the issue with
 * an ETag-conditional write from `draft` to `sending` before it calls Resend,
 * and only the request that wins the claim creates the broadcast. The loser
 * gets a 409. If the broadcast is refused, the issue goes back to `draft` with
 * the reason; if it succeeds it becomes `scheduled` (or `sent`, when it went
 * immediately) with Resend's broadcast id.
 *
 * An issue left in `sending` means a process died between the claim and
 * Resend's answer. It is never retried automatically, because a broadcast may
 * already exist; the page says to check Resend's Broadcasts list, and reject
 * is allowed from `sending` so the owner can clear it once they have looked.
 */
import { readKey } from '../ai/router.js';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { presentSetting } from '../platform-settings.js';
import { createResendClient } from './resend-client.js';
import { NEWSLETTER_FROM, resolveSegmentId } from './handlers.js';
import { renderIssue } from './render.js';
import { resolveSendTime } from './schedule.js';
import { NEWSLETTER_SETTINGS_CONFIG_ID, missingForSending } from './settings.js';

export const MAX_CUSTOM_NOTE_LENGTH = 2000;
export const MAX_SUBJECT_LENGTH = 120;
const LIST_LIMIT = 20;

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
  'lastError',
];

/** The list reads only what it shows, not every issue's sections. */
const SUMMARY_PROJECTION = SUMMARY_FIELDS.map((field) => `c.${field}`).join(', ');

const pick = (doc, fields) => Object.fromEntries(fields.filter((f) => doc[f] !== undefined).map((f) => [f, doc[f]]));

const describe = (result) => {
  const name = typeof result?.data?.name === 'string' ? ` ${result.data.name}` : '';
  const message = typeof result?.data?.message === 'string' ? `: ${result.data.message.slice(0, 200)}` : '';
  return `HTTP ${result?.status ?? 0}${name}${message}`;
};

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, queryDocs: Function, upsertDoc: Function, replaceDocIfMatch: Function }} deps.store
 * @param {Record<string, string|undefined>} [deps.env]
 * @param {typeof fetch} [deps.fetch]
 * @param {() => Date} [deps.now]
 */
export function createNewsletterAdminHandlers({
  guard,
  store,
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
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
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json(400, { ok: false, error: 'Body must be a JSON object' });
      }
      const unknown = Object.keys(body).filter((key) => !['customNote', 'subject'].includes(key));
      if (unknown.length) return json(400, { ok: false, error: `Unknown field(s): ${unknown.join(', ')}` });

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
        const updated = { ...issue, ...patch, updatedAt: now().toISOString() };
        try {
          await store.replaceDocIfMatch('newsletters', updated);
        } catch (error) {
          if (error?.code === 412) {
            return json(409, { ok: false, error: 'The issue changed while you were editing. Reload and try again.' });
          }
          throw error;
        }
        return json(200, present(updated, await readSettings()));
      } catch (error) {
        context.error?.(`updateNewsletter failed: ${error?.message ?? error}`);
        return json(500, { ok: false, error: 'Failed to save the newsletter issue' });
      }
    },

    async approve(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;

      const apiKey = readKey(env, 'RESEND_API_KEY');
      if (!apiKey) return json(503, { ok: false, error: 'Resend is not configured: RESEND_API_KEY is not set' });

      let settings;
      let issue;
      try {
        settings = await readSettings();
        issue = await readIssue(request);
      } catch (error) {
        context.error?.(`approveNewsletter read failed: ${error?.message ?? error}`);
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

      const approvedAt = now().toISOString();
      const approvedBy = auth.user?.oid || auth.user?.sub || null;
      const claimed = { ...issue, status: 'sending', approvedAt, approvedBy, lastError: null, updatedAt: approvedAt };
      try {
        await store.replaceDocIfMatch('newsletters', claimed);
      } catch (error) {
        if (error?.code === 412) {
          return json(409, { ok: false, error: 'This issue was just approved or changed elsewhere. Reload it.' });
        }
        context.error?.(`approveNewsletter claim failed: ${error?.message ?? error}`);
        return json(500, { ok: false, error: 'Failed to approve the newsletter issue' });
      }

      const client = createResendClient({ apiKey, fetch: fetchImpl });

      /**
       * Write the claim's outcome ONLY if the issue is still the claim. Reject
       * is allowed from `sending` (to clear a stuck send), so an owner can
       * reject while this request is between the claim and Resend's answer; an
       * unconditional write here would silently undo that. The fresh read
       * supplies the ETag the conditional replace needs.
       *
       * @returns {Promise<{ written: true } | { written: false, current: object|null }>}
       */
      const settle = async (next) => {
        const current = await store.readDoc('newsletters', issue.id, issue.id);
        if (current?.status !== 'sending' || current?.approvedAt !== approvedAt) {
          return { written: false, current };
        }
        try {
          await store.replaceDocIfMatch('newsletters', { ...next, _etag: current._etag });
          return { written: true };
        } catch (error) {
          if (error?.code === 412) return { written: false, current: null };
          throw error;
        }
      };

      const revert = async (reason) => {
        context.error?.(`approveNewsletter ${issue.id} not sent: ${reason}`);
        await settle({
          ...claimed,
          status: 'draft',
          // Not approved after all: nothing was scheduled, so the issue must
          // not read as approved in the list or the preview.
          approvedAt: null,
          approvedBy: null,
          lastError: reason,
          updatedAt: now().toISOString(),
        }).catch((error) =>
          context.error?.(`approveNewsletter could not revert ${issue.id}: ${error?.message ?? error}`)
        );
        return json(502, { ok: false, error: `Resend did not accept the newsletter: ${reason}` });
      };

      let segmentId;
      try {
        segmentId = await resolveSegmentId(client);
      } catch (error) {
        return revert(error.message);
      }

      const { subject, html, text } = renderIssue(claimed, { postalAddress: settings.postalAddress });
      const plan = resolveSendTime(now(), settings);
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
      if (!created.ok || !created.data?.id) return revert(describe(created));

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
        context.error?.(`approveNewsletter ${issue.id} sent as ${created.data.id} but not recorded: ${error?.message ?? error}`);
        return json(200, {
          ok: true,
          warning: `Resend accepted broadcast ${created.data.id}, but the site could not record it. Do not approve again.`,
        });
      }
      if (!outcome.written) {
        // Rejected (or otherwise changed) while Resend was being asked. The
        // broadcast exists and the owner's reject stands, so the only honest
        // answer names the broadcast and what to do about it.
        context.error?.(
          `approveNewsletter ${issue.id}: broadcast ${created.data.id} was created, but the issue changed to ${outcome.current?.status ?? 'unknown'} meanwhile`
        );
        return json(409, {
          ok: false,
          code: 'CHANGED_DURING_SEND',
          broadcastId: created.data.id,
          error: `Resend accepted broadcast ${created.data.id}, but this issue was changed while it was being sent. If it should not go out, cancel it in Resend's Broadcasts page.`,
        });
      }
      context.log?.(`approveNewsletter ${issue.id} → broadcast ${created.data.id} ${done.status}`);
      return json(200, present(done, settings));
    },

    async reject(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        if (!['draft', 'sending'].includes(issue.status)) {
          return json(409, { ok: false, error: `A ${issue.status} issue cannot be rejected.` });
        }
        const rejectedAt = now().toISOString();
        const rejected = { ...issue, status: 'rejected', rejectedAt, updatedAt: rejectedAt };
        try {
          await store.replaceDocIfMatch('newsletters', rejected);
        } catch (error) {
          if (error?.code === 412) return json(409, { ok: false, error: 'The issue changed elsewhere. Reload it.' });
          throw error;
        }
        return json(200, present(rejected, await readSettings()));
      } catch (error) {
        context.error?.(`rejectNewsletter failed: ${error?.message ?? error}`);
        return json(500, { ok: false, error: 'Failed to reject the newsletter issue' });
      }
    },
  };
}
