#!/usr/bin/env node
/**
 * Run each runner-image capability exactly the way vps-agent does, against a
 * locally built image, and expect the exit codes the job would report.
 *
 *   node lab-image/sandbox-check.mjs hcw-lab-runner:dev
 *
 * smoke.sh runs inside a container that has a network switch and nothing
 * else; the job sandbox is a read-only root with `--cap-drop ALL`, a 64 MB
 * tmpfs, uid 65534 and a memory limit, and two of the three faults #675
 * found (the tmpfs mounted root-owned, providers dying on a read-only TMPDIR)
 * were invisible to smoke.sh and fatal here. So this script does not restate
 * the sandbox: it imports `prepareJobDir` and `buildDockerArgs` from
 * vps-agent/lib/docker-runner.js and the capability table from
 * vps-agent/lib/capabilities.js, swaps only the image for the one under
 * test, and spawns the argv the agent would spawn. If the agent's flags
 * change, this checks the new flags.
 *
 * No dependency beyond Node and Docker (the tar fixture is made with the
 * host's `tar --format=ustar`, present on ubuntu-latest and on Windows).
 */

import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { prepareJobDir, buildDockerArgs } = await import(
  new URL('../vps-agent/lib/docker-runner.js', import.meta.url)
);
const { CAPABILITIES } = await import(new URL('../vps-agent/lib/capabilities.js', import.meta.url));

const image = process.argv[2];
if (!image) {
  console.error('usage: node lab-image/sandbox-check.mjs <runner image tag>');
  process.exit(2);
}

/** The agent's defaults (vps-agent/index.js config.limits). */
const LIMITS = { memory: '256m', cpus: '0.5', pidsLimit: 128 };

const fixture = (...p) => path.join(here, 'smoke', ...p);
const readText = (...p) => fs.readFile(fixture(...p), 'utf8');
const tarOf = (dir) =>
  execFileSync('tar', ['--format=ustar', '-cf', '-', '-C', dir, '.'], { maxBuffer: 16 * 1024 * 1024 }).toString(
    'base64'
  );

const cases = [
  {
    name: 'terraform-validate, text payload (builder-shaped main.tf)',
    type: 'terraform-validate',
    encoding: 'text',
    payload: () => readText('terraform-validate-payload', 'main.tf'),
    expectExit: 0,
    expectOutput: ['Success! The configuration is valid.', /(?:^|\n)\s+rewrote .*\n\s+rewrote .*\n\s+rewrote /],
  },
  {
    name: 'terraform-validate, tar payload (the same root as an archive)',
    type: 'terraform-validate',
    encoding: 'tar',
    payload: () => tarOf(fixture('terraform-validate-payload')),
    expectExit: 0,
    expectOutput: ['Success! The configuration is valid.'],
  },
  {
    name: 'helm-template, tar payload (chart in a top-level directory)',
    type: 'helm-template',
    encoding: 'tar',
    payload: () => tarOf(fixture('helm-payload')),
    expectExit: 0,
    expectOutput: ['kind: Deployment', 'name: hcw-hcw-smoke'],
  },
  {
    name: 'kubeconform, text payload (valid manifests)',
    type: 'kubeconform',
    encoding: 'text',
    payload: () => readText('kubeconform-payload', 'valid', 'deployment.yaml'),
    expectExit: 0,
    expectOutput: ['Valid: 2, Invalid: 0, Errors: 0'],
  },
  {
    name: 'kubeconform, text payload (unknown field is rejected)',
    type: 'kubeconform',
    encoding: 'text',
    payload: () => readText('kubeconform-payload', 'invalid', 'deployment.yaml'),
    expectExit: 1,
    expectOutput: ["'replicaz' not allowed"],
  },
];

let failed = 0;
for (const c of cases) {
  const capability = { ...CAPABILITIES[c.type], image };
  const jobId = `check-${c.type}-${Date.now().toString(36)}`;
  const jobDir = await prepareJobDir(capability.payloadFileName, await c.payload(), c.encoding);
  try {
    const argv = buildDockerArgs(
      capability,
      { jobDir, containerName: `labjob-${jobId}`, jobId, encoding: c.encoding },
      LIMITS
    );
    const started = Date.now();
    const run = spawnSync('docker', argv, {
      encoding: 'utf8',
      timeout: (capability.timeoutSeconds + 15) * 1000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const problems = [];
    if (run.error) problems.push(`docker did not run: ${run.error.message}`);
    if (run.status !== c.expectExit) problems.push(`exit ${run.status}, expected ${c.expectExit}`);
    for (const want of c.expectOutput) {
      const found = typeof want === 'string' ? output.includes(want) : want.test(output);
      if (!found) problems.push(`output lacks ${want}`);
    }
    if (problems.length === 0) {
      console.log(`ok:   ${c.name} (exit ${run.status}, ${seconds}s)`);
    } else {
      failed += 1;
      console.log(`FAIL: ${c.name}: ${problems.join('; ')}`);
      console.log(`      docker ${argv.join(' ')}`);
      console.log(output.replace(/^/gm, '      '));
    }
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

if (failed > 0) {
  console.log(`sandbox-check: FAILED (${failed} of ${cases.length})`);
  process.exit(1);
}
console.log(`sandbox-check: passed (${cases.length} jobs on ${image})`);
