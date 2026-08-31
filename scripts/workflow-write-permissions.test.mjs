/**
 * Which workflows may hold `contents: write`.
 *
 * ## The exposure this bounds
 *
 * A ruleset bypass is granted to the TOKEN, not to a workflow. So while the
 * ruleset lists the Actions token as a bypass actor, **every** workflow holding
 * `contents: write` can push to `main` past every required check.
 *
 * THE BYPASS IS NO LONGER NEEDED, as of 2026-08-31.
 * `publish-content-manifest.yml` was the only thing that required it, and its
 * `commit` job now opens a pull request with a GitHub App installation token
 * instead of pushing — so the checks run rather than being skipped. Removing
 * the bypass actor from the ruleset is an owner action, and until it happens
 * this file is still the thing bounding the blast radius.
 *
 * Either way the list earns its keep: pinned here, adding a `contents: write`
 * grant becomes a reviewed change with a justification, instead of a line in an
 * unrelated pull request that nobody reads as a security decision — which is
 * exactly how this kind of grant spreads.
 *
 * ## Why a text scan and not a YAML parse
 *
 * This is a tripwire, not a parser. Nothing in this repository parses YAML
 * today, and `scripts/` carries two runtime dependencies on purpose; adding one
 * to read a single key is a poor trade. The pattern below deliberately
 * OVER-matches — it fires on the block form, the flow form, odd spacing, and on
 * a grant nested anywhere in the file — because the failure direction matters:
 * a false positive is a five-second read of a diff, and a false negative is a
 * workflow that can push to `main` with nothing saying so.
 *
 * Its one honest limit: a comment mentioning the string is indistinguishable
 * from a grant, so comment lines are excluded, and `dependency-review.yml`
 * (which discusses the grant in prose) is why that exclusion exists at all.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOWS = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');

/**
 * Workflows reviewed and accepted as holding `contents: write`.
 *
 * A justification is required, and it should say what the workflow writes and
 * why that cannot be done without the grant.
 */
const ALLOWED = new Map([
  [
    'sync-wiki.yml',
    'Publishes wiki/ to the repository wiki. The wiki is a separate git ' +
      'repository, but the grant is repository-scoped and therefore counts here.',
  ],
]);

/**
 * `publish-content-manifest.yml` left this list on 2026-08-31 and should not
 * come back to it. Its `commit` job now holds `contents: read` and does its
 * writing with a GitHub App installation token, which opens a pull request that
 * the required checks run on. Re-adding the grant there would restore the thing
 * T-726 removed — the ability to push to main past every check — so if a future
 * change makes this test fail on that file, the question to ask is why the App
 * path stopped working, not whether to widen the list.
 */

/** Tolerant on purpose — see the header. */
const GRANT = /contents\s*:\s*['"]?write['"]?/;

/** A `#` before any other content. Trailing comments still count as grants. */
const COMMENT = /^\s*#/;

export function grantsContentsWrite(source) {
  return String(source)
    .split(/\r?\n/)
    .some((line) => !COMMENT.test(line) && GRANT.test(line));
}

describe('grantsContentsWrite', () => {
  // The scanner is asserted against fixtures rather than trusted, because a
  // scanner that silently matched nothing would make the suite below pass
  // while checking nothing at all.
  it('finds the ordinary block form', () => {
    expect(grantsContentsWrite('permissions:\n  contents: write\n')).toBe(true);
  });

  it('finds the flow form and odd spacing', () => {
    expect(grantsContentsWrite('permissions: { contents: write }')).toBe(true);
    expect(grantsContentsWrite('    contents:    write')).toBe(true);
    expect(grantsContentsWrite("    contents: 'write'")).toBe(true);
  });

  it('finds a grant nested in a job rather than at the top level', () => {
    expect(
      grantsContentsWrite('jobs:\n  commit:\n    permissions:\n      contents: write\n')
    ).toBe(true);
  });

  it('does not count a comment discussing the grant', () => {
    expect(grantsContentsWrite('#   contents: write\n')).toBe(false);
    expect(grantsContentsWrite('  # it used to hold contents: write\n')).toBe(false);
  });

  it('counts a grant that carries a trailing comment', () => {
    expect(grantsContentsWrite('      contents: write # commits the manifest')).toBe(true);
  });

  it('does not count read', () => {
    expect(grantsContentsWrite('permissions:\n  contents: read\n')).toBe(false);
  });
});

describe('workflows holding contents: write', () => {
  const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  it('finds workflows to check, so an empty directory cannot pass silently', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  // THE ASSERTION. A workflow that gains this grant gains the ability to push
  // to main past every required check, because the ruleset bypass belongs to
  // the token rather than to a workflow.
  it('is exactly the reviewed set', () => {
    const found = files
      .filter((f) => grantsContentsWrite(readFileSync(join(WORKFLOWS, f), 'utf8')))
      .sort();

    expect(found).toEqual([...ALLOWED.keys()].sort());
  });

  it('records why each one has it', () => {
    for (const [file, why] of ALLOWED) {
      expect(why.length, `${file} needs a justification, not a placeholder`).toBeGreaterThan(40);
    }
  });
});
