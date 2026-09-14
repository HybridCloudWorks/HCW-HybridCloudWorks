/**
 * The Code and Security summary. What must hold: the role is checked before
 * anything else; an unseeded token is "not configured", not an error; totals
 * are counted across every page; the answer carries no finding text; failures
 * are not cached; and nothing but the route, status and invocation is logged.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createCodeQualityHandlers,
  summarizeIssues,
  minimalIssue,
  pickMetrics,
  CODE_QUALITY_CACHE_MS,
  MAX_PAGES,
  TIME_BUDGET_MS,
  PAGE_SIZE,
  QLTY_PROJECT_URL,
} from './qlty-summary.js';

const TOKEN = 'not-a-real-qlty-token-EXAMPLE-VALUE-FOR-TESTS';
const NOW = new Date('2026-09-14T16:00:00Z');
const SECRET_MESSAGE = 'this message text must never reach the answer';

const reply = (status, data, headers = {}) => ({
  ok: status < 300,
  status,
  headers: new Headers(headers),
  text: async () => (data === undefined ? '' : JSON.stringify(data)),
});

const issue = (overrides = {}) => ({
  id: 'i1',
  fingerprint: 'fp-secret',
  tool: 'zizmor',
  ruleKey: 'zizmor/artipacked',
  message: SECRET_MESSAGE,
  category: 'vulnerability',
  level: 'medium',
  status: 'open',
  location: { path: '.github/workflows/ci.yml', startLine: 3, endLine: 3 },
  ...overrides,
});

const METRICS = [
  { key: 'SEC', name: 'Security Rating', category: 'security', valueType: 'grade', value: 'F', description: 'x' },
  { key: 'LCOV', name: 'Line Coverage', category: 'coverage', valueType: 'percentage', value: 64.44 },
];

/** A fake Qlty: `pages` is an array of issue arrays, served by offset. */
function makeQlty({ pages = [[issue()]], metricsStatus = 200, issuesStatus = 200 } = {}) {
  const fetch = vi.fn(async (url, init) => {
    const parsed = new URL(url);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    if (parsed.pathname.endsWith('/metrics')) {
      return metricsStatus === 200 ? reply(200, { data: METRICS }) : reply(metricsStatus, { error: 'nope' });
    }
    if (parsed.pathname.endsWith('/issues')) {
      if (issuesStatus !== 200) return reply(issuesStatus, { error: 'nope' }, { 'Retry-After': '120' });
      expect(parsed.searchParams.get('status')).toBe('open');
      expect(parsed.searchParams.get('page[limit]')).toBe(String(PAGE_SIZE));
      const index = Number(parsed.searchParams.get('page[offset]')) / PAGE_SIZE;
      const rows = pages[index] ?? [];
      return reply(200, { data: rows, meta: { hasMore: index < pages.length - 1 } });
    }
    return reply(404, {});
  });
  return fetch;
}

const allow = (role) => ({
  requireRole: vi.fn(async (_req, required) => {
    const rank = { none: 0, editor: 1 };
    return rank[role] >= rank[required]
      ? { user: { oid: 'owner-oid' }, error: null }
      : { error: { status: 403, headers: {}, body: '{"ok":false,"error":"Forbidden"}' } };
  }),
});

const context = () => ({ invocationId: 'inv-1', warn: vi.fn(), error: vi.fn() });
const body = (response) => JSON.parse(response.body);

function build({ role = 'editor', env = { QLTY_API_TOKEN: TOKEN }, fetch = makeQlty(), now = () => NOW } = {}) {
  return { handlers: createCodeQualityHandlers({ guard: allow(role), env, fetch, now }), fetch };
}

