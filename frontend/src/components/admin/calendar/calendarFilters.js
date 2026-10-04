/**
 * The Calendar toolbar's narrowing rules (ADR 0033 §4, split out of
 * calendarModel.js in PR #841 so each module stays readable): which items the
 * filters keep, and which channels the items name for the filter list.
 */

const channelNamesOf = (item) =>
  [item.meta?.provider, ...(item.meta?.platforms || [])].filter(Boolean).map(String);

/** True when `item` names a channel containing `needle` (already lower-cased). */
const matchesChannel = (item, needle) =>
  channelNamesOf(item).some((name) => name.toLowerCase().includes(needle));

/**
 * Items narrowed by the toolbar's filters. `kinds` empty means every kind;
 * `status` '' means every status; `channel` matches a social platform, a
 * content provider or a Listen & Learn provider, case-insensitively.
 */
export function applyFilters(items, { kinds = [], status = '', channel = '' } = {}) {
  const wantedKinds = new Set(kinds);
  const needle = channel.trim().toLowerCase();
  const keepKind = (item) => wantedKinds.size === 0 || wantedKinds.has(item.kind);
  const keepStatus = (item) => !status || String(item.status) === status;
  const keepChannel = (item) => !needle || matchesChannel(item, needle);
  return (items || []).filter((item) => keepKind(item) && keepStatus(item) && keepChannel(item));
}

/** Every distinct channel the items name, for the filter list. */
export function channelsOf(items) {
  const set = new Set();
  for (const item of items || []) {
    for (const name of channelNamesOf(item)) set.add(name);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
