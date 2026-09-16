/**
 * The tab resolver, which is the only thing standing between a `?tab=` value
 * and the page picking a panel out of an object.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TAB, MOVED_TABS, TABS, resolveTab, tabHref } from './tabs';

describe('resolveTab', () => {
  it('keeps a tab that exists', () => {
    for (const { id } of TABS) expect(resolveTab(id)).toBe(id);
  });

  it('sends an old address to where its content went', () => {
    expect(resolveTab('setup')).toBe('settings');
    expect(resolveTab('history')).toBe('jobs');
  });

  it('falls back to Dashboard for an unknown id, for nothing, and for undefined', () => {
    expect(resolveTab('nope')).toBe(DEFAULT_TAB);
    expect(resolveTab('')).toBe(DEFAULT_TAB);
    expect(resolveTab(undefined)).toBe(DEFAULT_TAB);
    expect(resolveTab(null)).toBe(DEFAULT_TAB);
  });

  it('does not read Object.prototype for a `?tab=` that names one of its keys', () => {
    expect(resolveTab('constructor')).toBe(DEFAULT_TAB);
    expect(resolveTab('toString')).toBe(DEFAULT_TAB);
    expect(resolveTab('__proto__')).toBe(DEFAULT_TAB);
  });

  it('every MOVED_TABS target is a real tab, so no redirect dead-ends', () => {
    const ids = new Set(TABS.map((tab) => tab.id));
    for (const target of Object.values(MOVED_TABS)) expect(ids.has(target)).toBe(true);
  });

  it('no MOVED_TABS key shadows a real tab id', () => {
    for (const { id } of TABS) expect(Object.hasOwn(MOVED_TABS, id)).toBe(false);
  });
});

describe('tabHref', () => {
  it('builds a deep link on the hub route', () => {
    expect(tabHref('dashboard')).toBe('/admin/labs?tab=dashboard');
  });

  it('encodes a value rather than pasting it into the query string', () => {
    expect(tabHref('a b&c')).toBe('/admin/labs?tab=a%20b%26c');
  });
});
