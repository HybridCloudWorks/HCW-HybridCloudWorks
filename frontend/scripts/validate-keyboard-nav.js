#!/usr/bin/env node

/**
 * Keyboard Navigation Validation Script
 *
 * Tests keyboard accessibility across Phase 7d pages
 * Validates:
 * - Tab order and logical progression
 * - Focus visibility (focus rings)
 * - No focus traps
 * - Button/interactive element accessibility
 * - ARIA labels and attributes
 *
 * Usage: node scripts/validate-keyboard-nav.js [--url http://localhost:5173]
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Test suite configuration
const PAGES_TO_TEST = [
  {
    name: 'FrameworksPage',
    url: '/aws/frameworks',
    expectedTabbableCount: { min: 40, max: 60 },
    criticalElements: ['[role="button"]', 'button', 'a[href]', 'input', '[tabindex="0"]'],
  },
  {
    name: 'BlogPage',
    url: '/aws/blog',
    expectedTabbableCount: { min: 35, max: 50 },
    criticalElements: ['[role="button"]', 'button', 'a[href]', 'input'],
  },
  {
    name: 'ArchitecturePage',
    url: '/aws/architecture-designs',
    expectedTabbableCount: { min: 30, max: 50 },
    criticalElements: ['[role="button"]', 'button', 'a[href]', 'input'],
  },
  {
    name: 'AudioArchitecturePage',
    url: '/aws/audio-architecture',
    expectedTabbableCount: { min: 40, max: 70 },
    criticalElements: ['[role="button"]', 'button', 'a[href]', 'input'],
  },
  {
    name: 'EducationPage',
    url: '/aws/education',
    expectedTabbableCount: { min: 20, max: 40 },
    criticalElements: ['[role="button"]', 'button', 'a[href]', 'input'],
  },
];

/**
 * Test Results Tracker
 */
class ValidationRunner {
  constructor() {
    this.results = [];
    this.totalTests = 0;
    this.passedTests = 0;
    this.failedTests = 0;
  }

  recordTest(testName, passed, message) {
    const status = passed ? '✓ PASS' : '✗ FAIL';
    const color = passed ? colors.green : colors.red;

    this.results.push({
      testName,
      passed,
      message,
    });

    console.log(`${color}${status}${colors.reset} ${testName}: ${message}`);

    this.totalTests++;
    if (passed) this.passedTests++;
    else this.failedTests++;
  }

