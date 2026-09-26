/**
 * What the weekly version-floors branch is allowed to contain (#715).
 *
 * The same tripwire as avm-versions-workflow.test.mjs, for the same reason:
 * the `commit` job pushes a branch with a GitHub App installation token, and
 * the one `git add <path>` line keeps that branch to the floors file. `-A` or
 * `.` would sweep in whatever the earlier job left in the workspace.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.github',
  'workflows',
  'update-version-floors.yml'
);
const FLOORS_PATH = 'scripts/version-floors.json';

/** Non-comment lines only, so prose about `git add -A` cannot trip it. */
function commandLines(source) {
  return String(source)
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line));
}

describe('the version floors workflow', () => {
  const source = readFileSync(WORKFLOW, 'utf8');
  const lines = commandLines(source);
  const updateJob = source.slice(source.indexOf('  update:'), source.indexOf('  commit:'));
  const commitJob = source.slice(source.indexOf('  commit:'));

  it('runs on Wednesdays at 06:30 UTC and by hand, not in an hour another updater uses', () => {
    expect(lines.some((l) => l.includes("cron: '30 6 * * 3'"))).toBe(true);
    expect(lines.some((l) => /^\s*workflow_dispatch:/.test(l))).toBe(true);
    expect(lines.filter((l) => /cron:/.test(l))).toHaveLength(1);
    expect(lines.some((l) => /^\s*pull_request:/.test(l))).toBe(false);
  });

  it('stages exactly the floors file, and nothing else', () => {
    const staged = lines.filter((l) => /\bgit add\b/.test(l)).map((l) => l.replace(/^.*\bgit add\s+/, '').trim());
    expect(staged).toEqual([FLOORS_PATH]);
  });

  it('never stages with a wildcard or commits with -a', () => {
    expect(lines.filter((l) => /\bgit add\s+(-A\b|--all\b|\.(\s|$)|:\/)/.test(l))).toEqual([]);
    expect(lines.filter((l) => /\bgit commit\b[^\n]*\s-(a|am|-all)\b/.test(l))).toEqual([]);
  });

  it('checks for a change with git status --porcelain on the floors file in both jobs', () => {
    const checks = lines.filter((l) => l.includes(FLOORS_PATH) && /\bgit (diff|status)\b/.test(l));
    expect(checks).toHaveLength(2);
    for (const check of checks) expect(check).toContain('git status --porcelain');
  });

  it('runs the updater without installing anything', () => {
    expect(updateJob).toContain('node scripts/update-version-floors.mjs --summary');
    expect(lines.some((l) => /\bnpm (ci|install)\b/.test(l))).toBe(false);
  });

  it('masks the App token before writing it anywhere', () => {
    const maskAt = source.indexOf('::add-mask::');
    const writeAt = source.indexOf('token=${token}');
    expect(maskAt).toBeGreaterThan(-1);
    expect(maskAt).toBeLessThan(writeAt);
  });

  it('makes the branch name unique per attempt, not just per run', () => {
    const branchLine = lines.find((l) => l.includes('branch="chore/version-floors-'));
    expect(branchLine).toContain('GITHUB_RUN_ID');
    expect(branchLine).toContain('GITHUB_RUN_ATTEMPT');
  });

  it('opens the pull request ready for review, with the same title as the commit', () => {
    const title = 'chore: move the version floors (checked ${AS_OF})';
    expect(lines.some((l) => l.includes(`git commit -m "${title}"`))).toBe(true);
    expect(lines.some((l) => l.includes(`--title "${title}"`))).toBe(true);
    expect(lines.filter((l) => /--draft\b/.test(l))).toEqual([]);
  });

  it('tells the reviewer the floors test is expected to fail until the pins move', () => {
    expect(commitJob).toContain('This pull request is expected to fail');
    expect(commitJob).toContain('until the pins move');
    expect(commitJob).toContain('runtime_version');
  });

  it('gives neither job a write permission of its own', () => {
    expect(lines.some((l) => /contents:\s*write/.test(l))).toBe(false);
    expect(lines.some((l) => /id-token:\s*write/.test(l))).toBe(false);
    expect(updateJob).toContain('contents: read');
    expect(commitJob).toContain('contents: read');
    expect(lines.some((l) => /^permissions:\s*\{\}/.test(l))).toBe(true);
  });

  it('reuses the App the other scheduled pull requests use, from the automation environment', () => {
    expect(lines.some((l) => l.includes('vars.MANIFEST_APP_ID'))).toBe(true);
    expect(lines.some((l) => l.includes('secrets.MANIFEST_APP_PRIVATE_KEY'))).toBe(true);
    expect(commitJob).toContain('environment: automation');
    expect(lines.some((l) => l.includes('node scripts/github-app-token.mjs --revoke'))).toBe(true);
  });

  it('pins every action by full commit SHA with a version comment', () => {
    const uses = lines.filter((l) => /^\s*uses:\s/.test(l));
    expect(uses.length).toBeGreaterThan(3);
    for (const line of uses) expect(line, `not pinned by SHA: ${line.trim()}`).toMatch(/@[0-9a-f]{40}\s+#\s*v\d/);
  });

  it('runs the commit job only when the update job reported a change', () => {
    expect(updateJob).toContain('changed: ${{ steps.changed.outputs.changed }}');
    expect(commitJob).toContain("if: needs.update.outputs.changed == 'true'");
    const uploadAt = updateJob.indexOf('uses: actions/upload-artifact');
    const stepStart = updateJob.lastIndexOf('      - name:', uploadAt);
    const uploadStep = updateJob.slice(stepStart);
    expect(uploadStep).toContain("if: steps.changed.outputs.changed == 'true'");
    expect(uploadStep).toContain(FLOORS_PATH);
  });
});
