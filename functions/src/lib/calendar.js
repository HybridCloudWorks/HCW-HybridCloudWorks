/**
 * calendar.js — the Amplify → Calendar aggregate read (ADR 0033 §4).
 *
 *   GET /api/cms/calendar?from=ISO&to=ISO   editor
 *
 * One read unions everything in ContentForge that has a date: content
 * schedules and publishes, newsletter sends, social posts, speaking events and
 * their CFP deadlines, certification expirations and renewals, Ambassador
 * deadlines and Listen & Learn releases. Each source is ONE collector — a
 * small function over the store that answers calendar items — so adding a
 * source is adding a collector to COLLECTORS and nothing else.
 *
 * A collector that throws costs its own items, never the whole read: the
 * answer carries `warnings[]` naming the source that failed, and the page
 * shows that beside the items it did get. The `ambassador` container may not
 * be provisioned yet (ADR 0033 §6 item 4); its collector treats "container
 * not found" as "nothing there" and adds no warning.
 *
 * An item is `{ id, kind, title, start, end?, allDay, status, href, sourceId,
 * sourceCollection, meta }`. `start` and `end` are ISO instants; a calendar
 * date (a `YYYY-MM-DD` with no time) is `allDay: true` with `start` at UTC
 * midnight of that day, which the page shows on that day in every time zone.
 */

export const CALENDAR_KINDS = Object.freeze([
  'content',
  'newsletter',
  'social',
  'speaking',
  'certification',
  'ambassador',
  'audio',
]);

/** The longest window one read may ask for: a quarter, with room for the grid's padding. */
export const MAX_WINDOW_DAYS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const PER_SOURCE_LIMIT = 500;

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** `YYYY-MM-DD` of an ISO instant, in UTC. */
const dayOf = (iso) => String(iso).slice(0, 10);
const isCalendarDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * A stored date — an ISO string, a calendar date, a number, or a legacy
 * Timestamp-shaped object — as `{ iso, allDay }`, or null when unreadable.
 */
export function toInstant(value) {
  if (value === null || value === undefined || value === '') return null;
  if (isCalendarDate(value)) return { iso: `${value}T00:00:00.000Z`, allDay: true };
  let date;
  if (typeof value === 'object' && typeof value.toDate === 'function') date = value.toDate();
  else if (typeof value === 'object' && Number.isFinite(value.seconds)) {
    date = new Date(value.seconds * 1000);
  } else date = new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return { iso: date.toISOString(), allDay: false };
}

/** True when `instant` falls inside [from, to). */
const inWindow = (instant, from, to) => {
  const t = Date.parse(instant.iso);
  return t >= from.getTime() && t < to.getTime();
};

/**
 * Cosmos string bounds for a field that may hold either `YYYY-MM-DD` or an
 * ISO instant: a day-granular lower bound and an exclusive upper bound of the
 * day after `to`. Both spellings sort correctly against a bare day, so one
 * query serves both; the collector then filters precisely with `inWindow`.
 */
export function dayBounds(from, to) {
  return {
    fromDay: dayOf(from.toISOString()),
    toDay: dayOf(new Date(to.getTime() + DAY_MS).toISOString()),
  };
}

const text = (value, max = 200) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** The parameter list every windowed query shares. */
const windowParams = (from, to) => [
  { name: '@from', value: from.toISOString() },
  { name: '@to', value: to.toISOString() },
];

function item({
  id,
  kind,
  title,
  start,
  end = null,
  allDay = false,
  status,
  href,
  sourceId,
  sourceCollection,
  meta = {},
}) {
  return {
    id,
    kind,
    title: text(title) || 'Untitled',
    start,
    end,
    allDay,
    status: String(status || 'scheduled'),
    href,
    sourceId,
    sourceCollection,
    meta,
  };
}

// ── collectors ───────────────────────────────────────────────────────────────