describe('summarizeIssues', () => {
  it('counts by level, category and security, and ranks rules and files by count', () => {
    const summary = summarizeIssues([
      issue(),
      issue({ level: 'high', location: { path: '.github/workflows/ci.yml' } }),
      issue({ tool: 'qlty', ruleKey: 'similar-code', category: 'duplication', level: 'medium', location: { path: 'a.js' } }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.byLevel).toEqual({ high: 1, medium: 2, low: 0, note: 0, fmt: 0 });
    expect(summary.unclassified).toBe(0);
    expect(summary.byCategory).toEqual({ vulnerability: 2, duplication: 1 });
    expect(summary.security).toEqual({ total: 2, byLevel: { high: 1, medium: 1, low: 0, note: 0, fmt: 0 } });
    expect(summary.topRules[0]).toEqual({
      tool: 'zizmor',
      rule: 'zizmor/artipacked',
      category: 'vulnerability',
      level: 'high',
      count: 2,
    });
    expect(summary.topFiles[0]).toEqual({ path: '.github/workflows/ci.yml', level: 'high', count: 2 });
  });

  it('keeps the level objects to the five known keys when Qlty sends another level', () => {
    const summary = summarizeIssues([issue({ level: 'critical' }), issue({ level: 'high' })]);
    expect(summary.total).toBe(2);
    expect(summary.unclassified).toBe(1);
    expect(summary.byLevel).toEqual({ high: 1, medium: 0, low: 0, note: 0, fmt: 0 });
    expect(summary.security.byLevel).toEqual({ high: 1, medium: 0, low: 0, note: 0, fmt: 0 });
    expect(summary.security.total).toBe(2);
  });

  it('drops message, fingerprint and lines from each issue as it arrives', () => {
    expect(minimalIssue(issue())).toEqual({
      tool: 'zizmor',
      ruleKey: 'zizmor/artipacked',
      category: 'vulnerability',
      level: 'medium',
      location: { path: '.github/workflows/ci.yml' },
    });
  });

  it('carries no message, fingerprint or line text', () => {
    const serialized = JSON.stringify(summarizeIssues([issue()]));
    expect(serialized).not.toContain(SECRET_MESSAGE);
    expect(serialized).not.toContain('fp-secret');
  });
});

describe('pickMetrics', () => {
  it('keeps the descriptor and value, and drops everything else', () => {
    expect(pickMetrics(METRICS)).toEqual([
      { key: 'SEC', name: 'Security Rating', category: 'security', valueType: 'grade', value: 'F' },
      { key: 'LCOV', name: 'Line Coverage', category: 'coverage', valueType: 'percentage', value: 64.44 },
    ]);
    expect(pickMetrics(null)).toEqual([]);
  });
});

describe('GET cms/code-quality', () => {
  it('checks the role before reading the token or calling Qlty', async () => {
    const { handlers, fetch } = build({ role: 'none' });
    const response = await handlers.summary({}, context());
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says not configured, without calling Qlty, when the token is unseeded', async () => {
    for (const env of [{}, { QLTY_API_TOKEN: '@Microsoft.KeyVault(SecretUri=https://x/secrets/QLTY-API-TOKEN)' }]) {
      const { handlers, fetch } = build({ env });
      const response = await handlers.summary({}, context());
      expect(response.status).toBe(200);
      expect(body(response)).toMatchObject({ ok: false, code: 'INTEGRATION_NOT_CONFIGURED', projectUrl: QLTY_PROJECT_URL });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('counts every page, returns the metrics, and never returns the token or finding text', async () => {
    const fetch = makeQlty({ pages: [Array.from({ length: PAGE_SIZE }, () => issue()), [issue({ level: 'low' })]] });
    const { handlers } = build({ fetch });
    const response = await handlers.summary({}, context());
    const answer = body(response);
    expect(response.status).toBe(200);
    expect(answer).toMatchObject({ ok: true, total: PAGE_SIZE + 1, truncated: false, fetchedAt: NOW.toISOString() });
    expect(answer.metrics.map((metric) => metric.key)).toEqual(['SEC', 'LCOV']);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(response.body).not.toContain(TOKEN);
    expect(response.body).not.toContain(SECRET_MESSAGE);
  });

  it('stops at the page cap, says so, and caches it, since a retry would hit the same cap', async () => {
    const pages = Array.from({ length: MAX_PAGES + 5 }, () => [issue()]);
    const fetch = makeQlty({ pages });
    const { handlers } = build({ fetch });
    const answer = body(await handlers.summary({}, context()));
    expect(answer.truncated).toBe('pages');
    expect(answer.total).toBe(MAX_PAGES);
    expect(fetch).toHaveBeenCalledTimes(MAX_PAGES + 1);

    const calls = fetch.mock.calls.length;
    const again = body(await handlers.summary({}, context()));
    expect(fetch.mock.calls.length).toBe(calls);
    expect(again.truncated).toBe('pages');
  });

  it('stops starting pages when the time budget runs out, and does not cache the partial answer', async () => {
    let clock = NOW.getTime();
    const pages = Array.from({ length: 10 }, () => [issue()]);
    const qlty = makeQlty({ pages });
    // Each Qlty call takes 20 s of the budget.
    const fetch = vi.fn(async (...args) => {
      clock += 20_000;
      return qlty(...args);
    });
    const { handlers } = build({ fetch, now: () => new Date(clock) });

    const answer = body(await handlers.summary({}, context()));
    expect(answer).toMatchObject({ ok: true, truncated: 'time' });
    // Metrics ends at 20 s, page 1 at 40 s, page 2 at 60 s; with the 60 s
    // budget spent, page 3 is never started.
    expect(TIME_BUDGET_MS).toBe(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(answer.total).toBe(2);

    const calls = fetch.mock.calls.length;
    await handlers.summary({}, context());
    expect(fetch.mock.calls.length).toBeGreaterThan(calls);
  });

  it('serves a success from cache for ten minutes, then reads Qlty again', async () => {
    let clock = NOW.getTime();
    const fetch = makeQlty();
    const { handlers } = build({ fetch, now: () => new Date(clock) });
    await handlers.summary({}, context());
    const calls = fetch.mock.calls.length;

    clock += CODE_QUALITY_CACHE_MS - 1;
    const cached = body(await handlers.summary({}, context()));
    expect(fetch.mock.calls.length).toBe(calls);
    expect(cached.cachedAt).toBe(NOW.toISOString());

    clock += 2;
    await handlers.summary({}, context());
    expect(fetch.mock.calls.length).toBe(calls * 2);
  });

  it('reports a Qlty refusal as 502 with the status only, logs no content, and does not cache it', async () => {
    const ctx = context();
    const fetch = makeQlty({ metricsStatus: 401 });
    const { handlers } = build({ fetch });
    const response = await handlers.summary({}, ctx);
    expect(response.status).toBe(502);
    expect(body(response)).toEqual({ ok: false, status: 401, error: 'Qlty answered 401' });
    expect(ctx.warn).toHaveBeenCalledWith('codeQualitySummary Qlty HTTP 401 [invocation inv-1]');
    await handlers.summary({}, context());
    expect(fetch.mock.calls.length).toBe(2);
  });

  it('passes a rate limit through as 429 with Retry-After', async () => {
    const { handlers } = build({ fetch: makeQlty({ issuesStatus: 429 }) });
    const response = await handlers.summary({}, context());
    expect(response.status).toBe(429);
    expect(response.headers['Retry-After']).toBe('120');
    expect(body(response)).toMatchObject({ ok: false, status: 429, retryAfterSeconds: 120 });
  });

  it('logs only the error name when the network fails', async () => {
    const ctx = context();
    const fetch = vi.fn(async () => {
      throw Object.assign(new Error(`connect failed ${TOKEN}`), { name: 'TypeError' });
    });
    const { handlers } = build({ fetch });
    const response = await handlers.summary({}, ctx);
    expect(response.status).toBe(500);
    expect(ctx.error).toHaveBeenCalledWith('codeQualitySummary failed TypeError [invocation inv-1]');
    expect(response.body).not.toContain(TOKEN);
  });
});
