/**
 * handlers.test.js — newsletter double opt-in against a fake Resend that keeps
 * state, so the read-back is tested against what was actually written rather
 * than against whatever a mock was told to say.
 */
import { describe, it, expect, vi } from 'vitest';
import { createClientIdentity } from '../auth/client-identity.js';
import {
  CONFIRM_PAGE_URL,
  NEWSLETTER_FROM,
  NEWSLETTER_SEGMENT_NAME,
  SUBSCRIBE_PER_ADDRESS_PER_HOUR,
  SUBSCRIBE_PER_CALLER_PER_HOUR,
  createNewsletterHandlers,
  normalizeEmail,
  normalizeSource,
} from './handlers.js';
import { buildConfirmationToken, deriveConfirmationKey } from './confirmation-token.js';

const SECRET = 'cf-secret';
const API_KEY = 'not-a-real-resend-key-EXAMPLE-VALUE-FOR-TESTS';
const NOW = 1_800_000_000_000;
const EMAIL = 'reader+news@example.com';

const fail = (code) => Object.assign(new Error(`fake Cosmos ${code}`), { code });

/** The quota store: per-document, with the 404/409/412 failures the quota relies on. */
function makeStore() {
  const docs = new Map();
  return {
    docs,
    readDoc: async (_c, id) => docs.get(id) ?? null,
    upsertDoc: async (_c, doc) => docs.set(doc.id, doc) && doc,
    createDoc: async (_c, doc) => {
      if (docs.has(doc.id)) throw fail(409);
      docs.set(doc.id, { ...doc, _etag: 'e1' });
      return doc;
    },
    replaceDocIfMatch: async (_c, doc) => {
      docs.set(doc.id, { ...doc, _etag: `${doc._etag}+` });
      return doc;
    },
    incrementIf: async (_c, id, { conditionValues }) => {
      const doc = docs.get(id);
      if (!doc) throw fail(404);
      const { windowFloor, limit } = conditionValues;
      if (!(doc.windowStartMs > windowFloor) || !(doc.count < limit)) throw fail(412);
      docs.set(id, { ...doc, count: doc.count + 1 });
      return doc;
    },
  };
}

/**
 * A stateful Resend. `quirks` reproduces the undocumented behaviours the
 * handler defends against.
 */
function makeResend({
  segments = [{ id: 'seg-news', name: NEWSLETTER_SEGMENT_NAME }],
  quirks = {},
  failSend = false,
} = {}) {
  const state = { segments: [...segments], contacts: new Map(), emails: [], calls: [] };
  const reply = (status, data) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (data === undefined ? '' : JSON.stringify(data)),
  });

  const fetchImpl = vi.fn(async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push(`${method} ${pathname}`);
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (method === 'POST' && pathname === '/emails') {
      if (failSend) return reply(422, { name: 'validation_error', message: `bad ${body.to[0]}` });
      state.emails.push(body);
      return reply(200, { id: `email-${state.emails.length}` });
    }
    if (method === 'GET' && pathname === '/segments') {
      expect(searchParams.get('limit')).toBe('100');
      return reply(200, { object: 'list', has_more: false, data: state.segments });
    }
    if (method === 'POST' && pathname === '/segments') {
      const created = { id: 'seg-created', name: body.name };
      state.segments.push(created);
      return reply(200, { object: 'segment', id: created.id });
    }
    if (method === 'POST' && pathname === '/contacts') {
      if (state.contacts.has(body.email)) {
        return reply(409, { name: 'contact_exists', message: 'exists' });
      }
      state.contacts.set(body.email, {
        email: body.email,
        // resend/resend-node#458's shape, when asked for.
        unsubscribed: quirks.createsUnsubscribed ? true : body.unsubscribed,
        segments: quirks.createIgnoresSegments ? [] : body.segments.map((s) => s.id),
      });
      return reply(200, { object: 'contact', id: 'contact-1' });
    }
    if (parts[0] === 'contacts' && parts.length >= 2) {
      const contact = state.contacts.get(parts[1]);
      if (!contact) return reply(404, { name: 'not_found', message: 'no contact' });
      if (parts.length === 2 && method === 'GET') {
        return reply(200, { object: 'contact', email: contact.email, unsubscribed: contact.unsubscribed });
      }
      if (parts.length === 2 && method === 'PATCH') {
        if (!quirks.patchIgnored) contact.unsubscribed = body.unsubscribed;
        return reply(200, { object: 'contact', id: 'contact-1' });
      }
      if (parts[2] === 'segments' && parts.length === 3 && method === 'GET') {
        const rows = contact.segments.map((id) => state.segments.find((s) => s.id === id) ?? { id });
        return reply(200, { object: 'list', has_more: false, data: rows });
      }
      if (parts[2] === 'segments' && parts.length === 4 && method === 'POST') {
        if (!quirks.addIgnored && !contact.segments.includes(parts[3])) contact.segments.push(parts[3]);
        return reply(200, { id: parts[3] });
      }
    }
    return reply(404, { name: 'unexpected', message: `${method} ${pathname}` });
  });

  return { state, fetch: fetchImpl };
}