/** Content due to publish in the window, plus what went live in it. */
export async function collectContentSchedules({ store, from, to }) {
  const params = windowParams(from, to);
  const fields =
    'c.id, c.Title, c.title, c.contentStatus, c.Live, c.scheduledPublishDate, c.publishedAt, c.type, c.publishTarget, c["Cloud Provider"], c.cloudProvider, c.publishError, c.scheduledPublishError';
  const [scheduled, published] = await Promise.all([
    store.queryDocs(
      'content',
      `SELECT TOP ${PER_SOURCE_LIMIT} ${fields} FROM c WHERE IS_STRING(c.scheduledPublishDate) AND c.scheduledPublishDate >= @from AND c.scheduledPublishDate < @to AND (NOT IS_DEFINED(c.Live) OR c.Live != true)`,
      params
    ),
    store.queryDocs(
      'content',
      `SELECT TOP ${PER_SOURCE_LIMIT} ${fields} FROM c WHERE c.Live = true AND IS_STRING(c.publishedAt) AND c.publishedAt >= @from AND c.publishedAt < @to`,
      params
    ),
  ]);
  const out = [];
  for (const row of scheduled || []) {
    const status = String(row.contentStatus || '');
    if (status === 'rejected' || status === 'archived') continue;
    const when = toInstant(row.scheduledPublishDate);
    if (!when || !inWindow(when, from, to)) continue;
    const error = row.publishError || row.scheduledPublishError || null;
    // A schedule still in the past with the content not live: the publisher
    // ran (or should have) and the item did not go out.
    const overdue = Date.parse(when.iso) < Date.now() - 20 * 60 * 1000;
    out.push(
      item({
        id: `content:${row.id}`,
        kind: 'content',
        title: row.Title || row.title,
        start: when.iso,
        allDay: when.allDay,
        status: error || overdue ? 'failed' : 'scheduled',
        href: `/admin/queue/${encodeURIComponent(row.id)}?source=content`,
        sourceId: row.id,
        sourceCollection: 'content',
        meta: {
          contentStatus: status,
          provider: row['Cloud Provider'] || row.cloudProvider || null,
          publishTarget: row.publishTarget || row.type || null,
          error: error
            ? text(error, 300)
            : overdue
              ? 'The scheduled time passed and the content is not live.'
              : null,
        },
      })
    );
  }
  for (const row of published || []) {
    const when = toInstant(row.publishedAt);
    if (!when || !inWindow(when, from, to)) continue;
    out.push(
      item({
        id: `content:${row.id}:published`,
        kind: 'content',
        title: row.Title || row.title,
        start: when.iso,
        allDay: when.allDay,
        status: 'published',
        href: `/admin/queue/${encodeURIComponent(row.id)}?source=content`,
        sourceId: row.id,
        sourceCollection: 'content',
        meta: {
          contentStatus: String(row.contentStatus || 'published'),
          provider: row['Cloud Provider'] || row.cloudProvider || null,
          publishTarget: row.publishTarget || row.type || null,
        },
      })
    );
  }
  return out;
}

/** Newsletter issues by when they send (scheduled) or sent. */
export async function collectNewsletterIssues({ store, from, to }) {
  const rows = await store.queryDocs(
    'newsletters',
    `SELECT TOP ${PER_SOURCE_LIMIT} c.id, c.status, c.subject, c.scheduledAt, c.sentAt, c.lastError, c.broadcastId FROM c WHERE c.kind = 'weekly_issue' AND c.status != 'deleted' AND ((IS_STRING(c.sentAt) AND c.sentAt >= @from AND c.sentAt < @to) OR (IS_STRING(c.scheduledAt) AND c.scheduledAt >= @from AND c.scheduledAt < @to))`,
    windowParams(from, to)
  );
  const out = [];
  for (const row of rows || []) {
    if (['draft', 'rejected'].includes(row.status)) continue;
    const when = toInstant(row.status === 'sent' ? row.sentAt : row.scheduledAt || row.sentAt);
    if (!when || !inWindow(when, from, to)) continue;
    out.push(
      item({
        id: `newsletter:${row.id}`,
        kind: 'newsletter',
        title: row.subject || row.id,
        start: when.iso,
        status: row.status,
        href: `/admin/mailing-list?tab=published&issue=${encodeURIComponent(row.id)}`,
        sourceId: row.id,
        sourceCollection: 'newsletters',
        meta: {
          error: row.lastError ? text(row.lastError, 300) : null,
          broadcastId: row.broadcastId || null,
        },
      })
    );
  }
  return out;
}

