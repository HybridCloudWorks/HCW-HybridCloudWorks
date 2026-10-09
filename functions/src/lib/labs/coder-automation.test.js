/**
 * The Coder automation report: POST /api/agent/reportCoderAutomation, and
 * the editor read the Integrations card makes of what it recorded.
 *
 * The load-bearing assertions are the containment ones, as for every agent
 * route (lab-agent.test.js): a refused credential reaches nothing; a body
 * that is not exactly the contract reaches nothing; a token reaches the vault
 * only after Coder has accepted it, and only under CODER-STATUS-TOKEN; and
 * the token is never in an answer, a stored document, an audit row or a log
 * line. Exercised through createLabAgentHandlers, so the guard order is the
 * production one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLabAgentHandlers } from '../lab-agent.js';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import {
  CODER_AUTOMATION_DOC_ID,
  MAX_LAST_ERROR_LENGTH,
  REDACTED_KEY,
  createCoderAutomationReadHandler,
  mergeReport,
  parseAutomationBody,
  parseIsoDateTime,
  recordAutomationReport,
} from './coder-automation.js';
import { TOKEN_RENEW_WARNING_DAYS } from './coder-status.js';

// Shaped like a Coder key (coder-status.js CODER_API_KEY_PATTERN) and plainly not one.
// Built at run time: a literal in Coder's API key shape reads as a leaked
// token to secret scanners (GitGuardian flagged these on #1030).
const TOKEN = ['FAKEKEYID0', 'FAKESECRETFAKESECRET00'].join('-');
const AGENT_ID = 'vps-hostinger-01';
const NOW = new Date('2026-10-08T05:00:00.000Z');
const ENV = { CODER_URL: 'https://coder.lab.example', KEY_VAULT_URI: 'https://kv.example/' };
const RUNNING_URL = 'https://coder.lab.example/api/v2/workspaces?q=status%3Arunning';

const REPORT = Object.freeze({
  checkedAt: '2026-10-08T04:59:00Z',
  statusTokenExpiresAt: '2027-10-08T04:59:00Z',
  rotationTokenExpiresAt: '2026-12-01T00:00:00Z',
  templatePushedAt: '2026-10-07T21:00:00+00:00',
  templateVersion: 'brave_turing4',
});

const allowGuard = () => ({
  requireAgent: vi.fn(async (_request, agentId) => ({
    agent: { agentId, active: true, oid: 'oid-agent-1', capabilities: [] },
    identity: { oid: 'oid-agent-1' },
    error: null,
  })),
});
const denyGuard = () => ({
  requireAgent: vi.fn(async () => ({
    agent: null,
    identity: null,
    error: { status: 403, body: JSON.stringify({ ok: false, error: 'Agent access required' }) },
  })),
});

/**
 * An in-memory admin_config with real ETag semantics: a replace with a stale
 * `_etag` is a 412, a create over an existing id a 409. `secret_state` and
 * the audit rows go through upsertDoc, as in production.
 */
function makeStore(initial = {}) {
  const docs = new Map(Object.entries(initial));
  let etag = 0;
  const stamp = (doc) => ({ ...doc, _etag: `"e${++etag}"` });
  for (const [id, doc] of docs) docs.set(id, stamp(doc));
  const audit = [];
  const store = {
    docs,
    audit,
    readDoc: vi.fn(async (container, id, pk) => {
      if (container === 'admin_config') expect(pk).toBe(ADMIN_CONFIG_PARTITION);
      return docs.has(id) ? structuredClone(docs.get(id)) : null;
    }),
    createDoc: vi.fn(async (_container, doc) => {
      if (docs.has(doc.id)) throw Object.assign(new Error('conflict'), { code: 409 });
      docs.set(doc.id, stamp(doc));
      return docs.get(doc.id);
    }),
    replaceDocIfMatch: vi.fn(async (_container, doc, options) => {
      expect(options).toEqual({ partitionKey: ADMIN_CONFIG_PARTITION });
      if (docs.get(doc.id)?._etag !== doc._etag) {
        throw Object.assign(new Error('precondition'), { code: 412 });
      }
      docs.set(doc.id, stamp(doc));
      return docs.get(doc.id);
    }),
    upsertDoc: vi.fn(async (container, doc) => {
      if (container === 'admin_audit_logs') audit.push(doc);
      else docs.set(doc.id, stamp(doc));
      return doc;
    }),
    // The agent store's other verbs; the report must never reach for them.
    queryDocs: vi.fn(async () => []),
    patchDoc: vi.fn(async () => ({})),
  };
  return store;
}

