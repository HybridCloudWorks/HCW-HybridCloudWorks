import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://hybridcloudworks.com';
const CDP_URL = process.env.SMOKE_CDP_URL || 'http://127.0.0.1:9222';
const STATE_PATH =
  process.env.SMOKE_STORAGE_STATE ||
  path.resolve('reports/live-smoke/admin-storage-state.edge.json');

async function main() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });

  console.log('Connecting to existing Edge via CDP:', CDP_URL);
  console.log(
    'Make sure you are already signed in at ' + BASE_URL + '/admin in that Edge session.'
  );

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error('No browser context found over CDP. Open at least one tab in Edge first.');
  }

  const isHcwUrl = (u) => {
    try {
      const host = new URL(u).hostname;
      return host === 'hybridcloudworks.com' || host.endsWith('.hybridcloudworks.com');
    } catch {
      return false;
    }
  };
  let page = context.pages().find((p) => isHcwUrl(p.url()));
  if (!page) page = await context.newPage();

  await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);

  const authSelectors = [
    'text=Content Dashboard',
    'text=Sign Out',
    'a:has-text("Dashboard")',
    'a:has-text("Back to Site")',
  ];

  let hasAuthenticatedUi = false;
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

  if (!hasAuthenticatedUi) {
    throw new Error(
      'Authenticated admin UI not detected in connected Edge session. Sign in manually first and retry.'
    );
  }

  // Playwright uses `indexedDB: true` (not includeIndexedDB) to persist Firebase Auth state.
  try {
    await context.storageState({ path: STATE_PATH, indexedDB: true });
  } catch {
    await context.storageState({ path: STATE_PATH });
  }
  console.log(`Saved admin storage state to: ${STATE_PATH}`);
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
});