/** Social posts by scheduled time, every status, the status carried. */
export async function collectSocialPosts({ store, from, to }) {
  const rows = await store.queryDocs(
    'social_posts',
    `SELECT TOP ${PER_SOURCE_LIMIT} c.id, c.caption, c.status, c.scheduledAt, c.platforms, c.accountIds, c.contentId, c.url, c.syncStatus, c.syncError, c.publerPostIds FROM c WHERE IS_STRING(c.scheduledAt) AND c.scheduledAt >= @from AND c.scheduledAt < @to`,
    windowParams(from, to)
  );
  const out = [];
  for (const row of rows || []) {
    const when = toInstant(row.scheduledAt);
    if (!when || !inWindow(when, from, to)) continue;
    const failed = row.status === 'failed' || row.syncStatus === 'failed';
    out.push(
      item({
        id: `social:${row.id}`,
        kind: 'social',
        title: row.caption || 'Social post',
        start: when.iso,
        status: failed ? 'failed' : row.status || 'scheduled',
        href: '/admin/social?tab=queue',
        sourceId: row.id,
        sourceCollection: 'social_posts',
        meta: {
          platforms: Array.isArray(row.platforms) ? row.platforms : [],
          accountIds: Array.isArray(row.accountIds) ? row.accountIds : [],
          contentId: row.contentId || null,
          url: row.url || null,
          caption: text(row.caption, 2000),
          error: row.syncError ? text(row.syncError, 300) : null,
          publerPostIds: Array.isArray(row.publerPostIds) ? row.publerPostIds : [],
        },
      })
    );
  }
  return out;
}

/** Speaking events by date, and their CFP deadlines when recorded. */
export async function collectSpeakingEvents({ store, from, to }) {
  const { fromDay, toDay } = dayBounds(from, to);
  const rows = await store.queryDocs(
    'speakerevents',
    `SELECT TOP ${PER_SOURCE_LIMIT} c.id, c.eventName, c.name, c.date, c.cfpDeadline, c.status, c.location, c.display FROM c WHERE (IS_STRING(c.date) AND c.date >= @fromDay AND c.date < @toDay) OR (IS_STRING(c.cfpDeadline) AND c.cfpDeadline >= @fromDay AND c.cfpDeadline < @toDay)`,
    [
      { name: '@fromDay', value: fromDay },
      { name: '@toDay', value: toDay },
    ]
  );
  const out = [];
  for (const row of rows || []) {
    const title = row.eventName || row.name || 'Speaking event';
    const when = toInstant(row.date);
    if (when && inWindow(when, from, to)) {
      out.push(
        item({
          id: `speaking:${row.id}`,
          kind: 'speaking',
          title,
          start: when.iso,
          allDay: when.allDay,
          status: row.status || (row.display === false ? 'hidden' : 'scheduled'),
          href: '/admin/speaking-events',
          sourceId: row.id,
          sourceCollection: 'speakerevents',
          meta: { location: row.location || null },
        })
      );
    }
    const cfp = toInstant(row.cfpDeadline);
    if (cfp && inWindow(cfp, from, to)) {
      out.push(
        item({
          id: `speaking:${row.id}:cfp`,
          kind: 'speaking',
          title: `CFP deadline: ${title}`,
          start: cfp.iso,
          allDay: cfp.allDay,
          status: 'deadline',
          href: '/admin/speaking-events',
          sourceId: row.id,
          sourceCollection: 'speakerevents',
          meta: { deadline: 'cfp' },
        })
      );
    }
  }
  return out;
}

