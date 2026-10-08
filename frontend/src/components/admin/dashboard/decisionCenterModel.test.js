/** The Decision Center's pure half (#1013, #1014). */
import { describe, expect, it } from 'vitest';
import {
  DECISION_TABS,
  EMPTY_TEXT,
  SOURCE_PAGES,
  itemsForTab,
  kindLabel,
  resolveDecisionTab,
  sourcesForTab,
  stageLabel,
  waitingLabel,
} from './decisionCenterModel';
// items.js imports nothing, so this runs where only the frontend's packages
// are installed (the frontend CI job). That every source the API reads has a
// list page here is held from the other side: functions/src/lib/decision-center.test.js.
import { CATEGORIES } from '../../../../../functions/src/lib/decision-center/items.js';

const NOW = Date.parse('2026-10-08T12:00:00.000Z');

describe('decisionCenterModel', () => {
  it('has a tab for every category the API sorts into, plus Needs a Decision first', () => {
    expect(DECISION_TABS.map((tab) => tab.id)).toEqual(['all', ...CATEGORIES]);
    for (const tab of DECISION_TABS) expect(EMPTY_TEXT, tab.id).toHaveProperty(tab.id);
  });

  it('sends every source to a page inside the admin', () => {
    for (const [id, href] of Object.entries(SOURCE_PAGES)) expect(href, id).toMatch(/^\/admin\//);
  });

  it('resolves only known tabs', () => {
    expect(resolveDecisionTab('pipelines')).toBe('pipelines');
    expect(resolveDecisionTab('constructor')).toBe('all');
    expect(resolveDecisionTab(null)).toBe('all');
  });

  it('filters items and sources by tab, keeping the API’s order', () => {
    const items = [
      { id: 'a', category: 'queues' },
      { id: 'b', category: 'other' },
      { id: 'c', category: 'queues' },
    ];
    expect(itemsForTab(items, 'all')).toBe(items);
    expect(itemsForTab(items, 'queues').map((item) => item.id)).toEqual(['a', 'c']);
    expect(sourcesForTab([{ category: 'other' }], 'queues')).toEqual([]);
  });

  it('says how long something has waited', () => {
    expect(waitingLabel('2026-10-08T11:50:00.000Z', NOW)).toBe('waiting 10m');
    expect(waitingLabel('2026-10-08T07:00:00.000Z', NOW)).toBe('waiting 5h');
    expect(waitingLabel('2026-10-05T12:00:00.000Z', NOW)).toBe('waiting 3d');
    expect(waitingLabel('2026-10-10T12:00:00.000Z', NOW)).toBe('in 2d');
    expect(waitingLabel(null, NOW)).toBe('');
    expect(waitingLabel('not a date', NOW)).toBe('');
  });

  it('labels kinds and stages, and words an unknown one rather than hiding it', () => {
    expect(kindLabel('coder_corner')).toBe('Coder Corner');
    expect(kindLabel('brand_new_kind')).toBe('Brand new kind');
    expect(stageLabel('approval')).toBe('Awaiting approval');
    expect(stageLabel('sync failed')).toBe('Sync failed');
    expect(stageLabel(undefined)).toBe('');
  });
});