const ME_URL = 'https://coder.lab.example/api/v2/users/me';
const KEY_URL = `https://coder.lab.example/api/v2/users/me/keys/${TOKEN.split('-')[0]}`;
const READ_SCOPES = ['template:read', 'workspace:read', 'api_key:read', 'user:read'];
// The key's own expiry as Coder writes it (nanoseconds), and later than the
// report's, so a test can tell whose date was stored.
const KEY_EXPIRES_AT = '2027-11-30T00:00:00.123456789Z';
const answered = (a) => (typeof a === 'function' ? a() : { ok: true, status: 200, json: async () => a });

/**
 * Coder's three verification reads (coder-status.js verifyStatusToken): the
 * running count as `running` says, and the user and the key record right
 * (hcw-status, the read scopes) unless `over` says otherwise.
 */
const coderAnswering = (running, over = {}) => {
  const byUrl = {
    [RUNNING_URL]: running,
    [ME_URL]: over.me ?? { username: 'hcw-status' },
    [KEY_URL]: over.key ?? { scopes: READ_SCOPES, scope: '', expires_at: KEY_EXPIRES_AT },
  };
  return vi.fn(async (url) =>
    Object.hasOwn(byUrl, url) ? answered(byUrl[url]) : { ok: false, status: 404, json: async () => ({}) }
  );
};

const makeVault = () => ({
  setVaultSecret: vi.fn(async () => ({ version: 'v42' })),
  refreshKeyVaultReferences: vi.fn(async () => ({ refreshed: true, reason: null })),
});

function setup({
  guard = allowGuard(),
  store = makeStore(),
  fetchImpl = coderAnswering({ count: 1 }),
  vault = makeVault(),
  env = ENV,
} = {}) {
  const context = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const handlers = createLabAgentHandlers({
    guard,
    store,
    now: () => NOW,
    coderAutomation: { env, fetchImpl, vault, uuid: () => 'audit-1' },
  });
  const send = async (body) => {
    const res = await handlers.reportCoderAutomation({ json: async () => body }, context);
    return { res, body: JSON.parse(res.body) };
  };
  return { guard, store, fetchImpl, vault, context, send };
}

const bodyWith = (over = {}) => ({ agentId: AGENT_ID, report: { ...REPORT }, ...over });
const stored = (store) => store.docs.get(CODER_AUTOMATION_DOC_ID);
const logLines = (context) =>
  [...context.log.mock.calls, ...context.warn.mock.calls, ...context.error.mock.calls]
    .flat()
    .map(String);

describe('the guard comes first, as on every agent route', () => {
  it('reaches no store, no Coder and no vault when requireAgent refuses', async () => {
    const t = setup({ guard: denyGuard() });
    const { res } = await t.send(bodyWith({ statusToken: TOKEN }));
    expect(res.status).toBe(403);
    for (const fn of Object.values(t.store).filter((v) => typeof v === 'function')) {
      expect(fn).not.toHaveBeenCalled();
    }
    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(t.vault.setVaultSecret).not.toHaveBeenCalled();
  });

  it('answers a body that is not JSON with 400 before asking the guard', async () => {
    const t = setup();
    const handlers = createLabAgentHandlers({ guard: t.guard, store: t.store, now: () => NOW });
    const res = await handlers.reportCoderAutomation(
      {
        json: async () => {
          throw new SyntaxError('not json');
        },
      },
      t.context
    );
    expect(res.status).toBe(400);
    expect(t.guard.requireAgent).not.toHaveBeenCalled();
  });

  it('binds the agent named in the body, like the heartbeat', async () => {
    const t = setup();
    await t.send(bodyWith());
    expect(t.guard.requireAgent).toHaveBeenCalledWith(expect.anything(), AGENT_ID);
  });
});

