/**
 * Reviewing weekly issues: reading one as it would send, editing a draft, and
 * setting one aside. Nothing in this module sends.
 */
import { describe, it, expect, vi } from 'vitest';
import { createNewsletterAdminHandlers } from './admin-handlers.js';

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
    queryDocs: vi.fn(async (_container, sql) => {
      // The list must project, not read whole issues.
      expect(sql).not.toMatch(/SELECT TOP \d+ \* /);
      return [...docs.values()].filter((d) => d.kind === 'weekly_issue');
    }),
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

function build({ store = makeStore(), role = 'editor', now = NOW } = {}) {
  return {
    handlers: createNewsletterAdminHandlers({ guard: allow(role), store, now: () => now }),
    store,
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

describe('reject', () => {
  it('sets aside a draft, or clears an issue stuck in sending', async () => {
    for (const status of ['draft', 'sending']) {
      const { handlers, store } = build({ store: makeStore({ issue: draftIssue({ status }) }) });
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
