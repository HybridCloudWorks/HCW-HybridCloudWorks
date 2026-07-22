import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', override: false });
dotenv.config();

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://hybridcloudworks.com';
const FUNCTIONS_BASE = process.env.VITE_GCP_FUNCTIONS_URL;
const OUT_DIR = path.resolve('reports/live-smoke');

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
};

function normalizeBearerToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // Accept common copy/paste variants from DevTools (case-insensitive).
  // Examples:
  // - "eyJ..."
  // - "Bearer eyJ..."
  // - "authorization: Bearer eyJ..."
  const match = raw.match(/bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)/i);
  if (match?.[1]) return match[1].trim();
  // Fall back to raw if it already looks like a JWT.
  if (raw.split('.').length === 3) return raw;
  return raw;
}

const SMOKE_ID_TOKEN = normalizeBearerToken(process.env.SMOKE_ID_TOKEN);

if (!FUNCTIONS_BASE) throw new Error('VITE_GCP_FUNCTIONS_URL is required.');
if (!firebaseConfig.projectId) throw new Error('VITE_FIREBASE_PROJECT_ID is required.');
if (!SMOKE_ID_TOKEN) {
  throw new Error(
    'SMOKE_ID_TOKEN is required. Copy it from a normal signed-in browser Network request Authorization header. ' +
      'Either paste the raw JWT (`eyJ...`) or the full `Bearer <token>` value.'
  );
}

if (SMOKE_ID_TOKEN.split('.').length !== 3) {
  throw new Error(
    'SMOKE_ID_TOKEN looks truncated. It must be a full JWT with 3 dot-separated parts (header.payload.signature). ' +
      'In DevTools Network, open the POST request, find Request Headers -> Authorization, and use "Copy value" to copy the full token.'
  );
}

const result = {
  metadata: {
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    functionsBase: FUNCTIONS_BASE,
  },
  checks: [],
  artifacts: {},
  notes: [],
};

function addCheck(id, status, evidence, notes = '') {
  result.checks.push({ id, status, evidence, notes });
}

