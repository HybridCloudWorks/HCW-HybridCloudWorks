/**
 * insights-handlers.js — Resend metrics, audience, domains, logs and templates
 * for the Mailing List page (#504). The API half; the page follows.
 *
 *   GET    /api/cms/mailing-list/metrics                              editor
 *   GET    /api/cms/mailing-list/broadcasts/{broadcastId}/clicked-links editor
 *   GET    /api/cms/mailing-list/broadcasts/{broadcastId}/recipients  editor
 *   GET    /api/cms/mailing-list/audience                             editor
 *   GET    /api/cms/mailing-list/audience/summary                     editor
 *   PATCH  /api/cms/mailing-list/audience/{contactId}                 publisher
 *   DELETE /api/cms/mailing-list/audience/{contactId}                 publisher
 *
 * Contacts are addressed by Resend's opaque contact id, never by email: a path
 * is recorded in request telemetry, and an address there would put a
 * subscriber's email in the logs.
 *   GET    /api/cms/mailing-list/domains                              editor
 *   POST   /api/cms/mailing-list/domains                              publisher
 *   GET    /api/cms/mailing-list/domains/{domainId}                   editor
 *   PATCH  /api/cms/mailing-list/domains/{domainId}                   publisher
 *   POST   /api/cms/mailing-list/domains/{domainId}/verify            publisher
 *   GET    /api/cms/mailing-list/logs                                 editor
 *   GET    /api/cms/mailing-list/logs/{logId}                         publisher
 *   GET    /api/cms/mailing-list/emails                               editor
 *   GET    /api/cms/mailing-list/templates                            editor
 *   GET    /api/cms/mailing-list/templates/{templateId}               editor
 *
 * ## Nothing here sends email
 *
 * Every Resend call goes through a fixed method on resend-client.js, and none
 * of them is `/emails` POST or `/broadcasts` POST. The writes are to contacts
 * (unsubscribe, delete) and to domains (add, verify, tracking), and each is
 * publisher-only. Domain delete is deliberately absent: removing a sending
 * domain stops the newsletter, and that belongs in Resend's own dashboard.
 *
 * ## Nothing the caller sends becomes a URL
 *
 * Path ids (contacts included) and cursors must match ID_PATTERN,
 * dates must be ISO, enums are checked against their lists and limits are
 * 1-100 — all before a key is read into a request. The client then
 * percent-encodes each value into a fixed template.
 *
 * ## What is returned, and what is logged
 *
 * Every answer is a projection onto named fields, so a field Resend adds later
 * does not reach the page unreviewed. A Resend refusal reaches the page as
 * `{ ok: false, status, error }`, where `error` is Resend's name and message
 * trimmed to 200 characters; a 429 is passed on as 429 with
 * `retryAfterSeconds`. Log lines carry the route name, an HTTP status and the
 * invocation id — never an address, a contact id, or any message text, because
 * Resend's messages can echo what was sent.
 */
import { readKey } from '../ai/router.js';
import { NEWSLETTER_SEGMENT_NAME } from './handlers.js';
import { createResendClient } from './resend-client.js';

/** Resend ids (UUIDs) and the opaque cursors it pages with. */
export const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const ISSUE_ID_PATTERN = /^issue-\d{4}-\d{2}-\d{2}$/;
/** A date, or a date-time in UTC or with an offset. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
/**
 * A hostname: labels of letters, digits and inner hyphens, a letter-only TLD.
 * Applied after trimming and lower-casing; the 253 cap is checked separately.
 */
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const METRICS = Object.freeze([
  'sent',
  'delivered',
  'opened',
  'unique_opened',
  'clicked',
  'unique_clicked',
  'bounced',
  'complained',
  'unsubscribed',
  'delivery_rate',
  'open_rate',
  'click_rate',
  'bounce_rate',
  'complaint_rate',
  'unsubscribe_rate',
]);
export const GRANULARITIES = Object.freeze(['hourly', 'daily', 'weekly', 'monthly']);
export const RECIPIENT_TYPES = Object.freeze([
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'unsubscribed',
  'suppressed',
]);
export const DOMAIN_REGIONS = Object.freeze(['us-east-1', 'eu-west-1', 'sa-east-1', 'ap-northeast-1']);

