/**
 * Coder's answers to the status token, recorded for the health pulse, and the
 * warning a 401 writes for a log alert (#1009, item 4).
 *
 * From 2026-10-06T01:25Z Coder refused the token for about 32 hours and the
 * only sign was a card reading "unknown". What these pin: a 401 on the labs
 * status read, on the scheduled check or on the Integrations card's expiry
 * read is recorded as a refusal of that operation and logged at warning with
 * a fixed, content-free start; a good read is recorded as an acceptance of
 * its own operation only, so the expiry read cannot clear a status read's
 * refusal (CodeRabbit, #1056); the scheduled check asks Coder whatever the
 * anonymous cache holds (CodeRabbit, #1056); one outage keeps its start; an
 * unchanged answer is written at most hourly; every write is under the ETag
 * of its read; and nothing here can break the read it rides on.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  CODER_STATUS_CACHE_ID,
  TOKEN_REFUSED_401_LOG,
  TOKEN_STATE_DOC_ID,
  TOKEN_STATE_REFRESH_MS,
  createCoderStatusHandlers,
  isRefusing,
  nextTokenState,
  recordTokenAnswer,
} from './coder-status.js';
import { coderTokenVerdict } from './lab-checks.js';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const TOKEN = 'AbCdEf1234-ghijklmnopqrstuvwxyz0123';
const ENV = { CODER_URL: 'https://coder.lab.example/', CODER_STATUS_TOKEN: TOKEN, CODER_MAX_WORKSPACES: '5' };
const V1 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const HEALTHY = {
  '/api/v2/buildinfo': { version: 'v2.38.0' },
  '/api/v2/templates': [{ name: 'hcw-lab', active_version_id: V1 }],
  '/api/v2/workspaces?q=status%3Arunning': { count: 1, workspaces: [{ id: 'w1' }] },
  [`/api/v2/templateversions/${V1}`]: { name: 'v7' },
};
const KEY_PATH = '/api/v2/users/me/keys/AbCdEf1234';

function coderFetch(routes) {
  return vi.fn(async (url) => {
    const u = new URL(url);
    const hit = routes[`${u.pathname}${u.search}`] ?? routes[u.pathname];
    if (hit === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return typeof hit === 'function' ? hit() : { ok: true, status: 200, json: async () => hit };
  });
}
const refusedWith = (status) => () => ({ ok: false, status, json: async () => ({}) });

/** A Cosmos double with ETags for the token record, and the minute cache's document. */
function store(state = null, { cacheFreshFor = 0 } = {}) {
  let n = 0;
  const docs = new Map(state ? [[TOKEN_STATE_DOC_ID, { ...state, _etag: `"e${(n += 1)}"` }]] : []);
  if (cacheFreshFor) {
    // A warm cache: what anonymous visitors keep refreshed every minute.
    docs.set(CODER_STATUS_CACHE_ID, {
      id: CODER_STATUS_CACHE_ID,
      kind: 'labs-coder-status',
      value: { configured: true, reachable: true, templates: [], capacity: { running: 1, max: 5 } },
      cachedAt: ago(cacheFreshFor),
    });
  }
  return {
    docs,
    readDoc: vi.fn(async (_c, id) => (docs.has(id) ? { ...docs.get(id) } : null)),
    upsertDoc: vi.fn(async (_c, doc) => doc),
    createDoc: vi.fn(async (_c, doc) => {
      if (docs.has(doc.id)) throw Object.assign(new Error('exists'), { code: 409 });
      docs.set(doc.id, { ...doc, _etag: `"e${(n += 1)}"` });
      return docs.get(doc.id);
    }),
    replaceDocIfMatch: vi.fn(async (_c, doc) => {
      if (docs.get(doc.id)?._etag !== doc._etag) throw Object.assign(new Error('changed'), { code: 412 });
      docs.set(doc.id, { ...doc, _etag: `"e${(n += 1)}"` });
      return docs.get(doc.id);
    }),
  };
}

const handlers = (s, fetchImpl, now = () => NOW) =>
  createCoderStatusHandlers({
    store: s,
    fetchImpl,
    env: ENV,
    now,
    guard: { requireRole: vi.fn(async () => ({ role: 'editor', user: { oid: 'u' } })) },
  });
const recorded = (s, operation) => s.docs.get(TOKEN_STATE_DOC_ID)?.operations?.[operation];

