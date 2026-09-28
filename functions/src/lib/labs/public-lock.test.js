/**
 * The lock on "Validate on the lab" (ADR 0032 decision 6 as revised
 * 2026-09-28, public-lock.js). What must hold:
 *
 *   - ONLY THE SITE'S PANE. A POST whose Origin is not exactly the apex or
 *     www is refused 403 ORIGIN_NOT_ALLOWED before its body is read, and a
 *     missing Origin is refused too.
 *   - A TURNSTILE TOKEN CLOUDFLARE PASSES, for the site's hostname and the
 *     `lab-validate` action. No token is 403 TURNSTILE_REQUIRED; a refused,
 *     replayed, off-site or wrong-action token is 403 TURNSTILE_FAILED.
 *   - FAIL CLOSED. No secret, or an unresolved Key Vault reference, is 503
 *     TURNSTILE_NOT_CONFIGURED on the POST and on the status read; siteverify
 *     unreachable, non-2xx, non-JSON or refusing the secret is 503
 *     TURNSTILE_UNAVAILABLE. Never a pass.
 *   - BEFORE ANY STORE READ OR COUNTER. Every refusal above leaves the store
 *     untouched; a token that passes reaches decision 6's bounds unchanged.
 *   - Nothing the visitor sent, and not their address, is logged.
 *   - The estate matches: the secret is a Key Vault reference, no Terraform
 *     resource holds it, and the frontend spells the same action and codes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { terraformSource } from '../../../test/terraform-source.js';
import { PRODUCTION_ORIGINS } from '../auth/cors.js';
import {
  DOOR_CODES,
  DOOR_REASONS,
  LAB_SITE_HOSTNAMES,
  LAB_SITE_ORIGINS,
  LAB_TURNSTILE_ACTION,
  LOCK_CODES,
  LOCK_REASONS,
  PUBLIC_BOUNDS,
  PUBLIC_SUBMISSION_SWITCH,
  TURNSTILE_SECRET_SETTING,
  TURNSTILE_SITEVERIFY_URL,
  createPublicSubmitHandlers,
  isSiteOrigin,
  judgeSiteverify,
  turnstileConfigured,
  verifyTurnstileToken,
} from './public-submit.js';

const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const NOW = Date.parse('2026-09-28T12:00:00Z');
const SECRET = 'turnstile-secret';
const OPEN = { [PUBLIC_SUBMISSION_SWITCH]: 'true', [TURNSTILE_SECRET_SETTING]: SECRET };
const SITE = 'https://hybridcloudworks.com';
const WWW = 'https://www.hybridcloudworks.com';
const TOKEN = 'turnstile-token-abc';
const CLIENT_IP = '203.0.113.7';
const UNRESOLVED =
  '@Microsoft.KeyVault(SecretUri=https://kv-site-prod-cus-01.vault.azure.net/secrets/TURNSTILE-SECRET-KEY)';

/** Cloudflare's answer for a token solved on the site for the builder's action. */
const PASS = Object.freeze({
  success: true,
  challenge_ts: '2026-09-28T11:59:50Z',
  hostname: 'hybridcloudworks.com',
  action: 'lab-validate',
  'error-codes': [],
});

const answering = (json, { ok = true, status = 200 } = {}) =>
  vi.fn(async () => ({ ok, status, json: async () => json }));

/**
 * Siteverify as Cloudflare runs it for single-use tokens: the first check of
 * a token passes, every later check of the same one is timeout-or-duplicate.
 */
function singleUseSiteverify() {
  const seen = new Set();
  return vi.fn(async (_url, init) => {
    const token = new URLSearchParams(init.body).get('response');
    const replay = seen.has(token);
    seen.add(token);
    return {
      ok: true,
      status: 200,
      json: async () =>
        replay ? { success: false, 'error-codes': ['timeout-or-duplicate'] } : { ...PASS },
    };
  });
}

const onlineAgent = () => ({
  id: 'vps-hostinger-01',
  lastSeenAt: new Date(NOW - 10_000).toISOString(),
  capabilities: ['terraform-validate'],
});

