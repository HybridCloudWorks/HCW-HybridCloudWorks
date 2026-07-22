/**
 * Failsafe contrast guardrail.
 *
 * For each public route × {light, dark}, inject axe-core and assert zero
 * `color-contrast` violations. Run via:
 *   npm run test:e2e -- contrast.spec.js
 *
 * Companion to scripts/axe-theme-scan.mjs (which produces the full report).
 * This spec is the CI gate; the script is the diagnostic tool.
 */
import { test, expect } from '@playwright/test';

const PROVIDERS = ['aws', 'azure', 'gcp', 'github', 'terraform', 'finops'];

// Smaller route set than the full scan: covers each layout/template once.
// The full scan runs separately as `npm run a11y:contrast`.
const ROUTES = [
  '/',
  '/about',
  '/contact',
  ...PROVIDERS.map((p) => `/${p}`),
  '/aws/blog',
  '/aws/architecture-designs',
  '/aws/frameworks',
  '/aws/education',
  '/aws/audio-architecture',
  '/github/news',
  '/github/code',
  '/finops/tools',
  '/tools/migration',
  '/tools/comparison',
  '/templates/framework',
];

const THEMES = ['light', 'dark'];
const AXE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.3/axe.min.js';

for (const theme of THEMES) {
  test.describe(`color-contrast (${theme})`, () => {
    test.use({ colorScheme: theme });

    for (const route of ROUTES) {
      test(`${route}`, async ({ page, context }) => {
        await context.addInitScript((selectedTheme) => {
          try {
            window.localStorage.setItem('hcw-theme', selectedTheme);
          } catch {
            /* storage may be unavailable */
          }
        }, theme);

        await page.goto(route, { waitUntil: 'networkidle' });
        await page
          .waitForFunction(
            (t) =>
              t === 'dark'
                ? document.documentElement.classList.contains('dark')
                : !document.documentElement.classList.contains('dark'),
            theme,
            { timeout: 5000 }
          )
          .catch(() => {});

        await page.addScriptTag({ url: AXE_CDN });

        const result = await page.evaluate(async () => {
          return window.axe.run(document, {
            runOnly: { type: 'rule', values: ['color-contrast'] },
          });
        });

        const violations = result.violations.flatMap((v) =>
          v.nodes.map((n) => ({
            target: n.target,
            ratio: n.any?.[0]?.data?.contrastRatio,
            expected: n.any?.[0]?.data?.expectedContrastRatio,
            fg: n.any?.[0]?.data?.fgColor,
            bg: n.any?.[0]?.data?.bgColor,
            html: n.html?.slice(0, 160),
          }))
        );

        expect(
          violations,
          `\nContrast violations on ${theme} ${route}:\n${JSON.stringify(violations, null, 2)}`
        ).toEqual([]);
      });
    }
  });
}
