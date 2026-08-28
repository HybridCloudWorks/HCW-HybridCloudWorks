/**
 * Sandboxed Docker execution.
 *
 * Security posture for every job:
 *   --network none          no network access (default; per-capability opt-out is NOT supported)
 *   --read-only             read-only root filesystem
 *   --memory / --cpus       resource limits from env config
 *   --pids-limit            fork-bomb protection
 *   --security-opt no-new-privileges
 *   --cap-drop ALL
 *   non-root user (65534)
 *   wall-clock timeout      container is force-killed on expiry
 *
 * The payload is written to a per-job temp dir on the host and mounted
 * read-only at /workspace. Commands come ONLY from the capability
 * allowlist (argv arrays — never shell-interpolated user strings).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const OUTPUT_CAP_BYTES = 64 * 1024;

function runProcess(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let truncated = false;
    let timedOut = false;

    const append = (chunk) => {
      if (out.length >= OUTPUT_CAP_BYTES) {
        truncated = true;
        return;
      }
      out += chunk.toString('utf8').slice(0, OUTPUT_CAP_BYTES - out.length);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, output: out, truncated, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, output: `spawn error: ${err.message}`, truncated, timedOut });
    });
  });
}

/**
 * The sandbox flags, in the order `buildDockerArgs` emits them.
 *
 * Exported so `docker-runner.test.js` asserts against a named list rather than
 * re-typing the array it is checking — a test that restates the implementation
 * passes whatever the implementation says (T-743). Each entry is
 * `[flag, value]`; a value of `null` means the flag takes no argument.
 *
 * Nothing here is per-capability. A capability contributes `extraDockerArgs`,
 * which are appended AFTER these and therefore cannot displace them — but note
 * that Docker's own last-wins behaviour means an `extraDockerArgs` entry
 * repeating one of these flags would still override it. `buildDockerArgs`
 * refuses that case rather than trusting the capability list to stay honest.
 */
export const SANDBOX_FLAGS = [
  ['--network', 'none'],
  ['--read-only', null],
  ['--security-opt', 'no-new-privileges'],
  ['--cap-drop', 'ALL'],
  ['--user', '65534:65534'],
];

/** Flags a capability may never set, because they weaken the sandbox. */
const RESERVED_FLAGS = new Set([
  ...SANDBOX_FLAGS.map(([flag]) => flag),
  '--privileged',
  '--pid',
  '--ipc',
  '--userns',
  '--cap-add',
  '--device',
  '--memory',
  '--cpus',
  '--pids-limit',
  '-v',
  '--volume',
  '--mount',
]);

/**
 * Build the full `docker` argv for one job.
 *
 * Pure and exported for testing: the sandbox flag list is this component's
 * entire security boundary, and before T-743 nothing asserted it stayed
 * intact — an edit dropping `--network none` shipped green.
 *
 * @param {object} capability entry from lib/capabilities.js
 * @param {object} ctx        { jobDir, containerName }
 * @param {object} limits     { memory, cpus, pidsLimit }
 * @returns {string[]} argv after the `docker` executable itself
 */
export function buildDockerArgs(capability, { jobDir, containerName }, limits) {
  const extra = capability.extraDockerArgs || [];
  const reserved = extra.filter((arg) => RESERVED_FLAGS.has(arg));
  if (reserved.length > 0) {
    // Refuse rather than emit a weakened sandbox. A capability is repository
    // code, so this is a developer error caught at run time, not an attacker
    // path — but the failure has to be loud, because the alternative is a
    // container that looks sandboxed in this file and is not.
    throw new Error(
      `capability may not set sandbox-controlled docker flags: ${reserved.join(', ')}`
    );
  }

  return [
    'run',
    '--rm',
    '--name', containerName,
    ...SANDBOX_FLAGS.flatMap(([flag, value]) => (value === null ? [flag] : [flag, value])),
    '--memory', limits.memory,
    '--cpus', limits.cpus,
    '--pids-limit', String(limits.pidsLimit),
    '-v', `${jobDir}:/workspace:ro`,
    ...extra,
    capability.image,
    ...capability.buildCommand(`/workspace/${capability.payloadFileName}`),
  ];
}

/**
 * Execute a job in a sandboxed container.
 * @param {object} capability entry from lib/capabilities.js
 * @param {string} payload   job payload string
 * @param {object} limits    { memory, cpus, pidsLimit } from env config
 * @returns {Promise<{exitCode:number, output:string, timedOut:boolean}>}
 */
export async function runInDocker(capability, payload, limits) {
  const jobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'labjob-'));
  const containerName = `labjob-${crypto.randomBytes(6).toString('hex')}`;
  try {
    const hostPayloadPath = path.join(jobDir, capability.payloadFileName);
    await fs.writeFile(hostPayloadPath, payload, 'utf8');

    const dockerArgs = buildDockerArgs(capability, { jobDir, containerName }, limits);

    const timeoutMs = (capability.timeoutSeconds + 15) * 1000; // grace for image pull/start
    const result = await runProcess('docker', dockerArgs, timeoutMs);

    if (result.timedOut) {
      // Ensure the container is gone (kill -> spawn kill is best-effort).
      await runProcess('docker', ['rm', '-f', containerName], 10000);
    }
    if (result.truncated) {
      result.output += '\n[output truncated at 64KB]';
    }
    return result;
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}