export const DEFAULT_METRICS_DAYS = 30;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_SEARCH_LENGTH = 100;
export const MAX_HOSTNAME_LENGTH = 253;
/** Audience summary: at most this many pages of 100 before it says `truncated`. */
export const SUMMARY_MAX_PAGES = 20;
export const SUMMARY_PAGE_SIZE = 100;
export const SUMMARY_CACHE_MS = 10 * 60 * 1000;
const ERROR_TEXT_LIMIT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

const json = (status, body, headers = {}) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const badRequest = (error) => json(400, { ok: false, error });

/** Only the listed fields, and only those present. */
const pick = (row, fields) =>
  Object.fromEntries(fields.filter((field) => row?.[field] !== undefined).map((field) => [field, row[field]]));

const rowsOf = (result) => (Array.isArray(result?.data?.data) ? result.data.data : []);

// ── Redaction ───────────────────────────────────────────────────────────────

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const BEARER_IN_TEXT = /\bBearer\s+[^\s"',;]+/gi;
/** Resend keys start `re_`; anything that looks like one goes. */
const RESEND_KEY_IN_TEXT = /\bre_[A-Za-z0-9_-]{8,}/g;
const SENSITIVE_KEY = /authorization|api[-_]?key|secret|token|password|cookie|^key$/i;
export const REDACTED = '[redacted]';
export const REDACTED_EMAIL = '[redacted email]';
const MAX_REDACT_DEPTH = 20;

/** A string with bearer tokens, Resend keys and email addresses removed. */
export function redactText(text) {
  return String(text)
    .replace(BEARER_IN_TEXT, `Bearer ${REDACTED}`)
    .replace(RESEND_KEY_IN_TEXT, REDACTED)
    .replace(EMAIL_IN_TEXT, REDACTED_EMAIL);
}

/**
 * A deep copy of a log body with credentials and addresses removed: any value
 * under a key that names a credential is replaced whole, and every string (and
 * every key) has bearer tokens, Resend keys and email addresses taken out.
 * Anything nested deeper than MAX_REDACT_DEPTH is dropped rather than walked.
 */
export function redactSensitive(value, depth = 0) {
  if (depth > MAX_REDACT_DEPTH) return REDACTED;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      const safeKey = redactText(key);
      out[safeKey] = SENSITIVE_KEY.test(key) ? REDACTED : redactSensitive(inner, depth + 1);
    }
    return out;
  }
  return value;
}

/** `jane@example.com` → `j***@example.com`. Anything unrecognisable is fully masked. */
export function maskEmail(value) {
  if (typeof value !== 'string') return null;
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return '***';
  return `${value[0]}***@${value.slice(at + 1)}`;
}

// ── Query and body validation ───────────────────────────────────────────────

const queryValue = (request, name) => {
  const value = request.query?.get?.(name);
  return value === undefined || value === null ? null : String(value);
};

/** `{ value }` or `{ error }` for an optional 1-100 integer. */
function readLimit(request, fallback = DEFAULT_PAGE_LIMIT) {
  const raw = queryValue(request, 'limit');
  if (raw === null || raw === '') return { value: fallback };
  if (!/^\d{1,3}$/.test(raw)) return { error: 'limit must be a whole number from 1 to 100' };
  const value = Number(raw);
  if (value < 1 || value > 100) return { error: 'limit must be a whole number from 1 to 100' };
  return { value };
}

/** `{ value }` or `{ error }` for an optional cursor. */
function readCursor(request) {
  const raw = queryValue(request, 'after');
  if (raw === null || raw === '') return { value: undefined };
  if (!ID_PATTERN.test(raw)) return { error: 'after must be a cursor from a previous page' };
  return { value: raw };
}

function readPage(request) {
  const limit = readLimit(request);
  if (limit.error) return limit;
  const after = readCursor(request);
  if (after.error) return after;
  return { value: { limit: limit.value, after: after.value } };
}

function readPathId(request, name) {
  const raw = request.params?.[name];
  return typeof raw === 'string' && ID_PATTERN.test(raw) ? raw : null;
}