describe('the body is exactly the contract, or a 400 with a sentence', () => {
  const refusals = [
    ['an unknown top-level key', bodyWith({ extra: 1 }), /"extra" is not a field this route reads/],
    ['no report', { agentId: AGENT_ID }, /report is required/],
    ['a report that is not an object', bodyWith({ report: ['x'] }), /report must be a JSON object/],
    ['an unknown report key', bodyWith({ report: { ...REPORT, uptime: 3 } }), /report\."uptime" is not a field/],
    ['no checkedAt', bodyWith({ report: { templateVersion: 'v1' } }), /report\.checkedAt is required/],
    ['a date with no zone', bodyWith({ report: { checkedAt: '2026-10-08T04:59:00' } }), /checkedAt must be an ISO 8601/],
    ['a bare date', bodyWith({ report: { checkedAt: '2026-10-08' } }), /checkedAt must be an ISO 8601/],
    ['an epoch number', bodyWith({ report: { checkedAt: 1791435540000 } }), /checkedAt must be an ISO 8601/],
    ['30 February', bodyWith({ report: { ...REPORT, templatePushedAt: '2026-02-30T00:00:00Z' } }), /templatePushedAt must be an ISO 8601/],
    ['a version that is too long', bodyWith({ report: { ...REPORT, templateVersion: 'v'.repeat(65) } }), /at most 64 characters/],
    ['a version that is not a string', bodyWith({ report: { ...REPORT, templateVersion: 7 } }), /templateVersion must be a non-empty string/],
    // The report is token-free, and the version is stored and served back as sent (CodeRabbit review).
    ['a version carrying a Coder key', bodyWith({ report: { ...REPORT, templateVersion: TOKEN } }), /templateVersion must not carry a Coder API key/],
    ['a version with a Coder key inside it', bodyWith({ report: { ...REPORT, templateVersion: `v1 ${TOKEN}` } }), /templateVersion must not carry a Coder API key/],
    ['an error that is too long', bodyWith({ report: { ...REPORT, lastError: 'e'.repeat(301) } }), /at most 300 characters/],
    ['an error that is not a string', bodyWith({ report: { ...REPORT, lastError: { message: 'x' } } }), /lastError must be a string/],
    // A nine-character id, built at run time like TOKEN.
    ['a token of the wrong shape', bodyWith({ statusToken: TOKEN.slice(1) }), /statusToken is not a Coder API key/],
    // The host's clock, checked (review of #1030): NOW is 05:00:00Z.
    [
      'a checkedAt 11 minutes ahead of the site',
      bodyWith({ report: { checkedAt: '2026-10-08T05:11:00Z' } }),
      /^report\.checkedAt is more than 10 minutes ahead of the site's clock; check the lab host's clock$/,
    ],
    [
      'a checkedAt in 2099',
      bodyWith({ report: { checkedAt: '2099-01-01T00:00:00Z' } }),
      /report\.checkedAt is more than 10 minutes ahead/,
    ],
    [
      'a template published in the future',
      bodyWith({ report: { ...REPORT, templatePushedAt: '2026-10-08T06:00:00Z' } }),
      /report\.templatePushedAt is more than 10 minutes ahead/,
    ],
    ['a token with a newline on it', bodyWith({ statusToken: `${TOKEN}\n` }), /statusToken is not a Coder API key/],
    ['a token that is null', bodyWith({ statusToken: null }), /statusToken is not a Coder API key/],
  ];

  it.each(refusals)('refuses %s, touching nothing', async (_name, body, sentence) => {
    const t = setup();
    const { res, body: answer } = await t.send(body);
    expect(res.status).toBe(400);
    expect(answer.ok).toBe(false);
    expect(answer.error).toMatch(sentence);
    expect(t.store.readDoc).not.toHaveBeenCalled();
    expect(t.store.createDoc).not.toHaveBeenCalled();
    expect(t.store.upsertDoc).not.toHaveBeenCalled();
    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(t.vault.setVaultSecret).not.toHaveBeenCalled();
  });

  it('accepts a host clock up to ten minutes ahead, and stores its dates as sent, not clamped', async () => {
    const t = setup();
    const { res } = await t.send(
      bodyWith({
        report: {
          checkedAt: '2026-10-08T05:09:59Z',
          // The expiries are rightly in the future, however far.
          rotationTokenExpiresAt: '2099-01-01T00:00:00Z',
          statusTokenExpiresAt: '2099-01-01T00:00:00Z',
        },
      })
    );
    expect(res.status).toBe(200);
    expect(stored(t.store)).toMatchObject({
      checkedAt: '2026-10-08T05:09:59.000Z',
      reportedAt: NOW.toISOString(),
      rotationTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    });
  });

  it('never repeats a refused token in its sentence', () => {
    const wrong = `${TOKEN}x`;
    expect(parseAutomationBody(bodyWith({ statusToken: wrong })).error).not.toContain(wrong);
  });

  it('accepts the dates the host will actually send, and stores them normalised', () => {
    expect(parseIsoDateTime('2026-10-08T04:59:00Z')).toBe('2026-10-08T04:59:00.000Z');
    expect(parseIsoDateTime('2026-10-08T06:59:00+02:00')).toBe('2026-10-08T04:59:00.000Z');
    // Coder's own expires_at carries nanoseconds.
    expect(parseIsoDateTime('2027-09-28T10:00:00.123456789Z')).toBe('2027-09-28T10:00:00.123Z');
    for (const wrong of ['', '2026-10-08 04:59:00Z', '2026-13-01T00:00:00Z', '2026-10-08T24:00:00Z', 'yesterday']) {
      expect(parseIsoDateTime(wrong), wrong).toBeNull();
    }
  });
});

