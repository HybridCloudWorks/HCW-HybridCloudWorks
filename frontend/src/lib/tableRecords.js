/**
 * Frozen records from a compact table (PR #841): the column names once, then
 * one row per record. A list of a few labelled choices — start modes, groups,
 * channels — reads as a table, and writing it as one keeps the labels aligned
 * instead of repeating the same three keys on every entry.
 */

/**
 * @template T
 * @param {ReadonlyArray<string>} columns the key each cell lands under
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} rows one row per record, cells in column order
 * @returns {ReadonlyArray<T>} frozen records, in row order
 */
export function recordsFrom(columns, rows) {
  const toRecord = (row) =>
    Object.freeze(Object.fromEntries(columns.map((column, index) => [column, row[index]])));
  return Object.freeze(rows.map(toRecord));
}
