import { describe, it, expect } from 'vitest';
import { NAV_GROUPS, NAV_ITEMS, navGroupFor, navItemFor } from './adminNav';

describe('navItemFor', () => {
  it('matches a route exactly, then by longest prefix, never the bare /admin for deeper paths', () => {
    expect(navItemFor('/admin').label).toBe('Dashboard');
    expect(navItemFor('/admin/queue').label).toBe('Review Queue');
    expect(navItemFor('/admin/queue/abc123').label).toBe('Review Queue');
    expect(navItemFor('/admin/editor/abc123').label).toBe('Editor');
    expect(navItemFor('/admin/ai-engine/docs/gemini').label).toBe('AI Engine');
    expect(navItemFor('/admin/nope')).toBeNull();
    expect(navItemFor('')).toBeNull();
  });
});

describe('navGroupFor', () => {
  it('finds the group an item belongs to', () => {
    const labs = NAV_ITEMS.find((i) => i.label === 'Labs');
    expect(navGroupFor(labs).label).toBe('Enhanced');
    expect(navGroupFor({ to: '/x' })).toBeNull();
  });
});

describe('the registry', () => {
  it('is frozen so a page cannot rewrite the menu', () => {
    expect(Object.isFrozen(NAV_GROUPS)).toBe(true);
    expect(Object.isFrozen(NAV_ITEMS)).toBe(true);
  });
});