describe('a renewed token: verified against Coder, then stored, never the other way round', () => {
  it('asks Coder with the token first, then writes it under CODER-STATUS-TOKEN through the Keys tab writer', async () => {
    const t = setup();
    const { res, body } = await t.send(bodyWith({ statusToken: TOKEN }));

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, stored: true });

    // Works, is the status user's, can only read: three reads, all with the candidate.
    expect(t.fetchImpl.mock.calls.map(([url]) => url)).toEqual([RUNNING_URL, ME_URL, KEY_URL]);
    for (const [, options] of t.fetchImpl.mock.calls) {
      expect(options.headers['Coder-Session-Token']).toBe(TOKEN);
      expect(options.redirect).toBe('error');
    }

    expect(t.vault.setVaultSecret).toHaveBeenCalledWith('CODER-STATUS-TOKEN', TOKEN, { env: ENV });
    expect(t.vault.refreshKeyVaultReferences).toHaveBeenCalledTimes(1);
    expect(t.fetchImpl.mock.invocationCallOrder[2]).toBeLessThan(
      t.vault.setVaultSecret.mock.invocationCallOrder[0]
    );

    // The Keys row goes amber, then green, exactly as for a paste.
    const state = t.store.docs.get('secret_state').secrets['CODER-STATUS-TOKEN'];
    expect(state).toMatchObject({
      lastWriteAt: NOW.toISOString(),
      lastWriteBy: `lab-agent:${AGENT_ID}`,
      lastWriteVersion: 'v42',
      lastOkAt: null,
      lastFailAt: null,
    });
  });

  it('records the server’s time of the store as the renewal, whatever the report said', async () => {
    const t = setup();
    await t.send(
      bodyWith({ statusToken: TOKEN, report: { ...REPORT, statusTokenRotatedAt: '2026-10-08T04:58:00Z' } })
    );
    expect(stored(t.store)).toMatchObject({
      id: CODER_AUTOMATION_DOC_ID,
      configScope: ADMIN_CONFIG_PARTITION,
      docType: 'coder_automation',
      agentId: AGENT_ID,
      reportedAt: NOW.toISOString(),
      checkedAt: '2026-10-08T04:59:00.000Z',
      statusTokenRotatedAt: NOW.toISOString(),
      // The stored key's own expiry from Coder, not the report's date.
      statusTokenExpiresAt: '2027-11-30T00:00:00.123Z',
      rotationTokenExpiresAt: '2026-12-01T00:00:00.000Z',
      templatePushedAt: '2026-10-07T21:00:00.000Z',
      templateVersion: 'brave_turing4',
      lastError: null,
    });
  });

  it('never keeps the previous token’s expiry for a stored token: null when Coder gives none (CodeRabbit review)', async () => {
    const t = setup({ fetchImpl: coderAnswering({ count: 1 }, { key: { scopes: READ_SCOPES, scope: '' } }) });
    await t.send(bodyWith({ report: { ...REPORT } }));
    expect(stored(t.store).statusTokenExpiresAt).toBe('2027-10-08T04:59:00.000Z');
    const { report: _report, ...rest } = bodyWith();
    await t.send({ ...rest, statusToken: TOKEN, report: { checkedAt: REPORT.checkedAt } });
    expect(stored(t.store).statusTokenExpiresAt).toBeNull();
    expect(stored(t.store).statusTokenRotatedAt).toBe(NOW.toISOString());
  });

  it('writes one content-free audit row for the rotation', async () => {
    const t = setup();
    await t.send(bodyWith({ statusToken: TOKEN }));
    expect(t.store.audit).toHaveLength(1);
    const [row] = t.store.audit;
    expect(row).toMatchObject({
      id: 'audit-1',
      action: 'coder_status_token_rotated',
      userId: 'oid-agent-1',
      timestamp: NOW.toISOString(),
      details: { agentId: AGENT_ID, secret: 'CODER-STATUS-TOKEN' },
    });
    expect(JSON.stringify(row)).not.toContain('FAKESECRET');
  });

  it('still answers stored when the audit row fails, because the token is in the vault', async () => {
    const t = setup();
    const upsert = t.store.upsertDoc;
    t.store.upsertDoc = vi.fn(async (container, doc) => {
      if (container === 'admin_audit_logs') throw Object.assign(new Error('down'), { code: 503 });
      return upsert(container, doc);
    });
    const { res, body } = await t.send(bodyWith({ statusToken: TOKEN }));
    expect(res.status).toBe(200);
    expect(body.stored).toBe(true);
    expect(t.context.warn).toHaveBeenCalledWith(expect.stringMatching(/audit row failed \(503\)/));
  });
});

