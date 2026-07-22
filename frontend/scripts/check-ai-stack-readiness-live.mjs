import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(REPO_ROOT, '.env.local'), override: false });
dotenv.config({ path: path.join(REPO_ROOT, '.env'), override: false });

function parseArgs(argv) {
  const args = {
    help: false,
    dryRun: false,
    endpoint: process.env.CONTENTFORGE_AI_READINESS_URL || '',
    project:
      process.env.CONTENTFORGE_FIREBASE_PROJECT ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      'hybridcloudworks-61e8d',
    region: process.env.CONTENTFORGE_FUNCTIONS_REGION || 'us-central1',
    baseUrl: process.env.SMOKE_BASE_URL || 'https://hybridcloudworks.com',
    headless: process.env.SMOKE_HEADFUL === '1' ? false : true,
    storageStatePath:
      process.env.SMOKE_STORAGE_STATE ||
      path.join(REPO_ROOT, 'reports', 'live-smoke', 'admin-storage-state.edge.json'),
    edgeUserDataDir:
      process.env.SMOKE_EDGE_PROFILE_DIR ||
      path.join(REPO_ROOT, 'reports', 'live-smoke', 'edge-smoke-profile'),
  };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--help' || current === '-h') {
      args.help = true;
      continue;
    }

    if (current === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (current === '--endpoint' && argv[index + 1]) {
      args.endpoint = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--project' && argv[index + 1]) {
      args.project = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--region' && argv[index + 1]) {
      args.region = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--base-url' && argv[index + 1]) {
      args.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return args;
}

function buildEndpoint(project, region) {
  if (!project) return '';
  return `https://${region}-${project}.cloudfunctions.net/aiStackReadiness`;
}

function getFirebaseConfig() {
  return {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
  };
}

function validateFirebaseConfig(config) {
  const missing = Object.entries(config)
    .filter(([, value]) => !String(value || '').trim())
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase web config values: ${missing.join(', ')}. ` +
        'Load the site env first so a browser session can restore Firebase Auth.'
    );
  }
}

async function waitForAuthenticatedUi(page) {
  const authSelectors = [
    'text=Content Dashboard',
    'text=Sign Out',
    'a:has-text("Dashboard")',
    'a:has-text("Back to Site")',
  ];

  const maxWaitMs = 5 * 60 * 1000;
  const pollEveryMs = 1000;

  for (let waited = 0; waited <= maxWaitMs; waited += pollEveryMs) {
    for (const selector of authSelectors) {
      const count = await page
        .locator(selector)
        .count()
        .catch(() => 0);
      if (count > 0) {
        return true;
      }
    }
    await page.waitForTimeout(pollEveryMs);
  }

  return false;
}

async function readAuthState(page, firebaseConfig) {
  return page.evaluate(
    async ({ apiKey }) => {
      const authKeyPrefix = `firebase:authUser:${apiKey}:`;
      const authStorageKey = Object.keys(localStorage).find((key) => key.startsWith(authKeyPrefix));

      let user = null;
      let storageKey = authStorageKey || null;
      let storageSource = 'localStorage';

      if (authStorageKey) {
        const rawUser = localStorage.getItem(authStorageKey);
        if (!rawUser) {
          throw new Error(`Firebase auth storage key was present but empty: ${authStorageKey}`);
        }
        user = JSON.parse(rawUser);
      } else {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('firebaseLocalStorageDb');
          request.onerror = () =>
            reject(request.error || new Error('Failed to open firebaseLocalStorageDb'));
          request.onsuccess = () => resolve(request.result);
        });

        if (!Array.from(db.objectStoreNames).includes('firebaseLocalStorage')) {
          db.close();
          throw new Error(
            'Firebase auth IndexedDB store is not available in this browser session.'
          );
        }

        const records = await new Promise((resolve, reject) => {
          const transaction = db.transaction(['firebaseLocalStorage'], 'readonly');
          const store = transaction.objectStore('firebaseLocalStorage');
          const request = store.getAll();

          request.onerror = () =>
            reject(request.error || new Error('Failed to read firebaseLocalStorage object store'));
          request.onsuccess = () => resolve(request.result || []);
        });

        db.close();

        const authRecord = records.find((record) =>
          String(record?.fbase_key || '').startsWith(authKeyPrefix)
        );
        if (!authRecord?.value) {
          throw new Error(
            'No Firebase auth user found in browser storage (localStorage or IndexedDB).'
          );
        }

        user = authRecord.value;
        storageKey = authRecord.fbase_key || null;
        storageSource = 'indexedDB';
      }

      const token = user?.stsTokenManager?.accessToken || '';

      if (!token || token.split('.').length !== 3) {
        throw new Error('Firebase auth user exists but does not contain a valid ID token.');
      }

      return {
        token,
        uid: user.uid,
        email: user.email,
        storageKey,
        storageSource,
      };
    },
    { apiKey: firebaseConfig.apiKey }
  );
}

async function createPersistentFallbackSession(args) {
  console.log(`Opening Edge smoke profile at: ${args.edgeUserDataDir}`);
  console.log('If admin auth is not already restored, sign in at /admin in the opened window.');

  const context = await chromium.launchPersistentContext(args.edgeUserDataDir, {
    channel: 'msedge',
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  return { browser: null, context, mode: 'persistentEdgeProfile' };
}

async function createBrowserSession(args) {
  if (fs.existsSync(args.storageStatePath)) {
    try {
      const browser = await chromium.launch({ channel: 'msedge', headless: args.headless });
      const context = await browser.newContext({
        storageState: args.storageStatePath,
        viewport: { width: 1440, height: 900 },
      });
      return { browser, context, mode: 'storageState' };
    } catch (error) {
      throw new Error(`Failed to use stored admin auth state: ${String(error?.message || error)}`);
    }
  }

  return createPersistentFallbackSession(args);
}

function printHelp() {
  console.log(`Usage: node scripts/check-ai-stack-readiness-live.mjs [options]

Fetch a Firebase ID token from the current admin browser auth context and call deployed aiStackReadiness.

Options:
  --endpoint <url>    Override the readiness endpoint URL
  --project <id>      Firebase project id used to derive the endpoint
  --region <region>   Cloud Functions region (default: us-central1)
  --base-url <url>    Site base URL used to open /admin (default: https://hybridcloudworks.com)
  --dry-run           Print resolved config and exit without opening a browser
  --help              Show this help
`);
}

async function run() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  const endpoint = args.endpoint || buildEndpoint(args.project, args.region);
  if (!endpoint) {
    throw new Error('Unable to resolve aiStackReadiness endpoint. Pass --endpoint or --project.');
  }

  const firebaseConfig = getFirebaseConfig();
  validateFirebaseConfig(firebaseConfig);

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          endpoint,
          baseUrl: args.baseUrl,
          storageStatePath: args.storageStatePath,
          edgeUserDataDir: args.edgeUserDataDir,
        },
        null,
        2
      )
    );
    return;
  }

  let browser = null;
  let context = null;
  let sessionMode = 'unknown';

  try {
    ({ browser, context, mode: sessionMode } = await createBrowserSession(args));
    let page = context.pages()[0] || (await context.newPage());
    console.log(`Using ${sessionMode} session against ${args.baseUrl}/admin`);
    await page.goto(`${args.baseUrl}/admin`, { waitUntil: 'domcontentloaded', timeout: 45000 });

    if (sessionMode !== 'storageState') {
      console.log('Waiting for authenticated admin UI...');
      const hasAuthenticatedUi = await waitForAuthenticatedUi(page);
      if (!hasAuthenticatedUi) {
        throw new Error(
          'Authenticated admin UI not detected. Sign in to the opened Edge window or run npm run smoke:auth:capture first.'
        );
      }
    }

    let authState;

    try {
      authState = await readAuthState(page, firebaseConfig);
    } catch (error) {
      if (sessionMode !== 'storageState') {
        throw error;
      }

      console.log(
        'Stored browser auth state did not restore Firebase auth. Retrying with the persistent Edge smoke profile...'
      );

      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});

      ({ browser, context, mode: sessionMode } = await createPersistentFallbackSession(args));
      page = context.pages()[0] || (await context.newPage());
      console.log(`Using ${sessionMode} session against ${args.baseUrl}/admin`);
      await page.goto(`${args.baseUrl}/admin`, { waitUntil: 'domcontentloaded', timeout: 45000 });

      console.log('Waiting for authenticated admin UI...');
      const hasAuthenticatedUi = await waitForAuthenticatedUi(page);
      if (!hasAuthenticatedUi) {
        throw new Error(
          'Stored auth state could not restore a Firebase session, and the persistent Edge smoke profile is not signed in. Run npm run smoke:auth:capture or sign in at /admin in the opened Edge window.'
        );
      }

      authState = await readAuthState(page, firebaseConfig);
    }

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authState.token}`,
      },
    });

    const payload = await response.json().catch(() => ({}));

    console.log(
      JSON.stringify(
        {
          mode: 'remote-browser-auth',
          auth: {
            email: authState.email,
            uid: authState.uid,
            session: sessionMode,
            storageSource: authState.storageSource,
            storageKey: authState.storageKey,
          },
          endpoint,
          ...payload,
        },
        null,
        2
      )
    );

    if (!response.ok) {
      process.exitCode = 1;
      return;
    }

    if (payload?.readiness?.ready === false) {
      process.exitCode = 2;
    }
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

run().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
