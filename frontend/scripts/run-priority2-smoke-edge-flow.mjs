import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const statePath =
  process.env.SMOKE_STORAGE_STATE ||
  path.resolve(ROOT, 'reports/live-smoke/admin-storage-state.edge.json');

function runNodeScript(scriptPath, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

async function main() {
  const captureScript = path.resolve(ROOT, 'scripts/capture-admin-storage-state-edge.mjs');
  const smokeScript = path.resolve(ROOT, 'scripts/run-priority2-smoke-edge.mjs');

  const forceRecapture = process.env.SMOKE_RECAPTURE_AUTH === '1';
  const stateExists = fs.existsSync(statePath);

  if (forceRecapture || !stateExists) {
    console.log('Capturing admin storage state in Edge...');
    await runNodeScript(captureScript, { SMOKE_STORAGE_STATE: statePath });
  } else {
    console.log(`Using existing storage state: ${statePath}`);
  }

  console.log('Running Priority 2 smoke checks with authenticated state...');
  await runNodeScript(smokeScript, {
    SMOKE_STORAGE_STATE: statePath,
    SMOKE_HEADFUL: process.env.SMOKE_HEADFUL || '0',
  });
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
});