const request = ({ body, ip = '203.0.113.7', cfSecret = SECRET } = {}) => ({
  method: 'POST',
  headers: {
    get: (name) =>
      ({ 'x-hcw-origin-secret': cfSecret, 'cf-connecting-ip': ip })[String(name).toLowerCase()] ?? null,
  },
  json: async () => body,
});

const context = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

function build({ resend = makeResend(), env = { RESEND_API_KEY: API_KEY, CLIENT_IP_SALT: 'salt' }, store = makeStore(), now = () => NOW } = {}) {
  const handlers = createNewsletterHandlers({
    identity: createClientIdentity({ originSecret: SECRET, ipSalt: 'salt', allowUnverifiedOrigin: false }),
    store,
    env,
    fetch: resend.fetch,
    now,
  });
  return { ...handlers, resend, store };
}

const bodyOf = (res) => JSON.parse(res.body);
const tokenFrom = (email) => new URL(email.text.match(/https:\/\/\S+/)[0]).hash.slice('#t='.length);
const everyLogLine = (ctx) =>
  [ctx.log, ctx.warn, ctx.error].flatMap((fn) => fn.mock.calls.flat()).join('\n');

describe('normalizeEmail and normalizeSource', () => {
  it('accepts a real address, trimmed, and keeps its case', () => {
    expect(normalizeEmail('  Reader+News@Example.com ')).toBe('Reader+News@Example.com');
  });

  it('refuses what cannot be an address', () => {
    for (const bad of [undefined, '', 'no-at-sign', 'a@b', 'a@@b.com', 'a b@c.com', 'a@b\n.com', 'a@b\u0000.com', `${'x'.repeat(250)}@b.com`]) {
      expect(normalizeEmail(bad), String(bad)).toBeNull();
    }
  });

  it('keeps only sources the site actually has', () => {
    expect(normalizeSource('footer')).toBe('footer');
    expect(normalizeSource('blog-post')).toBe('blog-post');
    expect(normalizeSource('<script>')).toBe('website');
    expect(normalizeSource(undefined)).toBe('website');
  });
});