describe('a token Coder will not accept is not stored', () => {
  const refusedBy = [
    ['401', coderAnswering(() => ({ ok: false, status: 401, json: async () => ({}) })), /Coder refused the token \(HTTP 401\)/],
    ['a 200 without a count', coderAnswering({ workspaces: [] }), /without a count/],
    [
      'no answer',
      coderAnswering(() => {
        throw new TypeError('fetch failed');
      }),
      /Coder could not be reached/,
    ],
    // Review of #1030: exactly 200, the status user's, and read-only.
    [
      'a 201 for the running count',
      coderAnswering(() => ({ ok: true, status: 201, json: async () => ({ count: 1 }) })),
      /^Coder answered HTTP 201 to the running-workspaces read; the token was not stored$/,
    ],
    [
      'a working key of another user',
      coderAnswering({ count: 1 }, { me: { username: 'some-learner' } }),
      /^User check: the token does not belong to hcw-status; the token was not stored$/,
    ],
    [
      'an unscoped key',
      coderAnswering({ count: 1 }, { key: { scopes: ['coder:all'], scope: 'all' } }),
      /^Scope check: the token is unscoped/,
    ],
    [
      'a key that can also change templates',
      coderAnswering({ count: 1 }, { key: { scopes: [...READ_SCOPES, 'template:update'] } }),
      /^Scope check: the token carries scopes beyond reading: template:update; the token was not stored$/,
    ],
    [
      'a key without api_key:read',
      coderAnswering({ count: 1 }, { key: { scopes: ['template:read', 'workspace:read', 'user:read'] } }),
      /^Scope check: the token lacks api_key:read; the token was not stored$/,
    ],
  ];

  it.each(refusedBy)('on %s: 422 with the reason, no vault write, no audit row', async (_name, fetchImpl, reason) => {
    const t = setup({ fetchImpl });
    const { res, body } = await t.send(bodyWith({ statusToken: TOKEN }));
    expect(res.status).toBe(422);
    expect(body).toEqual({ ok: false, stored: false, error: expect.stringMatching(reason) });
    expect(body.error).toMatch(/the token was not stored/);
    expect(t.vault.setVaultSecret).not.toHaveBeenCalled();
    expect(t.store.docs.has('secret_state')).toBe(false);
    expect(t.store.audit).toHaveLength(0);
  });

  it('records the report anyway, with the reason as lastError and no claim of a renewal', async () => {
    const previous = {
      id: CODER_AUTOMATION_DOC_ID,
      configScope: ADMIN_CONFIG_PARTITION,
      statusTokenRotatedAt: '2026-09-28T10:00:00.000Z',
      statusTokenExpiresAt: '2027-09-28T10:00:00.000Z',
    };
    const t = setup({
      store: makeStore({ [CODER_AUTOMATION_DOC_ID]: previous }),
      fetchImpl: coderAnswering(() => ({ ok: false, status: 401, json: async () => ({}) })),
    });
    await t.send(
      bodyWith({
        statusToken: TOKEN,
        report: { ...REPORT, statusTokenRotatedAt: '2026-10-08T04:58:00Z', lastError: 'host says hello' },
      })
    );
    const doc = stored(t.store);
    // The token the site still holds is the old one, so its dates stay.
    expect(doc.statusTokenRotatedAt).toBe('2026-09-28T10:00:00.000Z');
    expect(doc.statusTokenExpiresAt).toBe('2027-09-28T10:00:00.000Z');
    expect(doc.lastError).toBe(
      'Coder refused the token (HTTP 401); the token was not stored — host says hello'
    );
    expect(doc.lastError.length).toBeLessThanOrEqual(MAX_LAST_ERROR_LENGTH);
  });

  it('checks the user CODER_STATUS_USER names, and never repeats the name a refused key belonged to', async () => {
    const renamed = setup({
      env: { ...ENV, CODER_STATUS_USER: 'lab-status' },
      fetchImpl: coderAnswering({ count: 1 }, { me: { username: 'lab-status' } }),
    });
    expect((await renamed.send(bodyWith({ statusToken: TOKEN }))).body).toEqual({ ok: true, stored: true });

    const other = setup({ fetchImpl: coderAnswering({ count: 1 }, { me: { username: 'some-learner' } }) });
    const { res } = await other.send(bodyWith({ statusToken: TOKEN }));
    const everything = [res.body, JSON.stringify([...other.store.docs.values()]), ...logLines(other.context)].join('\n');
    expect(everything).not.toContain('some-learner');
    expect(other.context.warn).toHaveBeenCalledWith(
      'reportCoderAutomation: a renewed status token failed the user check (User check: the token does not belong to hcw-status); it was not stored'
    );
  });

  it('cannot verify, and so does not store, while CODER_URL is unset or not https', async () => {
    for (const env of [{}, { CODER_URL: 'http://coder.lab.example' }]) {
      const t = setup({ env });
      const { res, body } = await t.send(bodyWith({ statusToken: TOKEN }));
      expect(res.status).toBe(422);
      expect(body.error).toMatch(/CODER_URL is not set/);
      expect(t.fetchImpl).not.toHaveBeenCalled();
      expect(t.vault.setVaultSecret).not.toHaveBeenCalled();
    }
  });

  it('answers 502 when Key Vault refuses a verified token, and records why', async () => {
    const vault = makeVault();
    vault.setVaultSecret = vi.fn(async () => {
      throw new Error('Key Vault refused to set CODER-STATUS-TOKEN: HTTP 403');
    });
    const t = setup({ vault });
    const { res, body } = await t.send(bodyWith({ statusToken: TOKEN }));
    expect(res.status).toBe(502);
    expect(body).toEqual({ ok: false, stored: false, error: expect.stringMatching(/Key Vault refused the write/) });
    expect(vault.refreshKeyVaultReferences).not.toHaveBeenCalled();
    expect(t.store.audit).toHaveLength(0);
    expect(stored(t.store).lastError).toMatch(/Key Vault refused the write/);
  });
});

