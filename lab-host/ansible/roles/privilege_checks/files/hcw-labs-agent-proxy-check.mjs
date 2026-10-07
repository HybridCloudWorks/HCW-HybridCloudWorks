#!/usr/bin/node
/**
 * The end-of-run check that the lab agent's way to Docker works and is
 * narrow (LAB-5, 2026-10-07). Installed by the privilege_checks role as
 * /usr/local/libexec/hcw-labs-agent-proxy-check.mjs and run by it as the
 * agent user, with the agent unit's DOCKER_HOST and TMPDIR:
 *
 *   1. one shell-echo job, through the agent's own runInDocker from its
 *      checkout, so the argv, the staging directory and the proxy are the
 *      ones a real job meets; it must print its payload and exit 0;
 *   2. `docker ps`, a call no job makes, which the proxy must refuse;
 *   3. a job-shaped `docker run` with --privileged, which the proxy must
 *      refuse for its body.
 *
 *   node hcw-labs-agent-proxy-check.mjs <agent app dir> <memory> <cpus> <pids>
 *
 * Prints one JSON object and exits 0 when all three came out as expected,
 * 1 otherwise.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [appDir, memory, cpus, pids] = process.argv.slice(2);
if (!appDir || !memory || !cpus || !pids) {
  process.stderr.write('usage: hcw-labs-agent-proxy-check.mjs <agent app dir> <memory> <cpus> <pids>\n');
  process.exit(2);
}
const { runInDocker } = await import(pathToFileURL(path.join(appDir, 'lib', 'docker-runner.js')).href);
const { CAPABILITIES, IMAGES } = await import(pathToFileURL(path.join(appDir, 'lib', 'capabilities.js')).href);

const docker = (args) => {
  const run = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 });
  return { exitCode: run.status, output: `${run.stdout || ''}${run.stderr || ''}`.trim().slice(0, 2000) };
};

const marker = `hcw-labs-agent proxy check ${process.pid}`;
const job = await runInDocker(
  CAPABILITIES['shell-echo'],
  { id: 'bootstrap-proxy-check', payload: marker },
  { memory, cpus, pidsLimit: Number(pids) }
);
const listing = docker(['ps']);
const privileged = docker([
  'run', '--rm', '--name', 'labjob-000000000000', '--privileged', '--network', 'none', IMAGES.alpine, 'true',
]);

const result = {
  job: { ok: job.exitCode === 0 && job.output.includes(marker), exitCode: job.exitCode, output: job.output.slice(0, 2000) },
  listing: { ok: listing.exitCode !== 0 && listing.output.includes('refused this call'), ...listing },
  privileged: { ok: privileged.exitCode !== 0 && privileged.output.includes('refused this container'), ...privileged },
};
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(Object.values(result).every((check) => check.ok) ? 0 : 1);
