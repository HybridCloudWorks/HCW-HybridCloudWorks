/**
 * No live file may point a reader at `wiki/` (#502).
 *
 * The GitHub Wiki was retired on 2026-09-06 (ADR 0027) and `wiki/` was
 * deleted from the repository. Nine references outlived it, and they were not
 * dead links in prose — they were instructions:
 *
 *   - `monitor-functions-registered.yml` told the owner, inside a production
 *     alert email, to read *The failure with no alert* in
 *     `wiki/Alerting-And-Support.md`. That alert fires when a Function App
 *     loses registered functions, so the one moment it is read is the one
 *     moment the path has to resolve.
 *   - Four files across two packages cited `wiki/Blog-Machine.md` as "the
 *     cross-package contract of record" — the document a reader is sent to in
 *     order to keep the frontend and backend module parsers in step.
 *   - Two cited `wiki/0025-cosmos-firewall-datacenter-sentinel.md` for why the
 *     manifest job opens a firewall window.
 *
 * All of them resolved to nothing for five days, and nothing noticed, because
 * a comment is not compiled and a shell string inside a workflow is not
 * linted. This test is the thing that notices.
 *
 * WHAT IS ALLOWED, and why the list is not empty. History must still be able
 * to say "wiki": the changelog records what happened, ADR 0027 explains the
 * migration it performed, and the archived and historical pages under
 * `docs/archive/` and `docs/history/` are dated snapshots that are wrong to
 * edit. The rule is about pointers a reader is expected to follow TODAY.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Paths whose job is to record or explain the retirement. Prefix-matched
 * against the repo-relative path with forward slashes.
 */
const HISTORY = [
  'CHANGELOG.md',
  // `docs/archive/` stood here until 2026-09-11, when the 80 Firebase-era
  // pages were deleted (ADR 0027's amendment). The entry is gone rather than
  // kept "just in case", because the assertion below exists to make exactly
  // that kind of leftover fail — and it did, the moment the folder went.
  'docs/history/',
  // The ADR that performed the migration; it must describe what it replaced.
  'docs/decisions/0027-documentation-site.md',
  // Explains that `docs/` replaced `wiki/`, in the comment that says so.
  'mkdocs.yml',
  // Its comments carry the dated reason the allowlist looks as it does.
  'scripts/validate-repository-structure.ps1',
  // One clause of a sentence that is explicitly about the former location.
  'docs/standards/required-inputs.md',
  // This file, which must name the thing it forbids.
  'scripts/no-wiki-pointers.test.mjs',
];

/** Every tracked file, from git, so ignored and generated trees are excluded. */
function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

/**
 * Extensions worth reading. Deliberately broad, because the first version of
 * this list omitted Terraform and four live pointers in `infra/` sat behind
 * the gap — `cosmos.tf`, `outputs.tf` and two in `variables.tf`, each telling
 * an operator which document records why a firewall rule or an output exists.
 * The same blind spot was in the grep that found the original nine, which is
 * how a guard written to catch this class shipped missing a sixth of it
 * (Copilot review of cc34da78).
 *
 * Anything textual a person reads for instructions belongs here. If a file
 * type is added to the repository, add it.
 */
const TEXT = /\.(md|js|jsx|mjs|cjs|ts|tsx|yml|yaml|ps1|json|sh|tf|tfvars|hcl|txt|toml|env|bicep)$/i;

/**
 * A reference to the retired folder.
 *
 * The lookbehind forbids only a WORD character, so `mediawiki/` is not a
 * match while `./wiki/Page.md` and `../wiki/Page.md` are. An earlier version
 * also forbade `.`, `-` and `/`, which excused every dot-relative form — the
 * most natural way to write the pointer this test exists to forbid
 * (Copilot review of 4f5b6ad3).
 */
const POINTER = /(?<!\w)wiki\//i;

/**
 * A link to the retired Wiki itself. This is a pointer too, and a worse one:
 * it resolves to a redirect back to the repository root, so a reader who
 * follows it is told nothing at all.
 */
const WIKI_URL = /github\.com\/[^\s)]+\/wiki\b/i;

/**
 * URLs that merely contain `/wiki/` and have nothing to do with this
 * repository — Wikipedia above all. Stripped before the path check so they
 * cannot raise a false positive; GitHub's own Wiki URLs are deliberately left
 * in the line, because `WIKI_URL` must still see them.
 */
const FOREIGN_WIKI_URL = /https?:\/\/(?!\S*github\.com)\S*?\/wiki\/?\S*/gi;

