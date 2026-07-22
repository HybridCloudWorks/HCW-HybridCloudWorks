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

const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const OUTPUT_CAP_BYTES = 64 * 1024;

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
 * Execute a job in a sandboxed container.
 * @param {object} capability entry from lib/capabilities.js
 * @param {string} payload   job payload string
 * @param {object} limits    { memory, cpus, pidsLimit } from env config
 * @returns {Promise<{exitCode:number, output:string, timedOut:boolean}>}
 */
async function runInDocker(capability, payload, limits) {
  const jobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'labjob-'));
  const containerName = `labjob-${crypto.randomBytes(6).toString('hex')}`;
  try {
    const hostPayloadPath = path.join(jobDir, capability.payloadFileName);
    await fs.writeFile(hostPayloadPath, payload, 'utf8');

    const containerPayloadPath = `/workspace/${capability.payloadFileName}`;
    const command = capability.buildCommand(containerPayloadPath);

    const dockerArgs = [
      'run',
      '--rm',
      '--name', containerName,
      '--network', 'none',
      '--read-only',
      '--memory', limits.memory,
      '--cpus', limits.cpus,
      '--pids-limit', String(limits.pidsLimit),
      '--security-opt', 'no-new-privileges',
      '--cap-drop', 'ALL',
      '--user', '65534:65534',
      '-v', `${jobDir}:/workspace:ro`,
      ...(capability.extraDockerArgs || []),
      capability.image,
      ...command,
    ];

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

module.exports = { runInDocker, OUTPUT_CAP_BYTES };
