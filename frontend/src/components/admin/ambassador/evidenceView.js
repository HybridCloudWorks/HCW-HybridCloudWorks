/**
 * The Evidence tab's pure rules (ADR 0033 §4): the four filters and the
 * years on offer. No React, so evidenceView.test.js pins them without a DOM.
 */
import { evidenceRelevant } from './ambassadorModel';

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