/** The in-memory store public-submit.test.js uses, cut to what these paths touch. */
function memStore({ agents = [onlineAgent()] } = {}) {
  const docs = new Map();
  const key = (container, id) => `${container}/${id}`;
  const cosmosError = (code) => Object.assign(new Error(`cosmos ${code}`), { code });
  return {
    docs,
    jobs: () => [...docs.entries()].filter(([k]) => k.startsWith('lab_jobs/')).map(([, v]) => v),
    queryDocs: vi.fn(async (container, sql) => {
      if (container === 'lab_agents') return agents;
      if (sql.includes('COUNT(1)')) return [0];
      throw new Error(`unexpected query on ${container}`);
    }),
    readDoc: vi.fn(async (container, id) => docs.get(key(container, id)) ?? null),
    upsertDoc: vi.fn(async (container, doc) => {
      docs.set(key(container, doc.id), doc);
      return doc;
    }),
    createDoc: vi.fn(async (container, doc) => {
      if (docs.has(key(container, doc.id))) throw cosmosError(409);
      docs.set(key(container, doc.id), doc);
      return doc;
    }),
    replaceDocIfMatch: vi.fn(async (container, doc) => {
      docs.set(key(container, doc.id), doc);
      return doc;
    }),
    incrementIf: vi.fn(async (container, id, { path, value, condition, conditionValues }) => {
      const doc = docs.get(key(container, id));
      if (!doc) throw cosmosError(404);
      const passes = condition.includes('windowStartMs')
        ? doc.windowStartMs > conditionValues.windowFloor && doc.count < conditionValues.limit
        : doc.count < conditionValues.limit;
      if (!passes) throw cosmosError(412);
      doc[path.slice(1)] += value;
      return doc;
    }),
  };
}

const STORE_OPS = ['queryDocs', 'readDoc', 'upsertDoc', 'createDoc', 'replaceDocIfMatch', 'incrementIf'];
const storeCalls = (store) => STORE_OPS.reduce((n, op) => n + store[op].mock.calls.length, 0);

const identity = () => ({
  anonymousKey: vi.fn(() => ({ key: 'client-hash', trusted: true })),
  trustedClientIp: vi.fn(() => CLIENT_IP),
});

const headersOf = (map) => {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower[String(name).toLowerCase()] ?? null };
};

const body = (over = {}) => ({
  type: 'terraform-validate',
  payload: 'terraform {}\n',
  payloadEncoding: 'text',
  turnstileToken: TOKEN,
  ...over,
});

const post = (value = body(), headers = { origin: SITE }) => ({
  method: 'POST',
  headers: headersOf(headers),
  text: vi.fn(async () => (typeof value === 'string' ? value : JSON.stringify(value))),
  query: new Map(),
});
const get = () => ({ method: 'GET', headers: headersOf({}), text: vi.fn(async () => ''), query: new Map() });

const newContext = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
const parse = (res) => JSON.parse(res.body);

let issued = 0;
const nextUuid = () => `00000000-0000-4000-8000-${String((issued += 1)).padStart(12, '0')}`;

function build({ env = OPEN, store = memStore(), fetch = answering({ ...PASS }), id = identity() } = {}) {
  const handlers = createPublicSubmitHandlers({
    identity: id,
    store,
    env,
    now: () => NOW,
    uuid: nextUuid,
    fetch,
  });
  return { handlers, store, fetch, id };
}

/** Everything a context was asked to log, as one string. */
const logged = (context) =>
  [...context.log.mock.calls, ...context.warn.mock.calls, ...context.error.mock.calls]
    .flat()
    .map(String)
    .join('\n');

describe('the site, and only the site', () => {
  it('reads its origins from the CORS allowlist: the apex and www, which both serve the site', () => {
    expect(LAB_SITE_ORIGINS).toEqual(PRODUCTION_ORIGINS);
    expect(LAB_SITE_ORIGINS).toEqual([SITE, WWW]);
    expect(LAB_SITE_HOSTNAMES).toEqual(['hybridcloudworks.com', 'www.hybridcloudworks.com']);
  });

  it.each([SITE, WWW])('takes %s', (origin) => {
    expect(isSiteOrigin(origin)).toBe(true);
  });

  it.each([
    ['no Origin at all', null],
    ['an empty Origin', ''],
    ["the Static Web App's preview hostname", 'https://calm-ground-0d0e6a010.7.azurestaticapps.net'],
    ['plain http', 'http://hybridcloudworks.com'],
    ['a trailing slash', 'https://hybridcloudworks.com/'],
    ['a look-alike suffix', 'https://hybridcloudworks.com.evil.example'],
    ['a subdomain that is not www', 'https://lab.hybridcloudworks.com'],
    ['upper case', 'https://HYBRIDCLOUDWORKS.COM'],
    ['an opaque origin', 'null'],
    ['a local dev server', 'http://localhost:5173'],
  ])('refuses %s', (_label, origin) => {
    expect(isSiteOrigin(origin)).toBe(false);
  });
});

