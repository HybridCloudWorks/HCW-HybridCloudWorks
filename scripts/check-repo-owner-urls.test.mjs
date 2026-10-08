/**
 * No live file names the repository's former owner (#1009). The reasoning
 * is in scripts/check-repo-owner-urls.mjs, which ci.yml also runs on its own
 * on every pull request.
 *
 * This file is on that script's ALLOWED list: its fixtures are the lines the
 * check exists to catch.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ALLOWED,
  HISTORICAL,
  namesFormerOwner,
  describeFinding,
  findFormerOwnerUrls,
  listGuardedFiles,
  readTracked,
} from './check-repo-owner-urls.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const fromMap = (files) => (file) => files[file] ?? null;

describe('what the check catches', () => {
  it('names the file and the line of every occurrence, any case', () => {
    const files = {
      'lab-host/bootstrap.sh': 'a\nHCW_REPO_URL="https://github.com/HybridCloudWorks/HCW-HybridCloudWorks.git"\nb',
      'mkdocs.yml': 'repo_url: https://github.com/hybridcloudworks/HCW-HybridCloudWorks\r\n',
      'frontend/src/x.js': "const url = 'https://github.com/saulpatinojr/HCW-HybridCloudWorks';",
    };
    const findings = findFormerOwnerUrls(Object.keys(files), fromMap(files));
    expect(findings).toEqual([
      {
        file: 'lab-host/bootstrap.sh',
        line: 2,
        text: 'HCW_REPO_URL="https://github.com/HybridCloudWorks/HCW-HybridCloudWorks.git"',
      },
      { file: 'mkdocs.yml', line: 1, text: 'repo_url: https://github.com/hybridcloudworks/HCW-HybridCloudWorks' },
    ]);
    expect(describeFinding(findings[0])).toBe(
      'lab-host/bootstrap.sh:2: HCW_REPO_URL="https://github.com/HybridCloudWorks/HCW-HybridCloudWorks.git"'
    );
  });

  it('catches every form the repository is named in: web and git address, raw download, API path, gh --repo', () => {
    for (const line of [
      'git clone git@github.com:HybridCloudWorks/HCW-HybridCloudWorks.git',
      'Invoke-WebRequest -Uri https://raw.githubusercontent.com/HybridCloudWorks/HCW-HybridCloudWorks/main/x.ps1',
      'gh api repos/HybridCloudWorks/HCW-HybridCloudWorks/pulls/1/reviews',
      'gh variable set X -R HybridCloudWorks/HCW-HybridCloudWorks -b y',
      'gh pr list --repo hybridcloudworks/hcw-hybridcloudworks',
      'HybridCloudWorks/HCW-HybridCloudWorks at the start of a line',
    ]) {
      expect(namesFormerOwner(line), line).toBe(true);
    }
  });

  it('is about the owner, not the words: the organisation, its images and the new owner are not stale', () => {
    for (const line of [
      'https://github.com/orgs/HybridCloudWorks/projects/1',
      'https://github.com/HybridCloudWorks',
      'https://github.com/HybridCloudWorks/.github',
      'docker.io/hybridcloudworks/hcw-lab@sha256:abc',
      'hybridcloudworks/hcw-lab-runner:2026.10.08',
      'https://github.com/saulpatinojr/HCW-HybridCloudWorks/tree/main/lab-host',
      'gh pr list --repo saulpatinojr/HCW-HybridCloudWorks',
      // A name that merely ends in the old owner's is someone else.
      'not-hybridcloudworks/HCW-HybridCloudWorks',
    ]) {
      expect(namesFormerOwner(line), line).toBe(false);
    }
  });

  it('skips the allowed files, binary content and files it cannot read', () => {
    const files = {
      'scripts/no-wiki-pointers.test.mjs': 'https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/1',
      'frontend/src/logo.png': 'https://github.com/HybridCloudWorks/\0binary',
    };
    expect(findFormerOwnerUrls([...Object.keys(files), 'gone.js'], fromMap(files))).toEqual([]);
  });
});

describe('the repository', () => {
  it('leaves out only the dated records (review of #1018)', () => {
    expect([...HISTORICAL]).toEqual([
      'CHANGELOG.md',
      'docs/history/',
      'docs/decisions/',
      'docs/architecture/architecture-review-2026-08.md',
      'docs/architecture/resource-validation-report.md',
    ]);
  });

  it('names its former owner in no live file', () => {
    const files = listGuardedFiles(REPO);
    // A listing that came back empty, or kept to the old few directories,
    // would pass anything: the runbooks, infra-lab and the session
    // instructions are read too, and the dated records are not.
    for (const file of [
      'lab-host/bootstrap.sh',
      'mkdocs.yml',
      'docs/runbooks/labs-host.md',
      'infra-lab/README.md',
      '.claude/CLAUDE.md',
    ]) {
      expect(files).toContain(file);
    }
    expect(files).not.toContain('CHANGELOG.md');
    expect(files.some((file) => file.startsWith('docs/history/'))).toBe(false);
    expect(findFormerOwnerUrls(files, readTracked(REPO)).map(describeFinding)).toEqual([]);
  });

  it('allows only files that still need the allowance, each with a reason', () => {
    const read = readTracked(REPO);
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, file).toBeGreaterThan(20);
      expect(namesFormerOwner(String(read(file) ?? '')), `${file} no longer needs its allowance`).toBe(true);
    }
  });

  it('runs when invoked directly, as ci.yml invokes it, and says what it checked', () => {
    // A main-module guard that stopped matching would exit 0 having run
    // nothing, which CI reads as a pass (entrypoint-guards.test.mjs).
    const result = spawnSync(process.execPath, [join(REPO, 'scripts', 'check-repo-owner-urls.mjs')], {
      cwd: join(REPO, 'scripts'),
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(
      /^No tracked file outside the dated records \(CHANGELOG\.md, .*\) names the former owner's repository; \d+ files read\.$/m
    );
  });

  it('ci.yml runs the check on every pull request, outside the path filter', () => {
    // Gated on the scripts row's filter, a pull request that only touched
    // frontend/src or functions/src would skip it.
    const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
    const at = ci.indexOf('run: node check-repo-owner-urls.mjs');
    expect(at, 'no ci.yml step runs `node check-repo-owner-urls.mjs`').toBeGreaterThan(-1);
    const step = ci.slice(ci.lastIndexOf('- name:', at), at);
    expect(step).toMatch(/if: matrix\.name == 'scripts \(operations\)'/);
    expect(step).not.toMatch(/steps\.changes\.outputs\.relevant/);
  });
});
