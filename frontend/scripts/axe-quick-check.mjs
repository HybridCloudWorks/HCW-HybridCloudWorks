#!/usr/bin/env node
/**
 * Single-route contrast spot-check. Faster than `axe-theme-scan` (which
 * crawls all 72 routes × 2 themes). Use during iteration when you only
 * care about one route. Default route is /azure/education in both themes.
 *
 * Usage:
 *   node scripts/axe-quick-check.mjs                    # /azure/education
 *   node scripts/axe-quick-check.mjs /aws/blog          # one route, both themes
 *   node scripts/axe-quick-check.mjs /aws/blog dark     # one route, one theme
 */
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const route = process.argv[2] || '/azure/education';
const themeArg = process.argv[3];
const themes = themeArg ? [themeArg] : ['light', 'dark'];

const browser = await chromium.launch({ headless: true });
let totalFailures = 0;

try {
  for (const theme of themes) {
    const context = await browser.newContext({ colorScheme: theme });
    await context.addInitScript((t) => {
      try {
        window.localStorage.setItem('hcw-theme', t);
      } catch {
        /* storage may be unavailable */
      }
    }, theme);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);

    const cleanRoute = route.startsWith('//') ? route.slice(1) : route;
    const url = `${BASE_URL}${cleanRoute}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => {});
    await page.waitForTimeout(800);
    await page.addScriptTag({
      url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.3/axe.min.js',
    });
    const result = await page.evaluate(async () =>
      window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } })
    );
    const violation = result.violations.find((v) => v.id === 'color-contrast');
    const nodeCount = violation?.nodes.length || 0;
    totalFailures += nodeCount;
    console.log(`${theme.padEnd(5)} ${route.padEnd(30)} contrast violations: ${nodeCount}`);
    if (nodeCount > 0) {
      for (const node of violation.nodes) {
        const data = node.any?.[0]?.data ?? {};
        const target = (node.target || []).join(' ');
        console.log(`  - ${target}`);
        console.log(
          `    fg ${data.fgColor} on bg ${data.bgColor} = ${data.contrastRatio} (need ${data.expectedContrastRatio})`
        );
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\nTotal: ${totalFailures} contrast violations`);
process.exit(totalFailures > 0 ? 1 : 0);