/** An ISO date or date-time that parses, or `{ error }`. */
function readDate(request, name) {
  const raw = queryValue(request, name);
  if (raw === null || raw === '') return { value: undefined };
  if (!ISO_DATE_PATTERN.test(raw) || !Number.isFinite(Date.parse(raw))) {
    return { error: `${name} must be an ISO 8601 date (YYYY-MM-DD) or date-time` };
  }
  return { value: raw };
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The next-page cursor: the last row's id, when Resend says there is more. */
const nextCursor = (result, rows) => {
  if (!result?.data?.has_more || rows.length === 0) return null;
  const id = rows[rows.length - 1]?.id;
  return typeof id === 'string' && ID_PATTERN.test(id) ? id : null;
};

// ── Projections ─────────────────────────────────────────────────────────────

const METRIC_ROW_FIELDS = ['period', 'broadcast_id', 'domain_id', 'domain_name', ...METRICS];
const DOMAIN_SUMMARY_FIELDS = ['id', 'name', 'status', 'region', 'created_at'];
const DOMAIN_DETAIL_FIELDS = [...DOMAIN_SUMMARY_FIELDS, 'open_tracking', 'click_tracking', 'tracking_subdomain'];
const DOMAIN_RECORD_FIELDS = ['record', 'name', 'type', 'ttl', 'status', 'value', 'priority'];
const LOG_SUMMARY_FIELDS = ['id', 'created_at', 'method', 'response_status'];
const TEMPLATE_SUMMARY_FIELDS = ['id', 'name', 'alias', 'status', 'published_at'];
const TEMPLATE_VARIABLE_FIELDS = ['key', 'type', 'fallback_value'];

const projectMetricRow = (row) => pick(row, METRIC_ROW_FIELDS);
const projectTotals = (totals) => (isPlainObject(totals) ? pick(totals, METRICS) : {});
const projectDomain = (row) => pick(row, DOMAIN_SUMMARY_FIELDS);
const projectDomainDetail = (row) => ({
  ...pick(row, DOMAIN_DETAIL_FIELDS),
  records: Array.isArray(row?.records) ? row.records.map((record) => pick(record, DOMAIN_RECORD_FIELDS)) : [],
});
const projectLog = (row) => ({
  ...pick(row, LOG_SUMMARY_FIELDS),
  // A path such as /contacts/{email} names a person; the list never does.
  ...(typeof row?.endpoint === 'string' ? { endpoint: redactText(row.endpoint) } : {}),
});
const projectTemplate = (row) => ({
  ...pick(row, TEMPLATE_SUMMARY_FIELDS),
  variables: Array.isArray(row?.variables)
    ? row.variables.map((variable) => pick(variable, TEMPLATE_VARIABLE_FIELDS))
    : [],
});
const projectEmail = (row) => ({
  id: row?.id ?? null,
  to: (Array.isArray(row?.to) ? row.to : row?.to ? [row.to] : []).map(maskEmail),
  subject: typeof row?.subject === 'string' ? row.subject : null,
  created_at: row?.created_at ?? null,
  last_event: row?.last_event ?? null,
});
const projectRecipient = (row) => ({
  email: row?.email ?? null,
  count: row?.count ?? null,
  bounce_type: row?.bounce_type ?? null,
  clicked_links: Array.isArray(row?.clicked_links)
    ? row.clicked_links.map((link) => pick(link, ['url', 'clicks']))
    : [],
});
const projectClickedLink = (row) => pick(row, ['url', 'clicks', 'unique_clicks']);
const projectContact = (row) => ({
  id: row?.id ?? null,
  email: row?.email ?? null,
  first_name: row?.first_name ?? null,
  last_name: row?.last_name ?? null,
  created_at: row?.created_at ?? null,
  unsubscribed: row?.unsubscribed === true,
});

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function }} deps.store
 * @param {Record<string, string|undefined>} [deps.env]
 * @param {typeof fetch} [deps.fetch]
 * @param {() => Date} [deps.now]
 */
