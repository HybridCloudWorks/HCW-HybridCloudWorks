import { test, expect } from '@playwright/test';

test.describe('Frontend Smoke Tests', () => {
  test('should load homepage', async ({ page }) => {
    // Navigate to homepage with extended timeout for first load
    await page.goto('/', { waitUntil: 'networkidle' });

    // Verify page loaded with correct title
    const title = await page.title();
    expect(title).toMatch(/HCW|Hybrid Cloud Works|Personal Site/i);
  });

  test('should have accessible navigation', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Check that at least one navigation element is visible
    // Some responsive designs have multiple nav elements (mobile/desktop)
    const navs = page.locator('nav, [role="navigation"]');
    const navCount = await navs.count();
    expect(navCount).toBeGreaterThan(0); // At least one nav should exist

    // Check that at least one is visible
    const visibleNav = navs.first();
    await expect(visibleNav).toBeVisible({ timeout: 5000 });
  });

  test('should have proper document structure', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Check for semantic HTML elements
    const mains = page.locator('main');
    const headings = page.locator('h1, h2, h3');

    // Should have at least one main element (primary content area)
    const mainCount = await mains.count();
    expect(mainCount).toBeGreaterThanOrEqual(1);

    // First main should be visible
    const firstMain = mains.first();
    await expect(firstMain).toBeVisible({ timeout: 5000 });

    // Should have at least one heading (typically h1 for page title)
    const headingCount = await headings.count();
    expect(headingCount).toBeGreaterThanOrEqual(1);
  });

  test('should handle responsive viewport', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/', { waitUntil: 'networkidle' });

    // Verify page is still functional on mobile
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('should not have console errors during load', async ({ page }) => {
    const errors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    // Check that no critical errors occurred
    const criticalErrors = errors.filter(
      (e) => !e.includes('Non-Error promise rejection') && !e.includes('ResizeObserver loop')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