describe('once Key Vault has the token, the host is told so (review of #1030)', () => {
  it('answers 200 stored: true when recording the write on the Keys tab fails, with the failure as lastError', async () => {
    const t = setup();
    const create = t.store.createDoc;
    t.store.createDoc = vi.fn(async (container, doc) => {
      if (doc.id === 'secret_state') throw Object.assign(new Error('service unavailable'), { code: 503 });
      return create(container, doc);
    });
    const { res, body } = await t.send(
      bodyWith({ statusToken: TOKEN, report: { ...REPORT, lastError: 'host note' } })
    );

    // The token is live: a host told otherwise would mint and hand over another.
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, stored: true });
    expect(t.vault.setVaultSecret).toHaveBeenCalledTimes(1);
    expect(t.store.audit).toHaveLength(1);
    const doc = stored(t.store);
    expect(doc.statusTokenRotatedAt).toBe(NOW.toISOString());
    expect(doc.lastError).toBe(
      'The token was stored, but the Keys tab could not record the write (503), so its light may lag — host note'
    );
    expect(t.context.warn).toHaveBeenCalledWith(
      'reportCoderAutomation: the status token was stored, but a step after the vault write failed (500)'
    );
  });

  it('answers 200 stored: true when the reference refresh throws, which is best-effort anyway', async () => {
    const vault = makeVault();
    vault.refreshKeyVaultReferences = vi.fn(async () => {
      throw new Error('ARM throttled');
    });
    const t = setup({ vault });
    const { res, body } = await t.send(bodyWith({ statusToken: TOKEN }));
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, stored: true });
    expect(stored(t.store).lastError).toBeNull();
    expect(t.store.docs.get('secret_state').secrets['CODER-STATUS-TOKEN'].lastWriteVersion).toBe('v42');
  });
});

