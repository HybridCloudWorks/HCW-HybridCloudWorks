/**
 * Approving a weekly issue. The property that matters most is that an issue is
 * broadcast at most once, whatever the owner's mouse does.
 */
import { describe, it, expect, vi } from 'vitest';
import { createNewsletterAdminHandlers } from './admin-handlers.js';
import { NEWSLETTER_FROM } from './handlers.js';

const API_KEY = 'not-a-real-resend-key-EXAMPLE-VALUE-FOR-TESTS';
const NOW = new Date('2026-09-14T12:00:00Z'); // Monday 07:00 Central
const ID = 'issue-2026-09-14';

const fail = (code) => Object.assign(new Error(`fake Cosmos ${code}`), { code });

const draftIssue = (over = {}) => ({
  id: ID,
  kind: 'weekly_issue',
  status: 'draft',
  subject: 'Landing zones',
  intro: 'We covered a lot.',
  customNote: '',
  periodStart: '2026-09-07T12:00:00Z',
  periodEnd: NOW.toISOString(),
  sections: [{ id: 'articles', title: 'New', items: [{ title: 'A', url: 'https://hybridcloudworks.com/a' }] }],
  itemCount: 1,
  _etag: 'e1',
  ...over,
});

const completeSettings = {
  id: 'newsletter_settings',
  postalAddress: 'PO Box 1, Austin, TX',
  replyTo: 'owner@example.com',
  sendDay: 'tuesday',
  sendTime: '09:00',
  timeZone: 'America/Chicago',
};

/** Cosmos with real ETag semantics on the newsletters container. */
function makeStore({ issue = draftIssue(), settings = completeSettings } = {}) {
  const docs = new Map();
  if (issue) docs.set(`newsletters/${issue.id}`, issue);
  if (settings) docs.set('admin_config/newsletter_settings', settings);
  let etag = 1;
  return {
    docs,
    readDoc: vi.fn(async (container, id) => {
      const doc = docs.get(`${container}/${id}`);
      return doc ? { ...doc } : null;
    }),
    queryDocs: vi.fn(async () => [...docs.values()].filter((d) => d.kind === 'weekly_issue')),
    upsertDoc: vi.fn(async (container, doc) => {
      etag += 1;
      docs.set(`${container}/${doc.id}`, { ...doc, _etag: `e${etag}` });
      return doc;
    }),
    replaceDocIfMatch: vi.fn(async (container, doc) => {
      const current = docs.get(`${container}/${doc.id}`);
      if (!current || current._etag !== doc._etag) throw fail(412);
      etag += 1;
      docs.set(`${container}/${doc.id}`, { ...doc, _etag: `e${etag}` });
      return doc;
    }),
  };
}

function makeResend({ failBroadcast = false } = {}) {
  const broadcasts = [];
  const reply = (status, data) => ({ ok: status < 300, status, text: async () => JSON.stringify(data) });
  const fetch = vi.fn(async (url, init = {}) => {
    const { pathname } = new URL(url);
    if (pathname === '/segments') return reply(200, { object: 'list', has_more: false, data: [{ id: 'seg-news', name: 'Newsletter' }] });
    if (pathname === '/broadcasts') {
      if (failBroadcast) return reply(422, { name: 'validation_error', message: 'from domain not verified' });
      broadcasts.push(JSON.parse(init.body));
      return reply(200, { id: `bc-${broadcasts.length}` });
    }
    return reply(404, { name: 'unexpected' });
  });
  return { fetch, broadcasts };
}

const allow = (role = 'publisher') => ({
  requireRole: vi.fn(async (_req, required) => {
    const rank = { editor: 1, publisher: 2 };
    return rank[role] >= rank[required]
      ? { user: { oid: 'owner-oid' }, error: null }
      : { error: { status: 403, body: '{"error":"Forbidden"}' } };
  }),
});

const request = ({ id = ID, body } = {}) => ({ params: { id }, json: async () => body });
const context = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
const bodyOf = (res) => JSON.parse(res.body);

function build({ store = makeStore(), resend = makeResend(), role = 'publisher', env = { RESEND_API_KEY: API_KEY }, now = NOW } = {}) {
  return {
    handlers: createNewsletterAdminHandlers({ guard: allow(role), store, env, fetch: resend.fetch, now: () => now }),
    store,
    resend,
  };
}

describe('get', () => {
  it('renders the email as it would send, and says what is missing before it can', async () => {
    const { handlers } = build({ store: makeStore({ settings: null }) });
    const res = await handlers.get(request(), context());
    const body = bodyOf(res);
    expect(res.status).toBe(200);
    expect(body.preview.html).toContain('Postal address not set');
    expect(body.readyToSend).toBe(false);
    expect(body.missingSettings).toEqual(['postal address', 'reply-to address']);
    expect(body.sendPlan).toEqual({ sendNow: false, scheduledAt: '2026-09-15T14:00:00.000Z' });
  });

  it('refuses an id that is not an issue id before reading Cosmos', async () => {
    const { handlers, store } = build();
    const res = await handlers.get(request({ id: '../admin_config/x' }), context());
    expect(res.status).toBe(404);
    expect(store.readDoc).not.toHaveBeenCalledWith('newsletters', '../admin_config/x', expect.anything());
  });
});

