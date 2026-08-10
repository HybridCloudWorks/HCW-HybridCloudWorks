/**
 * Timestamp normalization.
 *
 * The load-bearing assertions are the ISO-string ones. Ten copies of this logic
 * existed — the review counted seven — and two of them were Firestore-only,
 * which against the strings Cosmos returns scored every document 0, so every
 * comparator returned 0 and every sort silently did nothing (TODO.md T-304).
 * A single test on an ISO string would have caught it in either copy.
 *
 * The last guard in this file is what found copies eight, nine and ten.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { byNewest, toDate, toMillis } from './dateUtils.js';

const ISO = '2026-01-02T03:04:05.000Z';
const MS = Date.UTC(2026, 0, 2, 3, 4, 5);

// What Firestore handed us before the migration, and still does for documents
// written before it.
const timestamp = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

describe('toMillis', () => {
  it('reads an ISO string — the case the broken copies could not', () => {
    expect(toMillis(ISO)).toBe(MS);
  });

  it('reads a Firestore Timestamp, a Date, and epoch millis', () => {
    expect(toMillis(timestamp(MS))).toBe(MS);
    expect(toMillis(new Date(MS))).toBe(MS);
    expect(toMillis(MS)).toBe(MS);
  });

  it('reads a Timestamp-alike that only has toDate', () => {
    expect(toMillis({ toDate: () => new Date(MS) })).toBe(MS);
  });

  it('returns 0, never NaN, for absent or unparseable input', () => {
    // NaN is the dangerous answer: `NaN - NaN` is NaN, which makes a
    // comparator non-transitive, so the list order becomes arbitrary rather
    // than wrong in a visible way.
    for (const value of [null, undefined, '', 0, false, 'not-a-date', {}, []]) {
      const ms = toMillis(value);
      expect(ms).toBe(0);
      expect(Number.isNaN(ms)).toBe(false);
    }
  });

  it('returns 0 when a Timestamp-alike yields an invalid Date', () => {
    expect(toMillis({ toDate: () => new Date('nope') })).toBe(0);
    expect(toMillis({ toMillis: () => Number.NaN })).toBe(0);
    expect(toMillis({ toDate: () => null })).toBe(0);
  });
});

describe('toDate', () => {
  it('returns a Date for anything toMillis can read', () => {
    expect(toDate(ISO)?.getTime()).toBe(MS);
    expect(toDate(timestamp(MS))?.getTime()).toBe(MS);
  });

  it('returns null rather than an Invalid Date', () => {
    // Callers render this. `String(new Date(NaN))` puts "Invalid Date" on the
    // page; null lets them pick their own placeholder.
    expect(toDate('not-a-date')).toBeNull();
    expect(toDate(null)).toBeNull();
  });
});

describe('byNewest', () => {
  const older = { updatedAt: '2026-01-01T00:00:00.000Z' };
  const newer = { updatedAt: '2026-06-01T00:00:00.000Z' };

  it('sorts newest first over ISO strings', () => {
    expect([older, newer].sort(byNewest('updatedAt'))).toEqual([newer, older]);
  });

  it('is not a no-op — the defect it replaces returned 0 for every pair', () => {
    expect(byNewest('updatedAt')(older, newer)).toBeGreaterThan(0);
    expect(byNewest('updatedAt')(newer, older)).toBeLessThan(0);
  });

  it('takes the latest of several fields, not the first present', () => {
    // `||` between fields takes the first that exists, which is not the same
    // as the most recent — a document archived in January and updated in June
    // belongs above one archived in March under "newest first".
    const a = { archivedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' };
    const b = { archivedAt: '2026-03-01T00:00:00.000Z' };
    expect(byNewest('archivedAt', 'updatedAt')(a, b)).toBeLessThan(0);
  });

  it('sorts documents with no usable timestamp last', () => {
    const undated = {};
    expect([undated, newer].sort(byNewest('updatedAt'))).toEqual([newer, undated]);
  });

  it('mixes Timestamps and ISO strings in one list', () => {
    // Both forms are live in the database at once, which is the whole reason
    // this helper accepts both.
    const legacy = { updatedAt: timestamp(Date.UTC(2026, 8, 1)) };
    expect([older, legacy, newer].sort(byNewest('updatedAt'))).toEqual([legacy, newer, older]);
  });
});

describe('no copies of the helper survive', () => {
  const SRC = join(process.cwd(), 'src');
  const OWNER = join(SRC, 'lib', 'dateUtils.js');

  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry) && !/\.test\./.test(entry)) sources.push(full);
    }
  };
  walk(SRC);

  // Comments across this codebase quote the retired expressions on purpose —
  // naming what a file deliberately no longer does is the point of them. The
  // guards below must read code only. Whole-line stripping rather than a `//`
  // regex, so that `https://` inside a string survives.
  const codeOf = (file) =>
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join('\n');

  it('leaves exactly one implementation under src/', () => {
    // Seven existed. Five were correct and two were not, and nothing made the
    // difference visible — which is the argument for one of them.
    const implementations = sources.filter((file) =>
      /typeof\s+value\??\.toMillis\s*===\s*'function'/.test(codeOf(file))
    );
    expect(implementations).toEqual([OWNER]);
  });

  it('leaves no module-level redeclaration of the helper names', () => {
    // Added after the first pass missed one: the guard below looks for the
    // `toMillis` shape, and QueuePage held a ninth copy written around
    // `toDate` instead. Nothing caught it until the bundler refused the
    // redeclaration — ESLint reported zero errors on the same file.
    const offenders = sources
      .filter((file) => file !== OWNER)
      .filter((file) =>
        /^(?:function|const|let|var)\s+(toMillis|toDate|byNewest)\b/m.test(codeOf(file))
      )
      .map((file) => file.replace(SRC, ''));
    expect(offenders).toEqual([]);
  });

  it('leaves no Firestore-only millis expression anywhere', () => {
    // `?.toMillis?.() || 0` is the exact shape that scored every ISO string 0.
    const offenders = sources
      .filter((file) => /\?\.toMillis\?\.\(\)/.test(codeOf(file)))
      .map((file) => file.replace(SRC, ''));
    expect(offenders).toEqual([]);
  });
});