describe('an origin that is not the site', () => {
  it.each([
    ['no Origin header', {}],
    ['another site', { origin: 'https://evil.example' }],
    ['the preview hostname', { origin: 'https://calm-ground-0d0e6a010.7.azurestaticapps.net' }],
  ])('refuses %s with 403 before reading the body, the store or Cloudflare', async (_label, headers) => {
    const { handlers, store, fetch } = build();
    const request = post(body(), headers);
    const res = await handlers.submitJob(request, newContext());
    expect(res.status).toBe(403);
    expect(parse(res)).toEqual({
      ok: false,
      code: 'ORIGIN_NOT_ALLOWED',
      error: LOCK_REASONS[LOCK_CODES.origin],
    });
    expect(request.text).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(storeCalls(store)).toBe(0);
  });

  it('takes a job from www as from the apex', async () => {
    const { handlers, store } = build({
      fetch: answering({ ...PASS, hostname: 'www.hybridcloudworks.com' }),
    });
    const res = await handlers.submitJob(post(body(), { origin: WWW }), newContext());
    expect(res.status).toBe(202);
    expect(store.jobs()).toHaveLength(1);
  });
});

describe('fails closed without the secret', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['an unresolved Key Vault reference, which is public text', UNRESOLVED],
  ])('treats a secret that is %s as not configured', (_label, value) => {
    expect(turnstileConfigured({ [TURNSTILE_SECRET_SETTING]: value })).toBe(false);
  });

  it('is configured by a real value', () => {
    expect(turnstileConfigured(OPEN)).toBe(true);
  });

  it('refuses a submission with 503 before the body, the origin, the store or Cloudflare', async () => {
    const { handlers, store, fetch } = build({
      env: { [PUBLIC_SUBMISSION_SWITCH]: 'true', [TURNSTILE_SECRET_SETTING]: UNRESOLVED },
    });
    const request = post(body(), {});
    const res = await handlers.submitJob(request, newContext());
    expect(res.status).toBe(503);
    expect(parse(res)).toEqual({
      ok: false,
      configured: false,
      code: 'TURNSTILE_NOT_CONFIGURED',
      error: DOOR_REASONS[DOOR_CODES.unconfigured],
    });
    expect(request.text).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(storeCalls(store)).toBe(0);
  });

  it('says so on the status read, with the bounds, and reads no store', async () => {
    const { handlers, store } = build({ env: { [PUBLIC_SUBMISSION_SWITCH]: 'true' } });
    const res = await handlers.getSubmissionStatus(get(), newContext());
    expect(res.status).toBe(200);
    expect(parse(res)).toEqual({
      configured: false,
      open: false,
      code: 'TURNSTILE_NOT_CONFIGURED',
      reason: DOOR_REASONS[DOOR_CODES.unconfigured],
      bounds: PUBLIC_BOUNDS,
    });
    expect(storeCalls(store)).toBe(0);
  });

  it('still says "switched off" first when the switch is off too', async () => {
    const { handlers } = build({ env: {} });
    const door = parse(await handlers.getSubmissionStatus(get(), newContext()));
    expect(door.code).toBe('PUBLIC_SUBMISSION_CLOSED');
  });

  it('says why a configured lab is shut: no agent', async () => {
    const { handlers } = build({ store: memStore({ agents: [] }) });
    const door = parse(await handlers.getSubmissionStatus(get(), newContext()));
    expect(door).toMatchObject({ configured: true, open: false, code: 'LAB_AGENT_OFFLINE' });
  });
});

