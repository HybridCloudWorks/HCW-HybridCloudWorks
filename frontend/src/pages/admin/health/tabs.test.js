/**
 * Where a `?tab=` value lands on the Health Hub (#569): its own tab, the tab
 * its content moved to, or Overview — never a blank panel.
 */
import { describe, it, expect } from 'vitest';

import { DEFAULT_TAB, MOVED_TABS, TABS, resolveTab } from './tabs';

describe('resolveTab', () => {
  it('opens each tab by its own id', () => {
    expect(TABS.map((tab) => tab.id)).toEqual(['overview', 'alerts', 'checks', 'code', 'report']);
    for (const { id } of TABS) expect(resolveTab(id)).toBe(id);
  });

  it('sends an old or plausible id to the tab that holds its content', () => {
    expect(resolveTab('signals')).toBe('overview');
    expect(resolveTab('observed')).toBe('overview');
    expect(resolveTab('status')).toBe('overview');
    expect(resolveTab('workflow-alerts')).toBe('alerts');
    for (const id of ['probes', 'verify', 'verified', 'diagnostics', 'smoke']) {
      expect(resolveTab(id)).toBe('checks');
    }
    expect(resolveTab('copy')).toBe('report');
    for (const id of ['qlty', 'quality', 'security', 'code-quality']) {
      expect(resolveTab(id)).toBe('code');
    }
  });

  it('lands every moved id on a tab that exists', () => {
    const ids = new Set(TABS.map((tab) => tab.id));
    for (const target of Object.values(MOVED_TABS)) expect(ids.has(target)).toBe(true);
  });

  it('opens Overview for an unknown, empty or missing id', () => {
    expect(DEFAULT_TAB).toBe('overview');
    expect(resolveTab('nope')).toBe('overview');
    expect(resolveTab('')).toBe('overview');
    expect(resolveTab(null)).toBe('overview');
    expect(resolveTab(undefined)).toBe('overview');
    // An inherited property name is not a moved id.
    expect(resolveTab('constructor')).toBe('overview');
    expect(resolveTab('__proto__')).toBe('overview');
  });
});