describe('the labs status read records the status operation’s answer', () => {
  it('records an acceptance when the detail read succeeds', async () => {
    const s = store();
    await handlers(s, coderFetch(HEALTHY)).readStatus({ warn: vi.fn() });
    expect(s.docs.get(TOKEN_STATE_DOC_ID)).toMatchObject({ configScope: 'admin_config', docType: 'coder_status_token' });
    expect(recorded(s, 'status')).toEqual({
      lastAcceptedAt: new Date(NOW).toISOString(),
      lastRefusedAt: null,
      lastRefusedStatus: null,
      refusingSince: null,
    });
    expect(recorded(s, 'expiry')).toBeUndefined();
  });

  it('records a 401 as a refusal, and warns with the fixed start an alert matches, never the token', async () => {
    const s = store({ operations: { status: { lastAcceptedAt: ago(3_600_000) } } });
    const warn = vi.fn();
    const body = await handlers(s, coderFetch({ ...HEALTHY, '/api/v2/templates': refusedWith(401) })).readStatus({ warn });

    // The public answer is what it always was: no word of the refusal.
    expect(body).toMatchObject({ configured: true, reachable: true, templates: [], capacity: { running: null } });
    expect(JSON.stringify(body)).not.toMatch(/refus|401|token/i);
    expect(recorded(s, 'status')).toMatchObject({
      lastAcceptedAt: ago(3_600_000),
      lastRefusedAt: new Date(NOW).toISOString(),
      lastRefusedStatus: 401,
      refusingSince: new Date(NOW).toISOString(),
    });
    const lines = warn.mock.calls.map(([line]) => line);
    expect(lines).toContain(
      `${TOKEN_REFUSED_401_LOG}: it has expired or been revoked; templates and running workspaces are reported as unknown`
    );
    expect(TOKEN_REFUSED_401_LOG).toBe('coder-status: Coder refused CODER_STATUS_TOKEN (401)');
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines.join('\n')).not.toContain('coder.lab.example');
  });

  it('records a 403 as a refusal too, with a line that names the scope and does not match the 401 alert', async () => {
    const s = store();
    const warn = vi.fn();
    await handlers(s, coderFetch({ ...HEALTHY, '/api/v2/workspaces?q=status%3Arunning': refusedWith(403) })).readStatus({
      warn,
    });
    expect(recorded(s, 'status')).toMatchObject({ lastRefusedStatus: 403 });
    const lines = warn.mock.calls.map(([line]) => line);
    expect(lines.some((line) => line.includes('(403): it lacks the template:read or workspace:read scope'))).toBe(true);
    expect(lines.some((line) => line.startsWith(TOKEN_REFUSED_401_LOG))).toBe(false);
  });

  it('records nothing when Coder is unreachable or the read fails for another reason', async () => {
    const unreachable = store();
    await handlers(unreachable, coderFetch({ ...HEALTHY, '/api/v2/buildinfo': refusedWith(503) })).readStatus({ warn: vi.fn() });
    const failing = store();
    await handlers(failing, coderFetch({ ...HEALTHY, '/api/v2/templates': refusedWith(500) })).readStatus({ warn: vi.fn() });
    expect(unreachable.createDoc).not.toHaveBeenCalled();
    expect(failing.createDoc).not.toHaveBeenCalled();
  });

  it('still answers when the record cannot be written, with a content-free warning', async () => {
    const s = store();
    s.createDoc.mockRejectedValueOnce(Object.assign(new Error(`write ${TOKEN_STATE_DOC_ID} failed`), { code: 503 }));
    const warn = vi.fn();
    const body = await handlers(s, coderFetch(HEALTHY)).readStatus({ warn });
    expect(body.capacity.running).toBe(1);
    expect(warn).toHaveBeenCalledWith("coder-status: Coder's answer to the status token could not be recorded (503)");
  });
});

