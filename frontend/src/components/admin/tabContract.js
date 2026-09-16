/**
 * The assertions every hub's tab resolver must satisfy (#577).
 *
 * Each hub ships the same `resolveTab`/`tabHref` pair over its own TABS and
 * MOVED_TABS, and each shipped its own copy of the same test file — two of them
 * close enough that Qlty flagged 50 duplicated lines at mass 324 on #626. The
 * contract is one thing, so it is written once here and each hub's test file
 * supplies only what differs: its module, its route, and the old ids it still
 * has to answer.
 *
 * Not a `.test.js` file, so vitest does not collect it on its own; the
 * `describe` blocks below register against whichever test file calls it. The
 * hubs still carrying their own copy (certifications, listen-and-learn,
 * recording-hub, social, speaking-events) can adopt this without changing what
 * they assert.
 */
import { describe, expect, it } from 'vitest';

/**
 * Register the shared tab-resolver suite for one hub.
 *
 * @param {object} tabsModule the hub's `tabs.js`, imported as a namespace
 * @param {object} options
 * @param {string} options.route the hub's admin route, e.g. `/admin/labs`
 * @param {Record<string,string>} options.redirects old `?tab=` ids this hub
 *   must still answer, mapped to the tab their content moved to
 */
export function describeTabResolver(tabsModule, { route, redirects }) {
  const { DEFAULT_TAB, MOVED_TABS, TABS, resolveTab, tabHref } = tabsModule;

  describe('resolveTab', () => {
    it('keeps a tab that exists', () => {
      for (const { id } of TABS) expect(resolveTab(id)).toBe(id);
    });

    it('sends an old address to where its content went', () => {
      // Every entry here is a link someone may already have written down.
      expect(Object.keys(redirects).length).toBeGreaterThan(0);
      for (const [old, moved] of Object.entries(redirects)) {
        expect(resolveTab(old)).toBe(moved);
      }
    });

    it('falls back to the default tab for an unknown id, for nothing, and for undefined', () => {
      for (const requested of ['nope', '', undefined, null]) {
        expect(resolveTab(requested)).toBe(DEFAULT_TAB);
      }
    });

    it('does not read Object.prototype for a `?tab=` that names one of its keys', () => {
      for (const key of ['constructor', 'toString', '__proto__']) {
        expect(resolveTab(key)).toBe(DEFAULT_TAB);
      }
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
      expect(tabHref(DEFAULT_TAB)).toBe(`${route}?tab=${DEFAULT_TAB}`);
    });

    it('encodes a value rather than pasting it into the query string', () => {
      expect(tabHref('a b&c')).toBe(`${route}?tab=a%20b%26c`);
    });
  });
}