export function createNewsletterInsightsHandlers({
  guard,
  store,
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  /** Per process: the Newsletter segment's id does not change. Failures are not cached. */
  let segmentIdPromise = null;
  /** Per process: `{ at, value }` of the last audience summary. */
  let summaryCache = null;

  const ref = (context) => `[invocation ${context?.invocationId ?? 'unknown'}]`;

  const clientOrNull = () => {
    const apiKey = readKey(env, 'RESEND_API_KEY');
    return apiKey ? createResendClient({ apiKey, fetch: fetchImpl }) : null;
  };
  const notConfigured = () =>
    json(503, { ok: false, error: 'Resend is not configured: RESEND_API_KEY is not set' });

  /**
   * A Resend failure as an HTTP answer. Logs the route, the status and the
   * invocation only; Resend's name and message go to the caller, trimmed.
   */
  function refused(route, result, context) {
    const status = result?.status ?? 0;
    context.warn?.(`${route} Resend HTTP ${status} ${ref(context)}`);
    const name = typeof result?.data?.name === 'string' ? result.data.name : '';
    const message = typeof result?.data?.message === 'string' ? result.data.message : '';
    const text = [name, message].filter(Boolean).join(': ') || (status ? `HTTP ${status}` : 'No answer from Resend');
    const error = text.slice(0, ERROR_TEXT_LIMIT);
    if (status === 429) {
      const seconds = Number.parseInt(String(result?.retryAfter ?? ''), 10);
      const retryAfterSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 1;
      return json(429, { ok: false, status, retryAfterSeconds, error }, { 'Retry-After': String(retryAfterSeconds) });
    }
    return json(502, { ok: false, status, error });
  }

  const failed = (route, error, context) => {
    const name = typeof error?.name === 'string' ? error.name : 'Error';
    context.error?.(`${route} failed ${name} ${ref(context)}`);
    return json(500, { ok: false, error: 'The Mailing List request failed' });
  };

  /**
   * The route's common opening: role, then the key. `{ client }` or `{ response }`.
   * Role first, so an under-privileged caller learns nothing about configuration.
   */
  async function open(request, role) {
    const auth = await guard.requireRole(request, role);
    if (auth?.error) return { response: auth.error };
    const client = clientOrNull();
    if (!client) return { response: notConfigured() };
    return { client, auth };
  }

  /**
   * The Newsletter segment's id, found by name and never created: these are
   * reads, and creating a segment is confirm's job (handlers.js). `{ id }`
   * (null when there is no such segment yet) or `{ result }` for a refusal.
   */
  async function findNewsletterSegment(client) {
    let after;
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const listed = await client.listSegments(after);
      if (!listed.ok) return { result: listed };
      const rows = rowsOf(listed);
      const found = rows.find((row) => row?.name === NEWSLETTER_SEGMENT_NAME);
      if (found?.id) return { id: found.id };
      if (!listed.data?.has_more || rows.length === 0) break;
      after = rows[rows.length - 1].id;
    }
    return { id: null };
  }

  async function segmentId(client) {
    if (!segmentIdPromise) {
      segmentIdPromise = findNewsletterSegment(client).then((found) => {
        // Cache only a found id: a refusal or a not-yet-created segment is
        // asked again next time.
        if (!found.id) segmentIdPromise = null;
        return found;
      });
    }
    return segmentIdPromise;
  }

  /** GET through `call`, projecting the successful body with `project`. */
  async function relay(route, context, call, project) {
    const result = await call();
    if (!result.ok) return refused(route, result, context);
    return json(200, { ok: true, ...project(result) });
  }

  return {
    async metrics(request, context) {
      const route = 'mailingListMetrics';
      const opened = await open(request, 'editor');
      if (opened.response) return opened.response;
      try {
        const broadcastRaw = queryValue(request, 'broadcast_id');
        const issueRaw = queryValue(request, 'issue_id');
        if (broadcastRaw && issueRaw) return badRequest('Send broadcast_id or issue_id, not both');
        if (broadcastRaw && !ID_PATTERN.test(broadcastRaw)) return badRequest('broadcast_id is not a Resend id');
        if (issueRaw && !ISSUE_ID_PATTERN.test(issueRaw)) return badRequest('issue_id must be issue-YYYY-MM-DD');
        const start = readDate(request, 'start_date');
        if (start.error) return badRequest(start.error);
        const end = readDate(request, 'end_date');
        if (end.error) return badRequest(end.error);
        const granularityRaw = queryValue(request, 'granularity');
        if (granularityRaw && !GRANULARITIES.includes(granularityRaw)) {
          return badRequest(`granularity must be one of ${GRANULARITIES.join(', ')}`);
        }
        const endDate = end.value ?? now().toISOString();
        const startDate = start.value ?? new Date(Date.parse(endDate) - DEFAULT_METRICS_DAYS * DAY_MS).toISOString();
        if (Date.parse(startDate) > Date.parse(endDate)) return badRequest('start_date must not be after end_date');

        let broadcastId = broadcastRaw || undefined;
        if (issueRaw) {
          const issue = await store.readDoc('newsletters', issueRaw, issueRaw);
          if (!issue || issue.kind !== 'weekly_issue' || issue.status === 'deleted') {
            return json(404, { ok: false, error: 'Issue not found' });
          }
          if (typeof issue.broadcastId !== 'string' || !ID_PATTERN.test(issue.broadcastId)) {
            return json(404, {
              ok: false,
              code: 'NO_BROADCAST',
              error: 'This issue has not been sent to Resend, so it has no metrics yet.',
            });
          }
          broadcastId = issue.broadcastId;
        }

        return await relay(
          route,
          context,
          () =>
            opened.client.getEmailMetrics({
              startDate,
              endDate,
              metrics: METRICS,
              // One row per broadcast when asking about one; a time series otherwise.
              dimensions: broadcastId ? ['broadcast'] : ['period'],
              granularity: granularityRaw || 'daily',
              broadcastId,
            }),
          ({ data }) => ({
            start_date: data?.start_date ?? startDate,
            end_date: data?.end_date ?? endDate,
            granularity: data?.granularity ?? (granularityRaw || 'daily'),
            broadcast_id: broadcastId ?? null,
            totals: projectTotals(data?.totals),
            data: Array.isArray(data?.data) ? data.data.map(projectMetricRow) : [],
          })
        );
      } catch (error) {
        return failed(route, error, context);
      }
    },

    async clickedLinks(request, context) {
      const route = 'mailingListClickedLinks';
      const opened = await open(request, 'editor');
      if (opened.response) return opened.response;
      const broadcastId = readPathId(request, 'broadcastId');
      if (!broadcastId) return badRequest('broadcastId is not a Resend id');
      const pageOptions = readPage(request);
      if (pageOptions.error) return badRequest(pageOptions.error);
      try {
        return await relay(
          route,
          context,
          () => opened.client.listBroadcastClickedLinks(broadcastId, pageOptions.value),
          (result) => {
            const rows = rowsOf(result);
            return {
              links: rows.map(projectClickedLink),
              has_more: Boolean(result.data?.has_more),
              next_after: nextCursor(result, rows),
            };
          }
        );
      } catch (error) {
        return failed(route, error, context);
      }
    },

    async recipients(request, context) {
      const route = 'mailingListRecipients';
      const opened = await open(request, 'editor');
      if (opened.response) return opened.response;
      const broadcastId = readPathId(request, 'broadcastId');
      if (!broadcastId) return badRequest('broadcastId is not a Resend id');
      const type = queryValue(request, 'type');
      if (!type || !RECIPIENT_TYPES.includes(type)) {
        return badRequest(`type must be one of ${RECIPIENT_TYPES.join(', ')}`);
      }
      const pageOptions = readPage(request);
      if (pageOptions.error) return badRequest(pageOptions.error);
      try {
        return await relay(
          route,
          context,
          () => opened.client.listBroadcastRecipients(broadcastId, { type, ...pageOptions.value }),
          (result) => {
            const rows = rowsOf(result);
            return {
              type,
              recipients: rows.map(projectRecipient),
              has_more: Boolean(result.data?.has_more),
              next_after: nextCursor(result, rows),
            };
          }
        );
      } catch (error) {
        return failed(route, error, context);
      }
    },

    /**
     * One page of the Newsletter segment. `search` filters THAT PAGE by a
     * case-insensitive email substring; it does not search the whole list, so
     * `has_more` and `next_after` still describe Resend's paging.
     */
    async audience(request, context) {
      const route = 'mailingListAudience';
      const opened = await open(request, 'editor');
      if (opened.response) return opened.response;
      const pageOptions = readPage(request);
      if (pageOptions.error) return badRequest(pageOptions.error);
      const search = queryValue(request, 'search');
      if (search !== null && search.length > MAX_SEARCH_LENGTH) {
        return badRequest(`search must be at most ${MAX_SEARCH_LENGTH} characters`);
      }
      try {
        const segment = await segmentId(opened.client);
        if (segment.result) return refused(route, segment.result, context);
        if (!segment.id) {
          return json(200, { ok: true, segmentFound: false, contacts: [], has_more: false, next_after: null });
        }
        return await relay(
          route,
          context,
          () => opened.client.listSegmentContacts(segment.id, pageOptions.value),
          (result) => {
            const rows = rowsOf(result);
            const needle = search ? search.trim().toLowerCase() : '';
            const contacts = rows
              .map(projectContact)
              .filter((contact) => !needle || String(contact.email ?? '').toLowerCase().includes(needle));
            return {
              segmentFound: true,
              contacts,
              has_more: Boolean(result.data?.has_more),
              next_after: nextCursor(result, rows),
              searchScope: 'page',
            };
          }
        );
      } catch (error) {
        return failed(route, error, context);
      }
    },

    /**
     * Counts for the whole segment, paging 100 at a time up to
     * SUMMARY_MAX_PAGES; `truncated` says the cap was hit. Cached per process
     * for SUMMARY_CACHE_MS, successes only.
     */
    async audienceSummary(request, context) {
      const route = 'mailingListAudienceSummary';
      const opened = await open(request, 'editor');
      if (opened.response) return opened.response;
      const at = now().getTime();
      if (summaryCache && at - summaryCache.at < SUMMARY_CACHE_MS) {
        return json(200, { ok: true, ...summaryCache.value, cachedAt: new Date(summaryCache.at).toISOString() });
      }
      try {
        const segment = await segmentId(opened.client);
        if (segment.result) return refused(route, segment.result, context);
        let total = 0;
        let unsubscribed = 0;
        let truncated = false;
        if (segment.id) {
          let after;
          for (let pageNumber = 0; ; pageNumber += 1) {
            if (pageNumber === SUMMARY_MAX_PAGES) {
              truncated = true;
              break;
            }
            const listed = await opened.client.listSegmentContacts(segment.id, { limit: SUMMARY_PAGE_SIZE, after });
            if (!listed.ok) return refused(route, listed, context);
            const rows = rowsOf(listed);
            total += rows.length;
            unsubscribed += rows.filter((row) => row?.unsubscribed === true).length;
            const cursor = nextCursor(listed, rows);
            if (!cursor) break;
            after = cursor;
          }
        }
        const value = { total, subscribed: total - unsubscribed, unsubscribed, truncated };
        summaryCache = { at, value };
        return json(200, { ok: true, ...value, cachedAt: new Date(at).toISOString() });
      } catch (error) {
        return failed(route, error, context);
      }
    },

    /** PUBLISHER. Body `{ unsubscribed: boolean }` only. */
    async updateContact(request, context) {
      const route = 'mailingListContactUpdate';
      const opened = await open(request, 'publisher');
      if (opened.response) return opened.response;
      const contactId = String(request.params?.contactId ?? '');
      if (!ID_PATTERN.test(contactId)) return badRequest('The path must carry a Resend contact id');
      const body = await request.json().catch(() => null);
      if (!isPlainObject(body)) return badRequest('Send a JSON body { unsubscribed: true | false }');
      const unknown = Object.keys(body).filter((key) => key !== 'unsubscribed');
      if (unknown.length) return badRequest(`Unknown field(s): ${unknown.join(', ')}`);
      if (typeof body.unsubscribed !== 'boolean') return badRequest('unsubscribed must be true or false');
      try {
        const result = await opened.client.setContactUnsubscribed(contactId, body.unsubscribed);
        if (!result.ok) return refused(route, result, context);
        summaryCache = null;
        context.log?.(`${route} ok ${ref(context)}`);
        return json(200, { ok: true });
      } catch (error) {
        return failed(route, error, context);
      }
    },

    /** PUBLISHER. Removes the contact from Resend altogether, not just the segment. */
    async deleteContact(request, context) {
      const route = 'mailingListContactDelete';
      const opened = await open(request, 'publisher');
      if (opened.response) return opened.response;
      const contactId = String(request.params?.contactId ?? '');
      if (!ID_PATTERN.test(contactId)) return badRequest('The path must carry a Resend contact id');
      try {
        const result = await opened.client.deleteContact(contactId);
        if (!result.ok) return refused(route, result, context);
        summaryCache = null;
        context.log?.(`${route} ok ${ref(context)}`);
        return json(200, { ok: true });
      } catch (error) {
        return failed(route, error, context);
      }
    },

    async listDomains(request, context) {
      const route = 'mailingListDomains';
      const opened = await open(request, 'editor');
      if (opened.response) return opened.response;
      try {
        return await relay(route, context, () => opened.client.listDomains(), (result) => ({
          domains: rowsOf(result).map(projectDomain),
        }));
      } catch (error) {
        return failed(route, error, context);
      }
    },

    async getDomain(request, context) {
      const route = 'mailingListDomain';
      const opened = await open(request, 'editor');
      if (opened.response) return opened.response;
      const domainId = readPathId(request, 'domainId');
      if (!domainId) return badRequest('domainId is not a Resend id');
      try {
        return await relay(route, context, () => opened.client.getDomain(domainId), (result) => ({
          domain: projectDomainDetail(result.data),
        }));
      } catch (error) {
        return failed(route, error, context);
      }
    },

    /** PUBLISHER. Body `{ name, region? }`. */
    async createDomain(request, context) {
      const route = 'mailingListDomainCreate';
      const opened = await open(request, 'publisher');
      if (opened.response) return opened.response;
      const body = await request.json().catch(() => null);
      if (!isPlainObject(body)) return badRequest('Send a JSON body { name }');
      const unknown = Object.keys(body).filter((key) => !['name', 'region'].includes(key));
      if (unknown.length) return badRequest(`Unknown field(s): ${unknown.join(', ')}`);
      const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
      if (!name || name.length > MAX_HOSTNAME_LENGTH || !HOSTNAME_PATTERN.test(name)) {
        return badRequest('name must be a domain name such as news.example.com');
      }
      if (body.region !== undefined && !DOMAIN_REGIONS.includes(body.region)) {
        return badRequest(`region must be one of ${DOMAIN_REGIONS.join(', ')}`);
      }
      try {
        const result = await opened.client.createDomain({ name, region: body.region });
        if (!result.ok) return refused(route, result, context);
        context.log?.(`${route} ok ${ref(context)}`);
        return json(201, { ok: true, domain: projectDomainDetail(result.data) });
      } catch (error) {
        return failed(route, error, context);
      }
    },

    /** PUBLISHER. Asks Resend to check the DNS records again. */
    async verifyDomain(request, context) {
      const route = 'mailingListDomainVerify';
      const opened = await open(request, 'publisher');
      if (opened.response) return opened.response;
      const domainId = readPathId(request, 'domainId');
      if (!domainId) return badRequest('domainId is not a Resend id');
      try {
        const result = await opened.client.verifyDomain(domainId);
        if (!result.ok) return refused(route, result, context);
        context.log?.(`${route} ok ${ref(context)}`);
        return json(200, { ok: true, id: domainId });
      } catch (error) {
        return failed(route, error, context);
      }
    },

    /** PUBLISHER. Body `{ open_tracking?, click_tracking? }`, booleans, at least one. */
    async updateDomain(request, context) {
      const route = 'mailingListDomainUpdate';
      const opened = await open(request, 'publisher');
      if (opened.response) return opened.response;
      const domainId = readPathId(request, 'domainId');
      if (!domainId) return badRequest('domainId is not a Resend id');
      const body = await request.json().catch(() => null);
      if (!isPlainObject(body)) return badRequest('Send a JSON body { open_tracking, click_tracking }');
      const allowed = ['open_tracking', 'click_tracking'];
      const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
      if (unknown.length) return badRequest(`Unknown field(s): ${unknown.join(', ')}`);
      const present = allowed.filter((key) => body[key] !== undefined);
      if (present.length === 0) return badRequest('Send open_tracking, click_tracking or both');
      if (present.some((key) => typeof body[key] !== 'boolean')) {
        return badRequest('open_tracking and click_tracking must be true or false');
      }
      try {
        const result = await opened.client.updateDomainTracking(domainId, {
          openTracking: body.open_tracking,
          clickTracking: body.click_tracking,
        });
        if (!result.ok) return refused(route, result, context);
        context.log?.(`${route} ok ${ref(context)}`);
        return json(200, { ok: true, id: domainId });
      } catch (error) {
        return failed(route, error, context);
      }
    },

    async listLogs(request, context) {
      const route = 'mailingListLogs';
      const opened = await open(request, 'editor');
      if (opened.response) return opened.response;
      const pageOptions = readPage(request);
      if (pageOptions.error) return badRequest(pageOptions.error);
      try {
        return await relay(route, context, () => opened.client.listLogs(pageOptions.value), (result) => {
          const rows = rowsOf(result);
          return { logs: rows.map(projectLog), has_more: Boolean(result.data?.has_more), next_after: nextCursor(result, rows) };
        });
      } catch (error) {
        return failed(route, error, context);
      }
    },

    /** PUBLISHER: request and response bodies, redacted of credentials and addresses. */
    async getLog(request, context) {
      const route = 'mailingListLog';
      const opened = await open(request, 'publisher');
      if (opened.response) return opened.response;
      const logId = readPathId(request, 'logId');
      if (!logId) return badRequest('logId is not a Resend id');
      try {
        return await relay(route, context, () => opened.client.getLog(logId), ({ data }) => ({
          log: {
            ...projectLog(data),
            ...(typeof data?.user_agent === 'string' ? { user_agent: redactText(data.user_agent) } : {}),
            request_body: redactSensitive(data?.request_body ?? null),
            response_body: redactSensitive(data?.response_body ?? null),
          },
        }));
      } catch (error) {
        return failed(route, error, context);
      }
    },

    async listEmails(request, context) {
      const route = 'mailingListEmails';
      const opened = await open(request, 'editor');
      if (opened.response) return opened.response;
      const pageOptions = readPage(request);
      if (pageOptions.error) return badRequest(pageOptions.error);
      try {
        return await relay(route, context, () => opened.client.listEmails(pageOptions.value), (result) => {
          const rows = rowsOf(result);
          return {
            emails: rows.map(projectEmail),
            has_more: Boolean(result.data?.has_more),
            next_after: nextCursor(result, rows),
          };
        });
      } catch (error) {
        return failed(route, error, context);
      }
    },

    async listTemplates(request, context) {
      const route = 'mailingListTemplates';
      const opened = await open(request, 'editor');
      if (opened.response) return opened.response;
      const pageOptions = readPage(request);
      if (pageOptions.error) return badRequest(pageOptions.error);
      try {
        return await relay(route, context, () => opened.client.listTemplates(pageOptions.value), (result) => {
          const rows = rowsOf(result);
          return {
            templates: rows.map(projectTemplate),
            has_more: Boolean(result.data?.has_more),
            next_after: nextCursor(result, rows),
          };
        });
      } catch (error) {
        return failed(route, error, context);
      }
    },

    async getTemplate(request, context) {
      const route = 'mailingListTemplate';
      const opened = await open(request, 'editor');
      if (opened.response) return opened.response;
      const templateId = readPathId(request, 'templateId');
      if (!templateId) return badRequest('templateId is not a Resend id');
      try {
        return await relay(route, context, () => opened.client.getTemplate(templateId), ({ data }) => ({
          template: { ...projectTemplate(data), html: typeof data?.html === 'string' ? data.html : null },
        }));
      } catch (error) {
        return failed(route, error, context);
      }
    },
  };
}