/** What the line-level check makes of one line. Mirrors the loop below. */
function isOffending(line) {
  const withoutForeign = line.replace(FOREIGN_WIKI_URL, '');
  return POINTER.test(withoutForeign) || WIKI_URL.test(withoutForeign);
}

describe('what counts as a pointer', () => {
  // Pinned directly, because the sweep below passing proves only that the
  // repository is clean today — not that the patterns would catch a pointer
  // reintroduced tomorrow. Two of these cases were holes until review.
  it.each([
    ['wiki/Blog-Machine.md'],
    ['see `wiki/` for the runbook'],
    ['./wiki/Alerting-And-Support.md'],
    ['../wiki/Required-Inputs.md'],
    ['docs at ../../wiki/Home.md'],
    ['https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki'],
    ['https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki/Home'],
  ])('flags %j', (line) => {
    expect(isOffending(line)).toBe(true);
  });

  it.each([
    ['docs/content/blog-machine.md'],
    ['https://docs.hybridcloudworks.com/runbooks/alerting-and-support/'],
    ['https://en.wikipedia.org/wiki/Idempotence'],
    ['the mediawiki/ export format'],
    ['a wikipedia article'],
    ['MediaWiki is not this'],
  ])('leaves %j alone', (line) => {
    expect(isOffending(line)).toBe(false);
  });
});

describe('the retired Wiki has no live pointers', () => {
  it('no tracked file outside the historical record points at wiki/', () => {
    const offenders = [];
    for (const rel of trackedFiles()) {
      if (!TEXT.test(rel)) continue;
      if (HISTORY.some((prefix) => rel === prefix || rel.startsWith(prefix))) continue;

      let body;
      try {
        body = readFileSync(path.join(repoRoot, rel), 'utf8');
      } catch {
        continue; // deleted in the working tree; git still lists it
      }

      body.split('\n').forEach((line, i) => {
        // Wikipedia and friends are dropped first so they cannot raise a
        // false positive. GitHub's own Wiki URLs stay, because linking the
        // retired Wiki is as dead an instruction as naming the deleted folder.
        const withoutForeign = line.replace(FOREIGN_WIKI_URL, '');
        if (POINTER.test(withoutForeign) || WIKI_URL.test(withoutForeign)) {
          offenders.push(`${rel}:${i + 1} — ${line.trim().slice(0, 120)}`);
        }
      });
    }

    expect(
      offenders,
      'The Wiki was retired on 2026-09-06 (ADR 0027) and wiki/ no longer exists.\n' +
        'Point the reader at docs/ instead, or at https://docs.hybridcloudworks.com/.\n' +
        'If the reference is a historical record rather than an instruction, add its\n' +
        'path to HISTORY in this file and say why.'
    ).toEqual([]);
  });

  it('reads the file types the repository actually contains', () => {
    // The rule above is only as wide as TEXT, and a missing extension is an
    // invisible hole rather than a failure — which is exactly how four live
    // Terraform pointers survived the first version of this test. This fails
    // when a tracked extension carrying more than a handful of files is not
    // covered, so the next language added to the repository is a decision
    // rather than an oversight.
    const counts = new Map();
    for (const rel of trackedFiles()) {
      const ext = path.extname(rel).toLowerCase();
      if (!ext) continue;
      counts.set(ext, (counts.get(ext) ?? 0) + 1);
    }
    // Binary and asset types nobody writes instructions in.
    const NOT_PROSE = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.avif',
      '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.pdf', '.zip',
      '.lock', '.map', '.css', '.html', '.snap', '.pyc', '.csv',
    ]);
    const uncovered = [...counts.entries()]
      .filter(([ext, n]) => n >= 5 && !NOT_PROSE.has(ext) && !TEXT.test(`x${ext}`))
      .map(([ext, n]) => `${ext} (${n} files)`);

    expect(
      uncovered,
      'Tracked file types this guard never reads. Add them to TEXT, or to\n' +
        'NOT_PROSE here if nobody writes instructions in them.'
    ).toEqual([]);
  });

  it('names an allowlist entry for every path it exempts, so the list cannot rot', () => {
    // A HISTORY entry that matches nothing is either a typo or a file that has
    // moved, and either way it is silently weakening the rule above.
    const tracked = trackedFiles();
    const unused = HISTORY.filter(
      (prefix) => !tracked.some((rel) => rel === prefix || rel.startsWith(prefix))
    );
    expect(unused, 'HISTORY entries matching no tracked file').toEqual([]);
  });
});
