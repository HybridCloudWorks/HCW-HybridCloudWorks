/**
 * The Platform group's order and membership.
 *
 * The owner asked for this order explicitly — Platform Settings first, Labs
 * last, with the two merged pages between them — so it is asserted rather than
 * left to whoever next appends an item to the array. Appending is what the
 * array invites, and an appended item lands after Labs.
 */
import { describe, it, expect } from 'vitest';

import { NAV_GROUPS } from './AdminLayout';

const platform = () => NAV_GROUPS.find((group) => group.label === 'Platform');

describe('the Platform nav group', () => {
  it('runs settings, health, integrations, labs — in that order', () => {
    expect(platform().items.map((item) => item.label)).toEqual([
      'Platform Settings',
      'Health',
      'Integrations',
      'Labs',
    ]);
  });

  it('points each item at the route that still exists', () => {
    expect(platform().items.map((item) => item.to)).toEqual([
      '/admin/platform',
      '/admin/health',
      '/admin/integrations',
      '/admin/labs',
    ]);
  });

  it('no longer offers the four routes that were merged away', () => {
    // These still resolve — App.jsx redirects them — but a nav entry pointing
    // at a redirect is a second name for one page, which is the thing the
    // merge removed.
    const everyRoute = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to));
    for (const retired of [
      '/admin/ops-health',
      '/admin/diagnostics',
      '/admin/connections',
      '/admin/api-keys',
    ]) {
      expect(everyRoute).not.toContain(retired);
    }
  });
});
