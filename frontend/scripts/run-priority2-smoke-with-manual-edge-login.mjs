import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const BASE_URL = process.env.SMOKE_BASE_URL || 'https://hybridcloudworks.com';
const STATE_PATH =
  process.env.SMOKE_STORAGE_STATE ||
  path.resolve(ROOT, 'reports/live-smoke/admin-storage-state.edge.json');

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function main() {
  console.log('STEP 1: Start Edge with remote debugging in a separate terminal:');
  console.log('  msedge --remote-debugging-port=9222');
  console.log(`STEP 2: In that Edge window, sign in to ${BASE_URL}/admin normally.`);
  console.log('STEP 3: Press Enter here when Content Dashboard is visible...');

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });

  console.log('Capturing storage state from your live Edge session...');
  await run(
    process.execPath,
    [path.resolve(ROOT, 'scripts/capture-admin-storage-state-from-edge-cdp.mjs')],
    {
      SMOKE_STORAGE_STATE: STATE_PATH,
      SMOKE_BASE_URL: BASE_URL,
    }
  );

  console.log('Running authenticated Priority 2 smoke checks...');
  await run(process.execPath, [path.resolve(ROOT, 'scripts/run-priority2-smoke-edge.mjs')], {
    SMOKE_STORAGE_STATE: STATE_PATH,
    SMOKE_BASE_URL: BASE_URL,
    SMOKE_HEADFUL: process.env.SMOKE_HEADFUL || '0',
  });
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
});
