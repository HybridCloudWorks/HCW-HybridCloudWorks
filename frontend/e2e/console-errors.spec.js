/**
 * Production console-error guardrail.
 *
 * For each public route, asserts that no `console.error` or page-error
 * fires during a normal page load. Lighthouse's `errors-in-console`
 * audit fails when ANYTHING logs to console.error, so this catches
 * regressions before they hit the Lighthouse gate.
 *
 * Run via:
 *   npm run test:e2e -- console-errors.spec.js
 *
 * Companion to e2e/contrast.spec.js. Same preview-server auto-start.
 */
import { test, expect } from '@playwright/test';

const ROUTES = [
  '/',
  '/about',
  '/contact',
  '/aws',
  '/aws/blog',
  '/aws/architecture-designs',
  '/aws/frameworks',
  '/aws/education',
  '/aws/audio-architecture',
  '/azure',
  '/azure/frameworks',
  '/gcp',
  '/gcp/frameworks',
  '/github',
  '/terraform',
  '/terraform/frameworks',
  '/finops',
];

// Some console messages come from third-party scripts we can't control
// (e.g. Material Symbols font loader, Firebase emulator detection probes).
// Add patterns here to ignore them. Keep this list short and justified.
const IGNORED_PATTERNS = [/Material Symbols/i, /sourcemap/i];

for (const route of ROUTES) {
  test(`no console errors on ${route}`, async ({ page }) => {
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (IGNORED_PATTERNS.some((re) => re.test(text))) return;
      errors.push(text);
    });
    page.on('pageerror', (err) => {
      const text = err.message || String(err);
      if (IGNORED_PATTERNS.some((re) => re.test(text))) return;
      errors.push(`pageerror: ${text}`);
    });

    await page.goto(route, { waitUntil: 'networkidle' });
    // Give async error paths a moment to settle.
    await page.waitForTimeout(500);

    expect(errors, `\nConsole errors on ${route}:\n${errors.join('\n')}`).toEqual([]);
  });
}
