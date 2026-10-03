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
 *   DELETE /api/cms/newsletters/{id}         editor     delete a draft, rejected or failed issue
 *
 * Added for ADR 0033 (Amplify slice), so an approved issue can be managed
 * from here rather than from Resend's dashboard:
 *
 *   POST  /api/cms/newsletters/{id}/cancel     publisher  cancel a scheduled broadcast; the issue returns to Drafts
 *   POST  /api/cms/newsletters/{id}/reschedule publisher  move a scheduled broadcast to another time
 *   POST  /api/cms/newsletters/{id}/retry      publisher  a failed issue back to a draft for a fresh approval
 *   POST  /api/cms/newsletters/{id}/duplicate  editor     a new draft with this issue's content
 *   POST  /api/cms/newsletter-reconcile        editor     ask Resend where every scheduled issue stands
 *   GET   /api/cms/newsletter-sender           editor     the From address newsletters send from
 *   PUT   /api/cms/newsletter-sender           publisher  change it (validated on a Resend sending domain)
 *
 * ## Scheduled becomes sent by asking Resend (reconcile.js)
 *
 * Approval records `scheduled`; Resend does the sending and tells nobody. So
 * a read of a scheduled issue, a list that finds one overdue, and the
 * reconcile route each read `GET /broadcasts/{id}` and write what it says —
 * `sent` with Resend's `sent_at`, or `failed` with the reason when Resend
 * canceled or lost it. That is the only path to `sent` for a scheduled issue.
 *
 * ## Manual blocks (applySectionEdit)
 *
 * The owner can add an item of their own — a chosen live article or a custom
 * block with a title, link, summary and image — to any section, or into a
 * section of their own (`manual`, `manual-<slug>`). A manual item carries
 * `manual: true` and is validated like a collected one: plain text, an https
 * link, an https image. Collected items are still never edited.
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
 *
 * ## The design is the one that was previewed
 *
 * With a Resend template chosen in Newsletter settings (#557), the preview, the
 * test send and the broadcast are all laid out in it (template-layout.js),
 * from the same cached copy (template-source.js). When the template cannot be
 * fetched or used, the preview and the test send fall back to the built-in
 * design and say why in `templateProblem`. Approval does NOT fall back: it is
 * refused with 409 TEMPLATE_UNUSABLE before the claim, so an issue is never
 * broadcast in a design other than the one the owner chose and previewed.
 */
import { readKey } from '../ai/router.js';
import { startBudgetClock } from '../ai/time-budget.js';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { presentSetting } from '../platform-settings.js';
import { createResendClient } from './resend-client.js';
import { resolveSegmentId } from './handlers.js';
import { ISSUE_ID_PATTERN, describeAiError, draftIntro, suggestSubjects } from './issue.js';
import { reconcileIssue, reconcileIssues, reconcilable, overdue } from './reconcile.js';
import { renderIssue } from './render.js';
import { resolveSendTime } from './schedule.js';
import { absoluteUrl, plainText } from './sections.js';
import {
  NEWSLETTER_SENDER_CONFIG_ID,
  checkSendingDomain,
  parseFromAddress,
  presentSender,
  resolveFromAddress,
} from './sender.js';
import {
  BUILT_IN_TEMPLATE_ID,
  NEWSLETTER_SETTINGS_CONFIG_ID,
  missingForSending,
} from './settings.js';
import { renderIssueInTemplate } from './template-layout.js';
import { loadTemplateHtml, sharedTemplateCache } from './template-source.js';

export const MAX_CUSTOM_NOTE_LENGTH = 2000;
export const MAX_SUBJECT_LENGTH = 120;
export const MAX_PREHEADER_LENGTH = 150;
/** One test email per issue per this long. */
export const TEST_SEND_INTERVAL_MS = 60 * 1000;

const EDITABLE_FIELDS = ['customNote', 'subject', 'preheader', 'sections', 'sendAt', 'etag'];
const LIST_LIMIT = 50;
const PUBLISHED_LIMIT = 100;
/** How many versions an issue remembers (ADR 0033): the last ten saves. */
export const MAX_VERSIONS = 10;
/** Overdue scheduled issues a list read asks Resend about, at most. */
const LIST_RECONCILE_LIMIT = 5;
const MAX_SECTION_TITLE_LENGTH = 80;
const MANUAL_SECTION_ID = /^manual(-[a-z0-9]{1,20})?$/;

/** Only these can be deleted: anything else was approved, and Resend has it (a failed one no longer does). */
const DELETABLE = new Set(['draft', 'rejected', 'failed']);

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
  'sendAt',
  'broadcastStatus',
  'reconciledAt',
  'canceledAt',
  'duplicatedFrom',
];

/** The list reads only what it shows, not every issue's sections. */
const SUMMARY_PROJECTION = SUMMARY_FIELDS.map((field) => `c.${field}`).join(', ');

const pick = (doc, fields) =>
  Object.fromEntries(fields.filter((f) => doc[f] !== undefined).map((f) => [f, doc[f]]));

/** A list row: the summary plus the etag, so a card can be deleted without opening it. */
const summarise = (row) => ({
  ...pick(row, SUMMARY_FIELDS),
  etag: row._etag ?? null,
});

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
  const code =
    typeof error?.code === 'string' || typeof error?.code === 'number' ? ` code ${error.code}` : '';
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
  const message =
    typeof result?.data?.message === 'string' ? `: ${result.data.message.slice(0, 200)}` : '';
  return `${describeForLog(result)}${message}`;
};

/**
 * A manual block as submitted, validated into the stored item shape, or
 * `{ error }`. Plain text only and https only, like a collected item: the
 * renderer escapes every field, and `absoluteUrl` drops anything that is not
 * https (a site path is made absolute).
 */