describe('the scheduled check asks Coder whatever the anonymous cache holds (CodeRabbit, #1056)', () => {
  it('records a 401 within the hour while visitors keep the cache warm', async () => {
    const s = store({ operations: { status: { lastAcceptedAt: ago(30 * 60_000) } } }, { cacheFreshFor: 10_000 });
    const fetchImpl = coderFetch({ ...HEALTHY, '/api/v2/templates': refusedWith(401) });
    const h = handlers(s, fetchImpl);

    // A visitor's read is served from the warm cache: Coder is not asked.
    const visitor = await h.readStatus({ warn: vi.fn() });
    expect(visitor.capacity.running).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();

    // The canary's hourly check asks Coder anyway, and records the refusal.
    const warn = vi.fn();
    expect(await h.checkToken({ warn })).toEqual({ checked: true, refusedStatus: 401 });
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname).sort()).toEqual([
      '/api/v2/templates',
      '/api/v2/workspaces',
    ]);
    expect(recorded(s, 'status')).toMatchObject({ lastRefusedStatus: 401, lastRefusedAt: new Date(NOW).toISOString() });
    expect(warn.mock.calls.some(([line]) => line.startsWith(TOKEN_REFUSED_401_LOG))).toBe(true);
    expect(coderTokenVerdict(s.docs.get(TOKEN_STATE_DOC_ID), NOW).status).toBe('critical');
    // And it leaves the cache as the visitors had it.
    expect(s.upsertDoc).not.toHaveBeenCalled();
  });

  it('records an acceptance, and says when it could not reach a verdict', async () => {
    const s = store();
    expect(await handlers(s, coderFetch(HEALTHY)).checkToken({ warn: vi.fn() })).toEqual({
      checked: true,
      refusedStatus: null,
    });
    expect(recorded(s, 'status').lastAcceptedAt).toBe(new Date(NOW).toISOString());

    const down = store();
    const warn = vi.fn();
    expect(await handlers(down, coderFetch({ ...HEALTHY, '/api/v2/templates': refusedWith(502) })).checkToken({ warn })).toEqual({
      checked: false,
      reason: 'error',
    });
    expect(down.createDoc).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('coder-status: the scheduled token check could not reach a verdict (Coder answered 502)');
  });

  it('does nothing without a token', async () => {
    const h = createCoderStatusHandlers({
      store: store(),
      fetchImpl: vi.fn(),
      env: { CODER_URL: ENV.CODER_URL },
      now: () => NOW,
    });
    expect(await h.checkToken({})).toEqual({ checked: false, reason: 'unset' });
  });
});

describe('the Integrations card’s expiry read records the expiry operation’s answer', () => {
  it('records its 401 as a refusal and writes the same warning', async () => {
    const s = store();
    const warn = vi.fn();
    const res = await handlers(s, coderFetch({ [KEY_PATH]: refusedWith(401) })).getCoderToken({}, { warn, error: vi.fn() });
    expect(JSON.parse(res.body).token).toEqual({ known: false, reason: 'refused' });
    expect(recorded(s, 'expiry')).toMatchObject({ lastRefusedStatus: 401 });
    expect(recorded(s, 'status')).toBeUndefined();
    expect(warn.mock.calls.map(([line]) => line)).toContain(
      `${TOKEN_REFUSED_401_LOG}: it has expired or been revoked; its expiry cannot be read`
    );
  });

  it('cannot clear a status read’s 403: the refusal stays raised after a successful expiry read (CodeRabbit, #1056)', async () => {
    const s = store();
    // The status read is refused for a scope …
    await handlers(s, coderFetch({ ...HEALTHY, '/api/v2/templates': refusedWith(403) })).readStatus({ warn: vi.fn() });
    // … and a minute later an editor opens Integrations, whose read of the
    // token's own record succeeds.
    await handlers(
      s,
      coderFetch({ [KEY_PATH]: { expires_at: '2027-01-08T00:00:00Z', token_name: 'hcw-status-site' } }),
      () => NOW + 60_000
    ).getCoderToken({}, { warn: vi.fn(), error: vi.fn() });

    expect(isRefusing(recorded(s, 'status'))).toBe(true);
    expect(recorded(s, 'expiry').lastAcceptedAt).toBe(new Date(NOW + 60_000).toISOString());
    const verdict = coderTokenVerdict(s.docs.get(TOKEN_STATE_DOC_ID), NOW + 120_000);
    expect(verdict.status).toBe('critical');
    expect(verdict.summary).toContain('on the labs status read (HTTP 403)');
    expect(verdict.summary).toContain('it lacks the template:read or workspace:read scope');

    // Only a status read that succeeds clears it.
    await handlers(s, coderFetch(HEALTHY), () => NOW + 180_000).readStatus({ warn: vi.fn() });
    expect(coderTokenVerdict(s.docs.get(TOKEN_STATE_DOC_ID), NOW + 240_000).status).toBe('healthy');
  });
});