describe('the Turnstile token', () => {
  it.each([
    ['no token', body({ turnstileToken: undefined })],
    ['an empty token', body({ turnstileToken: '' })],
    ['a blank token', body({ turnstileToken: '   ' })],
    ['a token that is not a string', body({ turnstileToken: 42 })],
  ])('refuses %s with 403 TURNSTILE_REQUIRED, asking no one', async (_label, value) => {
    const { handlers, store, fetch } = build();
    const res = await handlers.submitJob(post(value), newContext());
    expect(res.status).toBe(403);
    expect(parse(res)).toEqual({
      ok: false,
      code: 'TURNSTILE_REQUIRED',
      error: LOCK_REASONS[LOCK_CODES.required],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(storeCalls(store)).toBe(0);
  });

  it('sends siteverify the secret, the token and the trusted address, and nothing else', async () => {
    const { handlers, fetch, id } = build();
    await handlers.submitJob(post(), newContext());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [[url, init]] = fetch.mock.calls;
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      secret: SECRET,
      response: TOKEN,
      remoteip: CLIENT_IP,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(id.trustedClientIp).toHaveBeenCalledTimes(1);
  });

  it('omits remoteip when the identity trusts no address', async () => {
    const id = identity();
    id.trustedClientIp.mockReturnValue(null);
    const { handlers, fetch } = build({ id });
    expect((await handlers.submitJob(post(), newContext())).status).toBe(202);
    const params = new URLSearchParams(fetch.mock.calls[0][1].body);
    expect(params.has('remoteip')).toBe(false);
  });

  it('refuses a replayed token: tokens are single use, so the second check fails at siteverify', async () => {
    const store = memStore();
    const { handlers } = build({ store, fetch: singleUseSiteverify() });
    const first = await handlers.submitJob(post(), newContext());
    expect(first.status).toBe(202);
    const replay = await handlers.submitJob(post(), newContext());
    expect(replay.status).toBe(403);
    expect(parse(replay).code).toBe('TURNSTILE_FAILED');
    expect(store.jobs()).toHaveLength(1);
    // The replay moved no counter: the visitor's hour still holds one, and so does the day.
    expect(store.docs.get('submission_quota/lab-caller:client-hash')).toMatchObject({ count: 1 });
    expect(store.docs.get('tool_service_cache/lab-public-quota:2026-09-28')).toMatchObject({ count: 1 });
  });

  it.each([
    ['Cloudflare says no', { success: false, 'error-codes': ['invalid-input-response'] }],
    ['a token solved on another site', { ...PASS, hostname: 'evil.example' }],
    ['a token solved on a look-alike', { ...PASS, hostname: 'hybridcloudworks.com.evil.example' }],
    ['a token with no hostname', { ...PASS, hostname: undefined }],
    ['a token for another action', { ...PASS, action: 'login' }],
    ['a token with no action', { ...PASS, action: undefined }],
    ['success that is not the boolean true', { ...PASS, success: 'true' }],
  ])('refuses %s with 403 TURNSTILE_FAILED before the store', async (_label, answer) => {
    const { handlers, store } = build({ fetch: answering(answer) });
    const res = await handlers.submitJob(post(), newContext());
    expect(res.status).toBe(403);
    expect(parse(res)).toEqual({
      ok: false,
      code: 'TURNSTILE_FAILED',
      error: LOCK_REASONS[LOCK_CODES.failed],
    });
    expect(storeCalls(store)).toBe(0);
  });

  it('refuses a token longer than Turnstile issues without asking Cloudflare', async () => {
    const { handlers, store, fetch } = build();
    const res = await handlers.submitJob(post(body({ turnstileToken: 'x'.repeat(2049) })), newContext());
    expect(res.status).toBe(403);
    expect(parse(res).code).toBe('TURNSTILE_FAILED');
    expect(fetch).not.toHaveBeenCalled();
    expect(storeCalls(store)).toBe(0);
  });
});

describe('fails closed when siteverify cannot say yes', () => {
  const unreachable = (error) => vi.fn(async () => Promise.reject(error));

  it.each([
    ['a network error', unreachable(new TypeError('fetch failed'))],
    ['the five-second timeout', unreachable(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))],
    ['HTTP 500', answering({}, { ok: false, status: 500 })],
    ['HTTP 429', answering({}, { ok: false, status: 429 })],
    [
      'an answer that is not JSON',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('x')) })),
    ],
    ['a secret Cloudflare refuses', answering({ success: false, 'error-codes': ['invalid-input-secret'] })],
    ['a secret Cloudflare did not get', answering({ success: false, 'error-codes': ['missing-input-secret'] })],
    ["Cloudflare's own failure", answering({ success: false, 'error-codes': ['internal-error'] })],
  ])('answers 503 TURNSTILE_UNAVAILABLE on %s, never a pass', async (_label, fetch) => {
    const context = newContext();
    const { handlers, store } = build({ fetch });
    const res = await handlers.submitJob(post(), context);
    expect(res.status).toBe(503);
    expect(res.headers['Retry-After']).toBe('60');
    expect(parse(res)).toEqual({
      ok: false,
      code: 'TURNSTILE_UNAVAILABLE',
      error: LOCK_REASONS[LOCK_CODES.unavailable],
    });
    expect(storeCalls(store)).toBe(0);
    expect(context.warn).toHaveBeenCalled();
  });

  it('gives the request a timeout, so a slow siteverify cannot hold the function', async () => {
    let signal;
    const fetch = vi.fn(async (_url, init) => {
      signal = init.signal;
      return { ok: true, status: 200, json: async () => ({ ...PASS }) };
    });
    await verifyTurnstileToken({ fetch, secret: SECRET, token: TOKEN, timeoutMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signal.aborted).toBe(true);
  });
});

