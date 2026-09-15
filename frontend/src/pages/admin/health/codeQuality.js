/**
 * The Code and Security tab's pure half (#569): reading the summary that
 * `GET cms/code-quality` answers, and the report lines built from it.
 *
 * The route answers counts, rule keys, levels, categories, file paths and
 * Qlty's metric values only — never an issue's message or snippet — so
 * nothing here has finding text to show, and nothing here invents any.
 */

/** Qlty's levels, worst first. The route always sends exactly these keys. */
export const LEVELS = Object.freeze(['high', 'medium', 'low', 'note', 'fmt']);

/**
 * The tiles, by metric key. A grade tile may carry a percentage beside its
 * grade (Coverage: `COV` grade and `LCOV` line coverage); a percent tile is
 * the number alone.
 */
export const METRIC_TILES = Object.freeze([
  { label: 'Maintainability', grade: 'MNT' },
  { label: 'Security', grade: 'SEC' },
  { label: 'Coverage', grade: 'COV', percent: 'LCOV' },
  { label: 'Duplication', percent: 'DUP' },
  { label: 'Technical debt', percent: 'TDR' },
]);

export const NOT_CONFIGURED_CODE = 'INTEGRATION_NOT_CONFIGURED';

/** The metric row with this key, or null. Tolerates a missing or odd list. */
export function findMetric(metrics, key) {
  if (!key || !Array.isArray(metrics)) return null;
  return metrics.find((row) => row?.key === key) ?? null;
}

/** A metric value as a percentage string, or null when it is not a number. */
export function formatPercent(value) {
  const number = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return null;
  return `${Number.isInteger(number) ? number : number.toFixed(1)}%`;
}

/** A grade letter, or null when the metric is absent or not a string. */
export function gradeOf(metric) {
  return typeof metric?.value === 'string' && metric.value.trim() ? metric.value.trim() : null;
}

/** Each tile with its grade and percentage read out, null where Qlty gave none. */
export function readTiles(metrics) {
  return METRIC_TILES.map((tile) => ({
    label: tile.label,
    grade: tile.grade ? gradeOf(findMetric(metrics, tile.grade)) : null,
    percent: tile.percent ? formatPercent(findMetric(metrics, tile.percent)?.value) : null,
  }));
}

/** Only an https link leaves this page; anything else is dropped. */
export function safeHref(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
}

const count = (value) => (Number.isFinite(value) ? value : 0);

/** `high 1, medium 2, low 0, note 0, fmt 0` for a by-level object. */
export function levelSummary(byLevel) {
  return LEVELS.map((level) => `${level} ${count(byLevel?.[level])}`).join(', ');
}

/** Category rows, largest first, ties by name so the order is stable. */
export function categoryRows(byCategory) {
  if (!byCategory || typeof byCategory !== 'object') return [];
  return Object.entries(byCategory)
    .map(([name, value]) => ({ name, count: count(value) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const TRUNCATED_NOTES = Object.freeze({
  pages: 'Qlty has more open issues than the 50-page read limit, so these totals are a floor.',
  time: 'Qlty was slow and the read stopped at its time budget, so these totals are a floor.',
});

/** The warning for a cut-short read, or null for a complete one. */
export function truncatedNote(truncated) {
  return TRUNCATED_NOTES[truncated] ?? null;
}

const tileText = ({ label, grade, percent }) => {
  const parts = [grade, grade && percent ? `(${percent})` : percent].filter(Boolean);
  return `${label} ${parts.length ? parts.join(' ') : 'n/a'}`;
};

function successReportLines(data) {
  const unclassified = count(data.unclassified) > 0 ? `, unclassified ${data.unclassified}` : '';
  const rules = (Array.isArray(data.topRules) ? data.topRules : []).slice(0, 5);
  const note = truncatedNote(data.truncated);
  return [
    '### Code and Security — Qlty',
    '',
    `- As of: ${data.fetchedAt || data.cachedAt || 'unknown'}`,
    `- Grades: ${readTiles(data.metrics).map(tileText).join(', ')}`,
    `- Open issues: ${count(data.total)} (${levelSummary(data.byLevel)}${unclassified})`,
    `- Security issues: ${count(data.security?.total)} (${levelSummary(data.security?.byLevel)})`,
    ...(note ? [`- Note: ${note}`] : []),
    '- Top rules:',
    ...(rules.length
      ? rules.map((row) => `  - ${row.tool}:${row.rule} (${row.level}) — ${count(row.count)}`)
      : ['  - none']),
  ];
}

/**
 * The report's Code and Security section: the summary when the tab's read
 * landed in this session, and one line saying so when it did not.
 */
export function codeQualityReportLines(data) {
  if (data?.ok !== true) return ['Code and Security: not loaded in this session.'];
  return successReportLines(data);
}

/** The diagnostics report with the Code and Security section appended. */
export function withCodeQuality(report, data) {
  return [report, '', ...codeQualityReportLines(data)].join('\n');
}