describe('the report document: one, merged under its ETag', () => {
  it('a report without a token stores nothing, calls no one, and answers stored: false', async () => {
    const t = setup();
    const { res, body } = await t.send(bodyWith());
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, stored: false });
    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(t.vault.setVaultSecret).not.toHaveBeenCalled();
    expect(t.store.audit).toHaveLength(0);
    expect(t.store.createDoc).toHaveBeenCalledTimes(1);
  });

  it('keeps when things last happened, and replaces what this check says', async () => {
    const t = setup();
    await t.send(bodyWith({ report: { ...REPORT, lastError: 'template push failed' } }));
    await t.send(bodyWith({ report: { checkedAt: '2026-10-08T05:05:00Z' } }));
    const doc = stored(t.store);
    expect(doc.checkedAt).toBe('2026-10-08T05:05:00.000Z');
    expect(doc.templatePushedAt).toBe('2026-10-07T21:00:00.000Z');
    expect(doc.templateVersion).toBe('brave_turing4');
    expect(doc.rotationTokenExpiresAt).toBe('2026-12-01T00:00:00.000Z');
    // A check that went well clears the last one's error.
    expect(doc.lastError).toBeNull();
    expect(t.store.replaceDocIfMatch).toHaveBeenCalledTimes(1);
  });

  it('removes anything shaped like a Coder key from lastError before storing it', async () => {
    const t = setup();
    await t.send(bodyWith({ report: { ...REPORT, lastError: `coder said no to ${TOKEN} at 04:59` } }));
    expect(stored(t.store).lastError).toBe(`coder said no to ${REDACTED_KEY} at 04:59`);
  });

  it('reads again and merges again when another writer got there first', async () => {
    const store = makeStore({ [CODER_AUTOMATION_DOC_ID]: { id: CODER_AUTOMATION_DOC_ID, templateVersion: 'old' } });
    const replace = store.replaceDocIfMatch;
    let raced = false;
    store.replaceDocIfMatch = vi.fn(async (container, doc, options) => {
      if (!raced) {
        raced = true;
        // Someone else writes between our read and our replace.
        const current = store.docs.get(CODER_AUTOMATION_DOC_ID);
        store.docs.set(CODER_AUTOMATION_DOC_ID, { ...current, templateVersion: 'theirs', _etag: '"other"' });
      }
      return replace(container, doc, options);
    });
    const doc = await recordAutomationReport(
      store,
      { checkedAt: NOW.toISOString(), agentId: AGENT_ID, reportedAt: NOW.toISOString() },
      { sleep: async () => {} }
    );
    expect(store.replaceDocIfMatch).toHaveBeenCalledTimes(2);
    expect(store.readDoc).toHaveBeenCalledTimes(2);
    expect(doc.templateVersion).toBe('theirs');
  });

  it('reads again when a first report races another first report', async () => {
    const store = makeStore();
    const create = store.createDoc;
    store.createDoc = vi.fn(async (container, doc) => {
      store.docs.set(doc.id, { id: doc.id, templateVersion: 'first', _etag: '"first"' });
      return create(container, doc);
    });
    const doc = await recordAutomationReport(store, { checkedAt: NOW.toISOString() }, { sleep: async () => {} });
    expect(store.replaceDocIfMatch).toHaveBeenCalledTimes(1);
    expect(doc.templateVersion).toBe('first');
  });

  it('answers stored when the report cannot be recorded after the token was, and 500 when no token was', async () => {
    const t = setup();
    t.store.createDoc = vi.fn(async () => {
      throw Object.assign(new Error('conflict'), { code: 409 });
    });
    const { res, body } = await t.send(bodyWith({ statusToken: TOKEN }));
    // The token did reach the vault, so the answer is a success the host's
    // CLI can read: a 500 would read as nothing stored and earn another
    // token (CodeRabbit review). The failure is in the site's log.
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, stored: true });
    expect(t.context.error).toHaveBeenCalledWith(
      'reportCoderAutomation: the report could not be recorded (CONFLICT); the token it carried was stored'
    );

    const plain = setup();
    plain.store.createDoc = t.store.createDoc;
    const without = await plain.send(bodyWith());
    expect(without.res.status).toBe(500);
    expect(without.body).toEqual({ ok: false, stored: false, error: 'The report could not be recorded' });
  }, 20_000);

  it('builds the document from named fields only', () => {
    const merged = mergeReport(
      { id: CODER_AUTOMATION_DOC_ID, templateVersion: 'v1', strayField: 'x', _etag: '"e"' },
      { checkedAt: 'c', agentId: 'a', reportedAt: 'r' }
    );
    expect(merged).toEqual({
      id: CODER_AUTOMATION_DOC_ID,
      configScope: ADMIN_CONFIG_PARTITION,
      docType: 'coder_automation',
      templateVersion: 'v1',
      checkedAt: 'c',
      agentId: 'a',
      reportedAt: 'r',
      lastError: null,
    });
  });
});

