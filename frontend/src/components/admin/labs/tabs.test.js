/**
 * The tab resolver, which is the only thing standing between a `?tab=` value
 * and the page picking a panel out of an object.
 *
 * The assertions are the shared contract (../tabContract.js). What is specific
 * to Labs is the route and the old ids: `setup` was the third tab before #577
 * split it into Agents and Settings, `history` was how the job table was
 * reached when it was the bottom of Dashboard, and `labs` is the word someone
 * reaching for the catalogue types first (ADR 0033).
 */
import { describe, expect, it } from 'vitest';
import * as tabs from './tabs';
import { describeTabResolver } from '../tabContract';

describeTabResolver(tabs, {
  route: '/admin/labs',
  redirects: { setup: 'settings', history: 'jobs', labs: 'catalogue' },
});

describe('the Labs Hub order (ADR 0033)', () => {
  it('opens on the Catalogue, with the runner tabs after it', () => {
    expect(tabs.DEFAULT_TAB).toBe('catalogue');
    expect(tabs.TABS.map((tab) => tab.id)).toEqual([
      'catalogue',
      'dashboard',
      'jobs',
      'console',
      'agents',
      'settings',
      'coder',
    ]);
  });
});