describe('subscribe', () => {
  it('emails a confirmation link from the newsletter address and writes nothing to the list', async () => {
    const { subscribe, resend } = build();
    const res = await subscribe(request({ body: { email: EMAIL, source: 'footer', website: '' } }), context());

    expect(res.status).toBe(202);
    expect(bodyOf(res)).toEqual({ ok: true });
    expect(resend.state.emails).toHaveLength(1);
    const [sent] = resend.state.emails;
    expect(sent.from).toBe(NEWSLETTER_FROM);
    expect(sent.to).toEqual([EMAIL]);
    expect(sent.html).toContain(`${CONFIRM_PAGE_URL}#t=`);
    // Double opt-in: signing up must not add the contact.
    expect(resend.state.calls.filter((c) => c.includes('/contacts'))).toEqual([]);
    expect(resend.state.contacts.size).toBe(0);
  });

  it('puts the token in the fragment, so the address never reaches a request log', async () => {
    const { subscribe, resend } = build();
    await subscribe(request({ body: { email: EMAIL, source: 'footer' } }), context());
    const link = new URL(resend.state.emails[0].text.match(/https:\/\/\S+/)[0]);
    expect(link.origin + link.pathname).toBe(CONFIRM_PAGE_URL);
    expect(link.search).toBe('');
    expect(link.hash.startsWith('#t=')).toBe(true);
  });

  it('answers a filled honeypot exactly like a signup, and sends nothing', async () => {
    const { subscribe, resend, store } = build();
    const res = await subscribe(request({ body: { email: EMAIL, website: 'http://spam.example' } }), context());
    expect(res.status).toBe(202);
    expect(bodyOf(res)).toEqual({ ok: true });
    expect(resend.fetch).not.toHaveBeenCalled();
    expect(store.docs.size).toBe(0);
  });

  it('refuses an invalid address before spending quota or calling Resend', async () => {
    const { subscribe, resend, store } = build();
    const res = await subscribe(request({ body: { email: 'not an address' } }), context());
    expect(res.status).toBe(400);
    expect(resend.fetch).not.toHaveBeenCalled();
    expect(store.docs.size).toBe(0);
  });

  it('refuses a request that did not come through Cloudflare', async () => {
    const { subscribe, resend } = build();
    const res = await subscribe(request({ body: { email: EMAIL }, cfSecret: 'wrong' }), context());
    expect(res.status).toBe(403);
    expect(resend.fetch).not.toHaveBeenCalled();
  });

  it('says signup is unavailable, not that it worked, when the key is not seeded', async () => {
    const { subscribe } = build({ env: { RESEND_API_KEY: '@Microsoft.KeyVault(SecretUri=x)' } });
    const res = await subscribe(request({ body: { email: EMAIL } }), context());
    expect(res.status).toBe(503);
    expect(bodyOf(res).ok).toBe(false);
  });

  it('limits confirmation emails per ADDRESS, whoever asks — the anti-harassment limit', async () => {
    const { subscribe, resend } = build();
    const statuses = [];
    for (let i = 0; i < SUBSCRIBE_PER_ADDRESS_PER_HOUR + 1; i += 1) {
      const res = await subscribe(request({ body: { email: EMAIL }, ip: `198.51.100.${i + 1}` }), context());
      statuses.push(res.status);
    }
    expect(statuses).toEqual([...Array(SUBSCRIBE_PER_ADDRESS_PER_HOUR).fill(202), 429]);
    expect(resend.state.emails).toHaveLength(SUBSCRIBE_PER_ADDRESS_PER_HOUR);
  });

  it('counts the address case-insensitively, so capitals do not buy more emails', async () => {
    const { subscribe } = build();
    await subscribe(request({ body: { email: EMAIL }, ip: '198.51.100.1' }), context());
    await subscribe(request({ body: { email: EMAIL.toUpperCase() }, ip: '198.51.100.2' }), context());
    const third = await subscribe(request({ body: { email: 'READER+news@example.COM' }, ip: '198.51.100.3' }), context());
    expect(third.status).toBe(429);
  });

  it('limits signups per CALLER across different addresses', async () => {
    const { subscribe } = build();
    const statuses = [];
    for (let i = 0; i < SUBSCRIBE_PER_CALLER_PER_HOUR + 1; i += 1) {
      const res = await subscribe(request({ body: { email: `person${i}@example.com` } }), context());
      statuses.push(res.status);
    }
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, -1).every((s) => s === 202)).toBe(true);
  });

  it('reports a refused send as a failure, and logs no address', async () => {
    const ctx = context();
    const { subscribe } = build({ resend: makeResend({ failSend: true }) });
    const res = await subscribe(request({ body: { email: EMAIL } }), ctx);
    expect(res.status).toBe(502);
    expect(bodyOf(res).ok).toBe(false);
    expect(everyLogLine(ctx)).toContain('validation_error');
    expect(everyLogLine(ctx)).not.toContain('example.com');
  });

  it('never logs the address on success either', async () => {
    const ctx = context();
    const { subscribe } = build();
    await subscribe(request({ body: { email: EMAIL, source: 'blog-post' } }), ctx);
    expect(everyLogLine(ctx)).toContain('source=blog-post');
    expect(everyLogLine(ctx)).not.toContain('example.com');
  });
});