describe('the token never leaves the request', () => {
  const outcomes = [
    ['stored', () => coderAnswering({ count: 2 })],
    ['refused by Coder', () => coderAnswering(() => ({ ok: false, status: 401, json: async () => ({}) }))],
    [
      'Coder unreachable, with the token in the thrown text',
      () =>
        coderAnswering(() => {
          throw new Error(`socket closed while sending ${TOKEN}`);
        }),
    ],
  ];

  it.each(outcomes)(
    'when %s: not in the answer, the document, the secret state or a log line, and no agent or document id is logged',
    async (_name, fetchImpl) => {
      const t = setup({ fetchImpl: fetchImpl() });
      const { res } = await t.send(
        bodyWith({ statusToken: TOKEN, report: { ...REPORT, lastError: `while handing over ${TOKEN}` } })
      );
      const everything = [
        res.body,
        JSON.stringify([...t.store.docs.values()]),
        JSON.stringify(t.store.audit),
        ...logLines(t.context),
      ].join('\n');
      expect(everything).not.toContain('FAKESECRET');
      for (const line of logLines(t.context)) {
        expect(line).not.toContain(AGENT_ID);
        expect(line).not.toContain(CODER_AUTOMATION_DOC_ID);
        expect(line).not.toContain('coder.lab.example');
      }
    }
  );
});

describe('GET /api/cms/labs/coder-automation (editor)', () => {
  const request = () => ({ method: 'GET' });
  const context = { error: vi.fn() };
  const guardAs = (error = null) => ({ requireRole: vi.fn(async () => ({ error, user: { oid: 'u' } })) });

  beforeEach(() => context.error.mockReset());

  it('asks for editor, and answers the refusal unchanged', async () => {
    const denied = { status: 403, body: '{}' };
    const guard = guardAs(denied);
    const read = createCoderAutomationReadHandler({ guard, store: makeStore() });
    expect(await read(request(), context)).toBe(denied);
    expect(guard.requireRole).toHaveBeenCalledWith(expect.anything(), 'editor');
  });

  it('answers report: null before the host has ever reported', async () => {
    const res = await createCoderAutomationReadHandler({ guard: guardAs(), store: makeStore() })(
      request(),
      context
    );
    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(JSON.parse(res.body)).toEqual({ report: null, warningDays: TOKEN_RENEW_WARNING_DAYS });
  });

  it('answers the stored fields by name, and nothing else the document holds', async () => {
    const store = makeStore({
      [CODER_AUTOMATION_DOC_ID]: {
        id: CODER_AUTOMATION_DOC_ID,
        configScope: ADMIN_CONFIG_PARTITION,
        agentId: AGENT_ID,
        checkedAt: '2026-10-08T04:59:00.000Z',
        templateVersion: 'brave_turing4',
        lastError: '',
        strayField: 'not for the page',
      },
    });
    const res = await createCoderAutomationReadHandler({ guard: guardAs(), store })(request(), context);
    expect(JSON.parse(res.body)).toEqual({
      warningDays: TOKEN_RENEW_WARNING_DAYS,
      report: {
        agentId: AGENT_ID,
        reportedAt: null,
        checkedAt: '2026-10-08T04:59:00.000Z',
        statusTokenExpiresAt: null,
        statusTokenRotatedAt: null,
        rotationTokenExpiresAt: null,
        templatePushedAt: null,
        templateVersion: 'brave_turing4',
        lastError: null,
      },
    });
  });

  it('answers 500 with a content-free line when the read fails', async () => {
    const store = makeStore();
    store.readDoc = vi.fn(async () => {
      throw Object.assign(new Error(`read ${CODER_AUTOMATION_DOC_ID} failed`), { code: 503 });
    });
    const res = await createCoderAutomationReadHandler({ guard: guardAs(), store })(request(), context);
    expect(res.status).toBe(500);
    expect(context.error).toHaveBeenCalledWith('cmsLabsCoderAutomation failed (503)');
  });
});
