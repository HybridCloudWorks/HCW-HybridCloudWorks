/**
 * Counting for the Code and Security summary (#569), split from
 * qlty-summary.js so the HTTP handler and the arithmetic each stay small.
 *
 * Pure functions: Qlty issue rows in, totals out. The only fields ever read
 * from an issue are tool, rule key, category, level and path, and
 * `minimalIssue` drops everything else as each page arrives, so a message,
 * snippet or fingerprint is never cached, returned or logged.
 */

export const TOP_LIMIT = 10;

/** Qlty's levels, most severe first. */
export const LEVELS = Object.freeze(['high', 'medium', 'low', 'note', 'fmt']);

/** The categories that count as security: what Qlty's Security Issues metric counts. */
export const SECURITY_CATEGORIES = Object.freeze([
  'vulnerability',
  'security_hotspot',
  'secret',
  'dependency_alert',
]);

const text = (value, fallback = '') => (typeof value === 'string' && value ? value : fallback);

const levelRank = (level) => {
  const index = LEVELS.indexOf(level);
  return index === -1 ? LEVELS.length : index;
};

const zeroByLevel = () => Object.fromEntries(LEVELS.map((level) => [level, 0]));

const increment = (counts, key) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/** Count a level into a fixed `{high, medium, low, note, fmt}` object. False for a level outside LEVELS. */
const countLevel = (byLevel, level) => {
  if (!LEVELS.includes(level)) return false;
  byLevel[level] += 1;
  return true;
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

/**
 * The only fields kept from a Qlty issue, applied as each page arrives. Each
 * page's body is parsed whole before this runs, so the promise is about what
 * survives it: a message, snippet or fingerprint is never kept across pages,
 * cached, returned or logged.
 */
export const minimalIssue = (issue) => ({
  tool: issue?.tool,
  ruleKey: issue?.ruleKey,
  category: issue?.category,
  level: issue?.level,
  location: { path: issue?.location?.path },
});

const readIssue = (issue) => ({
  tool: text(issue?.tool, 'unknown'),
  rule: text(issue?.ruleKey, 'unknown'),
  category: text(issue?.category, 'unknown'),
  level: text(issue?.level, 'unknown'),
  path: text(issue?.location?.path),
});

/**
 * Condense Qlty issue rows into totals. `byLevel` and `security.byLevel`
 * always have exactly the five LEVELS keys; an issue whose level Qlty reports
 * outside them is counted in `total` and `unclassified` instead.
 *
 * @param {ReadonlyArray<object>} issues
 */
export function summarizeIssues(issues) {
  const byLevel = zeroByLevel();
  const byCategory = {};
  const security = { total: 0, byLevel: zeroByLevel() };
  let unclassified = 0;
  const rules = new Map();
  const files = new Map();

  for (const { tool, rule, category, level, path } of issues.map(readIssue)) {
    if (!countLevel(byLevel, level)) unclassified += 1;
    increment(byCategory, category);
    if (SECURITY_CATEGORIES.includes(category)) {
      security.total += 1;
      countLevel(security.byLevel, level);
    }
    tally(rules, `${tool}:${rule}`, level, () => ({ tool, rule, category }));
    if (path) tally(files, path, level, () => ({ path }));
  }

  return {
    total: issues.length,
    byLevel,
    unclassified,
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

/** Exported for the handler, which reports an error name with a fallback. */
export { text };