export function normalizeManualItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { error: 'a manual item must be an object' };
  const title = plainText(raw.title, 160);
  if (!title) return { error: 'a manual item needs a title' };
  const url = absoluteUrl(raw.url);
  if (!url) return { error: 'a manual item needs an https link' };
  const item = { manual: true, title, url };
  const summary = plainText(raw.summary);
  if (summary) item.summary = summary;
  const label = plainText(raw.label, 40);
  if (label) item.label = label;
  if (raw.imageUrl !== undefined && raw.imageUrl !== null && raw.imageUrl !== '') {
    const imageUrl = absoluteUrl(raw.imageUrl);
    if (!imageUrl) return { error: 'a manual item image must be an https URL' };
    item.imageUrl = imageUrl;
  }
  if (raw.contentId !== undefined && raw.contentId !== null)
    item.contentId = String(raw.contentId).slice(0, 120);
  return { item };
}

/**
 * The stored sections, filtered and reordered as the page submitted them,
 * plus any manual blocks it added, or `{ error }`. Collected items may only
 * be removed or reordered (see "Editing sections never adds content" above)
 * and are written back as STORED; a manual item (`manual: true`) is
 * validated by `normalizeManualItem` and may land in any section, or in a
 * manual section the page creates (`manual`, `manual-<slug>`, with a title).
 */
export function applySectionEdit(storedSections, submitted) {
  if (!Array.isArray(submitted)) return { error: 'sections must be an array' };
  const stored = new Map((storedSections || []).map((section) => [section.id, section]));
  const seenSections = new Set();
  const sections = [];
  for (const entry of submitted) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.id !== 'string'
    ) {
      return {
        error: 'each section must be an object with the id of a section in this issue',
      };
    }
    let original = stored.get(entry.id);
    if (!original) {
      // Only a manual section may be new, and it needs a title.
      if (!MANUAL_SECTION_ID.test(entry.id)) {
        return {
          error: 'sections may only be removed or reordered; a section was added',
        };
      }
      const title = plainText(entry.title, MAX_SECTION_TITLE_LENGTH);
      if (!title) return { error: 'a manual section needs a title' };
      original = { id: entry.id, title, manual: true, items: [] };
    }
    if (seenSections.has(entry.id)) return { error: 'a section is listed more than once' };
    seenSections.add(entry.id);
    if (entry.title !== undefined && entry.title !== original.title) {
      if (!original.manual) return { error: 'a section title cannot be edited' };
      const title = plainText(entry.title, MAX_SECTION_TITLE_LENGTH);
      if (!title) return { error: 'a manual section needs a title' };
      original = { ...original, title };
    }
    if (!Array.isArray(entry.items)) return { error: 'each section needs an items array' };
    const byUrl = new Map((original.items || []).map((item) => [item.url, item]));
    const seenItems = new Set();
    const items = [];
    for (const item of entry.items) {
      const isObject = item && typeof item === 'object' && !Array.isArray(item);
      if (isObject && item.manual === true) {
        const manual = normalizeManualItem(item);
        if (manual.error) return { error: manual.error };
        if (seenItems.has(manual.item.url)) return { error: 'an item is listed more than once' };
        seenItems.add(manual.item.url);
        items.push(manual.item);
        continue;
      }
      const url = isObject ? item.url : undefined;
      const match = typeof url === 'string' ? byUrl.get(url) : undefined;
      if (!match) {
        return {
          error:
            'items may only be removed or reordered within their section; an item was added or moved',
        };
      }
      if (seenItems.has(url)) return { error: 'an item is listed more than once' };
      seenItems.add(url);
      // Any field the page sends back must be the stored value: this is a
      // subset check, not an editor for titles, summaries or labels.
      const edited = Object.keys(item).some((key) => item[key] !== match[key]);
      if (edited)
        return {
          error: 'item fields cannot be edited; they come from the site',
        };
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
 * When an issue approved (or looked at) at `at` goes out: the issue's own
 * `sendAt` when it is set and still ahead, else the settings slot. An
 * override already in the past is reported, not silently honoured, because
 * Resend refuses a past `scheduled_at`.
 */
export function planFor(issue, settings, at) {
  const override = typeof issue?.sendAt === 'string' ? Date.parse(issue.sendAt) : NaN;
  if (Number.isFinite(override) && override > at.getTime()) {
    return {
      sendNow: false,
      scheduledAt: new Date(override).toISOString(),
      override: true,
    };
  }
  const plan = resolveSendTime(at, settings);
  return Number.isFinite(override) ? { ...plan, overrideExpired: true } : plan;
}

/** The last saved versions, newest first, with the one being replaced in front. */
export function pushVersion(issue, by, at) {
  const snapshot = {
    at,
    by,
    subject: issue.subject ?? '',
    preheader: issue.preheader ?? '',
    customNote: issue.customNote ?? '',
    sections: issue.sections ?? [],
    itemCount: issue.itemCount ?? 0,
  };
  const existing = Array.isArray(issue.versions) ? issue.versions : [];
  return [snapshot, ...existing].slice(0, MAX_VERSIONS);
}

/** A version as the page lists it: no sections, which can be large. */
const summariseVersion = (version) => ({
  at: version.at,
  by: version.by ?? null,
  subject: version.subject ?? '',
  preheader: version.preheader ?? '',
  itemCount:
    version.itemCount ??
    (version.sections || []).reduce((sum, s) => sum + (s.items?.length || 0), 0),
  sectionCount: (version.sections || []).length,
});

/**
 * The AI time budget of the two routes that wait on the drafter: regenerate
 * the intro, and suggest subject lines. It is counted from the moment the
 * handler starts, so the reads before the model call spend from it.
 *
 * Neither route has an entry in the client's timeout table (frontend
 * lib/api.js), so both get its 20 s default. 14 s leaves room for the write
 * and the render that follow a regenerated intro, and for the trip to the
 * browser. Inside it, a slow first provider fails over rather than
 * outliving the page (router.js header, SYNCHRONOUS CALLS HAVE A TIME
 * BUDGET). sync-budgets.test.js pins it against the client default.
 */
export const NEWSLETTER_AI_BUDGET_MS = 14_000;

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, queryDocs: Function, upsertDoc: Function, replaceDocIfMatch: Function }} deps.store
 * @param {Record<string, string|undefined>} [deps.env]
 * @param {typeof fetch} [deps.fetch]
 * @param {() => Date} [deps.now]
 * @param {{ generateDraft: Function } | null} [deps.drafter] the builder's drafter; null refuses the AI routes
 * @param {ReturnType<import('./template-source.js').createTemplateCache>} [deps.templateCache]
 * @param {number} [deps.aiBudgetMs] the AI routes' time budget; injected for tests
 */