/** Certification expirations and renewal dates. */
export async function collectCertifications({ store, from, to }) {
  const { fromDay, toDay } = dayBounds(from, to);
  const rows = await store.queryDocs(
    'certifications',
    `SELECT TOP ${PER_SOURCE_LIMIT} c.id, c.name, c.issuer, c.expDate, c.renewalDate FROM c WHERE (IS_STRING(c.expDate) AND c.expDate >= @fromDay AND c.expDate < @toDay) OR (IS_STRING(c.renewalDate) AND c.renewalDate >= @fromDay AND c.renewalDate < @toDay)`,
    [
      { name: '@fromDay', value: fromDay },
      { name: '@toDay', value: toDay },
    ]
  );
  const out = [];
  for (const row of rows || []) {
    const name = row.name || 'Certification';
    const exp = toInstant(row.expDate);
    if (exp && inWindow(exp, from, to)) {
      out.push(
        item({
          id: `certification:${row.id}:expires`,
          kind: 'certification',
          title: `Expires: ${name}`,
          start: exp.iso,
          allDay: exp.allDay,
          status: 'deadline',
          href: '/admin/certifications?tab=renewals',
          sourceId: row.id,
          sourceCollection: 'certifications',
          meta: { issuer: row.issuer || null, deadline: 'expiration' },
        })
      );
    }
    const renewal = toInstant(row.renewalDate);
    if (renewal && inWindow(renewal, from, to)) {
      out.push(
        item({
          id: `certification:${row.id}:renewal`,
          kind: 'certification',
          title: `Renew: ${name}`,
          start: renewal.iso,
          allDay: renewal.allDay,
          status: 'deadline',
          href: '/admin/certifications?tab=renewals',
          sourceId: row.id,
          sourceCollection: 'certifications',
          meta: { issuer: row.issuer || null, deadline: 'renewal' },
        })
      );
    }
  }
  return out;
}

/** A thrown Cosmos error that means the container is not there. */
export const isContainerMissing = (error) =>
  error?.code === 404 ||
  error?.statusCode === 404 ||
  /NotFound|Resource Not Found|does not exist/i.test(String(error?.message ?? ''));

/** Ambassador application deadlines; nothing until the container is provisioned. */
export async function collectAmbassadorDeadlines({ store, from, to }) {
  const { fromDay, toDay } = dayBounds(from, to);
  let rows;
  try {
    rows = await store.queryDocs(
      'ambassador',
      `SELECT TOP ${PER_SOURCE_LIMIT} c.id, c.programName, c.programId, c.title, c.status, c.submissionDeadline, c.renewalDate, c.expirationDate FROM c WHERE c.docType = 'application' AND ((IS_STRING(c.submissionDeadline) AND c.submissionDeadline >= @fromDay AND c.submissionDeadline < @toDay) OR (IS_STRING(c.renewalDate) AND c.renewalDate >= @fromDay AND c.renewalDate < @toDay) OR (IS_STRING(c.expirationDate) AND c.expirationDate >= @fromDay AND c.expirationDate < @toDay))`,
      [
        { name: '@fromDay', value: fromDay },
        { name: '@toDay', value: toDay },
      ]
    );
  } catch (error) {
    if (isContainerMissing(error)) return [];
    throw error;
  }
  const out = [];
  const deadlines = [
    ['submissionDeadline', 'Submit'],
    ['renewalDate', 'Renew'],
    ['expirationDate', 'Expires'],
  ];
  for (const row of rows || []) {
    const name = row.programName || row.title || row.programId || 'Ambassador application';
    for (const [field, verb] of deadlines) {
      const when = toInstant(row[field]);
      if (!when || !inWindow(when, from, to)) continue;
      out.push(
        item({
          id: `ambassador:${row.id}:${field}`,
          kind: 'ambassador',
          title: `${verb}: ${name}`,
          start: when.iso,
          allDay: when.allDay,
          status: 'deadline',
          href: '/admin/ambassador',
          sourceId: row.id,
          sourceCollection: 'ambassador',
          meta: { deadline: field, applicationStatus: row.status || null },
        })
      );
    }
  }
  return out;
}

