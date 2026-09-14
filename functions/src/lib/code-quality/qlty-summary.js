/**
 * The Health Hub's Code and Security summary (#569): Qlty's open issues and
 * project metrics for this repository, read server-side and condensed.
 *
 * WHAT LEAVES THIS MODULE. Counts, rule keys, levels, categories, file paths
 * and Qlty's own metric values. Never an issue's message, snippet or
 * fingerprint: the page shows where the findings are and how many, and Qlty's
 * project page is one link away for the rest.
 *
 * WHY IT PAGES. Qlty's API has no totals endpoint, so the totals are counted
 * from `GET .../issues?status=open` 100 at a time, up to MAX_PAGES (a cap, so a
 * runaway project cannot hold the request open; `truncated` says it was hit).
 * About 14 pages today against a 5,000-an-hour rate limit, and the answer is
 * cached per process for CODE_QUALITY_CACHE_MS, successes only, so a page left
 * open and refreshed does not spend the limit.
 *
 * WHY IT HAS A TIME BUDGET. Pages are sequential, each with its own 15 s
 * timeout, so a slow Qlty could hold the request far past the platform's HTTP
 * limit and the caller would see only a gateway timeout. After TIME_BUDGET_MS
 * no further page is started: the counts so far are returned with
 * `truncated: 'time'`, and that partial answer is not cached, so the next load
 * tries again.
 *
 * LOGGING is content-free, as in lib/newsletter/insights-handlers.js: the
 * route name, an HTTP status and the invocation id. The token is only ever in
 * an Authorization header and is never logged or returned.
 */

import { readKey } from '../ai/router.js';
import { minimalIssue, pickMetrics, summarizeIssues, text } from './qlty-aggregate.js';

export {
  LEVELS,
  SECURITY_CATEGORIES,
  TOP_LIMIT,
  minimalIssue,
  pickMetrics,
  summarizeIssues,
} from './qlty-aggregate.js';

export const QLTY_OWNER = 'HybridCloudWorks';
export const QLTY_PROJECT = 'HCW-HybridCloudWorks';
export const QLTY_API = 'https://api.qlty.sh';
export const QLTY_PROJECT_URL = `https://qlty.sh/gh/${QLTY_OWNER}/projects/${QLTY_PROJECT}`;
export const QLTY_ISSUES_URL = `${QLTY_PROJECT_URL}/issues`;

export const CODE_QUALITY_CACHE_MS = 10 * 60 * 1000;
export const PAGE_SIZE = 100;
export const MAX_PAGES = 50;
export const TIME_BUDGET_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

const json = (status, body, headers = {}) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const ref = (context) => `[invocation ${context?.invocationId ?? 'unknown'}]`;

const parseJson = (body) => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/** One authenticated GET. Resolves `{ ok, status, retryAfter, data }`; never throws for an HTTP status. */
async function qltyGet(fetchImpl, path, token) {
  const response = await fetchImpl(`${QLTY_API}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return {
    ok: response.ok,
    status: response.status,
    retryAfter: response.headers?.get?.('retry-after') ?? null,
    data: parseJson(await response.text()),
  };
}

/** A Qlty refusal as an HTTP answer. Logs the route, status and invocation only. */
function refused(route, result, context) {
  const status = result?.status ?? 0;
  context.warn?.(`${route} Qlty HTTP ${status} ${ref(context)}`);
  const error = status ? `Qlty answered ${status}` : 'No answer from Qlty';
  if (status !== 429) return json(502, { ok: false, status, error });
  const seconds = Number.parseInt(String(result?.retryAfter ?? ''), 10);
  const retryAfterSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 60;
  return json(429, { ok: false, status, retryAfterSeconds, error }, { 'Retry-After': String(retryAfterSeconds) });
}

/**
 * Every open issue, paged up to MAX_PAGES and while `outOfTime()` is false.
 * `{ issues, truncated: false | 'pages' | 'time' }`, or `{ refusal }` holding
 * the first failed page.
 */
async function listOpenIssues(get, base, outOfTime) {
  const issues = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (page > 0 && outOfTime()) return { issues, truncated: 'time' };
    const query = `page%5Blimit%5D=${PAGE_SIZE}&page%5Boffset%5D=${page * PAGE_SIZE}&status=open`;
    const listed = await get(`${base}/issues?${query}`);
    if (!listed.ok) return { refusal: listed };
    const rows = Array.isArray(listed.data?.data) ? listed.data.data : [];
    issues.push(...rows.map(minimalIssue));
    if (listed.data?.meta?.hasMore !== true || rows.length === 0) return { issues, truncated: false };
  }
  return { issues, truncated: 'pages' };
}

/** Metrics and every open issue, condensed. `{ value }` or `{ refusal }`. */
async function readProject(get, at, outOfTime) {
  const base = `/gh/${encodeURIComponent(QLTY_OWNER)}/projects/${encodeURIComponent(QLTY_PROJECT)}`;
  const metrics = await get(`${base}/metrics`);
  if (!metrics.ok) return { refusal: metrics };
  const listed = await listOpenIssues(get, base, outOfTime);
  if (listed.refusal) return listed;
  return {
    value: {
      projectUrl: QLTY_PROJECT_URL,
      issuesUrl: QLTY_ISSUES_URL,
      metrics: pickMetrics(metrics.data?.data),
      ...summarizeIssues(listed.issues),
      truncated: listed.truncated,
      fetchedAt: new Date(at).toISOString(),
    },
  };
}

const NOT_CONFIGURED = Object.freeze({
  ok: false,
  code: 'INTEGRATION_NOT_CONFIGURED',
  error: 'Qlty is not configured: QLTY_API_TOKEN is not set',
  projectUrl: QLTY_PROJECT_URL,
});

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {Record<string,string|undefined>} [deps.env]
 * @param {typeof fetch} [deps.fetch]
 * @param {() => Date} [deps.now]
 */
export function createCodeQualityHandlers({
  guard,
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  /** Per process: `{ at, value }` of the last complete summary. */
  let cache = null;

  const answer = (entry) =>
    json(200, { ok: true, ...entry.value, cachedAt: new Date(entry.at).toISOString() });

  /** The summary once the caller is authorised and the token is present. */
  async function fresh(route, token, context) {
    const at = now().getTime();
    if (cache && at - cache.at < CODE_QUALITY_CACHE_MS) return answer(cache);
    try {
      const outOfTime = () => now().getTime() - at >= TIME_BUDGET_MS;
      const read = await readProject((path) => qltyGet(fetchImpl, path, token), at, outOfTime);
      if (read.refusal) return refused(route, read.refusal, context);
      const entry = { at, value: read.value };
      // Only a time-truncated answer is left uncached: a slow Qlty may be fast
      // on the next load. A page-cap answer is cached, because retrying gives
      // the same cut-off and would spend MAX_PAGES + 1 calls on every load.
      if (read.value.truncated !== 'time') cache = entry;
      return answer(entry);
    } catch (error) {
      context.error?.(`${route} failed ${text(error?.name, 'Error')} ${ref(context)}`);
      return json(500, { ok: false, error: 'The Code and Security request failed.' });
    }
  }

  return {
    /** EDITOR. `GET cms/code-quality`: the condensed summary, cached. */
    async summary(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth?.error) return auth.error;
      const token = readKey(env, 'QLTY_API_TOKEN');
      return token ? fresh('codeQualitySummary', token, context) : json(200, NOT_CONFIGURED);
    },
  };
}