export function createNewsletterAdminHandlers({
  guard,
  store,
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
  drafter = null,
  templateCache = sharedTemplateCache,
  aiBudgetMs = NEWSLETTER_AI_BUDGET_MS,
}) {
  async function readSettings() {
    const doc = await store.readDoc(
      'admin_config',
      NEWSLETTER_SETTINGS_CONFIG_ID,
      ADMIN_CONFIG_PARTITION
    );
    return presentSetting('newsletter-settings', doc).value;
  }

  async function readIssue(request) {
    const id = String(request.params?.id ?? '');
    if (!ISSUE_ID_PATTERN.test(id)) return null;
    const doc = await store.readDoc('newsletters', id, id);
    return doc?.kind === 'weekly_issue' && doc.status !== 'deleted' ? doc : null;
  }

  /** A Resend client, or null without the key. Reads that reconcile use it; nothing else does. */
  const clientOrNull = () => {
    const apiKey = readKey(env, 'RESEND_API_KEY');
    return apiKey ? createResendClient({ apiKey, fetch: fetchImpl }) : null;
  };

  /** Where this send comes from: the owner's sender, or the default (sender.js). */
  const fromAddress = (context) => resolveFromAddress(store, context);

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

  /**
   * The issue rendered in the design chosen in settings: the built-in one when
   * no template is chosen, else the template, or the built-in one plus
   * `templateProblem` when the template cannot be fetched or used. Never
   * throws for a template problem; the log line carries only its fixed code.
   */
  async function renderChosenDesign(issue, renderSettings, settings, context) {
    if (!settings.templateId) {
      templateCache.select(BUILT_IN_TEMPLATE_ID);
      return { ...renderIssue(issue, renderSettings), templateProblem: null };
    }
    const loaded = await loadTemplateHtml({
      templateId: settings.templateId,
      apiKey: readKey(env, 'RESEND_API_KEY'),
      fetch: fetchImpl,
      cache: templateCache,
    });
    const rendered = loaded.problem
      ? {
          ...renderIssue(issue, renderSettings),
          templateProblem: loaded.problem,
        }
      : renderIssueInTemplate(issue, renderSettings, loaded.html);
    if (rendered.templateProblem) {
      context?.warn?.(
        `newsletter template not used [invocation ${context?.invocationId ?? 'unknown'}]: ${rendered.templateProblem.code}`
      );
    }
    return rendered;
  }

  async function present(issue, settings, context) {
    const { templateProblem, ...preview } = await renderChosenDesign(
      issue,
      { postalAddress: settings.postalAddress || ADDRESS_NOT_SET },
      settings,
      context
    );
    const missing = missingForSending(settings);
    let sendPlan = null;
    try {
      sendPlan = planFor(issue, settings, now());
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
        sendAt: issue.sendAt ?? null,
        versions: (Array.isArray(issue.versions) ? issue.versions : []).map(summariseVersion),
        // Echo this back as `etag` on PATCH, approve or reject; a stale one is a 409.
        etag: issue._etag ?? null,
      },
      preview,
      readyToSend: missing.length === 0 && !templateProblem,
      missingSettings: missing,
      sendingEnabled: sendingEnabled(),
      sendPlan,
      fromAddress: await fromAddress(context),
      // Set when a template is chosen but the preview is the built-in design.
      templateProblem,
    };
  }

  /**
   * The list's lazy reconcile: full documents for the overdue scheduled rows,
   * asked of Resend, and the rows replaced by what came back. Silent without
   * a key. Never throws: a list must not fail because Resend did.
   */
  async function reconcileOverdueRows(rows, context) {
    const client = clientOrNull();
    const at = now();
    const candidates = (rows || [])
      .filter((row) => overdue(row, at) && row.broadcastId !== null)
      .slice(0, LIST_RECONCILE_LIMIT);
    if (!client || candidates.length === 0) return { rows, warnings: [] };
    try {
      const issues = (
        await Promise.all(candidates.map((row) => store.readDoc('newsletters', row.id, row.id)))
      ).filter(Boolean);
      const outcome = await reconcileIssues({
        store,
        client,
        issues,
        now,
        all: true,
        limit: LIST_RECONCILE_LIMIT,
        log: context,
      });
      if (outcome.changed.length === 0) return { rows, warnings: outcome.warnings };
      const refreshed = await Promise.all(
        outcome.changed.map((id) => store.readDoc('newsletters', id, id))
      );
      const byId = new Map(refreshed.filter(Boolean).map((doc) => [doc.id, doc]));
      return {
        rows: rows.map((row) => (byId.has(row.id) ? byId.get(row.id) : row)),
        warnings: outcome.warnings,
      };
    } catch (error) {
      context.warn?.(`listNewsletters reconcile skipped: ${errorMeta(error)}`);
      return { rows, warnings: [] };
    }
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
            `SELECT TOP ${PUBLISHED_LIMIT} ${SUMMARY_PROJECTION}, c.broadcastId, c._etag FROM c WHERE c.kind = 'weekly_issue' AND ((c.status = 'sent' AND c.sentAt >= @from AND c.sentAt < @to) OR ((c.status = 'scheduled' OR c.status = 'failed') AND c.scheduledAt >= @from AND c.scheduledAt < @to)) ORDER BY c.createdAt DESC`,
            [
              { name: '@from', value: from },
              { name: '@to', value: to },
            ]
          );
        } else {
          rows = await store.queryDocs(
            'newsletters',
            `SELECT TOP ${LIST_LIMIT} ${SUMMARY_PROJECTION}, c.broadcastId, c._etag FROM c WHERE c.kind = 'weekly_issue' AND c.status != 'deleted' ORDER BY c.createdAt DESC`,
            []
          );
        }
        // Scheduled issues whose time has passed: ask Resend before answering,
        // so the list never shows a send as pending after it went (ADR 0033).
        const reconciled = await reconcileOverdueRows(rows || [], context);
        return json(200, {
          ok: true,
          issues: reconciled.rows.map(summarise),
          ...(reconciled.warnings.length ? { reconcileWarnings: reconciled.warnings } : {}),
        });
      } catch (error) {
        context.error?.(`listNewsletters failed: ${error?.message ?? error}`);
        return json(500, {
          ok: false,
          error: 'Failed to list newsletter issues',
        });
      }
    },

    async get(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        let issue = await readIssue(request);
        if (!issue) return notFound();
        let reconcileWarning = null;
        const client = reconcilable(issue) ? clientOrNull() : null;
        if (client) {
          try {
            const outcome = await reconcileIssue({
              store,
              client,
              issue,
              now,
              log: context,
            });
            issue = outcome.issue;
            if (outcome.reason) reconcileWarning = outcome.reason;
          } catch (error) {
            context.warn?.(`getNewsletter reconcile skipped: ${errorMeta(error)}`);
          }
        }
        return json(200, {
          ...(await present(issue, await readSettings(), context)),
          ...(reconcileWarning ? { reconcileWarning } : {}),
        });
      } catch (error) {
        context.error?.(`getNewsletter failed: ${error?.message ?? error}`);
        return json(500, {
          ok: false,
          error: 'Failed to read the newsletter issue',
        });
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
      if (unknown.length)
        return json(400, {
          ok: false,
          error: `Unknown field(s): ${unknown.join(', ')}`,
        });
      if (missingEtag(body)) return etagRequired();

      const patch = {};
      if (body.customNote !== undefined) {
        if (typeof body.customNote !== 'string')
          return json(400, { ok: false, error: 'customNote must be a string' });
        const note = body.customNote.replace(/\r\n/g, '\n').trim();
        if (note.length > MAX_CUSTOM_NOTE_LENGTH) {
          return json(400, {
            ok: false,
            error: `customNote must be at most ${MAX_CUSTOM_NOTE_LENGTH} characters`,
          });
        }
        patch.customNote = note;
      }
      if (body.subject !== undefined) {
        const subject =
          typeof body.subject === 'string' ? body.subject.replace(/\s+/g, ' ').trim() : '';
        if (!subject || subject.length > MAX_SUBJECT_LENGTH) {
          return json(400, {
            ok: false,
            error: `subject must be 1 to ${MAX_SUBJECT_LENGTH} characters`,
          });
        }
        patch.subject = subject;
      }
      if (body.preheader !== undefined) {
        if (typeof body.preheader !== 'string')
          return json(400, { ok: false, error: 'preheader must be a string' });
        // One line in an inbox list, so whitespace collapses like the subject's.
        const preheader = body.preheader.replace(/\s+/g, ' ').trim();
        if (preheader.length > MAX_PREHEADER_LENGTH) {
          return json(400, {
            ok: false,
            error: `preheader must be at most ${MAX_PREHEADER_LENGTH} characters`,
          });
        }
        patch.preheader = preheader;
      }
      if (body.sendAt !== undefined) {
        // A per-issue send time (ADR 0033): null clears it back to the settings slot.
        if (body.sendAt === null || body.sendAt === '') {
          patch.sendAt = null;
        } else {
          const when = typeof body.sendAt === 'string' ? Date.parse(body.sendAt) : NaN;
          if (!Number.isFinite(when))
            return json(400, {
              ok: false,
              error: 'sendAt must be an ISO instant or null',
            });
          if (when <= now().getTime())
            return json(400, {
              ok: false,
              error: 'sendAt must be in the future',
            });
          patch.sendAt = new Date(when).toISOString();
        }
      }

      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        if (issue.status !== 'draft') {
          return json(409, {
            ok: false,
            error: `Only a draft can be edited; this issue is ${issue.status}.`,
          });
        }
        if (staleView(body, issue)) return changedElsewhere();
        if (body.sections !== undefined) {
          // Checked against the stored issue, which is the version the etag names.
          const edit = applySectionEdit(issue.sections, body.sections);
          if (edit.error)
            return json(400, {
              ok: false,
              code: 'SECTIONS_INVALID',
              error: edit.error,
            });
          patch.sections = edit.sections;
          patch.itemCount = edit.itemCount;
        }
        const at = now().toISOString();
        // The version being replaced goes into history first, so Reset and a
        // later look-back both have what the owner saw before this save.
        const versions = pushVersion(issue, auth.user?.oid || auth.user?.sub || null, at);
        const updated = { ...issue, ...patch, versions, updatedAt: at };
        let written;
        try {
          written = await store.replaceDocIfMatch('newsletters', updated);
        } catch (error) {
          if (error?.code === 412) return changedElsewhere();
          throw error;
        }
        // The stored document, so the response carries the NEW etag.
        return json(200, await present(written ?? updated, await readSettings(), context));
      } catch (error) {
        context.error?.(`updateNewsletter failed: ${error?.message ?? error}`);
        return json(500, {
          ok: false,
          error: 'Failed to save the newsletter issue',
        });
      }
    },

    /**
     * Regenerate a draft's intro with the builder's own drafter, instruction
     * and saved tone (issue.js draftIntro). Only the intro is written, never the
     * subject, which the owner may have edited. An AI failure writes nothing.
     */
    async intro(request, context) {
      const budgetLeft = startBudgetClock(aiBudgetMs);
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      if (missingEtag(body)) return etagRequired();
      const ref = `[invocation ${context?.invocationId ?? 'unknown'}]`;
      if (!drafter)
        return json(503, {
          ok: false,
          error: 'AI drafting is not configured for newsletters.',
        });
      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        if (issue.status !== 'draft') {
          return json(409, {
            ok: false,
            error: `Only a draft's intro can be regenerated; this issue is ${issue.status}.`,
          });
        }
        if (staleView(body, issue)) return changedElsewhere();

        // The saved tone (Newsletter settings → Content), the same one a build uses.
        const settings = await readSettings();
        let intro;
        try {
          ({ intro } = await draftIntro({
            drafter,
            sections: issue.sections ?? [],
            subject: issue.subject,
            tone: settings.introTone,
            budgetMs: budgetLeft(),
          }));
        } catch (error) {
          context.error?.(`regenerateNewsletterIntro AI failed ${ref}: ${errorMeta(error)}`);
          return json(502, {
            ok: false,
            code: 'AI_FAILED',
            error: `The intro was not regenerated: ${describeAiError(error)}`,
          });
        }
        if (!intro) {
          return json(502, {
            ok: false,
            code: 'AI_FAILED',
            error: 'The intro was not regenerated: the AI returned an empty intro. Try again.',
          });
        }

        // Conditional on the version read above, so an edit that landed while
        // the model was writing is not overwritten.
        const updated = {
          ...issue,
          intro,
          introError: null,
          updatedAt: now().toISOString(),
        };
        let written;
        try {
          written = await store.replaceDocIfMatch('newsletters', updated);
        } catch (error) {
          if (error?.code === 412) return changedElsewhere();
          throw error;
        }
        return json(200, await present(written ?? updated, settings, context));
      } catch (error) {
        context.error?.(`regenerateNewsletterIntro failed ${ref}: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to regenerate the intro',
        });
      }
    },

    /** Subject-line suggestions for the page to offer. Writes nothing, so no etag. */
    async subjects(request, context) {
      const budgetLeft = startBudgetClock(aiBudgetMs);
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const ref = `[invocation ${context?.invocationId ?? 'unknown'}]`;
      if (!drafter)
        return json(503, {
          ok: false,
          error: 'AI drafting is not configured for newsletters.',
        });
      let issue;
      try {
        issue = await readIssue(request);
      } catch (error) {
        context.error?.(`suggestNewsletterSubjects read failed ${ref}: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to read the newsletter issue',
        });
      }
      if (!issue) return notFound();
      try {
        const subjects = await suggestSubjects({
          drafter,
          sections: issue.sections ?? [],
          subject: issue.subject,
          budgetMs: budgetLeft(),
        });
        return json(200, { ok: true, subjects });
      } catch (error) {
        context.error?.(`suggestNewsletterSubjects AI failed ${ref}: ${errorMeta(error)}`);
        return json(502, {
          ok: false,
          code: 'AI_FAILED',
          error: `No subject lines were suggested: ${describeAiError(error)}`,
        });
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
      if (!apiKey)
        return json(503, {
          ok: false,
          error: 'Resend is not configured: RESEND_API_KEY is not set',
        });

      let settings;
      let issue;
      try {
        settings = await readSettings();
        issue = await readIssue(request);
      } catch (error) {
        context.error?.(`testNewsletter read failed ${ref}: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to read the newsletter issue',
        });
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
        return json(409, {
          ok: false,
          error: `Only a draft can be test-sent; this issue is ${issue.status}.`,
        });
      }

      const at = now();
      const tooSoon = (doc) => {
        const last = Date.parse(doc?.lastTestAt ?? '');
        if (!Number.isFinite(last) || at.getTime() - last >= TEST_SEND_INTERVAL_MS) return null;
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((last + TEST_SEND_INTERVAL_MS - at.getTime()) / 1000)
        );
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

      // In the chosen design; an unusable template falls back to the built-in
      // one for a test, and the answer says so.
      let rendered;
      try {
        rendered = await renderChosenDesign(
          issue,
          { postalAddress: settings.postalAddress, testSend: true },
          settings,
          context
        );
      } catch (error) {
        context.error?.(`testNewsletter render failed ${ref}: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to render the newsletter issue',
        });
      }

      let claimed;
      try {
        claimed = await store.replaceDocIfMatch('newsletters', {
          ...issue,
          lastTestAt: at.toISOString(),
        });
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
        from: await fromAddress(context),
        to: [sentTo],
        subject: `[TEST] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
      });
      const etag = claimed?._etag ?? null;
      if (!sent.ok) {
        context.error?.(`testNewsletter not sent ${ref}: ${describeForLog(sent)}`);
        return json(502, {
          ok: false,
          etag,
          ...(rendered.templateProblem ? { templateProblem: rendered.templateProblem } : {}),
          error: `Resend did not accept the test email: ${describeForOwner(sent)}`,
        });
      }
      context.log?.(`testNewsletter sent ${ref}`);
      return json(200, {
        ok: true,
        sentTo,
        etag,
        ...(rendered.templateProblem ? { templateProblem: rendered.templateProblem } : {}),
      });
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
          error:
            'Sending is switched off. Set newsletter_sending_enabled to true in Terraform to allow approval.',
        });
      }

      const apiKey = readKey(env, 'RESEND_API_KEY');
      if (!apiKey)
        return json(503, {
          ok: false,
          error: 'Resend is not configured: RESEND_API_KEY is not set',
        });

      let settings;
      let issue;
      try {
        settings = await readSettings();
        issue = await readIssue(request);
      } catch (error) {
        context.error?.(`approveNewsletter read failed ${ref}: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to read the newsletter issue',
        });
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
        return json(409, {
          ok: false,
          error: `Only a draft can be approved; this issue is ${issue.status}.`,
        });
      }
      // Approve what the approver saw: an issue edited since they opened it is
      // not sent with content they never read.
      if (staleView(body, issue)) return changedElsewhere();

      // Everything that can fail on the site's own data is worked out BEFORE the
      // claim, so a bad settings document refuses the approval instead of
      // leaving the issue stuck in `sending` with nothing sent.
      let plan;
      try {
        plan = planFor(issue, settings, now());
      } catch (error) {
        context.error?.(`approveNewsletter send slot invalid ${ref}: ${errorMeta(error)}`);
        return json(409, {
          ok: false,
          code: 'SETTINGS_INVALID',
          error:
            'The send day, time or time zone in Newsletter settings is not valid. Save them again, then approve.',
        });
      }
      let rendered;
      try {
        rendered = await renderChosenDesign(
          issue,
          { postalAddress: settings.postalAddress },
          settings,
          context
        );
      } catch (error) {
        context.error?.(`approveNewsletter render failed ${ref}: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to render the newsletter issue',
        });
      }
      // The chosen template could not be fetched or used. The preview showed
      // the built-in design with a warning; sending that instead of the design
      // the owner chose is refused, before anything is claimed.
      if (rendered.templateProblem) {
        context.error?.(
          `approveNewsletter template unusable ${ref}: ${rendered.templateProblem.code}`
        );
        return json(409, {
          ok: false,
          code: 'TEMPLATE_UNUSABLE',
          templateProblem: rendered.templateProblem,
          error: `The template chosen in Newsletter settings cannot be used: ${rendered.templateProblem.message} Fix it in Resend or choose the built-in design, check the preview, then approve.`,
        });
      }

      const approvedAt = now().toISOString();
      const approvedBy = auth.user?.oid || auth.user?.sub || null;
      const claimed = {
        ...issue,
        status: 'sending',
        approvedAt,
        approvedBy,
        lastError: null,
        updatedAt: approvedAt,
      };
      try {
        await store.replaceDocIfMatch('newsletters', claimed);
      } catch (error) {
        if (error?.code === 412) return changedElsewhere();
        context.error?.(`approveNewsletter claim failed ${ref}: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to approve the newsletter issue',
        });
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
          const doc = await store.replaceDocIfMatch('newsletters', {
            ...next,
            _etag: current._etag,
          });
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
        return json(502, {
          ok: false,
          error: `Resend did not accept the newsletter: ${reason}`,
        });
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
        from: await fromAddress(context),
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
        }).catch((error) =>
          context.error?.(`approveNewsletter could not record ${ref}: ${errorMeta(error)}`)
        );
        return json(502, {
          ok: false,
          code: 'SEND_OUTCOME_UNKNOWN',
          error:
            "Resend did not answer, so it may have accepted the newsletter. Check Resend's Broadcasts list before anything else; reject this issue here only once you have.",
        });
      }
      if (!created.ok || !created.data?.id)
        return revert(describeForOwner(created), describeForLog(created));

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
          ...(await present(latest, settings, context)),
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
      return json(200, await present(outcome.doc, settings, context));
    },

    /**
     * Cancel a scheduled broadcast. Resend's cancel is `DELETE /broadcasts/{id}`
     * for a `scheduled` one; a refusal comes back with Resend's own sentence,
     * because the plan or the state is what it names. On success the issue
     * is a kept draft again, approvable afresh, with the cancellation recorded.
     */
    async cancel(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      if (missingEtag(body)) return etagRequired();
      const ref = `[invocation ${context?.invocationId ?? 'unknown'}]`;
      const apiKey = readKey(env, 'RESEND_API_KEY');
      if (!apiKey)
        return json(503, {
          ok: false,
          error: 'Resend is not configured: RESEND_API_KEY is not set',
        });
      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        if (issue.status !== 'scheduled' || !issue.broadcastId) {
          return json(409, {
            ok: false,
            error: `Only a scheduled issue can be canceled; this issue is ${issue.status}.`,
          });
        }
        if (staleView(body, issue)) return changedElsewhere();
        const client = createResendClient({ apiKey, fetch: fetchImpl });
        const deleted = await client.deleteBroadcast(issue.broadcastId);
        if (!deleted.ok) {
          context.error?.(`cancelNewsletter refused ${ref}: ${describeForLog(deleted)}`);
          return json(502, {
            ok: false,
            code: 'CANCEL_REFUSED',
            error: `Resend did not cancel the broadcast: ${describeForOwner(deleted)}`,
          });
        }
        const at = now().toISOString();
        const canceled = {
          ...issue,
          status: 'draft',
          savedAt: issue.savedAt ?? at,
          canceledAt: at,
          canceledBroadcastId: issue.broadcastId,
          broadcastId: null,
          broadcastStatus: null,
          scheduledAt: null,
          approvedAt: null,
          approvedBy: null,
          lastError: null,
          updatedAt: at,
        };
        let written;
        try {
          written = await store.replaceDocIfMatch('newsletters', canceled);
        } catch (error) {
          if (error?.code === 412) return changedElsewhere();
          throw error;
        }
        context.log?.(`cancelNewsletter ok ${ref}`);
        return json(200, await present(written ?? canceled, await readSettings(), context));
      } catch (error) {
        context.error?.(`cancelNewsletter failed ${ref}: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to cancel the newsletter issue',
        });
      }
    },

    /**
     * Move a scheduled broadcast. Resend's update does not take a new
     * `scheduled_at`, so this is a cancel and a fresh broadcast with the same
     * rendered content: the old one is deleted first, and if the new one is
     * refused the issue returns to a draft with the reason rather than
     * standing scheduled against a broadcast that no longer exists.
     */
    async reschedule(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      if (missingEtag(body)) return etagRequired();
      const ref = `[invocation ${context?.invocationId ?? 'unknown'}]`;
      const when = typeof body.scheduledAt === 'string' ? Date.parse(body.scheduledAt) : NaN;
      if (!Number.isFinite(when))
        return json(400, {
          ok: false,
          error: 'scheduledAt must be an ISO instant',
        });
      if (when <= now().getTime() + 60 * 1000)
        return json(400, {
          ok: false,
          error: 'scheduledAt must be at least a minute ahead',
        });
      const scheduledAt = new Date(when).toISOString();
      const apiKey = readKey(env, 'RESEND_API_KEY');
      if (!apiKey)
        return json(503, {
          ok: false,
          error: 'Resend is not configured: RESEND_API_KEY is not set',
        });
      try {
        const settings = await readSettings();
        const issue = await readIssue(request);
        if (!issue) return notFound();
        if (issue.status !== 'scheduled' || !issue.broadcastId) {
          return json(409, {
            ok: false,
            error: `Only a scheduled issue can be rescheduled; this issue is ${issue.status}.`,
          });
        }
        if (staleView(body, issue)) return changedElsewhere();
        const rendered = await renderChosenDesign(
          issue,
          { postalAddress: settings.postalAddress },
          settings,
          context
        );
        if (rendered.templateProblem) {
          return json(409, {
            ok: false,
            code: 'TEMPLATE_UNUSABLE',
            templateProblem: rendered.templateProblem,
            error: `The template chosen in Newsletter settings cannot be used: ${rendered.templateProblem.message}`,
          });
        }
        const client = createResendClient({ apiKey, fetch: fetchImpl });
        const deleted = await client.deleteBroadcast(issue.broadcastId);
        if (!deleted.ok) {
          context.error?.(`rescheduleNewsletter cancel refused ${ref}: ${describeForLog(deleted)}`);
          return json(502, {
            ok: false,
            code: 'CANCEL_REFUSED',
            error: `Resend did not release the current broadcast, so nothing moved: ${describeForOwner(deleted)}`,
          });
        }
        const at = now().toISOString();
        let segmentId;
        let created = null;
        try {
          segmentId = await resolveSegmentId(client);
          created = await client.createBroadcast({
            segmentId,
            from: await fromAddress(context),
            replyTo: settings.replyTo,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            name: `HybridCloudWorks Weekly ${issue.id.slice('issue-'.length)}`,
            scheduledAt,
          });
        } catch (error) {
          created = {
            ok: false,
            status: 0,
            data: { message: String(error?.message ?? error) },
          };
        }
        if (!created.ok || !created.data?.id) {
          // The old broadcast is gone and no new one exists: say so on the issue.
          context.error?.(
            `rescheduleNewsletter new broadcast refused ${ref}: ${describeForLog(created)}`
          );
          const reverted = {
            ...issue,
            status: 'draft',
            savedAt: issue.savedAt ?? at,
            canceledAt: at,
            canceledBroadcastId: issue.broadcastId,
            broadcastId: null,
            broadcastStatus: null,
            scheduledAt: null,
            approvedAt: null,
            approvedBy: null,
            lastError: `The previous broadcast was canceled but Resend refused the new one: ${describeForOwner(created)}. Approve again to reschedule.`,
            updatedAt: at,
          };
          await store.replaceDocIfMatch('newsletters', reverted).catch((error) => {
            context.error?.(`rescheduleNewsletter could not revert ${ref}: ${errorMeta(error)}`);
          });
          return json(502, {
            ok: false,
            code: 'RESCHEDULE_REFUSED',
            error: reverted.lastError,
          });
        }
        const moved = {
          ...issue,
          broadcastId: created.data.id,
          broadcastStatus: 'scheduled',
          scheduledAt,
          sendAt: scheduledAt,
          rescheduledAt: at,
          lastError: null,
          updatedAt: at,
        };
        let written;
        try {
          written = await store.replaceDocIfMatch('newsletters', moved);
        } catch (error) {
          if (error?.code === 412) {
            return json(409, {
              ok: false,
              code: 'CHANGED_DURING_RESCHEDULE',
              broadcastId: created.data.id,
              error: `Resend accepted broadcast ${created.data.id} for ${scheduledAt}, but this issue changed meanwhile. Reload it; if it does not show the new time, cancel the extra broadcast in Resend.`,
            });
          }
          throw error;
        }
        context.log?.(`rescheduleNewsletter ok ${ref}`);
        return json(200, await present(written ?? moved, settings, context));
      } catch (error) {
        context.error?.(`rescheduleNewsletter failed ${ref}: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to reschedule the newsletter issue',
        });
      }
    },

    /**
     * A failed issue back to a kept draft, so it can be approved again. The
     * failure stays in `lastError` for the page to show until the next
     * approval clears it.
     */
    async retry(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      if (missingEtag(body)) return etagRequired();
      try {
        const issue = await readIssue(request);
        if (!issue) return notFound();
        if (issue.status !== 'failed') {
          return json(409, {
            ok: false,
            error: `Only a failed issue can be retried; this issue is ${issue.status}.`,
          });
        }
        if (staleView(body, issue)) return changedElsewhere();
        const at = now().toISOString();
        const retried = {
          ...issue,
          status: 'draft',
          savedAt: issue.savedAt ?? at,
          retriedAt: at,
          failedBroadcastId: issue.broadcastId ?? null,
          broadcastId: null,
          broadcastStatus: null,
          scheduledAt: null,
          sentAt: null,
          approvedAt: null,
          approvedBy: null,
          updatedAt: at,
        };
        let written;
        try {
          written = await store.replaceDocIfMatch('newsletters', retried);
        } catch (error) {
          if (error?.code === 412) return changedElsewhere();
          throw error;
        }
        return json(200, await present(written ?? retried, await readSettings(), context));
      } catch (error) {
        context.error?.(`retryNewsletter failed: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to retry the newsletter issue',
        });
      }
    },

    /**
     * A new kept draft with this issue's subject, preview text, note, intro
     * and sections, under today's id (or a suffixed one when today's is taken).
     * Nothing about the source changes.
     */
    async duplicate(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const source = await readIssue(request);
        if (!source) return notFound();
        const at = now();
        const day = at.toISOString().slice(0, 10);
        let id = `issue-${day}`;
        for (let n = 2; n < 100; n += 1) {
          const taken = await store.readDoc('newsletters', id, id);
          if (!taken || taken.status === 'deleted') break;
          id = `issue-${day}-${n}`;
        }
        const stamp = at.toISOString();
        const doc = {
          id,
          kind: 'weekly_issue',
          version: 1,
          status: 'draft',
          periodStart: source.periodStart ?? null,
          periodEnd: source.periodEnd ?? null,
          subject: source.subject ?? '',
          preheader: source.preheader ?? '',
          intro: source.intro ?? '',
          introError: null,
          customNote: source.customNote ?? '',
          sections: source.sections ?? [],
          itemCount: source.itemCount ?? 0,
          problems: [],
          duplicatedFrom: source.id,
          savedAt: stamp,
          savedBy: auth.user?.oid || auth.user?.sub || null,
          createdAt: stamp,
          updatedAt: stamp,
        };
        await store.upsertDoc('newsletters', doc);
        const stored = (await store.readDoc('newsletters', id, id)) ?? doc;
        return json(200, await present(stored, await readSettings(), context));
      } catch (error) {
        context.error?.(`duplicateNewsletter failed: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to duplicate the newsletter issue',
        });
      }
    },

    /** Ask Resend where every scheduled issue stands, now, and write what it says. */
    async reconcile(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const client = clientOrNull();
      if (!client)
        return json(503, {
          ok: false,
          error: 'Resend is not configured: RESEND_API_KEY is not set',
        });
      try {
        const rows = await store.queryDocs(
          'newsletters',
          `SELECT TOP ${PUBLISHED_LIMIT} * FROM c WHERE c.kind = 'weekly_issue' AND (c.status = 'scheduled' OR c.status = 'sending') AND IS_DEFINED(c.broadcastId)`,
          []
        );
        const outcome = await reconcileIssues({
          store,
          client,
          issues: rows || [],
          now,
          all: true,
          limit: PUBLISHED_LIMIT,
          log: context,
        });
        return json(200, { ok: true, ...outcome });
      } catch (error) {
        context.error?.(`reconcileNewsletters failed: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to reconcile newsletter issues with Resend',
        });
      }
    },

    /** GET /api/cms/newsletter-sender — the From address, and whether it is the default. */
    async getSender(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const doc = await store.readDoc(
          'admin_config',
          NEWSLETTER_SENDER_CONFIG_ID,
          ADMIN_CONFIG_PARTITION
        );
        return json(200, { ok: true, ...presentSender(doc) });
      } catch (error) {
        context.error?.(`getNewsletterSender failed: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to read the newsletter sender',
        });
      }
    },

    /**
     * PUT /api/cms/newsletter-sender { from } — publisher. An empty `from`
     * returns to the default. Any other address must parse and sit on a
     * sending domain: the default's, or one Resend lists as verified.
     */
    async putSender(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return json(400, { ok: false, error: 'Body must be a JSON object' });
      if (body.from !== undefined && typeof body.from !== 'string')
        return json(400, { ok: false, error: 'from must be a string' });
      const raw = String(body.from ?? '').trim();
      try {
        const at = now().toISOString();
        const by = auth.user?.oid || auth.user?.sub || null;
        if (!raw) {
          await store.upsertDoc('admin_config', {
            id: NEWSLETTER_SENDER_CONFIG_ID,
            configScope: ADMIN_CONFIG_PARTITION,
            from: '',
            updatedAt: at,
            updatedBy: by,
          });
          return json(200, {
            ok: true,
            ...presentSender({ from: '', updatedAt: at, updatedBy: by }),
          });
        }
        const parsed = parseFromAddress(raw);
        if (!parsed)
          return json(400, {
            ok: false,
            error: 'from must be an email address, optionally as "Name <address>"',
          });
        const domain = await checkSendingDomain(parsed.domain, clientOrNull());
        if (!domain.ok)
          return json(400, {
            ok: false,
            code: 'DOMAIN_NOT_SENDING',
            error: domain.reason,
          });
        const doc = {
          id: NEWSLETTER_SENDER_CONFIG_ID,
          configScope: ADMIN_CONFIG_PARTITION,
          from: parsed.from,
          updatedAt: at,
          updatedBy: by,
        };
        await store.upsertDoc('admin_config', doc);
        return json(200, { ok: true, ...presentSender(doc) });
      } catch (error) {
        context.error?.(`putNewsletterSender failed: ${errorMeta(error)}`);
        return json(500, {
          ok: false,
          error: 'Failed to save the newsletter sender',
        });
      }
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
          return json(409, {
            ok: false,
            error: `Only a draft can be saved to Drafts; this issue is ${issue.status}.`,
          });
        }
        if (staleView(body, issue)) return changedElsewhere();
        // Already saved: nothing to write, and saying so is not an error.
        if (issue.savedAt) return json(200, await present(issue, await readSettings(), context));
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
        return json(200, await present(written ?? saved, await readSettings(), context));
      } catch (error) {
        context.error?.(`saveNewsletter failed: ${error?.message ?? error}`);
        return json(500, {
          ok: false,
          error: 'Failed to save the issue to Drafts',
        });
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
        return json(500, {
          ok: false,
          error: 'Failed to delete the newsletter issue',
        });
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
          return json(409, {
            ok: false,
            error: `A ${issue.status} issue cannot be rejected.`,
          });
        }
        if (staleView(body, issue)) return changedElsewhere();
        const rejectedAt = now().toISOString();
        const rejected = {
          ...issue,
          status: 'rejected',
          rejectedAt,
          updatedAt: rejectedAt,
        };
        let written;
        try {
          written = await store.replaceDocIfMatch('newsletters', rejected);
        } catch (error) {
          if (error?.code === 412) return changedElsewhere();
          throw error;
        }
        return json(200, await present(written ?? rejected, await readSettings(), context));
      } catch (error) {
        context.error?.(`rejectNewsletter failed: ${error?.message ?? error}`);
        return json(500, {
          ok: false,
          error: 'Failed to reject the newsletter issue',
        });
      }
    },
  };
}
