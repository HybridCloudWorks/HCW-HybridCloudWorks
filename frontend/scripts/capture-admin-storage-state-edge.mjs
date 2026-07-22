import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://hybridcloudworks.com';
const STATE_PATH =
  process.env.SMOKE_STORAGE_STATE ||
  path.resolve('reports/live-smoke/admin-storage-state.edge.json');

// Prefer a dedicated smoke profile dir to avoid locking/crashing the real Edge profile.
const EDGE_USER_DATA_DIR =
  process.env.SMOKE_EDGE_PROFILE_DIR || path.resolve('reports/live-smoke/edge-smoke-profile');

async function main() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });

  console.log(`Using real Edge profile at: ${EDGE_USER_DATA_DIR}`);
  console.log('If this is the first run for the smoke profile, you may need to sign in manually.');
  console.log('Close all Edge windows using this same profile dir to avoid lock conflicts.');

  // launchPersistentContext uses the real Edge profile which already has Google auth cookies
  const context = await chromium.launchPersistentContext(EDGE_USER_DATA_DIR, {
    channel: 'msedge',
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  const page = context.pages()[0] || (await context.newPage());

  console.log(`Opening ${BASE_URL}/admin ...`);
  await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);

  const authSelectors = [
    'text=Content Dashboard',
    'text=Sign Out',
    'a:has-text("Dashboard")',
    'a:has-text("Back to Site")',
  ];

  let hasAuthenticatedUi = false;
  const maxWaitMs = 5 * 60 * 1000;
  const pollEveryMs = 1000;
  for (let waited = 0; waited <= maxWaitMs; waited += pollEveryMs) {
    for (const selector of authSelectors) {
      const count = await page
        .locator(selector)
        .count()
        .catch(() => 0);
      if (count > 0) {
        hasAuthenticatedUi = true;
        break;
      }
    }
    if (hasAuthenticatedUi) break;
    await page.waitForTimeout(pollEveryMs);
  }

  if (!hasAuthenticatedUi) {
    await context.close();
    throw new Error(
      'Authenticated admin UI not detected. Sign in to https://hybridcloudworks.com/admin in the opened Edge window and retry.'
    );
  }

  // Playwright uses `indexedDB: true` (not includeIndexedDB) to persist Firebase Auth state.
  try {
    await context.storageState({ path: STATE_PATH, indexedDB: true });
  } catch {
    await context.storageState({ path: STATE_PATH });
  }
  console.log(`Saved admin storage state to: ${STATE_PATH}`);

  await context.close();
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
});