describe('recordTokenAnswer', () => {
  const at = (ms) => () => NOW + ms;

  it('keeps one outage’s start however often it is seen again', async () => {
    const s = store();
    await recordTokenAnswer({ store: s, operation: 'status', refusedStatus: 401, now: at(0) });
    await recordTokenAnswer({ store: s, operation: 'status', refusedStatus: 401, now: at(TOKEN_STATE_REFRESH_MS) });
    expect(recorded(s, 'status')).toMatchObject({
      refusingSince: new Date(NOW).toISOString(),
      lastRefusedAt: new Date(NOW + TOKEN_STATE_REFRESH_MS).toISOString(),
    });
  });

  it('writes an unchanged answer at most hourly, and a change at once', async () => {
    const s = store();
    const answer = (refusedStatus, ms) => recordTokenAnswer({ store: s, operation: 'status', refusedStatus, now: at(ms) });
    expect(await answer(null, 0)).toBe(true);
    expect(await answer(null, 60_000)).toBe(false);
    expect(await answer(401, 120_000)).toBe(true);
    expect(await answer(401, 180_000)).toBe(false);
    expect(await answer(403, 240_000)).toBe(true);
    expect(await answer(null, 300_000)).toBe(true);
    expect(isRefusing(recorded(s, 'status'))).toBe(false);
    expect(await answer(null, 300_000 + TOKEN_STATE_REFRESH_MS)).toBe(true);
  });

  it('judges news per operation: an answer for one never stands in for the other', async () => {
    const s = store();
    expect(await recordTokenAnswer({ store: s, operation: 'status', refusedStatus: null, now: at(0) })).toBe(true);
    expect(await recordTokenAnswer({ store: s, operation: 'expiry', refusedStatus: null, now: at(1_000) })).toBe(true);
    expect(Object.keys(s.docs.get(TOKEN_STATE_DOC_ID).operations).sort()).toEqual(['expiry', 'status']);
  });

  it('writes under the ETag of its read, and leaves an answer another worker wrote in between', async () => {
    const s = store({ operations: { status: { lastAcceptedAt: ago(2 * TOKEN_STATE_REFRESH_MS) } } });
    s.replaceDocIfMatch.mockRejectedValueOnce(Object.assign(new Error('changed'), { code: 412 }));
    const warn = vi.fn();
    expect(
      await recordTokenAnswer({ store: s, operation: 'status', refusedStatus: null, now: at(0), context: { warn } })
    ).toBe(false);
    expect(s.replaceDocIfMatch.mock.calls[0][1]._etag).toBe('"e1"');
    expect(s.replaceDocIfMatch.mock.calls[0][2]).toEqual({ partitionKey: 'admin_config' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('records nothing through a store without conditional writes, or for an operation it does not know', async () => {
    expect(
      await recordTokenAnswer({ store: { readDoc: vi.fn(), upsertDoc: vi.fn() }, operation: 'status', refusedStatus: 401 })
    ).toBe(false);
    const s = store();
    expect(await recordTokenAnswer({ store: s, operation: 'bogus', refusedStatus: 401 })).toBe(false);
    expect(s.readDoc).not.toHaveBeenCalled();
  });

  it('nextTokenState: an acceptance ends that operation’s outage, keeps its last refusal, and leaves the other alone', () => {
    const refusing = nextTokenState(null, 'status', 401, ago(60_000));
    const withExpiry = nextTokenState(refusing, 'expiry', null, ago(30_000));
    expect(isRefusing(withExpiry.operations.status)).toBe(true);
    const back = nextTokenState(withExpiry, 'status', null, ago(0));
    expect(back.operations.status).toMatchObject({
      lastRefusedAt: ago(60_000),
      lastRefusedStatus: 401,
      lastAcceptedAt: ago(0),
      refusingSince: null,
    });
    expect(back.operations.expiry).toEqual(withExpiry.operations.expiry);
    expect(isRefusing(back.operations.status)).toBe(false);
  });
});

describe('the anonymous routes record what they learn', () => {
  it('hand the status handlers the conditional writes, so a visitor’s live read is evidence too', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../functions/labs-public-http.js', import.meta.url), 'utf8');
    const wiring = /const coder = \(\) =>[\s\S]*?\);/.exec(source)?.[0] ?? '';
    expect(wiring).toMatch(/createDoc/);
    expect(wiring).toMatch(/replaceDocIfMatch/);
  });
});
