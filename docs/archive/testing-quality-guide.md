# Testing Guide - ContentForge & Frontend

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


## Overview

The project now has a comprehensive testing workflow with manual trigger capability for on-demand
testing.

## Test Files

### 1. **E2E Tests**

#### `e2e/smoke.spec.js` (5 tests)

- ✅ Homepage loads correctly
- ✅ Navigation is accessible
- ✅ Document structure is semantic
- ✅ Responsive design (mobile)
- ✅ No console errors on load

#### `e2e/contentforge.spec.js` (16 tests)

- **Dashboard** (2 tests): Page loads, main content visible
- **Review Queue** (3 tests): Filter loading, queue items display, filter changes
- **Editor** (1 test): Editor page loads
- **Submit URLs** (2 tests): Form loads, controls present
- **Published Content** (2 tests): Published page loads, grid display
- **Navigation** (2 tests): Admin navigation works
- **Responsive Design** (2 tests): Mobile & tablet layouts
- **Error Handling** (1 test): Graceful error handling

### 2. **Unit Tests**

- Run with: `npm test`
- Uses Vitest + jsdom
- Covers component logic

### 3. **Code Quality**

- ESLint + Prettier checks
- Route validation
- Accessibility checks

## How to Run Tests

### Manual Testing (Recommended for Development)

**All tests:**

```bash
npm run test:e2e
```

**Specific test file (ContentForge only):**

```bash
npm run test:e2e -- e2e/contentforge.spec.js
```

**With headed browser (see what's happening):**

```bash
npm run test:e2e:headed
```

**Debug mode (interactive):**

```bash
npm run test:e2e:debug
```

**Unit tests:**

```bash
npm test
```

**Full quality check:**

```bash
npm run code:quality
```

## GitHub Actions Workflow

### New Workflow: `test-comprehensive.yml`

**Manual Trigger:** Go to: Actions → Test Comprehensive → Run workflow

**Options:**

- `all` (default) - Run both unit and E2E tests
- `unit` - Unit tests only
- `e2e` - E2E tests only

**Automatic Triggers:**

- Runs on PRs with changes to `src/`, `e2e/`, or test configs
- Generates artifacts (coverage, reports, videos)

**Artifacts Generated:**

- Playwright HTML report
- Test results JSON
- Vitest coverage
- Screenshots & videos (on failure)

## Test Results

**Latest Run:**

```
21 passed (6.5s)
├── smoke.spec.js (5 tests) ✅
└── contentforge.spec.js (16 tests) ✅
```

## Best Practices

### Writing New Tests

1. **Resilient Selectors** - Use accessible roles when possible

   ```javascript
   // ❌ Brittle
   page.locator('.card-xyz-123');

   // ✅ Better
   page.locator('button:has-text("Approve")');
   page.locator('[role="navigation"]');
   ```

2. **Handle Loading States**

   ```javascript
   await page.goto('/admin', { waitUntil: 'networkidle' });
   ```

3. **Graceful Assertions** - Handle optional elements
   ```javascript
   const hasElement = await locator.isVisible().catch(() => false);
   expect(hasElement || fallback).toBeTruthy();
   ```

## Troubleshooting

### Tests Failing Locally?

1. **Ensure dev server is running:**

   ```bash
   npm run dev
   ```

2. **Clear playwright cache:**

   ```bash
   npx playwright install
   ```

3. **Check browser logs:**
   - Screenshots saved to `test-results/`
   - Videos saved on failure

### CI/CD Pipeline Issues?

- Check artifact uploads in GitHub Actions
- Verify secrets are set (Firebase credentials)
- Check workflow permissions in repo settings

## Next Steps

1. **Add more ContentForge tests** for:
   - Approve/reject workflows
   - Publish operations
   - AI generation triggers

2. **Expand unit tests** for:
   - Admin components
   - Firebase hooks
   - Content publishing logic

3. **Set up CI integration** to:
   - Block merges on test failure
   - Generate test reports on PRs
   - Track test coverage trends
