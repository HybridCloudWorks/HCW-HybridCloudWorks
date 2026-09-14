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
 * LOGGING is content-free, as in lib/newsletter/insights-handlers.js: the
 * route name, an HTTP status and the invocation id. The token is only ever in
 * an Authorization header and is never logged or returned.
 */

import { readKey } from '../ai/router.js';

export const QLTY_OWNER = 'HybridCloudWorks';
export const QLTY_PROJECT = 'HCW-HybridCloudWorks';
export const QLTY_API = 'https://api.qlty.sh';
export const QLTY_PROJECT_URL = `https://qlty.sh/gh/${QLTY_OWNER}/projects/${QLTY_PROJECT}`;
export const QLTY_ISSUES_URL = `${QLTY_PROJECT_URL}/issues`;

export const CODE_QUALITY_CACHE_MS = 10 * 60 * 1000;
export const PAGE_SIZE = 100;
export const MAX_PAGES = 50;
export const TOP_LIMIT = 10;
const REQUEST_TIMEOUT_MS = 15_000;

/** Qlty's levels, most severe first. */
export const LEVELS = Object.freeze(['high', 'medium', 'low', 'note', 'fmt']);

/** The categories that count as security: what Qlty's Security Issues metric counts. */
export const SECURITY_CATEGORIES = Object.freeze([
  'vulnerability',
  'security_hotspot',
  'secret',
  'dependency_alert',
]);

const json = (status, body, headers = {}) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const text = (value, fallback = '') => (typeof value === 'string' && value ? value : fallback);

const levelRank = (level) => {
  const index = LEVELS.indexOf(level);
  return index === -1 ? LEVELS.length : index;
};

const zeroByLevel = () => Object.fromEntries(LEVELS.map((level) => [level, 0]));

const increment = (counts, key) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/** Count `key` in `map`, keeping the most severe level seen. `seed` builds a first entry's fields. */
function tally(map, key, level, seed) {
  if (!map.has(key)) map.set(key, { key, ...seed(), level, count: 0 });
  const entry = map.get(key);
  entry.count += 1;
  if (levelRank(level) < levelRank(entry.level)) entry.level = level;
}

const topOf = (map, limit) =>
  [...map.values()]
    .sort((a, b) => b.count - a.count || levelRank(a.level) - levelRank(b.level) || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(({ key, ...rest }) => rest);

/** The only fields ever read from a Qlty issue, so nothing else can leak into the answer. */
const readIssue = (issue) => ({
  tool: text(issue?.tool, 'unknown'),
  rule: text(issue?.ruleKey, 'unknown'),
  category: text(issue?.category, 'unknown'),
  level: text(issue?.level, 'unknown'),
  path: text(issue?.location?.path),
});

/**
 * Condense Qlty issue rows into totals.
 *
 * @param {ReadonlyArray<object>} issues
 */
export function summarizeIssues(issues) {
  const byLevel = zeroByLevel();
  const byCategory = {};
  const security = { total: 0, byLevel: zeroByLevel() };
  const rules = new Map();
  const files = new Map();

  for (const { tool, rule, category, level, path } of issues.map(readIssue)) {
    increment(byLevel, level);
    increment(byCategory, category);
    if (SECURITY_CATEGORIES.includes(category)) {
      security.total += 1;
      increment(security.byLevel, level);
    }
    tally(rules, `${tool}:${rule}`, level, () => ({ tool, rule, category }));
    if (path) tally(files, path, level, () => ({ path }));
  }

  return {
    total: issues.length,
    byLevel,
    byCategory,
    security,
    topRules: topOf(rules, TOP_LIMIT),
    topFiles: topOf(files, TOP_LIMIT),
  };
}

/** Qlty's metric rows, projected to the descriptor fields and the value. */
export function pickMetrics(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => typeof row?.key === 'string' && row.value !== undefined)
    .map((row) => ({
      key: row.key,
      name: text(row.name),
      category: text(row.category),
      valueType: text(row.valueType),
      value: typeof row.value === 'number' || typeof row.value === 'string' ? row.value : null,
    }));
}

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
 * Every open issue, paged up to MAX_PAGES. `{ issues, truncated }`, or
 * `{ refusal }` holding the first failed page.
 */
async function listOpenIssues(get, base) {
  const issues = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = `page%5Blimit%5D=${PAGE_SIZE}&page%5Boffset%5D=${page * PAGE_SIZE}&status=open`;
    const listed = await get(`${base}/issues?${query}`);
    if (!listed.ok) return { refusal: listed };
    const rows = Array.isArray(listed.data?.data) ? listed.data.data : [];
    issues.push(...rows);
    if (listed.data?.meta?.hasMore !== true || rows.length === 0) return { issues, truncated: false };
  }
  return { issues, truncated: true };
}

/** Metrics and every open issue, condensed. `{ value }` or `{ refusal }`. */
async function readProject(get, at) {
  const base = `/gh/${encodeURIComponent(QLTY_OWNER)}/projects/${encodeURIComponent(QLTY_PROJECT)}`;
  const metrics = await get(`${base}/metrics`);
  if (!metrics.ok) return { refusal: metrics };
  const listed = await listOpenIssues(get, base);
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
  /** Per process: `{ at, value }` of the last successful summary. */
  let cache = null;

  const answer = (entry) =>
    json(200, { ok: true, ...entry.value, cachedAt: new Date(entry.at).toISOString() });

  /** The summary once the caller is authorised and the token is present. */
  async function fresh(route, token, context) {
    const at = now().getTime();
    if (cache && at - cache.at < CODE_QUALITY_CACHE_MS) return answer(cache);
    try {
      const read = await readProject((path) => qltyGet(fetchImpl, path, token), at);
      if (read.refusal) return refused(route, read.refusal, context);
      cache = { at, value: read.value };
      return answer(cache);
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
