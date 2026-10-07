#!/usr/bin/env node
/**
 * check-drill-age.mjs — is the last Cosmos restore drill recent enough?
 *
 * The recovery objectives (RTO 8 hours, RPO 24 hours; ADR 0011, amendment of
 * 2026-10-06) are only as true as the last time a restore was timed. The
 * estate review of 2026-10-06 (finding PLAT-1) found the Drills table in
 * docs/runbooks/cosmos-restore.md empty and nothing that would ever notice:
 * a quarterly drill that is skipped once is skipped forever, because the
 * table does not complain. This is the complaint.
 *
 * It reads the Drills table at the end of that runbook, takes the newest
 * row whose Date cell is a real `YYYY-MM-DD`, and exits:
 *
 *   0  the newest drill is at most 100 days old (a quarter plus ten days);
 *   1  it is older, or there is no dated row at all;
 *   2  the table could not be read: no `## Drills` heading, no table under
 *      it with a `Date` column first, or a Date cell that is neither a
 *      placeholder (`—`) nor a real, past calendar date. A typo is "cannot
 *      evaluate", never "no drill" and never "fine", for the reason
 *      .claude/CLAUDE.md gives: a check that cannot run has not run.
 *
 * Fenced code blocks are skipped, so the example row the runbook shows
 * inside one is never read as a drill.
 *
 * .github/workflows/check-drill-age.yml runs it every Monday and turns a
 * non-zero exit into an issue. The table was empty when this was written,
 * so its first run fails on purpose: the fix is the drill, not this script.
 *
 * Usage: node scripts/check-drill-age.mjs [--runbook <file>] [--today YYYY-MM-DD]
 *          [--max-age-days <n>] [--summary <file>]
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RUNBOOK = join(REPO, 'docs', 'runbooks', 'cosmos-restore.md');
export const RUNBOOK_LABEL = 'docs/runbooks/cosmos-restore.md';
export const MAX_AGE_DAYS = 100;
const DAY_MS = 86_400_000;

/** Cells that mark a row as "no drill yet" rather than a drill. */
const PLACEHOLDERS = new Set(['', '—', '–', '-']);

/** A table problem the script cannot evaluate past: exit 2. */
export class DrillTableError extends Error {}

/** `| a | b |` -> ['a', 'b']. */
export function cells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

const isSeparator = (row) => row.length > 0 && row.every((c) => /^:?-{3,}:?$/.test(c));

/**
 * The data rows of the Drills table: the first Markdown table under the
 * `## Drills` heading whose first header cell is `Date`, outside any fenced
 * code block. Throws DrillTableError when there is none.
 */
export function drillRows(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Drills\s*$/.test(l));
  if (start === -1) throw new DrillTableError('no "## Drills" heading');

  let fenced = false;
  let table = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (/^#{1,2}\s/.test(line)) break;
    const isRow = line.trim().startsWith('|');
    if (table) {
      if (!isRow) break;
      table.push(line);
      continue;
    }
    if (isRow && cells(line)[0] === 'Date' && isSeparator(cells(lines[i + 1] ?? ''))) {
      table = [];
      i += 1;
    }
  }
  if (!table) throw new DrillTableError('no table with "Date" as its first column under "## Drills"');
  return table.map((line) => ({ line, cells: cells(line) }));
}

/** `2026-10-20` -> its UTC midnight in ms, or null when it is not a real date. */
export function parseDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

/** Today's UTC date as `YYYY-MM-DD`. */
export function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * The verdict for a runbook's text on a given day.
 *
 * Returns { status: 'current' | 'stale' | 'none', newest, ageDays, drills }.
 * Throws DrillTableError for a table it cannot read.
 */