async function postFunction(fnName, body) {
  let response;
  try {
    response = await fetch(`${FUNCTIONS_BASE}/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SMOKE_ID_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      payload: {
        error: 'fetch_failed',
        fn: fnName,
        message: String(err?.message || err),
      },
    };
  }

  const payload = await response
    .json()
    .catch(async () => ({ raw: await response.text().catch(() => ''), status: response.status }));
  return { ok: response.ok, status: response.status, payload };
}

async function firestoreRunQueryByAction(actionValue) {
  // Firestore REST: https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents:runQuery`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SMOKE_ID_TOKEN}`,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'admin_audit_logs' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'action' },
              op: 'EQUAL',
              value: { stringValue: actionValue },
            },
          },
          limit: 5,
        },
      }),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      payload: { error: 'fetch_failed', message: String(err?.message || err) },
    };
  }
  const payload = await response.json().catch(() => []);
  return { ok: response.ok, status: response.status, payload };
}

async function firestoreDirectAuditCreateAttempt(actionValue) {
  // This should be blocked by rules: allow write: if false
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/admin_audit_logs`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SMOKE_ID_TOKEN}`,
      },
      body: JSON.stringify({
        fields: {
          action: { stringValue: actionValue },
          clientTimestamp: { stringValue: new Date().toISOString() },
        },
      }),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      payload: { error: 'fetch_failed', message: String(err?.message || err) },
    };
  }
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

async function run() {
  const marker = `hcw-smoke-${Date.now()}`;
  const promptSetName = `${marker}-set`;
  let contentId = null;
  let blogId = null;

  try {
    const createResult = await postFunction('createContentItem', {
      data: {
        type: 'blog',
        publishTarget: 'blog',
        Title: `Smoke ${marker}`,
        Summary: `Smoke run ${marker}`,
        SourceUrl: `${BASE_URL}/smoke/${marker}`,
        CloudProvider: 'Azure',
        contentStatus: 'ingested',
      },
    });
    addCheck(
      'content.create',
      createResult.ok ? 'pass' : 'fail',
      JSON.stringify(createResult.payload)
    );
    if (!createResult.ok)
      throw new Error(`createContentItem failed: ${JSON.stringify(createResult.payload)}`);
    contentId = createResult.payload?.contentId || createResult.payload?.id || null;
    result.artifacts.contentId = contentId;
    if (!contentId)
      throw new Error(
        `createContentItem did not return contentId: ${JSON.stringify(createResult.payload)}`
      );

    const saveDraftResult = await postFunction('saveEditorDraft', {
      contentId,
      title: `Smoke ${marker}`,
      draft: `# Smoke ${marker}\n\nThis is a live hardened admin smoke.\n`,
      tags: ['smoke'],
    });
    addCheck(
      'editor.save',
      saveDraftResult.ok ? 'pass' : 'fail',
      JSON.stringify(saveDraftResult.payload)
    );
    if (!saveDraftResult.ok)
      throw new Error(`saveEditorDraft failed: ${JSON.stringify(saveDraftResult.payload)}`);

    const approveResult = await postFunction('transitionContentStatus', {
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

    const publishResult = await postFunction('publishContentToBlogs', {
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

    const unpublishPublishResult = await postFunction('unpublishContentToInspected', {
      contentId,
      reviewNotes: 'Unpublished from Publish pane and returned to preview',
    });
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

    const afterFirstUnpublish = await postFunction('getContentItem', { contentId });
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

    await postFunction('transitionContentStatus', {
      contentId,
      newStatus: 'approved_blog',
      reviewNotes: `Smoke re-approve ${marker}`,
    });
    await postFunction('publishContentToBlogs', {
      contentIds: [contentId],
      publishTarget: 'blog',
      cloudProvider: 'Azure',
      markLive: true,
      createSlugPageTrigger: true,
      addToCurated: false,
    });

    const unpublishEditorResult = await postFunction('unpublishContentToInspected', {
      contentId,
      reviewNotes: 'Unpublished from Editor board (was published_blog) - returned to review queue',
    });
    addCheck(
      'editor.unpublish',
      unpublishEditorResult.ok ? 'pass' : 'fail',
      JSON.stringify(unpublishEditorResult.payload)
    );

    const saveSetResult = await postFunction('manageImagePromptConfig', {
      action: 'saveSet',
      setName: promptSetName,
      primaryPrompt: `Primary prompt for ${marker}`,
    });
    addCheck(
      'prompts.set.save',
      saveSetResult.ok ? 'pass' : 'fail',
      JSON.stringify(saveSetResult.payload)
    );

    const pageAssignmentResult = await postFunction('manageImagePromptConfig', {
      action: 'savePageAssignment',
      pagePath: '/azure/blog',
      setName: promptSetName,
      promptName: '',
    });
    addCheck(
      'prompts.pageAssignment.save',
      pageAssignmentResult.ok ? 'pass' : 'fail',
      JSON.stringify(pageAssignmentResult.payload)
    );

    const deleteSetResult = await postFunction('manageImagePromptConfig', {
      action: 'deleteSet',
      setName: promptSetName,
    });
    addCheck(
      'prompts.set.delete',
      deleteSetResult.ok ? 'pass' : 'fail',
      JSON.stringify(deleteSetResult.payload)
    );
    if (!deleteSetResult.ok) {
      throw new Error(
        `manageImagePromptConfig deleteSet failed: ${JSON.stringify(deleteSetResult.payload)}`
      );
    }

    const auditAction = `smoke_audit_${marker}`;
    const auditResult = await postFunction('recordAdminAudit', {
      action: auditAction,
      details: { marker, route: '/admin' },
    });
    addCheck(
      'audit.backend.write',
      auditResult.ok ? 'pass' : 'fail',
      JSON.stringify(auditResult.payload)
    );
    if (!auditResult.ok) {
      throw new Error(`recordAdminAudit failed: ${JSON.stringify(auditResult.payload)}`);
    }

    const auditReadback = await firestoreRunQueryByAction(auditAction);
    const anyAuditRows = Array.isArray(auditReadback.payload)
      ? auditReadback.payload.some((row) => row?.document?.name)
      : false;
    addCheck(
      'audit.backend.readback',
      anyAuditRows ? 'pass' : 'fail',
      `status=${auditReadback.status}`
    );
    if (!anyAuditRows) {
      throw new Error(`audit readback failed: status=${auditReadback.status}`);
    }

    const directWriteAttempt = await firestoreDirectAuditCreateAttempt(`forged_${marker}`);
    addCheck(
      'audit.client.write.blocked',
      directWriteAttempt.ok === false && directWriteAttempt.status === 403 ? 'pass' : 'fail',
      JSON.stringify({ status: directWriteAttempt.status, payload: directWriteAttempt.payload })
    );
    if (!(directWriteAttempt.ok === false && directWriteAttempt.status === 403)) {
      throw new Error(
        `audit client write was not blocked: ${JSON.stringify(directWriteAttempt.payload)}`
      );
    }
  } catch (error) {
    addCheck(
      'runner.execution',
      'fail',
      'Hardened admin token smoke failed',
      String(error?.message || error)
    );
  } finally {
    if (contentId) {
      try {
        await postFunction('softDeleteLivePage', {
          contentId,
          blogId,
          reason: `Smoke cleanup ${marker}`,
        });
        addCheck('cleanup.softDeleteLivePage', 'pass', `contentId=${contentId}`);
      } catch (error) {
        result.notes.push(`Cleanup failed for ${contentId}: ${String(error?.message || error)}`);
      }
    }
  }

  result.metadata.endedAt = new Date().toISOString();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `admin-hardened-token-smoke-${Date.now()}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ file: outFile, checks: result.checks }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
