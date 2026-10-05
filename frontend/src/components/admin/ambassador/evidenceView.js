/**
 * The Evidence tab's pure rules (ADR 0033 §4): the four filters, the years
 * on offer, the Group by control's groups, the collapsed state each group
 * remembers in localStorage, and the guide rows that say what each program
 * still needs. No React, so evidenceView.test.js pins them without a DOM.
 */
import { EVIDENCE_SOURCES, evidenceRelevant, sourceLabel } from './ambassadorModel';

/** Every filter off: the whole library. */
export const EMPTY_EVIDENCE_FILTERS = Object.freeze({
  source: '',
  program: '',
  year: '',
  verification: '',
});

/** What an item must satisfy for each filter that is set. */
const MATCHERS = Object.freeze({
  source: (item, value) => item.sourceModule === value,
  program: (item, value) => evidenceRelevant(item, value),
  year: (item, value) => String(item.date || '').startsWith(value),
  verification: (item, value) => (item.verificationStatus || 'unverified') === value,
});

/** The items that satisfy every filter that is set; an unset filter keeps everything. */
export function filterEvidence(evidence, filters) {
  const active = Object.entries(filters).filter(([, value]) => value);
  return (evidence || []).filter((item) =>
    active.every(([key, value]) => MATCHERS[key](item, value))
  );
}

export const anyFilterSet = (filters) => Object.values(filters).some(Boolean);

/** The years the dated items span, newest first, for the Period filter. */
export function yearsOf(evidence) {
  const years = (evidence || [])
    .map((item) => String(item.date || '').slice(0, 4))
    .filter((year) => /^\d{4}$/.test(year));
  return [...new Set(years)].sort().reverse();
}

// ── Group by ──────────────────────────────────────────────────────────────────

/** The Group by control's choices, None first. */
export const GROUP_BY_OPTIONS = Object.freeze([
  ['', 'None'],
  ['source', 'Source'],
  ['program', 'Program'],
  ['year', 'Year'],
  ['verification', 'Verification'],
]);

const EVERY_PROGRAM = Object.freeze({ key: 'every', label: 'Every program' });
const UNDATED = Object.freeze({ key: 'undated', label: 'Undated' });

/** The group(s) one item belongs to; an item naming several programs is in each. */
const GROUPERS = Object.freeze({
  source: (item) => [{ key: item.sourceModule || 'manual', label: sourceLabel(item.sourceModule) }],
  program: (item, { byId }) => {
    const ids = Array.isArray(item.programIds) ? item.programIds : [];
    return ids.length === 0
      ? [EVERY_PROGRAM]
      : ids.map((id) => ({ key: id, label: byId?.get(id)?.name || id }));
  },
  year: (item) => {
    const year = String(item.date || '').slice(0, 4);
    return [/^\d{4}$/.test(year) ? { key: year, label: year } : UNDATED];
  },
  verification: (item) => {
    const verified = item.verificationStatus === 'verified';
    return [
      { key: verified ? 'verified' : 'unverified', label: verified ? 'Verified' : 'Unverified' },
    ];
  },
});

const isEvery = (group) => group.key === EVERY_PROGRAM.key;
const isUndated = (group) => group.key === UNDATED.key;

/** Group order: sources as the picker lists them, Every program first, years newest first, verified first. */
const ORDERS = Object.freeze({
  source: (a, b) => EVIDENCE_SOURCES.indexOf(a.key) - EVIDENCE_SOURCES.indexOf(b.key),
  program: (a, b) => Number(isEvery(b)) - Number(isEvery(a)) || a.label.localeCompare(b.label),
  year: (a, b) => Number(isUndated(a)) - Number(isUndated(b)) || b.key.localeCompare(a.key),
  verification: (a) => (a.key === 'verified' ? -1 : 1),
});

/**
 * The filtered items as `[{ key, label, items }]` for the chosen grouping;
 * no grouping is one group holding everything.
 */
export function groupEvidence(rows, groupBy, { byId } = {}) {
  const grouper = GROUPERS[groupBy];
  if (!grouper) return [{ key: 'all', label: 'All evidence', items: rows || [] }];
  const groups = new Map();
  for (const item of rows || []) {
    for (const { key, label } of grouper(item, { byId })) {
      if (!groups.has(key)) groups.set(key, { key, label, items: [] });
      groups.get(key).items.push(item);
    }
  }
  return [...groups.values()].sort(ORDERS[groupBy]);
}

// ── collapsed groups, remembered per browser ──────────────────────────────────

export const COLLAPSED_GROUPS_KEY = 'ambassador.evidence.collapsed';

/** The storage key of one group's collapsed flag. */
export const groupStateKey = (groupBy, key) => `${groupBy}:${key}`;

const storageOf = (storage) => (storage === undefined ? globalThis.localStorage : storage);

/** `{ [groupStateKey]: true }` as last saved; `{}` when storage is absent, blocked or holds junk. */
export function readCollapsedGroups(storage) {
  try {
    const parsed = JSON.parse(storageOf(storage)?.getItem(COLLAPSED_GROUPS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Save the collapsed flags; false when storage refused, which the tab shrugs off. */
export function writeCollapsedGroups(collapsed, storage) {
  try {
    const target = storageOf(storage);
    if (!target) return false;
    target.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(collapsed));
    return true;
  } catch {
    return false;
  }
}

// ── the guide: what each program still needs ──────────────────────────────────

function unitWord(unit, n) {
  if (unit === 'credits') return 'credits';
  return n === 1 ? 'item' : 'items';
}

/**
 * One row per requirement of `program`, from the readiness the API computed
 * for it: `have / need` in the program's unit, and when short a one-line
 * hint naming the evidence types that would count plus the source the Add
 * button should open the editor with.
 */
export function guideRows(program, readiness) {
  if (!program || !Array.isArray(readiness?.requirements)) return [];
  const unit = readiness.unit === 'credits' ? 'credits' : 'items';
  const byId = new Map((program.requirements || []).map((req) => [req.id, req]));
  return readiness.requirements.map((row) => {
    const types = byId.get(row.id)?.evidenceTypes || [];
    const short = Math.max(0, (Number(row.minCount) || 0) - (Number(row.count) || 0));
    const from = types.map(sourceLabel).join(', ') || 'any source';
    return {
      id: row.id,
      label: row.label,
      have: Number(row.count) || 0,
      need: Number(row.minCount) || 0,
      unit,
      met: short === 0,
      short,
      hint: short > 0 ? `${short} more ${unitWord(unit, short)} from ${from}` : '',
      addSource: types[0] || 'manual',
    };
  });
}
