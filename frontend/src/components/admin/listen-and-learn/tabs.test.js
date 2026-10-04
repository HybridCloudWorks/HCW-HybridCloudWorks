/**
 * The tab resolver, through the shared contract (components/admin/
 * tabContract.js): every old address this hub has had still lands somewhere
 * real, including `published`, which ADR 0033 §4 folded into the Library.
 */
import { describe, expect, it } from 'vitest';
import * as tabs from './tabs';
import { describeTabResolver } from '../tabContract';

describeTabResolver(tabs, {
  route: '/admin/listen-and-learn',
  redirects: {
    published: 'library',
    sets: 'library',
    episodes: 'library',
    drafts: 'review',
    voice: 'settings',
    grounding: 'generate',
  },
});

describe('the Library is the front door', () => {
  it('opens on the Library and lists the four duties in order', () => {
    expect(tabs.DEFAULT_TAB).toBe('library');
    expect(tabs.TABS.map((t) => t.id)).toEqual(['library', 'generate', 'review', 'settings']);
  });
});
