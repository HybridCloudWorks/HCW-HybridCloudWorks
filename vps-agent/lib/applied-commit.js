/**
 * The commit this host last converged from, for the heartbeat (#1009; the
 * heartbeat half of LAB-4, #950).
 *
 * lab-host/ansible/site.yml writes APPLIED_COMMIT_FILE as its very last task,
 * after every role, the handlers they notified and the privilege checks, so
 * the record only ever names a commit the whole playbook converged from: a
 * run that fails earlier leaves the previous record in place, and a check run
 * (bootstrap.sh --check) writes nothing. The file is root:root 0644, so this
 * process, which runs as hcw-labs-agent, can read it and cannot change it.
 *
 *   { "commit": "<40 hex>", "committedAt": "<ISO 8601>", "appliedAt": "<ISO 8601>" }
 *
 * `committedAt` is the commit's own committer date (`git log -1 --format=%cI`),
 * which is what the site compares with main's history; `appliedAt` is when
 * the playbook finished. The site raises a host whose commit lags main's
 * lab-host/ and vps-agent/ changes by more than a day
 * (functions/src/lib/labs/drift.js). Nothing here heals a lag: the agent only
 * reports.
 *
 * READ ON EVERY HEARTBEAT, not once at start. The playbook restarts the agent
 * mid-run (the labs_agent role's handler) and writes this record afterwards,
 * so a value read at start would name the previous commit until the next
 * restart. The file is a hundred bytes; reading it every thirty seconds costs
 * nothing.
 *
 * Never throws. A missing, oversized or malformed record is null, and the
 * heartbeat then carries no `applied` at all; the site says the host has not
 * reported one, which is the loud outcome, not a quiet guess.
 */
import { readFile } from 'node:fs/promises';

/** Where the playbook writes it (`lab_host_applied_commit_file` in group_vars/all.yml). */
export const APPLIED_COMMIT_FILE = '/etc/hcw/applied-commit.json';

/** The record is three short fields; anything near this is not one. */
export const MAX_RECORD_BYTES = 4096;

const SHA = /^[0-9a-f]{40}$/;

/**
 * An ISO 8601 date-time with seconds and a zone, as git's `%cI` and the
 * playbook's `now(utc=true)` write it. The server checks the calendar and
 * the clock again; this only keeps a mangled file off the wire.
 */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/;

const isDateTime = (value) =>
  typeof value === 'string' && ISO_DATE_TIME.test(value) && Number.isFinite(Date.parse(value));

/**
 * The record's three fields, or null when the text is not exactly that shape.
 * Extra keys are dropped, not passed on: the heartbeat sends what the site
 * reads and nothing the file might grow later.
 *
 * @param {string} text
 * @returns {{ commit: string, committedAt: string, appliedAt: string } | null}
 */
export function parseAppliedCommit(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { commit, committedAt, appliedAt } = value;
  if (typeof commit !== 'string' || !SHA.test(commit)) return null;
  if (!isDateTime(committedAt) || !isDateTime(appliedAt)) return null;
  return { commit, committedAt, appliedAt };
}

/**
 * Read the record. Resolves to its fields or null; never rejects.
 *
 * @param {{ path?: string, read?: (path: string, encoding: string) => Promise<string> }} [io]
 *   tests only; production reads APPLIED_COMMIT_FILE
 */
export async function readAppliedCommit({ path = APPLIED_COMMIT_FILE, read = readFile } = {}) {
  try {
    const text = await read(path, 'utf8');
    if (typeof text !== 'string' || text.length > MAX_RECORD_BYTES) return null;
    return parseAppliedCommit(text);
  } catch {
    return null;
  }
}