describe('what siteverify said, judged', () => {
  it('passes only success for the site and the action', () => {
    expect(judgeSiteverify({ ...PASS })).toEqual({ ok: true });
    expect(judgeSiteverify({ ...PASS, hostname: 'www.hybridcloudworks.com' })).toEqual({ ok: true });
  });

  it.each([null, undefined, 'yes', [], {}])('does not pass %j', (answer) => {
    expect(judgeSiteverify(answer).ok).toBe(false);
  });

  it('names the reason for the log, and quotes what Cloudflare reported', () => {
    expect(judgeSiteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] })).toEqual({
      ok: false,
      kind: 'failed',
      detail: 'siteverify said no (error codes: timeout-or-duplicate)',
    });
    expect(judgeSiteverify({ ...PASS, action: 'login' }).detail).toBe(
      'the token is for the action "login", not lab-validate'
    );
  });
});

describe('a token that passes reaches decision 6, unchanged', () => {
  it('queues the job, and the bounds still apply after it', async () => {
    const store = memStore();
    const { handlers } = build({ store });
    for (let i = 0; i < PUBLIC_BOUNDS.perClientPerHour; i += 1) {
      expect((await handlers.submitJob(post(body({ turnstileToken: `t-${i}` })), newContext())).status).toBe(202);
    }
    const third = await handlers.submitJob(post(body({ turnstileToken: 't-2' })), newContext());
    expect(third.status).toBe(429);
    expect(parse(third).code).toBe('LAB_RATE_LIMITED');
    expect(store.jobs()).toHaveLength(2);
    expect(store.jobs().every((job) => job.public === true && job.ttl === 86_400)).toBe(true);
  });

  it('is still refused while no agent is online, with nothing counted', async () => {
    const store = memStore({ agents: [] });
    const { handlers, fetch } = build({ store });
    const res = await handlers.submitJob(post(), newContext());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(503);
    expect(parse(res).code).toBe('LAB_AGENT_OFFLINE');
    expect(store.incrementIf).not.toHaveBeenCalled();
    expect(store.jobs()).toEqual([]);
  });

  it('still refuses an invalid body before asking Cloudflare', async () => {
    const { handlers, fetch } = build();
    const res = await handlers.submitJob(post(body({ type: 'shell-echo' })), newContext());
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('logs neither the token nor the address, whatever the outcome', async () => {
    const outcomes = [
      answering({ ...PASS }),
      answering({ ...PASS, action: 'login' }),
      answering({}, { ok: false, status: 502 }),
    ];
    for (const fetch of outcomes) {
      const context = newContext();
      const { handlers } = build({ fetch });
      await handlers.submitJob(post(), context);
      expect(logged(context)).not.toContain(TOKEN);
      expect(logged(context)).not.toContain(CLIENT_IP);
      expect(logged(context)).not.toContain(SECRET);
    }
  });
});

describe('the estate matches the lock', () => {
  const infra = terraformSource(join(REPO, 'infra'));

  it('reads the secret through a Key Vault reference, so no value is in state or in the repository', () => {
    expect(infra).toContain(
      '"TURNSTILE_SECRET_KEY" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/TURNSTILE-SECRET-KEY)"'
    );
  });

  it('has no Terraform resource for the widget, whose secret attribute would sit in state', () => {
    expect(infra).not.toMatch(/resource\s+"cloudflare_turnstile_widget"/);
  });

  it('sets the switch from its Terraform variable, as exactly "true" or "false"', () => {
    expect(infra).toContain(
      '"LABS_PUBLIC_SUBMISSION_ENABLED" = var.labs_public_submission_enabled ? "true" : "false"'
    );
  });

  it('shares the action with the widget the builder renders', () => {
    const frontend = readFileSync(join(REPO, 'frontend', 'src', 'lib', 'turnstile.js'), 'utf8');
    expect(frontend).toContain(`export const LAB_TURNSTILE_ACTION = '${LAB_TURNSTILE_ACTION}';`);
    // Cloudflare's rule for an action: up to 32 letters, digits, _ and -.
    expect(LAB_TURNSTILE_ACTION).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  it('gives the builder every door code, so each shut door says its own reason', () => {
    const rules = readFileSync(
      join(REPO, 'frontend', 'src', 'pages', 'tools', 'landingZone', 'labValidateRules.js'),
      'utf8'
    );
    for (const code of Object.values(DOOR_CODES)) expect(rules).toContain(`'${code}'`);
  });
});
