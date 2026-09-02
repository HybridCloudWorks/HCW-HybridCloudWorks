// TODO.md's handling rule says: "Completed items are removed from this file
// after the corresponding regular entry is present in CHANGELOG.md." Until
// 2026-09-02 that rule was prose, which means it held exactly as long as
// every editor remembered it. This makes it a gate.
//
// The check: any T-identifier present in TODO.md at the pull request's base
// but absent from TODO.md at its head must appear in CHANGELOG.md at the
// head. Identifiers that merely move or renumber within TODO.md still exist
// at the head and pass; identifiers recorded in the CHANGELOG at any earlier
// point also pass, because the CHANGELOG only grows.
//
// Failure mode is deliberate: if the base version of TODO.md cannot be read
// (a bad ref, a shallow clone), this exits non-zero with a message naming
// the environment problem rather than passing silently — a policy gate that
// cannot evaluate has not evaluated (the distinction .claude/CLAUDE.md calls
// a reporting failure versus a real one).
//
// Usage: node scripts/check-todo-changelog-movement.mjs --base <ref>
// Exit codes: 0 = rule holds, 1 = violation (ids named), 2 = cannot evaluate.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const T_ID = /\bT-\d+\b/g;

export function extractIds(text) {
  return new Set(String(text ?? '').match(T_ID) ?? []);
}

// Returns the T-ids removed from TODO.md that CHANGELOG.md does not carry,
// sorted for stable output. Empty array = the rule holds.
export function findUnrecordedRemovals(baseTodo, headTodo, changelog) {
  const headIds = extractIds(headTodo);
  const changelogIds = extractIds(changelog);
  return [...extractIds(baseTodo)]
    .filter((id) => !headIds.has(id) && !changelogIds.has(id))
    .sort();
}

function main() {
  const baseFlag = process.argv.indexOf('--base');
  const baseRef = baseFlag !== -1 ? process.argv[baseFlag + 1] : undefined;
  if (!baseRef) {
    console.error('usage: check-todo-changelog-movement.mjs --base <ref>');
    process.exit(2);
  }

  let baseTodo;
  try {
    baseTodo = execFileSync('git', ['show', `${baseRef}:TODO.md`], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    console.error(
      `Cannot read TODO.md at base ${baseRef}: ${error.message}\n` +
        'A gate that cannot evaluate has not evaluated — fix the ref or the ' +
        'fetch depth rather than skipping this check.'
    );
    process.exit(2);
  }

  const headTodo = readFileSync('TODO.md', 'utf8');
  const changelog = readFileSync('CHANGELOG.md', 'utf8');

  const missing = findUnrecordedRemovals(baseTodo, headTodo, changelog);
  if (missing.length > 0) {
    console.error(
      `These identifiers left TODO.md without a CHANGELOG.md entry: ${missing.join(', ')}\n` +
        "TODO.md's handling rule: completed items are removed only after the " +
        'corresponding entry is present in CHANGELOG.md. Add the entry in ' +
        'the same pull request, or restore the item.'
    );
    process.exit(1);
  }

  console.log(
    'OK: every identifier removed from TODO.md is recorded in CHANGELOG.md.'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
