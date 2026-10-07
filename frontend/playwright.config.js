import { defineConfig, devices } from '@playwright/test';
import { STUB_BUILD_ENV } from './e2e/fixtures/stub-build-env.js';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: Boolean(process.env.CI),
  /* One retry on CI: enough to absorb a slow first paint, not enough to
     hide a flaky test (estate review 2026-10-06, QA-1). */
  retries: process.env.CI ? 1 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['html'], ['json', { outputFile: 'test-results/results.json' }]],
  /* Timeout for each test */
  timeout: 30 * 1000,
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:4173',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    /* Video on failure for debugging */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    /* A phone: the owner runs the admin from one (QA-1, AP-F1). */
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run a preview server for e2e + contrast tests */
  webServer: process.env.TEST_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
        // The placeholder identity the signed-in admin spec runs against
        // (e2e/fixtures/stub-build-env.js), the same values the CI e2e job's
        // Build step sets.
        //
        // FAIL CLOSED, NOT TRUSTED (review of #985). Two things can still put
        // a different bundle under the suite: a local frontend/.env, which
        // vite.config.js reads after process.env so it wins over these, and
        // a server already listening, which reuse would adopt without
        // building. Reuse is therefore off: every run builds what it tests.
        // The .env case is not overridden here, because that would mean a
        // test-only precedence rule in the production build config; instead
        // the fixture (e2e/fixtures/entra.js) aborts any request to a third
        // host and refuses any tenant or client that is not the placeholder,
        // so a mis-built bundle fails the run and its bearer never leaves the
        // browser.
        env: { ...STUB_BUILD_ENV },
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