describe('confirm', () => {
  async function signedUp(options) {
    const built = build(options);
    await built.subscribe(request({ body: { email: EMAIL, source: 'footer' } }), context());
    return { ...built, token: tokenFrom(built.resend.state.emails[0]) };
  }

  it('adds the contact to the Newsletter segment, subscribed, and reads it back', async () => {
    const { confirm, resend, token } = await signedUp();
    const res = await confirm(request({ body: { token } }), context());

    expect(res.status).toBe(200);
    expect(bodyOf(res)).toEqual({ ok: true });
    expect(resend.state.contacts.get(EMAIL)).toEqual({ email: EMAIL, unsubscribed: false, segments: ['seg-news'] });
    // Read back, not trusted.
    expect(resend.state.calls).toContain(`GET /contacts/${encodeURIComponent(EMAIL)}`);
  });

  it('sends segments as objects, which is what Resend accepts', async () => {
    const { confirm, resend, token } = await signedUp();
    await confirm(request({ body: { token } }), context());
    const createCall = resend.fetch.mock.calls.find(([url, init]) => url.endsWith('/contacts') && init.method === 'POST');
    expect(JSON.parse(createCall[1].body).segments).toEqual([{ id: 'seg-news' }]);
  });

  it('creates the Newsletter segment when it does not exist yet', async () => {
    const { confirm, resend, token } = await signedUp({ resend: makeResend({ segments: [] }) });
    const res = await confirm(request({ body: { token } }), context());
    expect(res.status).toBe(200);
    expect(resend.state.segments).toEqual([{ id: 'seg-created', name: NEWSLETTER_SEGMENT_NAME }]);
    expect(resend.state.contacts.get(EMAIL).segments).toEqual(['seg-created']);
  });

  it('resubscribes an address that had unsubscribed, because confirming is that consent', async () => {
    const resend = makeResend();
    resend.state.contacts.set(EMAIL, { email: EMAIL, unsubscribed: true, segments: [] });
    const { confirm, token } = await signedUp({ resend });
    const res = await confirm(request({ body: { token } }), context());
    expect(res.status).toBe(200);
    expect(resend.state.contacts.get(EMAIL)).toEqual({ email: EMAIL, unsubscribed: false, segments: ['seg-news'] });
  });

  it('adds to the segment when create silently ignored it', async () => {
    const resend = makeResend({ quirks: { createIgnoresSegments: true } });
    const { confirm, token } = await signedUp({ resend });
    const res = await confirm(request({ body: { token } }), context());
    expect(res.status).toBe(200);
    expect(resend.state.contacts.get(EMAIL).segments).toEqual(['seg-news']);
  });

  it('repairs a contact that comes back unsubscribed (resend/resend-node#458)', async () => {
    const resend = makeResend({ quirks: { createsUnsubscribed: true } });
    const { confirm, token } = await signedUp({ resend });
    const res = await confirm(request({ body: { token } }), context());
    expect(res.status).toBe(200);
    expect(resend.state.contacts.get(EMAIL).unsubscribed).toBe(false);
  });

  it('refuses to say yes when the contact still reads back unsubscribed', async () => {
    // The silent loss ADR 0030 exists to prevent: told "you are in", then
    // skipped by every broadcast.
    const resend = makeResend({ quirks: { createsUnsubscribed: true, patchIgnored: true } });
    const ctx = context();
    const { confirm, token } = await signedUp({ resend });
    const res = await confirm(request({ body: { token } }), ctx);
    expect(res.status).toBe(502);
    expect(bodyOf(res).ok).toBe(false);
    expect(everyLogLine(ctx)).toContain('reads back as unsubscribed');
    expect(everyLogLine(ctx)).not.toContain('example.com');
  });

  it('refuses to say yes when the contact never lands in the segment', async () => {
    const resend = makeResend({ quirks: { createIgnoresSegments: true, addIgnored: true } });
    const { confirm, token } = await signedUp({ resend });
    const res = await confirm(request({ body: { token } }), context());
    expect(res.status).toBe(502);
  });

  it('refuses a token it did not sign, touching nothing at Resend', async () => {
    const { confirm, resend } = build();
    const forged = buildConfirmationToken(deriveConfirmationKey('some-other-key-entirely-EXAMPLE'), { email: EMAIL, source: 'footer' }, { now: () => NOW });
    const res = await confirm(request({ body: { token: forged } }), context());
    expect(res.status).toBe(400);
    expect(bodyOf(res).code).toBe('INVALID_OR_EXPIRED');
    expect(resend.fetch).not.toHaveBeenCalled();
  });

  it('refuses an expired link', async () => {
    const built = build();
    await built.subscribe(request({ body: { email: EMAIL } }), context());
    const token = tokenFrom(built.resend.state.emails[0]);
    const later = createNewsletterHandlers({
      identity: createClientIdentity({ originSecret: SECRET, ipSalt: 'salt', allowUnverifiedOrigin: false }),
      store: makeStore(),
      env: { RESEND_API_KEY: API_KEY },
      fetch: built.resend.fetch,
      now: () => NOW + 49 * 60 * 60 * 1000,
    });
    const res = await later.confirm(request({ body: { token } }), context());
    expect(res.status).toBe(400);
  });

  it('refuses a request that did not come through Cloudflare', async () => {
    const { confirm, token } = await signedUp();
    const res = await confirm(request({ body: { token }, cfSecret: 'wrong' }), context());
    expect(res.status).toBe(403);
  });
});
