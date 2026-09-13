/**
 * Reviewing and approving weekly issues. The properties that matter most: an
 * issue is broadcast at most once, only as the approver saw it, and never over
 * a reject that landed while it was being sent.
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
      const stored = { ...doc, _etag: `e${etag}` };
      docs.set(`${container}/${doc.id}`, stored);
      // What Cosmos returns: the document as written, with its new etag.
      return { ...stored };
    }),
  };
}

function makeResend({ failBroadcast = false, noAnswer = false, onBroadcast } = {}) {
  const broadcasts = [];
  const reply = (status, data) => ({ ok: status < 300, status, text: async () => JSON.stringify(data) });
  const fetch = vi.fn(async (url, init = {}) => {
    const { pathname } = new URL(url);
    if (pathname === '/segments') {
      return reply(200, { object: 'list', has_more: false, data: [{ id: 'seg-news', name: 'Newsletter' }] });
    }
    if (pathname === '/broadcasts') {
      if (noAnswer) throw new Error('The operation was aborted due to timeout');
      if (failBroadcast) {
        // A provider message that echoes the payload, as refusals sometimes do.
        return reply(422, {
          name: 'validation_error',
          message: `from domain not verified for PO Box 1, Austin, TX in ${JSON.parse(init.body).subject}`,
        });
      }
      broadcasts.push(JSON.parse(init.body));
      await onBroadcast?.();
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

function build({
  store = makeStore(),
  resend = makeResend(),
  role = 'editor',
  env = { RESEND_API_KEY: API_KEY, NEWSLETTER_SENDING_ENABLED: 'true' },
  now = NOW,
} = {}) {
  return {
    handlers: createNewsletterAdminHandlers({
      guard: allow(role),
      store,
      env,
      fetch: resend.fetch,
      now: () => now,
    }),
    store,
    resend,
  };
}

const approveBody = { body: { etag: 'e1' } };

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
    const res = await handlers.update(request({ body: { customNote: '  Hello readers  ', etag: 'e1' } }), context());
    expect(res.status).toBe(200);
    expect(store.docs.get(`newsletters/${ID}`).customNote).toBe('Hello readers');
  });

  it('refuses unknown fields and edits to anything but a draft', async () => {
    const { handlers } = build();
    expect((await handlers.update(request({ body: { status: 'sent', etag: 'e1' } }), context())).status).toBe(400);
    const scheduled = build({ store: makeStore({ issue: draftIssue({ status: 'scheduled' }) }) });
    expect((await scheduled.handlers.update(request({ body: { customNote: 'x', etag: 'e1' } }), context())).status).toBe(409);
  });
});

describe('concurrency through the etag', () => {
  it('hands out the stored etag, and returns the new one after an edit', async () => {
    const { handlers } = build();
    const read = bodyOf(await handlers.get(request(), context()));
    expect(read.issue.etag).toBe('e1');
    const saved = bodyOf(
      await handlers.update(request({ body: { customNote: 'Hello', etag: read.issue.etag } }), context())
    );
    expect(saved.issue.etag).toBeTruthy();
    expect(saved.issue.etag).not.toBe('e1');
  });

  it('refuses an edit or a reject that sends no etag or no body, with one error shape, and writes nothing', async () => {
    const { handlers, store } = build();
    for (const res of [
      await handlers.update(request({ body: { customNote: 'No version' } }), context()),
      await handlers.update(request({ body: { customNote: 'Empty', etag: '' } }), context()),
      await handlers.update(request(), context()),
      await handlers.update(request({ body: ['not', 'an', 'object'] }), context()),
      await handlers.reject(request({ body: {} }), context()),
      await handlers.reject(request(), context()),
    ]) {
      expect(res.status).toBe(400);
      expect(bodyOf(res).code).toBe('ETAG_REQUIRED');
    }
    expect(store.docs.get(`newsletters/${ID}`)).toMatchObject({ status: 'draft', customNote: '' });
    expect(store.replaceDocIfMatch).not.toHaveBeenCalled();
  });

  it('refuses an edit made from a stale view, and writes nothing', async () => {
    const { handlers, store } = build();
    const first = bodyOf(await handlers.get(request(), context()));
    await handlers.update(request({ body: { customNote: 'Theirs', etag: first.issue.etag } }), context());
    const res = await handlers.update(
      request({ body: { customNote: 'Mine', etag: first.issue.etag } }),
      context()
    );
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe('ISSUE_CHANGED');
    expect(store.docs.get(`newsletters/${ID}`).customNote).toBe('Theirs');
  });

  it('refuses a reject made from a stale view', async () => {
    const { handlers, store } = build();
    const first = bodyOf(await handlers.get(request(), context()));
    await handlers.update(request({ body: { subject: 'Changed', etag: first.issue.etag } }), context());
    const res = await handlers.reject(request({ body: { etag: first.issue.etag } }), context());
    expect(res.status).toBe(409);
    expect(store.docs.get(`newsletters/${ID}`).status).toBe('draft');
  });
});

describe('approve', () => {
  it('schedules one broadcast to the Newsletter segment at the configured slot', async () => {
    const { handlers, store, resend } = build({ role: 'publisher' });
    const res = await handlers.approve(request(approveBody), context());

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
    expect(bodyOf(res).issue.etag).toBe(store.docs.get(`newsletters/${ID}`)._etag);
  });

  it('sends now, without scheduled_at, when the slot is most of a week away', async () => {
    const { handlers, store, resend } = build({ role: 'publisher', now: new Date('2026-09-16T15:00:00Z') });
    await handlers.approve(request(approveBody), context());
    expect(resend.broadcasts[0]).not.toHaveProperty('scheduled_at');
    expect(store.docs.get(`newsletters/${ID}`)).toMatchObject({ status: 'sent', sentAt: '2026-09-16T15:00:00.000Z' });
  });

  it('broadcasts ONCE when approved twice at the same moment', async () => {
    const { handlers, resend } = build({ role: 'publisher' });
    const [a, b] = await Promise.all([
      handlers.approve(request(approveBody), context()),
      handlers.approve(request(approveBody), context()),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(resend.broadcasts).toHaveLength(1);
  });

  it('will not send an issue edited after the approver opened it', async () => {
    const { handlers, store, resend } = build({ role: 'publisher' });
    await handlers.update(request({ body: { subject: 'Edited by someone else', etag: 'e1' } }), context());
    const res = await handlers.approve(request(approveBody), context());
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe('ISSUE_CHANGED');
    expect(resend.fetch).not.toHaveBeenCalled();
    expect(store.docs.get(`newsletters/${ID}`).status).toBe('draft');
  });

  it('requires the etag, before anything is read or sent', async () => {
    const { handlers, resend } = build({ role: 'publisher' });
    for (const res of [
      await handlers.approve(request(), context()),
      await handlers.approve(request({ body: {} }), context()),
    ]) {
      expect(res.status).toBe(400);
      expect(bodyOf(res).code).toBe('ETAG_REQUIRED');
    }
    expect(resend.fetch).not.toHaveBeenCalled();
  });

  it('does not overwrite a reject that lands while Resend is being asked, and names the broadcast', async () => {
    const store = makeStore();
    const resend = makeResend({
      onBroadcast: async () => {
        // The owner clears the stuck send from another tab mid-request.
        const current = store.docs.get(`newsletters/${ID}`);
        const res = await createNewsletterAdminHandlers({ guard: allow('editor'), store, now: () => NOW }).reject(
          request({ body: { etag: current._etag } }),
          context()
        );
        expect(res.status).toBe(200);
      },
    });
    const { handlers } = build({ role: 'publisher', store, resend });
    const res = await handlers.approve(request(approveBody), context());

    expect(res.status).toBe(409);
    expect(bodyOf(res)).toMatchObject({ code: 'CHANGED_DURING_SEND', broadcastId: 'bc-1' });
    expect(bodyOf(res).error).toContain("cancel it in Resend's Broadcasts page");
    expect(store.docs.get(`newsletters/${ID}`).status).toBe('rejected');
  });

  it('refuses to send without the postal address and reply-to, and changes nothing', async () => {
    const { handlers, store, resend } = build({
      role: 'publisher',
      store: makeStore({ settings: { ...completeSettings, postalAddress: '' } }),
    });
    const res = await handlers.approve(request(approveBody), context());
    expect(res.status).toBe(409);
    expect(bodyOf(res)).toMatchObject({ code: 'SETTINGS_INCOMPLETE', missingSettings: ['postal address'] });
    expect(resend.fetch).not.toHaveBeenCalled();
    expect(store.docs.get(`newsletters/${ID}`).status).toBe('draft');
  });

  it("returns the issue to draft with Resend's reason, and clears the approval, when the broadcast is refused", async () => {
    const { handlers, store } = build({ role: 'publisher', resend: makeResend({ failBroadcast: true }) });
    const ctx = context();
    const res = await handlers.approve(request(approveBody), ctx);
    expect(res.status).toBe(502);
    // The owner gets Resend's sentence; the log gets status and error name only.
    const logged = ctx.error.mock.calls.flat().join('\n');
    expect(logged).toContain('HTTP 422 validation_error');
    expect(logged).not.toContain('PO Box');
    expect(logged).not.toContain('Landing zones');
    expect(bodyOf(res).error).toContain('from domain not verified');
    expect(store.docs.get(`newsletters/${ID}`)).toMatchObject({
      status: 'draft',
      lastError: expect.stringContaining('validation_error'),
      approvedAt: null,
      approvedBy: null,
    });
  });

  it('refuses, without claiming, when the send slot cannot be worked out', async () => {
    // Stored settings are normalised on read, so the reachable failure is the
    // slot calculation itself; an unusable clock makes it throw.
    const { handlers, store, resend } = build({ role: 'publisher', now: new Date(Number.NaN) });
    const res = await handlers.approve(request(approveBody), context());
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe('SETTINGS_INVALID');
    expect(resend.fetch).not.toHaveBeenCalled();
    const stored = store.docs.get(`newsletters/${ID}`);
    expect(stored.status).toBe('draft');
    expect(stored.approvedAt).toBeUndefined();
  });

  it('keeps the issue in sending, not draft, when Resend gives no answer', async () => {
    const { handlers, store, resend } = build({ role: 'publisher', resend: makeResend({ noAnswer: true }) });
    const res = await handlers.approve(request(approveBody), context());
    expect(res.status).toBe(502);
    expect(bodyOf(res).code).toBe('SEND_OUTCOME_UNKNOWN');
    expect(resend.fetch).toHaveBeenCalled();
    // A second approval must not be possible: a broadcast may exist.
    const stored = store.docs.get(`newsletters/${ID}`);
    expect(stored).toMatchObject({ status: 'sending', approvedBy: 'owner-oid' });
    const again = await handlers.approve(request({ body: { etag: stored._etag } }), context());
    expect(again.status).toBe(409);
  });

  it('answers a sent-but-unrecorded broadcast with the usual payload plus a warning', async () => {
    const store = makeStore();
    const replace = store.replaceDocIfMatch;
    let calls = 0;
    // The claim saves; recording the outcome does not.
    store.replaceDocIfMatch = vi.fn(async (...args) => {
      calls += 1;
      if (calls > 1) throw Object.assign(new Error('Service unavailable'), { code: 503 });
      return replace(...args);
    });
    const { handlers, resend } = build({ role: 'publisher', store });
    const res = await handlers.approve(request(approveBody), context());

    expect(res.status).toBe(200);
    expect(resend.broadcasts).toHaveLength(1);
    const body = bodyOf(res);
    expect(body.warning).toContain('Do not approve again');
    expect(body).toMatchObject({ ok: true, issue: { id: ID, status: 'sending' }, sendingEnabled: true });
    expect(body.preview).toBeTruthy();
    expect(body.issue.etag).toBe(store.docs.get(`newsletters/${ID}`)._etag);
  });

  it('logs only the name and code of a store error, never its message', async () => {
    const store = makeStore();
    const cosmosError = Object.assign(new Error(`Entity with the specified id ${ID} does not exist`), { code: 503 });
    store.replaceDocIfMatch = vi.fn(async () => {
      throw cosmosError;
    });
    const { handlers } = build({ role: 'publisher', store });
    const ctx = { ...context(), invocationId: 'inv-9' };
    expect((await handlers.approve(request(approveBody), ctx)).status).toBe(500);
    const logged = ctx.error.mock.calls.flat().join('\n');
    expect(logged).toContain('claim failed [invocation inv-9]: Error code 503');
    expect(logged).not.toContain(ID);
  });

  it('logs the invocation, never the issue or broadcast id', async () => {
    const { handlers } = build({ role: 'publisher' });
    const ctx = { ...context(), invocationId: 'inv-123' };
    expect((await handlers.approve(request(approveBody), ctx)).status).toBe(200);
    const logged = [...ctx.log.mock.calls, ...ctx.error.mock.calls].flat().join('\n');
    expect(logged).toContain('inv-123');
    expect(logged).not.toContain(ID);
    expect(logged).not.toContain('bc-1');
  });

  it('is a publisher decision, not an editor one', async () => {
    const { handlers, resend } = build({ role: 'editor' });
    const res = await handlers.approve(request(approveBody), context());
    expect(res.status).toBe(403);
    expect(resend.fetch).not.toHaveBeenCalled();
  });

  it('refuses an issue that is not a draft, including one stuck mid-send', async () => {
    for (const status of ['sending', 'scheduled', 'sent', 'rejected']) {
      const { handlers, resend } = build({ role: 'publisher', store: makeStore({ issue: draftIssue({ status }) }) });
      expect((await handlers.approve(request(approveBody), context())).status, status).toBe(409);
      expect(resend.fetch, status).not.toHaveBeenCalled();
    }
  });

  it('refuses before reading, claiming or sending while the Terraform switch is off', async () => {
    for (const value of [undefined, 'false', 'TRUE', '1']) {
      const store = makeStore();
      const readDoc = vi.spyOn(store, 'readDoc');
      const { handlers, resend } = build({
        role: 'publisher',
        store,
        env: { RESEND_API_KEY: API_KEY, NEWSLETTER_SENDING_ENABLED: value },
      });
      const res = await handlers.approve(request(approveBody), context());
      expect(res.status, String(value)).toBe(503);
      expect(bodyOf(res).code).toBe('NEWSLETTER_SENDING_DISABLED');
      expect(readDoc).not.toHaveBeenCalled();
      expect(resend.fetch).not.toHaveBeenCalled();
      expect(store.docs.get(`newsletters/${ID}`).status).toBe('draft');
    }
  });

  it('tells the page the Terraform send switch, off unless it is exactly "true"', async () => {
    for (const [value, expected] of [
      ['true', true],
      [undefined, false],
      ['false', false],
      ['TRUE', false],
      ['1', false],
    ]) {
      const { handlers } = build({ env: { RESEND_API_KEY: API_KEY, NEWSLETTER_SENDING_ENABLED: value } });
      expect(bodyOf(await handlers.get(request(), context())).sendingEnabled, String(value)).toBe(expected);
    }
  });

  it('says it is not configured without the Resend key', async () => {
    const { handlers } = build({ role: 'publisher', env: { NEWSLETTER_SENDING_ENABLED: 'true' } });
    expect((await handlers.approve(request(approveBody), context())).status).toBe(503);
  });
});

describe('reject', () => {
  it('sets aside a draft', async () => {
    const { handlers, store } = build();
    expect((await handlers.reject(request({ body: { etag: 'e1' } }), context())).status).toBe(200);
    expect(store.docs.get(`newsletters/${ID}`).status).toBe('rejected');
  });

  it('clears an issue stuck in sending', async () => {
    const { handlers, store } = build({ store: makeStore({ issue: draftIssue({ status: 'sending' }) }) });
    expect((await handlers.reject(request({ body: { etag: 'e1' } }), context())).status).toBe(200);
    expect(store.docs.get(`newsletters/${ID}`).status).toBe('rejected');
  });

  it('will not reject an issue that was scheduled or sent, or reject twice', async () => {
    for (const status of ['scheduled', 'sent', 'rejected']) {
      const { handlers, store } = build({ store: makeStore({ issue: draftIssue({ status }) }) });
      const res = await handlers.reject(request({ body: { etag: 'e1' } }), context());
      expect(res.status, status).toBe(409);
      expect(store.docs.get(`newsletters/${ID}`).status, status).toBe(status);
    }
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
