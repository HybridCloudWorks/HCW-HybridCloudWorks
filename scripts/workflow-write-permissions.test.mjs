/**
 * Which workflows may hold `contents: write`.
 *
 * ## The exposure this bounds
 *
 * `publish-content-manifest.yml` commits a refreshed manifest to `main`. For
 * that push to land on a branch protected by twelve required contexts, the
 * ruleset must list the Actions token as a bypass actor — and a ruleset bypass
 * is granted to the TOKEN, not to a workflow. So **every** workflow holding
 * `contents: write` can push to `main` past every required check. That is
 * T-726, and it is not closed by this file.
 *
 * What this file does is bound it. The bypass is unavoidable while the manifest
 * is committed at all, but the set of workflows that can USE it does not have
 * to be open-ended. Pinned here, adding one becomes a reviewed change with a
 * justification, instead of a line in an unrelated pull request that nobody
 * reads as a security decision — which is exactly how this kind of grant
 * spreads.
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
    'publish-content-manifest.yml',
    'The `commit` job commits frontend/data/content-manifest.json on the nightly ' +
      'refresh. It holds no Azure identity and runs no npm install — the `build` ' +
      'job that talks to Cosmos holds `contents: read` (T-726).',
  ],
  [
    'sync-wiki.yml',
    'Publishes wiki/ to the repository wiki. The wiki is a separate git ' +
      'repository, but the grant is repository-scoped and therefore counts here.',
  ],
]);

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
