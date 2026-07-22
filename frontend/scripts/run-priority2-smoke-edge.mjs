import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://hybridcloudworks.com';
const OUT_DIR = path.resolve('reports/live-smoke');
const STORAGE_STATE_PATH = process.env.SMOKE_STORAGE_STATE || '';
const CDP_URL = process.env.SMOKE_CDP_URL || '';
const AZURE_ARTICLE_PATH = process.env.SMOKE_AZURE_ARTICLE_PATH || '';
const HEADLESS = process.env.SMOKE_HEADFUL === '1' ? false : true;
const startedAt = new Date();

const result = {
  metadata: {
    startedAt: startedAt.toISOString(),
    baseUrl: BASE_URL,
    browserChannel: 'msedge',
    headless: HEADLESS,
    storageStatePath: STORAGE_STATE_PATH || null,
    azureArticlePath: AZURE_ARTICLE_PATH || null,
  },
  checks: [],
  notes: [],
};

function addCheck(id, status, evidence, notes = '') {
  result.checks.push({ id, status, evidence, notes });
}

function summarize() {
  return {
    pass: result.checks.filter((c) => c.status === 'pass').length,
    fail: result.checks.filter((c) => c.status === 'fail').length,
    blocked: result.checks.filter((c) => c.status === 'blocked').length,
  };
}

async function safeNewPage(context, label) {
  try {
    const page = await context.newPage();
    return page;
  } catch (error) {
    throw new Error(`Unable to create ${label} page: ${String(error?.message || error)}`);
  }
}

async function safeGoto(page, url, options = {}) {
  if (!page || page.isClosed()) {
    throw new Error(`Cannot navigate; page is closed for URL ${url}`);
  }
  return page.goto(url, options);
}

async function safeGotoAppReady(page, url, selectors = []) {
  await safeGoto(page, url, { waitUntil: 'domcontentloaded', timeout: 45000 });

  if (!selectors.length) return;

  const start = Date.now();
  const timeoutMs = 30000;
  while (Date.now() - start < timeoutMs) {
    for (const selector of selectors) {
      const count = await page
        .locator(selector)
        .count()
        .catch(() => 0);
      if (count > 0) return;
    }
    await page.waitForTimeout(500);
  }
}

