/**
 * The selection document, version 2 (ADR 0034 §2 and §6, #858): what a read
 * drops, what a save refuses.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_CHAIN_LENGTH,
  SELECTION_MODES,
  SELECTION_VERSION,
  isSelectionV2,
  normalizeSelection,
  normalizeSteps,
  validateSelection,
} from './selection.js';
import { DEFAULT_PROVIDER_ORDER } from './provider-order.js';

describe('normalizeSelection — drops what it cannot use', () => {
  it('reads the documented shape through unchanged', () => {
    const doc = {
      version: 2,
      global: { priority: [{ provider: 'foundry', model: null }, { provider: 'gemini', model: 'gemini-3.6-flash' }] },
      tasks: {
        forgeDrafting: { mode: 'recommended' },
        inspector: { mode: 'global', exclude: ['nvidia'] },
        podcastScript: {
          mode: 'custom',
          chain: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }],
          thenGlobal: false,
        },
      },
      updatedAt: '2026-10-04T21:05:00Z',
      updatedBy: 'owner',
    };
    expect(normalizeSelection(doc)).toEqual(doc);
  });

  it('drops an unknown provider, collapses a duplicate to its first occurrence, trims models (§6)', () => {
    const { global, tasks } = normalizeSelection({
      global: {
        priority: [
          { provider: ' Gemini ', model: ' gemini-2.5-pro ' },
          { provider: 'vertex' },
          { provider: 'gemini', model: 'other' },
          { provider: 'openai', model: '' },
        ],
      },
      tasks: {
        telegram: {
          mode: 'custom',
          chain: [{ provider: 'openai' }, { provider: 'perplexity' }, { provider: 'openai', model: 'x' }],
          exclude: ['nvidia', 'bedrock', 'nvidia', 'FOUNDRY'],
        },
      },
    });
    expect(global.priority).toEqual([
      { provider: 'gemini', model: 'gemini-2.5-pro' },
      { provider: 'openai', model: null },
    ]);
    expect(tasks.telegram).toEqual({
      mode: 'custom',
      chain: [{ provider: 'openai', model: null }],
      thenGlobal: true,
      exclude: ['nvidia', 'foundry'],
    });
  });

  it('drops an unknown task, reads a bad mode as global, keeps chain only for custom, defaults thenGlobal', () => {
    const { tasks } = normalizeSelection({
      tasks: {
        nope: { mode: 'custom', chain: [{ provider: 'gemini' }] },
        telegram: { mode: 'always', chain: [{ provider: 'gemini' }], thenGlobal: false, exclude: [] },
        inspector: { mode: 'custom' },
        critique: { mode: 'recommended', chain: [{ provider: 'gemini' }], thenGlobal: false },
      },
    });
    expect(tasks).toEqual({
      telegram: { mode: 'global' },
      inspector: { mode: 'custom', chain: [], thenGlobal: true },
      critique: { mode: 'recommended' },
    });
  });

  it('reads nothing as an empty version 2 document, and never throws', () => {
    for (const raw of [null, undefined, 'x', 7, [], { global: 'x', tasks: [] }]) {
      expect(normalizeSelection(raw)).toEqual({
        version: SELECTION_VERSION,
        global: { priority: [] },
        tasks: {},
        updatedAt: null,
        updatedBy: null,
      });
    }
  });

  it('caps a chain at one step per provider', () => {
    expect(MAX_CHAIN_LENGTH).toBe(DEFAULT_PROVIDER_ORDER.length);
    const chain = DEFAULT_PROVIDER_ORDER.map((provider) => ({ provider }));
    expect(normalizeSteps([...chain, ...chain], MAX_CHAIN_LENGTH)).toHaveLength(MAX_CHAIN_LENGTH);
  });

  it('isSelectionV2 keys on the version alone', () => {
    expect(isSelectionV2({ version: 2 })).toBe(true);
    expect(isSelectionV2({ version: '2' })).toBe(false);
    expect(isSelectionV2({ routes: {} })).toBe(false);
    expect(isSelectionV2(null)).toBe(false);
    expect(SELECTION_MODES).toEqual(['recommended', 'global', 'custom']);
  });
});

describe('validateSelection — names what a save must not store (§6)', () => {
  const ok = {
    version: 2,
    global: { priority: [{ provider: 'gemini', model: null }] },
    tasks: { telegram: { mode: 'custom', chain: [{ provider: 'openai' }], thenGlobal: true } },
    updatedAt: null,
  };

  it('accepts the documented shape', () => {
    expect(validateSelection(ok)).toEqual([]);
  });

  it.each([
    [null, 'Body must be { version: 2, global: { priority }, tasks }'],
    [{ ...ok, version: 1 }, 'version must be 2'],
    [{ ...ok, global: null }, 'global must be { priority: [{ provider, model? }] }'],
    [{ ...ok, global: { priority: [] } }, 'global.priority needs at least one provider'],
    [{ ...ok, global: { priority: 'gemini' } }, 'global.priority must be an array of { provider, model? }'],
    [{ ...ok, global: { priority: ['gemini'] } }, 'global.priority[0] must be { provider, model? }'],
    [
      { ...ok, global: { priority: [{ provider: 'vertex' }] } },
      `global.priority[0].provider must be one of ${DEFAULT_PROVIDER_ORDER.join(', ')}`,
    ],
    [
      { ...ok, global: { priority: [{ provider: 'gemini' }, { provider: 'Gemini' }] } },
      'global.priority[1]: gemini is listed twice',
    ],
    [{ ...ok, global: { priority: [{ provider: 'gemini', model: 7 }] } }, 'global.priority[0].model must be a string or null'],
    [{ ...ok, tasks: [] }, 'tasks must be an object'],
    [{ ...ok, tasks: { nope: { mode: 'global' } } }, expect.stringMatching(/^Unknown AI task: nope\. Known: /)],
    [{ ...ok, tasks: { telegram: 'global' } }, 'tasks.telegram must be { mode, chain?, thenGlobal?, exclude? }'],
    [{ ...ok, tasks: { telegram: { mode: 'always' } } }, 'tasks.telegram.mode must be one of recommended, global, custom'],
    [{ ...ok, tasks: { telegram: { mode: 'global', chain: [] } } }, 'tasks.telegram.chain is only for mode custom'],
    [{ ...ok, tasks: { telegram: { mode: 'custom' } } }, 'tasks.telegram.chain is required for mode custom'],
    [
      { ...ok, tasks: { telegram: { mode: 'custom', chain: Array(6).fill({ provider: 'gemini' }) } } },
      `tasks.telegram.chain: at most ${MAX_CHAIN_LENGTH} entries`,
    ],
    [
      { ...ok, tasks: { telegram: { mode: 'custom', chain: [{ provider: 'gemini' }, { provider: 'gemini' }] } } },
      'tasks.telegram.chain[1]: gemini is listed twice',
    ],
    [{ ...ok, tasks: { telegram: { mode: 'global', thenGlobal: 'yes' } } }, 'tasks.telegram.thenGlobal must be a boolean'],
    [{ ...ok, tasks: { telegram: { mode: 'global', exclude: 'nvidia' } } }, 'tasks.telegram.exclude must be an array of providers'],
    [{ ...ok, tasks: { telegram: { mode: 'global', exclude: ['bedrock'] } } }, 'tasks.telegram.exclude: unknown provider "bedrock"'],
    [{ ...ok, updatedAt: 7 }, 'updatedAt must be a string or null'],
  ])('refuses %j', (doc, error) => {
    const errors = validateSelection(doc);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors).toContainEqual(error);
  });

  it('with availability, refuses a custom chain with no eligible entry and thenGlobal off: "would have no model"', () => {
    const doc = {
      ...ok,
      tasks: {
        forgeDrafting: { mode: 'custom', chain: [{ provider: 'anthropic' }], thenGlobal: false },
        telegram: { mode: 'custom', chain: [{ provider: 'anthropic' }], thenGlobal: true },
      },
    };
    const availability = { keyed: ['gemini'], enabled: ['gemini'] };
    expect(validateSelection(doc, { availability })).toEqual([
      'tasks.forgeDrafting: this task would have no model — no entry of its custom chain is eligible and the Priority list does not follow it (Forge drafting)',
    ]);
    // Without availability the rule is not checked (the shape alone).
    expect(validateSelection(doc)).toEqual([]);
    // With the provider keyed it is fine.
    expect(validateSelection(doc, { availability: { keyed: ['gemini', 'anthropic'], enabled: ['anthropic'] } })).toEqual([]);
  });
});
