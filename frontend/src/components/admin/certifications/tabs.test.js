/**
 * Where a `?tab=` value lands on the Certifications Hub (#572): its own tab,
 * the tab its content moved to, or Catalog — never a blank panel.
 */
import { describe, it, expect } from 'vitest';

import { DEFAULT_TAB, MOVED_TABS, TABS, resolveTab, tabHref } from './tabs';

describe('resolveTab', () => {
  it('opens each tab by its own id, with Settings last', () => {
    expect(TABS.map((tab) => tab.id)).toEqual([
      'catalog',
      'featured',
      'renewals',
      'publishing',
      'settings',
    ]);
    for (const { id } of TABS) expect(resolveTab(id)).toBe(id);
  });

  it('sends the old view toggle ids to the tab that holds their content', () => {
    expect(resolveTab('all')).toBe('catalog');
    expect(resolveTab('featured')).toBe('featured');
    expect(resolveTab('expiring')).toBe('renewals');
    expect(resolveTab('expired')).toBe('renewals');
    expect(resolveTab('hidden')).toBe('settings');
    expect(resolveTab('snapshot')).toBe('publishing');
    expect(resolveTab('publish')).toBe('publishing');
  });

  it('lands every moved id on a tab that exists', () => {
    const ids = new Set(TABS.map((tab) => tab.id));
    for (const target of Object.values(MOVED_TABS)) expect(ids.has(target)).toBe(true);
  });

  it('opens Catalog for an unknown, empty, missing or inherited id', () => {
    expect(DEFAULT_TAB).toBe('catalog');
    for (const id of ['nope', '', null, undefined, 'constructor', '__proto__', 'toString']) {
      expect(resolveTab(id)).toBe('catalog');
    }
  });

  it('builds a deep link', () => {
    expect(tabHref('renewals')).toBe('/admin/certifications?tab=renewals');
  });
});
