/**
 * verify-article-modules-byline.mjs
 *
 * Public-page only verification. No auth needed.
 * Checks that inline modules and byline appear correctly on a live article detail page.
 *
 * Usage:
 *   VERIFY_ARTICLE_URL=https://hybridcloudworks.com/azure/blog/...-EeuByP \
 *   VERIFY_BYLINE=<expected byline text> \
 *   node scripts/verify-article-modules-byline.mjs
 *
 * Env vars:
 *   VERIFY_ARTICLE_URL   Full URL to the article detail page (required)
 *   VERIFY_BYLINE        Exact or partial byline text to look for in the page
 *   VERIFY_MODULE_1      First expected module label (e.g. "FACT")
 *   VERIFY_MODULE_2      Second expected module label (e.g. "RECOMMENDATION")
 *   VERIFY_MODULE_ORDER  If "1", check that MODULE_1 appears before MODULE_2 in DOM
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ARTICLE_URL =
  process.env.VERIFY_ARTICLE_URL ||
  'https://hybridcloudworks.com/azure/blog/microsoft-at-nvidia-gtc-new-solutions-for-microsoft-foundry-azure-ai-infrastruct-EeuByP';
const BYLINE = process.env.VERIFY_BYLINE || '';
const MODULE_1 = (process.env.VERIFY_MODULE_1 || 'FACT').toUpperCase();
const MODULE_2 = (process.env.VERIFY_MODULE_2 || '').toUpperCase();
const CHECK_ORDER = process.env.VERIFY_MODULE_ORDER === '1';
const OUT_DIR = path.resolve('reports/live-smoke');

const result = { url: ARTICLE_URL, checks: [], timestamp: new Date().toISOString() };

function pass(id, evidence) {
  result.checks.push({ id, status: 'pass', evidence });
  console.log(`  PASS  ${id}: ${evidence}`);
}

function fail(id, evidence, note = '') {
  result.checks.push({ id, status: 'fail', evidence, note });
  console.error(`  FAIL  ${id}: ${evidence}${note ? ' — ' + note : ''}`);
}

function blocked(id, note) {
  result.checks.push({ id, status: 'blocked', note });
  console.warn(`  BLKD  ${id}: ${note}`);
}

async function main() {
  console.log(`\nVerifying: ${ARTICLE_URL}\n`);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    const res = await page.goto(ARTICLE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const status = res?.status() ?? 0;
    if (status < 200 || status >= 400) {
      fail('article.load', `HTTP ${status}`);
      await browser.close();
      return writeAndExit();
    }

    // Wait for article content
    await page.waitForSelector('article, main', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    pass('article.load', `HTTP ${status}`);

    // --- Wide layout ---
    const articleBox = await page
      .locator('article')
      .first()
      .boundingBox()
      .catch(() => null);
    if (articleBox) {
      articleBox.width >= 900
        ? pass('layout.wide', `article width ${Math.round(articleBox.width)}px`)
        : fail(
            'layout.wide',
            `article width ${Math.round(articleBox.width)}px`,
            'Expected >= 900px'
          );
    } else {
      blocked('layout.wide', 'No <article> element found');
    }

    // --- Byline ---
    if (BYLINE) {
      const bylineCount = await page
        .locator(`text=${BYLINE}`)
        .count()
        .catch(() => 0);
      bylineCount > 0
        ? pass('byline.persistence', `"${BYLINE}" found on page`)
        : fail(
            'byline.persistence',
            `"${BYLINE}" NOT found`,
            'Save+publish may not have propagated yet'
          );
    } else {
      blocked('byline.persistence', 'Set VERIFY_BYLINE env var to check byline');
      // Still report what byline text is actually shown
      const bylineEl = await page
        .locator('[class*="author"], [class*="byline"], [data-testid*="author"]')
        .first()
        .textContent()
        .catch(() => null);
      if (bylineEl) {
        result.checks.push({ id: 'byline.actual', status: 'info', evidence: bylineEl.trim() });
        console.log(`  INFO  byline.actual: "${bylineEl.trim()}"`);
      }
    }

    // --- Module labels ---
    // Check for module label text: FACT, RECOMMENDATION, LINKS, SPACER, etc.
    const moduleLabels = ['FACT', 'RECOMMENDATION', 'LINKS', 'SPACER'];
    const foundLabels = [];
    for (const label of moduleLabels) {
      const count = await page
        .locator(`text=${label}`)
        .count()
        .catch(() => 0);
      if (count > 0) foundLabels.push(label);
    }

    // Also check for images inside article (picture modules)
    const articleImgCount = await page
      .locator('article img')
      .count()
      .catch(() => 0);

    if (foundLabels.length > 0 || articleImgCount > 0) {
      pass('modules.render', `labels=[${foundLabels.join(',')}], images=${articleImgCount}`);
    } else {
      fail(
        'modules.render',
        'No FACT/RECOMMENDATION/LINKS/SPACER labels and no article images found',
        'Article may not have had modules saved yet'
      );
    }

    // --- Specific module 1 ---
    if (MODULE_1) {
      const m1Count = await page
        .locator(`text=${MODULE_1}`)
        .count()
        .catch(() => 0);
      m1Count > 0
        ? pass(`module.${MODULE_1.toLowerCase()}`, `"${MODULE_1}" label rendered`)
        : fail(`module.${MODULE_1.toLowerCase()}`, `"${MODULE_1}" label NOT found`);
    }

    // --- Specific module 2 ---
    if (MODULE_2) {
      const m2Count = await page
        .locator(`text=${MODULE_2}`)
        .count()
        .catch(() => 0);
      m2Count > 0
        ? pass(`module.${MODULE_2.toLowerCase()}`, `"${MODULE_2}" label rendered`)
        : fail(`module.${MODULE_2.toLowerCase()}`, `"${MODULE_2}" label NOT found`);
    }

    // --- Module ordering ---
    if (CHECK_ORDER && MODULE_1 && MODULE_2) {
      const allText = await page.evaluate(() => document.body.innerText);
      const idx1 = allText.indexOf(MODULE_1);
      const idx2 = allText.indexOf(MODULE_2);
      if (idx1 === -1 || idx2 === -1) {
        blocked(
          'module.order',
          `Cannot check order: MODULE_1="${MODULE_1}" idx=${idx1}, MODULE_2="${MODULE_2}" idx=${idx2}`
        );
      } else if (idx1 < idx2) {
        pass(
          'module.order',
          `"${MODULE_1}" (pos ${idx1}) appears before "${MODULE_2}" (pos ${idx2})`
        );
      } else {
        fail(
          'module.order',
          `"${MODULE_1}" (pos ${idx1}) appears AFTER "${MODULE_2}" (pos ${idx2})`,
          'Drag/drop order may not have persisted'
        );
      }
    }

    // --- Screenshot for evidence ---
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ssPath = path.join(OUT_DIR, `article-verify-${stamp}.png`);
    await page.screenshot({ path: ssPath, fullPage: false });
    result.screenshotPath = ssPath;
    console.log(`\n  Screenshot: ${ssPath}`);
  } finally {
    await context.close();
    await browser.close();
  }

  writeAndExit();
}

function writeAndExit() {
  const pass = result.checks.filter((c) => c.status === 'pass').length;
  const fail = result.checks.filter((c) => c.status === 'fail').length;
  const blocked = result.checks.filter((c) => c.status === 'blocked').length;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(OUT_DIR, `article-verify-${stamp}.json`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log(`\nSummary: pass=${pass} fail=${fail} blocked=${blocked}`);
  console.log(`Results: ${outFile}\n`);

  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
