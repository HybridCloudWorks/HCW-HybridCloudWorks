import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';

dotenv.config({ path: '.env.local', override: false });
dotenv.config();

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://hybridcloudworks.com';
const FUNCTIONS_BASE = process.env.VITE_GCP_FUNCTIONS_URL;
const STORAGE_STATE_PATH =
  process.env.SMOKE_STORAGE_STATE ||
  path.resolve('reports/live-smoke/admin-storage-state.edge.json');
const EDGE_USER_DATA_DIR =
  process.env.SMOKE_EDGE_PROFILE_DIR || path.resolve('reports/live-smoke/edge-smoke-profile');
const OUT_DIR = path.resolve('reports/live-smoke');
const HEADLESS = process.env.SMOKE_HEADFUL === '1' ? false : true;

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

if (!FUNCTIONS_BASE) {
  throw new Error('VITE_GCP_FUNCTIONS_URL is required to run the hardened admin smoke.');
}

const result = {
  metadata: {
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    functionsBase: FUNCTIONS_BASE,
    storageStatePath: STORAGE_STATE_PATH,
    headless: HEADLESS,
  },
  checks: [],
  artifacts: {},
  notes: [],
};

function addCheck(id, status, evidence, notes = '') {
  result.checks.push({ id, status, evidence, notes });
}

function makeContentSlug(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function initFirebaseHelpers(page) {
  return page.evaluate(
    async ({ config, functionsBase }) => {
      const [{ initializeApp, getApps, getApp }, authModule, firestoreModule] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js'),
      ]);

      // Reuse the site's default app so Auth persistence can be restored.
      const app = getApps().length ? getApp() : initializeApp(config);
      const auth = authModule.getAuth(app);
      await new Promise((resolve) => {
        const unsubscribe = authModule.onAuthStateChanged(auth, () => {
          unsubscribe();
          resolve();
        });
        setTimeout(resolve, 20000);
      });

      const db = firestoreModule.getFirestore(app);
      const user = auth.currentUser;
      if (!user) {
        throw new Error('No authenticated admin user restored from storage state');
      }

      return {
        token: await user.getIdToken(),
        uid: user.uid,
        email: user.email,
        functionsBase,
      };
    },
    { config: firebaseConfig, functionsBase: FUNCTIONS_BASE }
  );
}

async function createBrowserSession() {
  try {
    const browser = await chromium.launch({ channel: 'msedge', headless: HEADLESS });
    const context = await browser.newContext({
      storageState: STORAGE_STATE_PATH,
      viewport: { width: 1440, height: 900 },
    });
    return { browser, context, mode: 'storageState' };
  } catch (error) {
    throw new Error(
      `Failed to create storage-state browser context: ${String(error?.message || error)}`
    );
  }
}

async function createPersistentFallbackSession() {
  const context = await chromium.launchPersistentContext(EDGE_USER_DATA_DIR, {
    channel: 'msedge',
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  return { browser: null, context, mode: 'persistentEdgeProfile' };
}

async function postFunction(page, token, fnName, body) {
  return page.evaluate(
    async ({ token: nextToken, fnName: nextFnName, body: nextBody, functionsBase }) => {
      const response = await fetch(`${functionsBase}/${nextFnName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nextToken}`,
        },
        body: JSON.stringify(nextBody),
      });
      const payload = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, payload };
    },
    { token, fnName, body, functionsBase: FUNCTIONS_BASE }
  );
}

async function directFirestoreWriteAttempt(page, marker) {
  return page.evaluate(
    async ({ config, marker: nextMarker }) => {
      const [{ initializeApp, getApps, getApp }, firestoreModule] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js'),
      ]);
      const app = getApps().length ? getApp() : initializeApp(config);
      const db = firestoreModule.getFirestore(app);
      try {
        await firestoreModule.addDoc(firestoreModule.collection(db, 'admin_audit_logs'), {
          action: `forged-${nextMarker}`,
          clientTimestamp: new Date().toISOString(),
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, code: error.code || null, message: String(error.message || error) };
      }
    },
    { config: firebaseConfig, marker }
  );
}

async function readAuditEntries(page, marker) {
  return page.evaluate(
    async ({ config, marker: nextMarker }) => {
      const [{ initializeApp, getApps, getApp }, firestoreModule] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js'),
      ]);
      const app = getApps().length ? getApp() : initializeApp(config);
      const db = firestoreModule.getFirestore(app);
      const q = firestoreModule.query(
        firestoreModule.collection(db, 'admin_audit_logs'),
        firestoreModule.where('action', '==', `smoke_audit_${nextMarker}`)
      );
      const snap = await firestoreModule.getDocs(q);
      return snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    },
    { config: firebaseConfig, marker }
  );
}