describe('update', () => {
  it('saves the note on a draft', async () => {
    const { handlers, store } = build();
    const res = await handlers.update(request({ body: { customNote: '  Hello readers  ' } }), context());
    expect(res.status).toBe(200);
    expect(store.docs.get(`newsletters/${ID}`).customNote).toBe('Hello readers');
  });

  it('refuses unknown fields and edits to anything but a draft', async () => {
    const { handlers } = build();
    expect((await handlers.update(request({ body: { status: 'sent' } }), context())).status).toBe(400);
    const scheduled = build({ store: makeStore({ issue: draftIssue({ status: 'scheduled' }) }) });
    expect((await scheduled.handlers.update(request({ body: { customNote: 'x' } }), context())).status).toBe(409);
  });
});

describe('approve', () => {
  it('schedules one broadcast to the Newsletter segment at the configured slot', async () => {
    const { handlers, store, resend } = build();
    const res = await handlers.approve(request(), context());

    expect(res.status).toBe(200);
    expect(resend.broadcasts).toHaveLength(1);
    expect(resend.broadcasts[0]).toMatchObject({
      segment_id: 'seg-news',
      from: NEWSLETTER_FROM,
      reply_to: 'owner@example.com',
      subject: 'Landing zones',
      send: true,
      scheduled_at: '2026-09-15T14:00:00.000Z',
    });
    expect(resend.broadcasts[0].html).toContain('{{{RESEND_UNSUBSCRIBE_URL}}}');
    expect(resend.broadcasts[0].html).toContain('PO Box 1, Austin, TX');
    expect(store.docs.get(`newsletters/${ID}`)).toMatchObject({
      status: 'scheduled',
      broadcastId: 'bc-1',
      scheduledAt: '2026-09-15T14:00:00.000Z',
      approvedBy: 'owner-oid',
    });
  });

  it('sends now, without scheduled_at, when the slot is most of a week away', async () => {
    const { handlers, store, resend } = build({ now: new Date('2026-09-16T15:00:00Z') });
    await handlers.approve(request(), context());
    expect(resend.broadcasts[0]).not.toHaveProperty('scheduled_at');
    expect(store.docs.get(`newsletters/${ID}`)).toMatchObject({ status: 'sent', sentAt: '2026-09-16T15:00:00.000Z' });
  });

  it('broadcasts ONCE when approved twice at the same moment', async () => {
    const { handlers, resend } = build();
    const [a, b] = await Promise.all([handlers.approve(request(), context()), handlers.approve(request(), context())]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(resend.broadcasts).toHaveLength(1);
  });

  it('refuses to send without the postal address and reply-to, and changes nothing', async () => {
    const { handlers, store, resend } = build({ store: makeStore({ settings: { ...completeSettings, postalAddress: '' } }) });
    const res = await handlers.approve(request(), context());
    expect(res.status).toBe(409);
    expect(bodyOf(res)).toMatchObject({ code: 'SETTINGS_INCOMPLETE', missingSettings: ['postal address'] });
    expect(resend.fetch).not.toHaveBeenCalled();
    expect(store.docs.get(`newsletters/${ID}`).status).toBe('draft');
  });

  it('returns the issue to draft with Resend’s reason when the broadcast is refused', async () => {
    const { handlers, store } = build({ resend: makeResend({ failBroadcast: true }) });
    const res = await handlers.approve(request(), context());
    expect(res.status).toBe(502);
    expect(bodyOf(res).error).toContain('from domain not verified');
    expect(store.docs.get(`newsletters/${ID}`)).toMatchObject({ status: 'draft', lastError: expect.stringContaining('validation_error') });
  });

  it('is a publisher decision, not an editor one', async () => {
    const { handlers, resend } = build({ role: 'editor' });
    const res = await handlers.approve(request(), context());
    expect(res.status).toBe(403);
    expect(resend.fetch).not.toHaveBeenCalled();
  });

  it('refuses an issue that is not a draft, including one stuck mid-send', async () => {
    for (const status of ['sending', 'scheduled', 'sent', 'rejected']) {
      const { handlers, resend } = build({ store: makeStore({ issue: draftIssue({ status }) }) });
      expect((await handlers.approve(request(), context())).status, status).toBe(409);
      expect(resend.fetch, status).not.toHaveBeenCalled();
    }
  });

  it('says it is not configured without the Resend key', async () => {
    const { handlers } = build({ env: {} });
    expect((await handlers.approve(request(), context())).status).toBe(503);
  });
});

describe('reject', () => {
  it('sets aside a draft, or clears an issue stuck in sending', async () => {
    for (const status of ['draft', 'sending']) {
      const { handlers, store } = build({ role: 'editor', store: makeStore({ issue: draftIssue({ status }) }) });
      expect((await handlers.reject(request(), context())).status, status).toBe(200);
      expect(store.docs.get(`newsletters/${ID}`).status).toBe('rejected');
    }
  });

  it('will not reject an issue that already went out', async () => {
    const { handlers } = build({ store: makeStore({ issue: draftIssue({ status: 'sent' }) }) });
    expect((await handlers.reject(request(), context())).status).toBe(409);
  });
});

describe('list', () => {
  it('returns summaries, not whole issues', async () => {
    const { handlers } = build();
    const body = bodyOf(await handlers.list(request(), context()));
    expect(body.issues).toEqual([
      expect.objectContaining({ id: ID, status: 'draft', subject: 'Landing zones', itemCount: 1 }),
    ]);
    expect(body.issues[0]).not.toHaveProperty('sections');
  });
});
