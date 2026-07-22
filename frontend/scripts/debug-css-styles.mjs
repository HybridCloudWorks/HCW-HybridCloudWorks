#!/usr/bin/env node
/**
 * Debug helper: dump the computed color and matched CSS rules for the
 * Azure-edu hover-state buttons that keep failing the contrast check.
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ colorScheme: 'light' });
  await ctx.addInitScript(() => {
    try {
      window.localStorage.setItem('hcw-theme', 'light');
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/azure/education', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const a = document.querySelector('a.bg-primary.hover\\:bg-blue-800');
    if (!a) return { error: 'no matching <a> found' };
    const computed = window.getComputedStyle(a);
    const computedHover = window.getComputedStyle(a, ':hover');
    return {
      element: a.outerHTML.slice(0, 300),
      classList: Array.from(a.classList),
      defaultColor: computed.color,
      hoverColor: computedHover.color,
      defaultBg: computed.backgroundColor,
      hoverBg: computedHover.backgroundColor,
    };
  });
  console.log(JSON.stringify(info, null, 2));
} finally {
  await browser.close();
}