async function run() {
  let browser = null;
  let context = null;
  let page = null;
  const marker = `hcw-smoke-${Date.now()}`;
  let contentId = null;
  let blogId = null;
  let promptSetName = `${marker}-set`;

  try {
    ({ browser, context } = await createBrowserSession());
    page = await context.newPage();
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    addCheck('admin.dashboard.load', 'pass', page.url());

    let authState = null;
    try {
      authState = await initFirebaseHelpers(page);
    } catch (error) {
      result.notes.push(`Storage-state auth restore failed: ${String(error?.message || error)}`);
      await context.close().catch(() => {});
      await browser?.close().catch(() => {});
      ({ browser, context } = await createPersistentFallbackSession());
      page = context.pages()[0] || (await context.newPage());
      await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      addCheck('admin.dashboard.load.persistentFallback', 'pass', page.url());
      authState = await initFirebaseHelpers(page);
      result.notes.push('Live smoke used persistent Edge profile fallback.');
    }
    addCheck('admin.auth.restored', 'pass', authState.email || authState.uid);

    const createResult = await postFunction(page, authState.token, 'createContentItem', {
      data: {
        type: 'blog',
        publishTarget: 'blog',
        Title: `Smoke ${marker}`,
        title: `Smoke ${marker}`,
        Summary: 'Smoke summary',
        summary: 'Smoke summary',
        blogDraft: '## Smoke Draft\n\nLive smoke content body.',
        content: '## Smoke Draft\n\nLive smoke content body.',
        sidebarContent: 'Smoke sidebar',
        Tags: ['smoke', 'admin'],
        slug: makeContentSlug(marker),
        sourceUrl: `${BASE_URL}/smoke/${marker}`,
        url: `${BASE_URL}/smoke/${marker}`,
        cloudProvider: 'Azure',
        'Cloud Provider': 'Azure',
        contentStatus: 'inspected',
      },
    });
    if (!createResult.ok)
      throw new Error(`createContentItem failed: ${JSON.stringify(createResult)}`);
    contentId = createResult.payload.contentId;
    result.artifacts.contentId = contentId;
    addCheck('smoke.content.create', 'pass', contentId);

    await page.goto(`${BASE_URL}/admin/editor/${contentId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    addCheck(
      'admin.editor.load',
      page.url().includes(`/admin/editor/${contentId}`) ? 'pass' : 'fail',
      page.url()
    );

    const saveResult = await postFunction(page, authState.token, 'saveEditorDraft', {
      contentId,
      expectedEditedAtMs: 0,
      force: false,
      draft: '## Smoke Draft\n\nUpdated from hardened live smoke.',
      title: `Smoke ${marker} Updated`,
      authorName: 'Smoke Runner',
      publishedDate: '2026-04-12',
      summary: 'Updated summary',
      tags: 'smoke,admin,live',
      sidebarContent: 'Updated sidebar',
      orderedImageUrls: [],
    });
    addCheck('editor.save', saveResult.ok ? 'pass' : 'fail', JSON.stringify(saveResult.payload));
    if (!saveResult.ok)
      throw new Error(`saveEditorDraft failed: ${JSON.stringify(saveResult.payload)}`);

    const approveResult = await postFunction(page, authState.token, 'transitionContentStatus', {
      contentId,
      newStatus: 'approved_blog',
      reviewNotes: `Smoke approve ${marker}`,
    });
    addCheck(
      'content.approve',
      approveResult.ok ? 'pass' : 'fail',
      JSON.stringify(approveResult.payload)
    );
    if (!approveResult.ok)
      throw new Error(`transitionContentStatus failed: ${JSON.stringify(approveResult.payload)}`);

    const publishResult = await postFunction(page, authState.token, 'publishContentToBlogs', {
      contentIds: [contentId],
      publishTarget: 'blog',
      cloudProvider: 'Azure',
      markLive: true,
      createSlugPageTrigger: true,
      addToCurated: false,
    });
    addCheck(
      'content.publish',
      publishResult.ok ? 'pass' : 'fail',
      JSON.stringify(publishResult.payload)
    );
    if (!publishResult.ok)
      throw new Error(`publishContentToBlogs failed: ${JSON.stringify(publishResult.payload)}`);
    blogId = publishResult.payload?.mappings?.[0]?.blogId || null;
    result.artifacts.blogId = blogId;

    await page.goto(`${BASE_URL}/admin/published`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    addCheck(
      'admin.published.load',
      page.url().includes('/admin/published') ? 'pass' : 'fail',
      page.url()
    );

    const unpublishPublishResult = await postFunction(
      page,
      authState.token,
      'unpublishContentToInspected',
      {
        contentId,
        reviewNotes: 'Unpublished from Publish pane and returned to preview',
      }
    );
    addCheck(
      'publish.unpublish',
      unpublishPublishResult.ok ? 'pass' : 'fail',
      JSON.stringify(unpublishPublishResult.payload)
    );
    if (!unpublishPublishResult.ok) {
      throw new Error(
        `unpublishContentToInspected failed: ${JSON.stringify(unpublishPublishResult.payload)}`
      );
    }

    const afterFirstUnpublish = await postFunction(page, authState.token, 'getContentItem', {
      contentId,
    });
    const firstItem = afterFirstUnpublish.payload?.item || {};
    addCheck(
      'publish.timestamps.preserved',
      firstItem.publishedAt || firstItem.blogPublishedAt ? 'pass' : 'fail',
      JSON.stringify({
        publishedAt: firstItem.publishedAt || null,
        blogPublishedAt: firstItem.blogPublishedAt || null,
        contentStatus: firstItem.contentStatus || null,
      })
    );

    await postFunction(page, authState.token, 'transitionContentStatus', {
      contentId,
      newStatus: 'approved_blog',
      reviewNotes: `Smoke re-approve ${marker}`,
    });
    await postFunction(page, authState.token, 'publishContentToBlogs', {
      contentIds: [contentId],
      publishTarget: 'blog',
      cloudProvider: 'Azure',
      markLive: true,
      createSlugPageTrigger: true,
      addToCurated: false,
    });

    const unpublishEditorResult = await postFunction(
      page,
      authState.token,
      'unpublishContentToInspected',
      {
        contentId,
        reviewNotes:
          'Unpublished from Editor board (was published_blog) - returned to review queue',
      }
    );
    addCheck(
      'editor.unpublish',
      unpublishEditorResult.ok ? 'pass' : 'fail',
      JSON.stringify(unpublishEditorResult.payload)
    );

    const saveSetResult = await postFunction(page, authState.token, 'manageImagePromptConfig', {
      action: 'saveSet',
      setName: promptSetName,
      primaryPrompt: `Primary prompt for ${marker}`,
    });
    addCheck(
      'prompts.set.save',
      saveSetResult.ok ? 'pass' : 'fail',
      JSON.stringify(saveSetResult.payload)
    );

    const pageAssignmentResult = await postFunction(
      page,
      authState.token,
      'manageImagePromptConfig',
      {
        action: 'savePageAssignment',
        pagePath: '/azure/blog',
        setName: promptSetName,
        promptName: '',
      }
    );
    addCheck(
      'prompts.pageAssignment.save',
      pageAssignmentResult.ok ? 'pass' : 'fail',
      JSON.stringify(pageAssignmentResult.payload)
    );

    const deleteSetResult = await postFunction(page, authState.token, 'manageImagePromptConfig', {
      action: 'deleteSet',
      setName: promptSetName,
    });
    addCheck(
      'prompts.set.delete',
      deleteSetResult.ok ? 'pass' : 'fail',
      JSON.stringify(deleteSetResult.payload)
    );

    const auditResult = await postFunction(page, authState.token, 'recordAdminAudit', {
      action: `smoke_audit_${marker}`,
      details: { marker, route: '/admin' },
    });
    addCheck(
      'audit.backend.write',
      auditResult.ok ? 'pass' : 'fail',
      JSON.stringify(auditResult.payload)
    );

    const auditEntries = await readAuditEntries(page, marker);
    addCheck(
      'audit.backend.readback',
      auditEntries.length > 0 ? 'pass' : 'fail',
      `entries=${auditEntries.length}`
    );

    const directWrite = await directFirestoreWriteAttempt(page, marker);
    addCheck(
      'audit.client.write.blocked',
      directWrite.ok === false && String(directWrite.code || '').includes('permission-denied')
        ? 'pass'
        : 'fail',
      JSON.stringify(directWrite)
    );
  } catch (error) {
    addCheck(
      'runner.execution',
      'fail',
      'Hardened admin live smoke failed',
      String(error?.message || error)
    );
  } finally {
    if (contentId) {
      try {
        await postFunction(
          page,
          await initFirebaseHelpers(page).then((auth) => auth.token),
          'softDeleteLivePage',
          {
            contentId,
            blogId,
            reason: `Smoke cleanup ${marker}`,
          }
        );
      } catch (error) {
        result.notes.push(`Cleanup failed for ${contentId}: ${String(error?.message || error)}`);
      }
    }
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

  result.metadata.endedAt = new Date().toISOString();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `admin-hardened-smoke-${Date.now()}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ file: outFile, checks: result.checks }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
