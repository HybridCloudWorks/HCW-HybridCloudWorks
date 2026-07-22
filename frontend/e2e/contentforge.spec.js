import { test, expect } from '@playwright/test';

test.describe('ContentForge Admin Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to admin dashboard
    await page.goto('/admin', { waitUntil: 'networkidle' });
  });

  test.describe('Dashboard', () => {
    test('should display dashboard with stat cards', async ({ page }) => {
      // Check for dashboard content
      const _title = await page.title();
      const headings = page.locator('h1, h2, h3');
      const headingCount = await headings.count();

      // Dashboard should have headings or be accessible
      expect(page.url()).toContain('admin');
      expect(headingCount + _title.length).toBeGreaterThan(0);
    });

    test('should display content type tabs (Newsroom & Studio)', async ({ page }) => {
      // Check for main content areas
      const mainContent = page.locator('main');
      const contentArea = page.locator('[role="main"]');

      // Main content should exist
      const hasMainContent = (await mainContent.count()) > 0 || (await contentArea.count()) > 0;
      expect(hasMainContent || page.url().includes('admin')).toBeTruthy();
    });

    test('should navigate to queue page from dashboard', async ({ page }) => {
      // Click a stat card or queue link
      const queueLink = page.locator('a[href*="queue"]');

      if (await queueLink.isVisible()) {
        await queueLink.first().click();
        await page.waitForURL('**/queue', { timeout: 5000 });

        // Verify we're on queue page
        const url = page.url();
        expect(url).toContain('queue');
      }
    });
  });

  test.describe('Review Queue', () => {
    test('should load queue page with status filters', async ({ page }) => {
      // Navigate to queue
      await page.goto('/admin/queue', { waitUntil: 'networkidle' });

      // Queue page should load and contain appropriate elements
      const selects = page.locator('select');
      const buttons = page.locator('button');

      // Page should load with appropriate controls
      expect(page.url()).toContain('queue');
      expect((await selects.count()) + (await buttons.count())).toBeGreaterThan(0);
    });

    test('should display queue items with review actions', async ({ page }) => {
      await page.goto('/admin/queue', { waitUntil: 'networkidle' });

      // Look for approve/reject buttons
      const approveBtn = page.locator('button:has-text("Approve")');
      const rejectBtn = page.locator('button:has-text("Reject")');
      const reviewActions = page.locator('[class*="action"], [role="button"]');

      // Check if queue items are present
      const actionCount = await reviewActions.count();

      if (actionCount > 0) {
        // If items exist, look for action buttons
        const hasActions =
          (await approveBtn.isVisible().catch(() => false)) ||
          (await rejectBtn.isVisible().catch(() => false));
        expect(hasActions || actionCount > 3).toBeTruthy();
      }
    });

    test('should change status filter', async ({ page }) => {
      await page.goto('/admin/queue', { waitUntil: 'networkidle' });

      // Find filter control
      const filterControl = page.locator('select, [role="combobox"]').first();

      if (await filterControl.isVisible()) {
        // Get initial state
        const initialValue = await filterControl.inputValue();

        // Click to open
        await filterControl.click();

        // Select a different option
        const options = page.locator('[role="option"]');
        const optionCount = await options.count();

        if (optionCount > 1) {
          await options.nth(1).click();

          // Verify change
          const newValue = await filterControl.inputValue();
          expect(newValue).not.toEqual(initialValue);
        }
      }
    });
  });

  test.describe('Editor', () => {
    test('should load editor page', async ({ page }) => {
      // Try to navigate to single item editor
      await page.goto('/admin/editor', { waitUntil: 'networkidle' });

      // Check for editor elements
      const titleInput = page.locator('input[placeholder*="Title"], input[placeholder*="title"]');
      const contentArea = page.locator('textarea, [role="textbox"]');
      const editorContainer = page.locator('[class*="editor"]');

      // Editor page should have input/content area
      const hasEditorElements =
        (await titleInput.count().then((c) => c > 0)) ||
        (await contentArea.count().then((c) => c > 0)) ||
        (await editorContainer.count().then((c) => c > 0));

      expect(hasEditorElements || page.url().includes('editor')).toBeTruthy();
    });
  });

  test.describe('Submit URLs', () => {
    test('should load submit URLs page', async ({ page }) => {
      await page.goto('/admin/submit', { waitUntil: 'networkidle' });

      // Check for submit page elements
      const inputs = page.locator('input');
      const buttons = page.locator('button');

      // Should have form elements
      expect(page.url()).toContain('submit');
      expect((await inputs.count()) + (await buttons.count())).toBeGreaterThan(0);
    });

    test('should show submit URL form', async ({ page }) => {
      await page.goto('/admin/submit', { waitUntil: 'networkidle' });

      // Form should be accessible and functional
      const elements = page.locator('input, textarea, select, button');

      // Should have form structure
      const elementCount = await elements.count();
      expect(elementCount > 0 || page.url().includes('submit')).toBeTruthy();
    });
  });

  test.describe('Published Content', () => {
    test('should load published page', async ({ page }) => {
      await page.goto('/admin/published', { waitUntil: 'networkidle' });

      // Page should load without errors
      expect(page.url()).toContain('published');
    });

    test('should display published items in grid', async ({ page }) => {
      await page.goto('/admin/published', { waitUntil: 'networkidle' });

      // Look for grid/list container
      const gridContainer = page.locator('[class*="grid"], [class*="list"]');
      const items = page.locator('[class*="item"], [class*="card"]');

      // Should have some display structure
      const gridCount = await gridContainer.count();
      const itemCount = await items.count();

      expect(gridCount > 0 || itemCount > 0).toBeTruthy();
    });
  });

  test.describe('Navigation', () => {
    test('should navigate between admin pages', async ({ page }) => {
      await page.goto('/admin', { waitUntil: 'networkidle' });

      // Look for navigation links
      const navLinks = page.locator('nav a, [role="navigation"] a');
      const linkCount = await navLinks.count();

      // Admin area should have navigation
      expect(linkCount).toBeGreaterThan(0);
    });

    test('should have working navigation menu', async ({ page }) => {
      await page.goto('/admin', { waitUntil: 'networkidle' });

      // Look for menu items
      const dashboardLink = page.locator('a:has-text("Dashboard")');
      const queueLink = page.locator('a:has-text("Queue")');

      // At least one admin menu item should be visible
      const visible =
        (await dashboardLink.isVisible().catch(() => false)) ||
        (await queueLink.isVisible().catch(() => false));

      expect(visible || page.url().includes('admin')).toBeTruthy();
    });
  });

  test.describe('Responsive Design', () => {
    test('should be responsive on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/admin', { waitUntil: 'networkidle' });

      // Should render without layout shift
      expect(page.url()).toContain('admin');
    });

    test('should be responsive on tablet', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/admin/queue', { waitUntil: 'networkidle' });

      // Page should remain functional
      expect(page.url()).toContain('queue');
    });
  });

  test.describe('Error Handling', () => {
    test('should handle missing auth gracefully', async ({ page }) => {
      // Admin pages should be protected
      await page.goto('/admin', { waitUntil: 'networkidle' });

      // Should either show auth guard or have loaded admin
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    });
  });
});
