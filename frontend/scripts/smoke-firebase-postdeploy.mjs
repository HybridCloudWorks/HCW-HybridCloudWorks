import { execSync } from 'node:child_process';

const projectId =
  process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'hybridcloudworks-61e8d';
const baseUrl = process.env.SMOKE_BASE_URL || `https://${projectId}.web.app`;

const targetFunctionNames = (
  process.env.SMOKE_FUNCTIONS ||
  'getCurrentAdminStatus,getAdminDashboardSnapshot,getQueueSnapshot,listContentItems,bootstrapCurrentUserAdmin'
)
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

const checks = [];

function logHeader(title) {
  console.log(`\n=== ${title} ===`);
}

function addCheck(target, url, status, ok, notes = '') {
  checks.push({ target, url, status, ok, notes });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function parseFunctionsListFromCliOutput(output) {
  const jsonStart = output.indexOf('{');
  const jsonEnd = output.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error('Could not find JSON payload in firebase functions:list output.');
  }

  const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  const collected = [];

  function walk(node) {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }

    if (typeof node.id === 'string' && typeof node.uri === 'string') {
      collected.push({ id: node.id, uri: node.uri, state: node.state || 'UNKNOWN' });
    }

    Object.values(node).forEach(walk);
  }

  walk(parsed);

  // Ensure unique IDs in case the JSON includes multiple references.
  const deduped = new Map();
  collected.forEach((entry) => {
    if (!deduped.has(entry.id)) {
      deduped.set(entry.id, entry);
    }
  });

  return deduped;
}

function getFunctionMap() {
  try {
    const cmd = `firebase functions:list --json --project ${projectId}`;
    const output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return parseFunctionsListFromCliOutput(output);
  } catch (error) {
    const message = error?.message || String(error);
    console.warn(`Warning: unable to read function metadata from Firebase CLI: ${message}`);
    return new Map();
  }
}

function isHostingStatusOk(status) {
  return status >= 200 && status < 400;
}

function isFunctionStatusOk(status) {
  // For admin-protected endpoints, 401/403/405 still prove the function is deployed and reachable.
  return status >= 200 && status < 500 && status !== 404;
}

async function checkUrl(target, url, statusFn, notes = '') {
  try {
    const response = await fetchWithTimeout(url, { method: 'GET' });
    const ok = statusFn(response.status);
    addCheck(target, url, response.status, ok, notes);
  } catch (error) {
    addCheck(target, url, 'ERR', false, String(error?.message || error));
  }
}

async function run() {
  logHeader('Firebase Post-Deploy Smoke');
  console.log(`Project: ${projectId}`);
  console.log(`Hosting base URL: ${baseUrl}`);

  logHeader('Hosting Checks');
  await checkUrl('hosting.root', `${baseUrl}/`, isHostingStatusOk);
  await checkUrl('hosting.firebase-init', `${baseUrl}/__/firebase/init.json`, isHostingStatusOk);

  logHeader('Function Checks');
  const discovered = getFunctionMap();

  for (const name of targetFunctionNames) {
    const entry = discovered.get(name);
    const url = entry?.uri || `https://us-central1-${projectId}.cloudfunctions.net/${name}`;
    const notes = entry ? `state=${entry.state}` : 'cli-metadata=missing,fallback=url-pattern';
    await checkUrl(`function.${name}`, `${url}?smoke=1`, isFunctionStatusOk, notes);
  }

  const failures = checks.filter((item) => !item.ok);

  logHeader('Smoke Summary');
  checks.forEach((item) => {
    const marker = item.ok ? 'PASS' : 'FAIL';
    const details = item.notes ? ` (${item.notes})` : '';
    console.log(`[${marker}] ${item.target} -> status=${item.status} ${item.url}${details}`);
  });

  if (failures.length > 0) {
    console.error(`\nPost-deploy smoke failed: ${failures.length} check(s) did not pass.`);
    process.exit(1);
  }

  console.log('\nPost-deploy smoke passed.');
}

run().catch((error) => {
  console.error(`Post-deploy smoke crashed: ${String(error?.message || error)}`);
  process.exit(1);
});
