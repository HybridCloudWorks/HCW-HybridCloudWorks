/**
 * What the nightly manifest branch is allowed to contain (T-726).
 *
 * ## The exposure this bounds
 *
 * The `commit` job holds a GitHub App installation token with `contents: write`
 * for the length of two API calls, and pushes a branch with it. A pull request
 * is opened from that branch and — once auto-merge is enabled — merges itself
 * after the checks pass. So whatever lands on that branch reaches `main` with no
 * human reading the diff.
 *
 * `git add frontend/data/content-manifest.json` keeps that to one file.
 * `git add -A` or `git add .` would sweep in anything else the earlier jobs left
 * in the workspace — a downloaded artifact, a stray build output — and the
 * checks would very likely pass on it, because the checks test the repository,
 * not the reviewer's expectation of what changed.
 *
 * That substitution is one character wide and looks like a cleanup. This is the
 * tripwire.
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
  'publish-content-manifest.yml'
);

const MANIFEST_PATH = 'frontend/data/content-manifest.json';

/** Non-comment lines only, so prose about `git add -A` cannot trip it. */
function commandLines(source) {
  return String(source)
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line));
}

describe('the manifest workflow', () => {
  const source = readFileSync(WORKFLOW, 'utf8');
  const lines = commandLines(source);

  it('stages the manifest by path', () => {
    expect(lines.some((l) => l.includes(`git add ${MANIFEST_PATH}`))).toBe(true);
  });

  // The one-character substitution. `-A`, `--all`, `.`, and `:/` all sweep.
  it('never stages with a wildcard', () => {
    const wildcards = lines.filter((l) => /\bgit add\s+(-A\b|--all\b|\.(\s|$)|:\/)/.test(l));
    expect(wildcards, `wildcard staging found: ${wildcards.join(' | ')}`).toEqual([]);
  });

  it('never commits with -a, which stages every tracked change', () => {
    const bare = lines.filter((l) => /\bgit commit\b[^\n]*\s-(a|am|-all)\b/.test(l));
    expect(bare, `git commit -a found: ${bare.join(' | ')}`).toEqual([]);
  });

  // The token is captured from stdout into GITHUB_OUTPUT. Masking has to come
  // first: once a value reaches a log or an output unmasked, it is disclosed.
  it('masks the App token before writing it anywhere', () => {
    const maskAt = source.indexOf('::add-mask::');
    const writeAt = source.indexOf('token=${token}');
    expect(maskAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(maskAt).toBeLessThan(writeAt);
  });

  // FOUND IN REVIEW. The branch name was `...-${GITHUB_RUN_ID}` alone, and a
  // re-run of the same run keeps that id: the branch would already exist on the
  // remote, so the push fails — or succeeds against a stale branch whose pull
  // request is already open, which answers 422 on create. A nightly job that
  // breaks on its own re-run is a job nobody can retry.
  it('makes the branch name unique per attempt, not just per run', () => {
    const branchLine = lines.find((l) => l.includes('branch="chore/content-manifest-'));
    expect(branchLine, 'the branch name line moved or was renamed').toBeTruthy();
    expect(branchLine).toContain('GITHUB_RUN_ID');
    expect(branchLine).toContain('GITHUB_RUN_ATTEMPT');
  });

  // ALSO FOUND IN REVIEW, and the reason it needs a test of its own: the
  // permission assertions below read non-comment lines, so a header describing
  // a security model the file no longer implements passes every one of them.
  // The header said `commit` holds `contents: write` for as long as it did not.
  it('has no comment claiming the commit job holds contents: write', () => {
    const claims = String(source)
      .split(/\r?\n/)
      .filter((l) => /^\s*#/.test(l))
      .filter((l) => /commit`?\s*(job\s*)?holds\s*`?contents:\s*write/.test(l));
    expect(claims, `stale header claim: ${claims.join(' | ')}`).toEqual([]);
  });

  // The whole point of T-726: this job must not be able to push to main itself.
  it('gives the commit job no write permission of its own', () => {
    const commitJob = source.slice(source.indexOf('  commit:'));
    expect(commitJob).toContain('contents: read');
    expect(commandLines(commitJob).some((l) => /contents:\s*write/.test(l))).toBe(false);
  });
});
