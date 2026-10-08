/**
 * No shipped file names the repository's former owner (#1009). The reasoning
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
  FORMER_OWNER_URL,
  GUARDED,
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

  it('is about the owner, not the words: the organisation board and the image names are not repository URLs', () => {
    for (const line of [
      'https://github.com/orgs/HybridCloudWorks/projects/1',
      'docker.io/hybridcloudworks/hcw-lab@sha256:abc',
      'https://github.com/saulpatinojr/HCW-HybridCloudWorks/tree/main/lab-host',
    ]) {
      expect(FORMER_OWNER_URL.test(line), line).toBe(false);
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
  it('guards the paths the 2026-10-08 review named', () => {
    expect([...GUARDED]).toEqual([
      'lab-host/',
      'vps-agent/',
      'frontend/src/',
      'functions/src/',
      'scripts/',
      '.github/',
      'mkdocs.yml',
    ]);
  });

  it('names its former owner nowhere it ships', () => {
    const files = listGuardedFiles(REPO);
    // A listing that came back empty would pass anything.
    expect(files).toContain('lab-host/bootstrap.sh');
    expect(files).toContain('mkdocs.yml');
    expect(findFormerOwnerUrls(files, readTracked(REPO)).map(describeFinding)).toEqual([]);
  });

  it('allows only files that still need the allowance, each with a reason', () => {
    const read = readTracked(REPO);
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, file).toBeGreaterThan(20);
      expect(FORMER_OWNER_URL.test(String(read(file) ?? '')), `${file} no longer needs its allowance`).toBe(true);
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
    expect(result.stdout).toMatch(/^No tracked file under lab-host\/, .* names the former owner's GitHub address\.$/m);
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
