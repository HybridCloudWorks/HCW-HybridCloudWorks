/**
 * infra/cosmos-containers.json is generated, and CI now checks it (#817).
 *
 * The generator's header has always said `--check` is for CI, and
 * package.json has always defined `container-spec:check`, but no workflow ran
 * either. Terraform reads the generated file with jsondecode(file(...)), so a
 * manifest edit that was never regenerated — or a hand edit to the JSON —
 * reached a plan with nothing having compared the two. Running the check from
 * here puts it in the `scripts` CI job, which already runs on changes under
 * scripts/ and infra/.
 *
 * The invariants below are the ones a regeneration must not lose, because
 * each is a production failure rather than a failed test: a partition key is
 * immutable once a container holds data, and the public content list orders by
 * cp_sortDate.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, '..', 'infra', 'cosmos-containers.json'), 'utf8'));
const byName = new Map(spec.containers.map((c) => [c.name, c]));

describe('generate-cosmos-container-spec --check', () => {
  it('finds the committed file identical to what the manifest renders', () => {
    const run = spawnSync(process.execPath, [join(here, 'generate-cosmos-container-spec.mjs'), '--check'], {
      encoding: 'utf8',
    });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout + run.stderr).toMatch(/is up to date/);
  });
});

describe('what a regeneration must keep', () => {
  it('names every container once', () => {
    expect(byName.size).toBe(spec.containers.length);
    expect(spec.containers.length).toBeGreaterThan(50);
  });

  it('keeps content_versions partitioned on /contentId', () => {
    expect(byName.get('content_versions')?.partition_key_path).toBe('/contentId');
  });

  it('indexes and declares cp_sortDate on the two containers the public list orders', () => {
    for (const name of ['content', 'blogs']) {
      const container = byName.get(name);
      expect(container?.included_paths, name).toContain('/cp_sortDate/?');
      expect(container?.computedProperties?.map((p) => p.name), name).toContain('cp_sortDate');
    }
  });
});