export function evaluate(markdown, { today, maxAgeDays = MAX_AGE_DAYS } = {}) {
  const todayMs = parseDate(today);
  if (todayMs === null) throw new DrillTableError(`--today "${today}" is not a YYYY-MM-DD date`);

  const dates = [];
  for (const { line, cells: row } of drillRows(markdown)) {
    const first = row[0] ?? '';
    if (PLACEHOLDERS.has(first)) continue;
    const ms = parseDate(first);
    if (ms === null) {
      throw new DrillTableError(`Date cell "${first}" is not a YYYY-MM-DD calendar date: ${line.trim()}`);
    }
    if (ms > todayMs) {
      throw new DrillTableError(`Date cell "${first}" is after today (${today}): ${line.trim()}`);
    }
    dates.push({ text: first, ms });
  }

  if (dates.length === 0) return { status: 'none', newest: null, ageDays: null, drills: 0 };
  const newest = dates.reduce((a, b) => (b.ms > a.ms ? b : a));
  const ageDays = Math.round((todayMs - newest.ms) / DAY_MS);
  return {
    status: ageDays > maxAgeDays ? 'stale' : 'current',
    newest: newest.text,
    ageDays,
    drills: dates.length,
  };
}

/** One line for the console and the first line of the summary. */
export function verdictLine(result, maxAgeDays = MAX_AGE_DAYS) {
  if (result.status === 'none') {
    return `No restore drill is recorded in ${RUNBOOK_LABEL}'s Drills table.`;
  }
  const when = `Last drill: ${result.newest}, ${result.ageDays} day(s) ago`;
  return result.status === 'stale'
    ? `${when}, more than the ${maxAgeDays} allowed. The next one is overdue.`
    : `${when}, within ${maxAgeDays}.`;
}

/** The Markdown the workflow writes to the job summary and the issue. */
export function renderMarkdown(result, maxAgeDays = MAX_AGE_DAYS) {
  return [
    '## Cosmos restore drill age',
    '',
    verdictLine(result, maxAgeDays),
    '',
    result.status === 'current'
      ? 'Nothing to do until the next quarterly drill.'
      : `Run the drill in \`${RUNBOOK_LABEL}\`, "The drill" (steps 1 to 6), and add its dated row to the Drills table at the end of that page before tearing down. The row format is defined there. The next weekly run then passes on its own.`,
    '',
  ].join('\n');
}

function usage() {
  return [
    'Usage: node scripts/check-drill-age.mjs [--runbook <file>] [--today YYYY-MM-DD]',
    '         [--max-age-days <n>] [--summary <file>]',
    '',
    'Exit 0 when the newest dated row of the Drills table is at most --max-age-days',
    `(default ${MAX_AGE_DAYS}) old, 1 when it is older or there is none, 2 when the`,
    'table cannot be read.',
  ].join('\n');
}

export function parseArgs(argv) {
  const options = { runbook: RUNBOOK, today: todayUtc(), maxAgeDays: MAX_AGE_DAYS, summary: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new DrillTableError(`${flag} needs a value`);
      i += 1;
      return v;
    };
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--runbook') options.runbook = value();
    else if (flag === '--today') options.today = value();
    else if (flag === '--summary') options.summary = value();
    else if (flag === '--max-age-days') {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) throw new DrillTableError('--max-age-days must be a positive integer');
      options.maxAgeDays = n;
    } else throw new DrillTableError(`Unknown argument: ${flag}`);
  }
  return options;
}

export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  let result;
  try {
    result = evaluate(readFileSync(options.runbook, 'utf8'), {
      today: options.today,
      maxAgeDays: options.maxAgeDays,
    });
  } catch (error) {
    const message = `Cannot evaluate the Drills table in ${options.runbook}: ${error.message}`;
    console.error(message);
    if (options.summary) writeFileSync(options.summary, `## Cosmos restore drill age\n\n${message}\n`);
    return 2;
  }

  console.log(verdictLine(result, options.maxAgeDays));
  if (options.summary) writeFileSync(options.summary, renderMarkdown(result, options.maxAgeDays));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `status=${result.status}\n`);
  return result.status === 'current' ? 0 : 1;
}

// pathToFileURL rather than a hand-built file:// string: a Windows path does
// not round-trip through the latter (entrypoint-guards.test.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