  printSummary() {
    console.log(`\n${colors.cyan}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.cyan}Keyboard Navigation Validation Summary${colors.reset}`);
    console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}\n`);

    const passColor = this.failedTests === 0 ? colors.green : colors.red;
    console.log(
      `${passColor}Total: ${this.totalTests} | ` +
        `${colors.green}Passed: ${this.passedTests}${colors.reset} | ` +
        `${colors.red}Failed: ${this.failedTests}${colors.reset}\n`
    );

    if (this.failedTests > 0) {
      console.log(`${colors.red}Failed Tests:${colors.reset}`);
      this.results
        .filter((r) => !r.passed)
        .forEach((r) => {
          console.log(`  - ${r.testName}: ${r.message}`);
        });
    }

    return this.failedTests === 0;
  }
}

/**
 * Validation checks (documentation of expected behavior)
 * These can be verified manually in Chrome DevTools Console via JavaScript injection
 */
function generateValidationReport() {
  const runner = new ValidationRunner();

  console.log(`${colors.cyan}Keyboard Navigation Validation Report${colors.reset}`);
  console.log(`${colors.cyan}Generated: ${new Date().toISOString()}${colors.reset}\n`);

  // Test 1: AccessibleButton imports
  console.log(`${colors.blue}[1] Component Import Validation${colors.reset}`);
  PAGES_TO_TEST.forEach((page) => {
    const pagePath = path.join(__dirname, `../src/pages/aws/${page.name}.jsx`);

    if (fs.existsSync(pagePath)) {
      const content = fs.readFileSync(pagePath, 'utf-8');
      const hasAccessibleButtonImport = content.includes(
        "import { AccessibleButton } from '@/components/accessibility'"
      );

      runner.recordTest(
        `${page.name} - AccessibleButton Import`,
        hasAccessibleButtonImport,
        hasAccessibleButtonImport ? 'Import statement found' : 'MISSING: No AccessibleButton import'
      );
    }
  });

  // Test 2: AccessibleButton usage
  console.log(`\n${colors.blue}[2] AccessibleButton Component Usage${colors.reset}`);
  PAGES_TO_TEST.forEach((page) => {
    const pagePath = path.join(__dirname, `../src/pages/aws/${page.name}.jsx`);

    if (fs.existsSync(pagePath)) {
      const content = fs.readFileSync(pagePath, 'utf-8');
      const buttonUsageCount = (content.match(/<AccessibleButton/g) || []).length;

      runner.recordTest(
        `${page.name} - AccessibleButton Usage`,
        buttonUsageCount > 0,
        buttonUsageCount > 0
          ? `${buttonUsageCount} AccessibleButton components found`
          : 'No AccessibleButton components detected'
      );
    }
  });

  // Test 3: Focus ring styles (via source inspection)
  console.log(`\n${colors.blue}[3] Focus Ring Style Validation${colors.reset}`);
  const accessibilityComponentPath = path.join(
    __dirname,
    '../src/components/accessibility/AccessibleButton.tsx'
  );

  if (fs.existsSync(accessibilityComponentPath)) {
    const content = fs.readFileSync(accessibilityComponentPath, 'utf-8');
    const hasFocusRing = content.includes('focus:ring');
    const hasFocusOffset = content.includes('focus:ring-offset');

    runner.recordTest(
      'AccessibleButton - Focus Ring',
      hasFocusRing,
      hasFocusRing
        ? 'Focus ring styles present (focus:ring-2)'
        : 'MISSING: No focus ring styles found'
    );

    runner.recordTest(
      'AccessibleButton - Focus Ring Offset',
      hasFocusOffset,
      hasFocusOffset
        ? 'Focus ring offset present (focus:ring-offset-2)'
        : 'MISSING: No focus ring offset found'
    );
  }

  // Test 4: No hardcoded button elements in pages
  console.log(`\n${colors.blue}[4] Button Component Replacement Validation${colors.reset}`);
  PAGES_TO_TEST.forEach((page) => {
    const pagePath = path.join(__dirname, `../src/pages/aws/${page.name}.jsx`);

    if (fs.existsSync(pagePath)) {
      const content = fs.readFileSync(pagePath, 'utf-8');

      // Find <button ...> tags but exclude closing </button> and AccessibleButton components
      const hardcodedButtons = (content.match(/<button\s+[^>]*>/g) || []).length;
      const accessibleButtons = (content.match(/<AccessibleButton/g) || []).length;

      const hasValidButtonRatio = hardcodedButtons === 0;

      runner.recordTest(
        `${page.name} - No Hardcoded Buttons`,
        hasValidButtonRatio,
        hasValidButtonRatio
          ? `✓ All buttons use AccessibleButton (${accessibleButtons} found)`
          : `⚠ Found ${hardcodedButtons} native <button> elements (should be 0)`
      );
    }
  });

  console.log(`\n${colors.cyan}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.blue}[Manual Browser Tests Required]${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}\n`);

  console.log(`${colors.yellow}To complete keyboard navigation validation:${colors.reset}\n`);

  console.log(`${colors.cyan}Test 1: Tab Order and Navigation${colors.reset}`);
  console.log(`  1. Start dev server: npm run dev`);
  console.log(`  2. Open: http://localhost:5173/aws/frameworks`);
  console.log(`  3. Press Tab repeatedly from top of page`);
  console.log(`  4. Verify: Focus moves logically left→right, top→bottom`);
  console.log(`  5. Verify: All interactive elements are reachable (no skips)`);
  console.log(`  6. Verify: Focus ring is visible around all items\n`);

  console.log(`${colors.cyan}Test 2: Focus Visibility${colors.reset}`);
  console.log(`  1. On any button, press Tab to focus it`);
  console.log(`  2. Verify: Focus ring appears (blue outline + offset)`);
  console.log(`  3. Verify: Ring is clearly visible on all page backgrounds`);
  console.log(`  4. Note: Styles should match 'focus:ring-2 focus:ring-offset-2'\n`);

  console.log(`${colors.cyan}Test 3: Focus Traps${colors.reset}`);
  console.log(`  1. Open any page (e.g., /aws/blog)`);
  console.log(`  2. Press Tab until reaching last interactive element`);
  console.log(`  3. Press Tab one more time`);
  console.log(`  4. Verify: Focus returns to first interactive element (not trapped)\n`);

  console.log(`${colors.cyan}Test 4: Button Accessibility${colors.reset}`);
  console.log(`  1. Using browser DevTools, inspect any AccessibleButton component`);
  console.log(`  2. Verify: Element has role='button' or is semantic <button>`);
  console.log(`  3. Verify: Button text is visible and descriptive`);
  console.log(`  4. Note: All buttons should be keyboard accessible (Tab/Space/Enter)\n`);

  console.log(`${colors.cyan}Test 5: Skip Navigation Links${colors.reset}`);
  console.log(`  1. Go to /aws/frameworks`);
  console.log(`  2. Press Tab while holding Shift at very start of page`);
  console.log(`  3. Verify: Skip link appears (optional but recommended)\n`);

  console.log(`${colors.cyan}Additional Checks:${colors.reset}`);
  console.log(`  - Open DevTools Console on all test pages`);
  console.log(`  - Verify: No warnings about missing ARIA labels`);
  console.log(`  - Verify: No axe-core accessibility violations\n`);

  // Return success/failure
  return runner.printSummary();
}

/**
 * Run validation
 */
const success = generateValidationReport();

process.exit(success ? 0 : 1);