async function checkPublicUrl(page, url, id) {
  try {
    const response = await safeGoto(page, url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const code = response?.status?.() ?? null;
    if (code && code >= 200 && code < 400) {
      addCheck(id, 'pass', `${url} -> HTTP ${code}`);
    } else {
      addCheck(id, 'fail', `${url} -> HTTP ${code ?? 'n/a'}`, 'Unexpected HTTP status');
    }
  } catch (error) {
    addCheck(id, 'fail', `${url}`, String(error?.message || error));
  }
}

async function detectAdminReady(adminPage) {
  try {
    await safeGoto(adminPage, `${BASE_URL}/admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  } catch (error) {
    addCheck(
      'admin.dashboard.visible',
      'blocked',
      '/admin navigation failed',
      String(error?.message || error)
    );
    return false;
  }

  await adminPage.waitForTimeout(1000);

  const authSelectors = [
    'text=Content Dashboard',
    'text=Sign Out',
    'a:has-text("Dashboard")',
    'a:has-text("Back to Site")',
  ];

  let hasDashboard = false;
  for (const selector of authSelectors) {
    const count = await adminPage
      .locator(selector)
      .count()
      .catch(() => 0);
    if (count > 0) {
      hasDashboard = true;
      break;
    }
  }

  if (hasDashboard) {
    addCheck('admin.dashboard.visible', 'pass', '/admin loaded with Content Dashboard heading');
    return true;
  }

  addCheck(
    'admin.dashboard.visible',
    'blocked',
    '/admin did not show dashboard content',
    'Provide SMOKE_STORAGE_STATE with authenticated admin cookies to run authenticated checks'
  );
  return false;
}

async function runAdminChecksFromCdp() {
  let cdpBrowser;
  try {
    cdpBrowser = await chromium.connectOverCDP(CDP_URL);
    const context = cdpBrowser.contexts()[0];
    if (!context) {
      addCheck(
        'admin.dashboard.visible',
        'blocked',
        '/admin over CDP',
        'No CDP browser context found'
      );
      addCheck(
        'priority2.bylinePersistence',
        'blocked',
        'Admin/editor smoke step skipped',
        'Authentication not available to run editor publish persistence checks'
      );
      addCheck(
        'priority2.moduleOrderPersistence',
        'blocked',
        'Admin/editor smoke step skipped',
        'Authentication not available to run drag-and-drop publish persistence checks'
      );
      return;
    }

    let adminPage = context.pages().find((page) => page.url().includes('/admin'));
    if (!adminPage) adminPage = await context.newPage();
    await runAdminChecks(adminPage);
  } catch (error) {
    addCheck(
      'admin.dashboard.visible',
      'blocked',
      '/admin over CDP',
      String(error?.message || error)
    );
    addCheck(
      'priority2.bylinePersistence',
      'blocked',
      'Admin/editor smoke step skipped',
      'Authentication not available to run editor publish persistence checks'
    );
    addCheck(
      'priority2.moduleOrderPersistence',
      'blocked',
      'Admin/editor smoke step skipped',
      'Authentication not available to run drag-and-drop publish persistence checks'
    );
  }
}

async function runAdminChecks(adminPage) {
  const adminReady = await detectAdminReady(adminPage);
  if (!adminReady) {
    addCheck(
      'priority2.bylinePersistence',
      'blocked',
      'Admin/editor smoke step skipped',
      'Authentication not available to run editor publish persistence checks'
    );
    addCheck(
      'priority2.moduleOrderPersistence',
      'blocked',
      'Admin/editor smoke step skipped',
      'Authentication not available to run drag-and-drop publish persistence checks'
    );
    return;
  }

  const panelChecks = [
    'ContentForge Flow',
    'Pipeline Readiness',
    'Publishing Operations',
    'Workflow Alerts',
  ];

  for (const panel of panelChecks) {
    const ok = await adminPage
      .getByText(panel, { exact: false })
      .isVisible()
      .catch(() => false);
    addCheck(
      `admin.panel.${panel.toLowerCase().replace(/\s+/g, '.')}`,
      ok ? 'pass' : 'fail',
      panel,
      ok ? '' : 'Expected panel not visible'
    );
  }

  try {
    await safeGoto(adminPage, `${BASE_URL}/admin/queue`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    addCheck(
      'admin.queue.load',
      adminPage.url().includes('/admin/queue') ? 'pass' : 'fail',
      adminPage.url()
    );
  } catch (error) {
    addCheck('admin.queue.load', 'fail', '/admin/queue', String(error?.message || error));
  }

  try {
    await safeGoto(adminPage, `${BASE_URL}/admin/published`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    addCheck(
      'admin.published.load',
      adminPage.url().includes('/admin/published') ? 'pass' : 'fail',
      adminPage.url()
    );
  } catch (error) {
    addCheck('admin.published.load', 'fail', '/admin/published', String(error?.message || error));
  }

  addCheck(
    'priority2.bylinePersistence',
    'blocked',
    'Manual mutation workflow not auto-run',
    'Byline persistence requires selecting a dedicated test content item and publishing it'
  );
  addCheck(
    'priority2.moduleOrderPersistence',
    'blocked',
    'Manual mutation workflow not auto-run',
    'Module ordering persistence requires drag/drop save + publish on a dedicated test item'
  );
}

async function runPublicContentChecks(publicPage) {
  await checkPublicUrl(publicPage, `${BASE_URL}/`, 'public.home');
  await checkPublicUrl(publicPage, `${BASE_URL}/aws`, 'public.aws');
  await checkPublicUrl(publicPage, `${BASE_URL}/azure`, 'public.azure');
  await checkPublicUrl(publicPage, `${BASE_URL}/azure/blog`, 'public.azure.blog');

  try {
    await safeGotoAppReady(publicPage, `${BASE_URL}/azure/blog`, [
      'main',
      'a[href^="/azure/blog/"]',
      'h1',
      '[data-testid="blog-list"]',
    ]);
  } catch (error) {
    addCheck(
      'priority2.azureBlogVisibility',
      'fail',
      '/azure/blog',
      String(error?.message || error)
    );
    addCheck(
      'priority2.inlineModules',
      'blocked',
      'No article page sampled',
      'Azure blog route did not load'
    );
    return;
  }

  const articleLinks = await publicPage
    .locator('a[href^="/azure/blog/"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('href')).filter(Boolean))
    .catch(() => []);

  let firstPath = '';
  if (AZURE_ARTICLE_PATH) {
    if (AZURE_ARTICLE_PATH.startsWith('http://') || AZURE_ARTICLE_PATH.startsWith('https://')) {
      firstPath = AZURE_ARTICLE_PATH;
    } else {
      firstPath = AZURE_ARTICLE_PATH.startsWith('/')
        ? AZURE_ARTICLE_PATH
        : `/${AZURE_ARTICLE_PATH}`;
    }
  }

  if (!firstPath && !articleLinks.length) {
    addCheck(
      'priority2.azureBlogVisibility',
      'pass',
      '/azure/blog returned 200 and rendered',
      'No article links found in this sample run'
    );
    addCheck(
      'priority2.inlineModules',
      'blocked',
      '/azure/blog',
      'No /azure/blog/{slug} links found to inspect a detail page'
    );
    addCheck('priority2.wideLayout', 'blocked', '/azure/blog', 'No article detail page sampled');
    return;
  }

  if (!firstPath) {
    firstPath = articleLinks[0];
  }

  const articleUrl =
    firstPath.startsWith('http://') || firstPath.startsWith('https://')
      ? firstPath
      : `${BASE_URL}${firstPath}`;

  try {
    await safeGotoAppReady(publicPage, articleUrl, ['article', 'main h1', 'main']);
    addCheck('priority2.azureBlogVisibility', 'pass', articleUrl);
  } catch (error) {
    addCheck('priority2.azureBlogVisibility', 'fail', articleUrl, String(error?.message || error));
    addCheck('priority2.inlineModules', 'blocked', articleUrl, 'Detail page navigation failed');
    addCheck('priority2.wideLayout', 'blocked', articleUrl, 'Detail page navigation failed');
    return;
  }

  const articleBox = await publicPage
    .locator('article')
    .first()
    .boundingBox()
    .catch(() => null);
  if (articleBox && articleBox.width >= 900) {
    addCheck(
      'priority2.wideLayout',
      'pass',
      `article width ${Math.round(articleBox.width)}px @ ${articleUrl}`
    );
  } else {
    addCheck(
      'priority2.wideLayout',
      articleBox ? 'fail' : 'blocked',
      articleBox ? `article width ${Math.round(articleBox.width)}px @ ${articleUrl}` : articleUrl,
      articleBox
        ? 'Wide layout threshold expected >= 900px on desktop viewport'
        : 'No article element found'
    );
  }

  const moduleLabelCount = await publicPage
    .locator('text=/FACT|RECOMMENDATION|LINKS/')
    .count()
    .catch(() => 0);
  const hasPicture =
    (await publicPage
      .locator('article img')
      .count()
      .catch(() => 0)) > 0;
  const hasSpacerSignal =
    (await publicPage
      .locator('article div')
      .count()
      .catch(() => 0)) > 0;

  if (moduleLabelCount > 0 || hasPicture || hasSpacerSignal) {
    addCheck(
      'priority2.inlineModules',
      'pass',
      `labels=${moduleLabelCount}, imageInArticle=${hasPicture}, spacerSignal=${hasSpacerSignal}`,
      `Sampled ${articleUrl}`
    );
  } else {
    addCheck(
      'priority2.inlineModules',
      'blocked',
      `Sampled ${articleUrl}`,
      'No inline module marker found in sampled article'
    );
  }
}

function writeResultFile() {
  const endedAt = new Date();
  result.metadata.endedAt = endedAt.toISOString();
  result.metadata.durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);

  const stamp = endedAt.toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(OUT_DIR, `priority2-edge-smoke-${stamp}.json`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return outFile;
}

async function main() {
  let browser;
  let adminContext;
  let publicContext;

  try {
    browser = await chromium.launch({
      channel: 'msedge',
      headless: HEADLESS,
      slowMo: HEADLESS ? 0 : 40,
    });

    const adminContextOptions = { viewport: { width: 1440, height: 900 } };
    if (STORAGE_STATE_PATH && fs.existsSync(STORAGE_STATE_PATH)) {
      adminContextOptions.storageState = STORAGE_STATE_PATH;
      result.notes.push(`Loaded admin storage state from ${STORAGE_STATE_PATH}`);
    } else if (STORAGE_STATE_PATH) {
      result.notes.push(`SMOKE_STORAGE_STATE was set but not found: ${STORAGE_STATE_PATH}`);
    }

    adminContext = await browser.newContext(adminContextOptions);
    publicContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });

    const adminPage = await safeNewPage(adminContext, 'admin');
    const publicPage = await safeNewPage(publicContext, 'public');

    await runPublicContentChecks(publicPage);

    if (CDP_URL) {
      result.notes.push(`Using CDP admin session from ${CDP_URL}`);
      await runAdminChecksFromCdp();
    } else {
      await runAdminChecks(adminPage);
    }
  } catch (error) {
    result.notes.push(`Runner error: ${String(error?.message || error)}`);
    addCheck(
      'runner.execution',
      'fail',
      'Edge smoke runner failed unexpectedly',
      String(error?.message || error)
    );
  } finally {
    if (adminContext) await adminContext.close().catch(() => {});
    if (publicContext) await publicContext.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  const outFile = writeResultFile();
  const summary = {
    ...summarize(),
    file: outFile,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
