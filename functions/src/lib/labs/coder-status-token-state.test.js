/**
 * Coder's answers to the status token, recorded for the health pulse, and the
 * warning a 401 writes for a log alert (#1009, item 4).
 *
 * From 2026-10-06T01:25Z Coder refused the token for about 32 hours and the
 * only sign was a card reading "unknown". What these pin: a 401 on the labs
 * status read, or on the Integrations card's expiry read, is recorded as a
 * refusal and logged at warning with a fixed, content-free start; a good read
 * is recorded as an acceptance; one outage keeps its start; an unchanged
 * answer is written at most hourly; every write is under the ETag of its
 * read; and nothing here can break the status read it rides on.
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

function coderFetch(routes) {
  return vi.fn(async (url) => {
    const u = new URL(url);
    const hit = routes[`${u.pathname}${u.search}`] ?? routes[u.pathname];
    if (hit === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return typeof hit === 'function' ? hit() : { ok: true, status: 200, json: async () => hit };
  });
}
const refusedWith = (status) => () => ({ ok: false, status, json: async () => ({}) });

/** A Cosmos double with ETags for admin_config, and a plain cache container. */
function store(state = null) {
  let n = 0;
  const docs = new Map(state ? [[TOKEN_STATE_DOC_ID, { ...state, _etag: `"e${(n += 1)}"` }]] : []);
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

const status = (s, fetchImpl, context) =>
  createCoderStatusHandlers({ store: s, fetchImpl, env: ENV, now: () => NOW }).readStatus(context);

describe('the labs status read records Coder’s answer to the token', () => {
  it('records an acceptance when the detail read succeeds', async () => {
    const s = store();
    await status(s, coderFetch(HEALTHY), { warn: vi.fn() });
    expect(s.docs.get(TOKEN_STATE_DOC_ID)).toMatchObject({
      configScope: 'admin_config',
      docType: 'coder_status_token',
      lastAcceptedAt: new Date(NOW).toISOString(),
      lastRefusedAt: null,
      refusingSince: null,
    });
  });

  it('records a 401 as a refusal, and warns with the fixed start an alert matches, never the token', async () => {
    const s = store({ lastAcceptedAt: ago(3_600_000) });
    const warn = vi.fn();
    const body = await status(s, coderFetch({ ...HEALTHY, '/api/v2/templates': refusedWith(401) }), { warn });

    // The public answer is what it always was: no word of the refusal.
    expect(body).toMatchObject({ configured: true, reachable: true, templates: [], capacity: { running: null } });
    expect(JSON.stringify(body)).not.toMatch(/refus|401|token/i);
    expect(s.docs.get(TOKEN_STATE_DOC_ID)).toMatchObject({
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
    await status(s, coderFetch({ ...HEALTHY, '/api/v2/workspaces?q=status%3Arunning': refusedWith(403) }), { warn });
    expect(s.docs.get(TOKEN_STATE_DOC_ID)).toMatchObject({ lastRefusedStatus: 403 });
    const lines = warn.mock.calls.map(([line]) => line);
    expect(lines.some((line) => line.includes('(403): it lacks the template:read or workspace:read scope'))).toBe(true);
    expect(lines.some((line) => line.startsWith(TOKEN_REFUSED_401_LOG))).toBe(false);
  });

  it('records nothing when Coder is unreachable or the read fails for another reason', async () => {
    const unreachable = store();
    await status(unreachable, coderFetch({ ...HEALTHY, '/api/v2/buildinfo': refusedWith(503) }), { warn: vi.fn() });
    const failing = store();
    await status(failing, coderFetch({ ...HEALTHY, '/api/v2/templates': refusedWith(500) }), { warn: vi.fn() });
    expect(unreachable.createDoc).not.toHaveBeenCalled();
    expect(failing.createDoc).not.toHaveBeenCalled();
  });

  it('still answers when the record cannot be written, with a content-free warning', async () => {
    const s = store();
    s.createDoc.mockRejectedValueOnce(Object.assign(new Error(`write ${TOKEN_STATE_DOC_ID} failed`), { code: 503 }));
    const warn = vi.fn();
    const body = await status(s, coderFetch(HEALTHY), { warn });
    expect(body.capacity.running).toBe(1);
    expect(warn).toHaveBeenCalledWith("coder-status: Coder's answer to the status token could not be recorded (503)");
  });

  it('reaches Coder no more than the minute cache allows, so it records no more than that either', async () => {
    const s = store();
    s.readDoc.mockImplementation(async (_c, id) =>
      id === CODER_STATUS_CACHE_ID
        ? { id, kind: 'labs-coder-status', value: { configured: true, reachable: true }, cachedAt: ago(10_000) }
        : null
    );
    const fetchImpl = coderFetch(HEALTHY);
    await status(s, fetchImpl, { warn: vi.fn() });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(s.createDoc).not.toHaveBeenCalled();
  });
});

describe('the Integrations card’s expiry read', () => {
  const guard = { requireRole: vi.fn(async () => ({ role: 'editor', user: { oid: 'u' } })) };
  const keyPath = '/api/v2/users/me/keys/AbCdEf1234';

  it('records its 401 as a refusal and writes the same warning', async () => {
    const s = store();
    const warn = vi.fn();
    const h = createCoderStatusHandlers({
      store: s,
      guard,
      fetchImpl: coderFetch({ [keyPath]: refusedWith(401) }),
      env: ENV,
      now: () => NOW,
    });
    const res = await h.getCoderToken({}, { warn, error: vi.fn() });
    expect(JSON.parse(res.body).token).toEqual({ known: false, reason: 'refused' });
    expect(s.docs.get(TOKEN_STATE_DOC_ID)).toMatchObject({ lastRefusedStatus: 401 });
    expect(warn.mock.calls.map(([line]) => line)).toContain(
      `${TOKEN_REFUSED_401_LOG}: it has expired or been revoked; its expiry cannot be read`
    );
  });

  it('records an acceptance when the token reads its own record', async () => {
    const s = store();
    const h = createCoderStatusHandlers({
      store: s,
      guard,
      fetchImpl: coderFetch({ [keyPath]: { expires_at: '2027-01-08T00:00:00Z', token_name: 'hcw-status-site' } }),
      env: ENV,
      now: () => NOW,
    });
    await h.getCoderToken({}, { warn: vi.fn(), error: vi.fn() });
    expect(s.docs.get(TOKEN_STATE_DOC_ID)).toMatchObject({ lastAcceptedAt: new Date(NOW).toISOString() });
  });
});

describe('recordTokenAnswer', () => {
  const at = (ms) => () => NOW + ms;

  it('keeps one outage’s start however often it is seen again', async () => {
    const s = store();
    await recordTokenAnswer({ store: s, refusedStatus: 401, now: at(0) });
    await recordTokenAnswer({ store: s, refusedStatus: 401, now: at(TOKEN_STATE_REFRESH_MS) });
    expect(s.docs.get(TOKEN_STATE_DOC_ID)).toMatchObject({
      refusingSince: new Date(NOW).toISOString(),
      lastRefusedAt: new Date(NOW + TOKEN_STATE_REFRESH_MS).toISOString(),
    });
  });

  it('writes an unchanged answer at most hourly, and a change at once', async () => {
    const s = store();
    expect(await recordTokenAnswer({ store: s, refusedStatus: null, now: at(0) })).toBe(true);
    expect(await recordTokenAnswer({ store: s, refusedStatus: null, now: at(60_000) })).toBe(false);
    expect(await recordTokenAnswer({ store: s, refusedStatus: 401, now: at(120_000) })).toBe(true);
    expect(await recordTokenAnswer({ store: s, refusedStatus: 401, now: at(180_000) })).toBe(false);
    expect(await recordTokenAnswer({ store: s, refusedStatus: 403, now: at(240_000) })).toBe(true);
    expect(await recordTokenAnswer({ store: s, refusedStatus: null, now: at(300_000) })).toBe(true);
    expect(isRefusing(s.docs.get(TOKEN_STATE_DOC_ID))).toBe(false);
    expect(await recordTokenAnswer({ store: s, refusedStatus: null, now: at(300_000 + TOKEN_STATE_REFRESH_MS) })).toBe(true);
  });

  it('writes under the ETag of its read, and leaves an answer another worker wrote in between', async () => {
    const s = store({ lastAcceptedAt: ago(2 * TOKEN_STATE_REFRESH_MS) });
    s.replaceDocIfMatch.mockRejectedValueOnce(Object.assign(new Error('changed'), { code: 412 }));
    const warn = vi.fn();
    expect(await recordTokenAnswer({ store: s, refusedStatus: null, now: at(0), context: { warn } })).toBe(false);
    expect(s.replaceDocIfMatch.mock.calls[0][1]._etag).toBe('"e1"');
    expect(s.replaceDocIfMatch.mock.calls[0][2]).toEqual({ partitionKey: 'admin_config' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('records nothing through a store without conditional writes', async () => {
    expect(await recordTokenAnswer({ store: { readDoc: vi.fn(), upsertDoc: vi.fn() }, refusedStatus: 401 })).toBe(false);
  });

  it('nextTokenState: an acceptance ends the outage and keeps the last refusal for the record', () => {
    const refusing = nextTokenState(null, 401, ago(60_000));
    const back = nextTokenState(refusing, null, ago(0));
    expect(back).toMatchObject({ lastRefusedAt: ago(60_000), lastRefusedStatus: 401, lastAcceptedAt: ago(0), refusingSince: null });
    expect(isRefusing(back)).toBe(false);
  });
});