/** Listen & Learn episodes by the day they were approved for the site. */
export async function collectListenAndLearnReleases({ store, from, to }) {
  const rows = await store.queryDocs(
    'listen_and_learn_episodes',
    `SELECT TOP ${PER_SOURCE_LIMIT} c.id, c.title, c.provider, c.setId, c.status, c.approvedAt FROM c WHERE IS_STRING(c.approvedAt) AND c.approvedAt >= @from AND c.approvedAt < @to`,
    windowParams(from, to)
  );
  const out = [];
  for (const row of rows || []) {
    const when = toInstant(row.approvedAt);
    if (!when || !inWindow(when, from, to)) continue;
    out.push(
      item({
        id: `audio:${row.id}`,
        kind: 'audio',
        title: row.title || 'Listen & Learn episode',
        start: when.iso,
        status: row.status === 'published' ? 'published' : row.status || 'draft',
        href: '/admin/listen-and-learn',
        sourceId: row.id,
        sourceCollection: 'listen_and_learn_episodes',
        meta: { provider: row.provider || null, setId: row.setId || null },
      })
    );
  }
  return out;
}

/** Every source, by name. The read runs all of them; a failure names its key. */
export const COLLECTORS = Object.freeze({
  content: collectContentSchedules,
  newsletter: collectNewsletterIssues,
  social: collectSocialPosts,
  speaking: collectSpeakingEvents,
  certification: collectCertifications,
  ambassador: collectAmbassadorDeadlines,
  audio: collectListenAndLearnReleases,
});

/**
 * Run every collector for the window. Never throws: a failing source becomes
 * a warning and its items are left out.
 *
 * @returns {Promise<{ items: object[], warnings: string[] }>}
 */
export async function collectCalendar({
  store,
  from,
  to,
  collectors = COLLECTORS,
  kinds = null,
  log,
}) {
  const wanted = Object.entries(collectors).filter(([kind]) => !kinds || kinds.includes(kind));
  const settled = await Promise.allSettled(
    wanted.map(([, collect]) => collect({ store, from, to }))
  );
  const items = [];
  const warnings = [];
  settled.forEach((result, index) => {
    const [kind] = wanted[index];
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      warnings.push(
        `${kind}: ${text(result.reason?.message ?? result.reason, 200) || 'could not be read'}`
      );
      log?.warn?.(`[calendar] ${kind} collector failed: ${result.reason?.name ?? 'Error'}`);
    }
  });
  items.sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.id.localeCompare(b.id));
  return { items, warnings };
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function }} deps.store
 * @param {object} [deps.collectors]
 */
export function createCalendarHandlers({ guard, store, collectors = COLLECTORS }) {
  return {
    /** GET /api/cms/calendar?from&to[&kinds=a,b] — editor. */
    async read(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const from = new Date(String(request.query?.get?.('from') ?? ''));
      const to = new Date(String(request.query?.get?.('to') ?? ''));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return json(400, {
          ok: false,
          error: 'from and to must be ISO instants',
        });
      }
      if (to.getTime() <= from.getTime())
        return json(400, { ok: false, error: 'to must be after from' });
      if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
        return json(400, {
          ok: false,
          error: `The window may be at most ${MAX_WINDOW_DAYS} days`,
        });
      }
      const kindsParam = String(request.query?.get?.('kinds') ?? '').trim();
      const kinds = kindsParam
        ? kindsParam
            .split(',')
            .map((kind) => kind.trim())
            .filter((kind) => CALENDAR_KINDS.includes(kind))
        : null;
      try {
        const { items, warnings } = await collectCalendar({
          store,
          from,
          to,
          collectors,
          kinds,
          log: context,
        });
        return json(200, {
          ok: true,
          from: from.toISOString(),
          to: to.toISOString(),
          items,
          warnings,
          total: items.length,
        });
      } catch (error) {
        context.error?.(`calendar read failed: ${error?.name ?? 'Error'}`);
        return json(500, { ok: false, error: 'Failed to read the calendar' });
      }
    },
  };
}
