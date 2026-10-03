/**
 * The tab resolver, through the shared contract (../tabContract.js). What is
 * specific to the Ambassador hub is the route and the ids a reader might
 * guess at before any real one existed.
 */
import { describe, expect, it } from 'vitest';
import * as tabs from './tabs';
import { describeTabResolver } from '../tabContract';

describeTabResolver(tabs, {
  route: '/admin/ambassador',
  redirects: {
    overview: 'dashboard',
    catalog: 'programs',
    import: 'evidence',
    reminders: 'settings',
  },
});

describe('Ambassador tabs', () => {
  it('ends with Settings, as ADR 0033 §8 requires', () => {
    expect(tabs.TABS.at(-1).id).toBe('settings');
    expect(tabs.TABS.map((t) => t.label)).toEqual([
      'Dashboard',
      'Programs',
      'Applications',
      'Evidence',
      'Settings',
    ]);
  });
});
