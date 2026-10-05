/**
 * The model catalogue helpers (ADR 0034 slice 2, #857): which models a card
 * offers, how the disclosure list orders them, the merge onto the provider
 * documents, and the "List refreshed" line.
 */
import { describe, it, expect } from 'vitest';
import {
  catalogEntries,
  describeRefresh,
  isStaleEntry,
  relativeTime,
  visibleModelsFor,
  withCatalogModels,
} from './catalog.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const model = (id, over = {}) => ({
  id,
  status: 'live',
  hidden: false,
  unpriced: false,
  capabilities: ['text'],
  ...over,
});

const catalog = {
  providers: {
    openai: {
      refresh: { lastOk: '2026-10-05T06:15:00.000Z', lastAttempt: null, lastError: null },
      stale: false,
      models: {
        'gpt-5-nano': model('gpt-5-nano'),
        'gpt-4o': model('gpt-4o', { status: 'retired' }),
        'gpt-5-mini': model('gpt-5-mini', { hidden: true }),
        'o3-mini': model('o3-mini', { status: 'unknown', unpriced: true }),
        'gpt-4o-mini': model('gpt-4o-mini'),
        // Listed by the provider, enriched with no text capability.
        'gpt-4o-mini-tts': model('gpt-4o-mini-tts', { capabilities: [] }),
      },
    },
    nvidia: {
      refresh: { lastOk: null, lastAttempt: null, lastError: null },
      stale: true,
      seeded: true,
      models: { 'z-ai/glm-5.3': model('z-ai/glm-5.3', { status: 'unknown' }) },
    },
  },
};

describe('visibleModelsFor', () => {
  it('offers live and unknown text models that are not hidden, live first then by id', () => {
    // The speech model is in the disclosure, never in a select.
    expect(visibleModelsFor(catalog, 'openai')).toEqual(['gpt-4o-mini', 'gpt-5-nano', 'o3-mini']);
    expect(
      visibleModelsFor({ providers: { x: { models: { a: { id: 'a', status: 'live' } } } } }, 'x')
    ).toEqual([]);
    expect(visibleModelsFor(catalog, 'nvidia')).toEqual(['z-ai/glm-5.3']);
    expect(visibleModelsFor(catalog, 'gemini')).toEqual([]);
    expect(visibleModelsFor(null, 'openai')).toEqual([]);
  });
});

describe('catalogEntries', () => {
  it('lists every model including hidden and retired: live, unknown, retired, by id', () => {
    expect(catalogEntries(catalog.providers.openai).map((m) => m.id)).toEqual([
      'gpt-4o-mini',
      'gpt-4o-mini-tts',
      'gpt-5-mini',
      'gpt-5-nano',
      'o3-mini',
      'gpt-4o',
    ]);
    expect(catalogEntries(null)).toEqual([]);
  });
});

describe('withCatalogModels', () => {
  it('replaces models from the catalogue and leaves a provider the catalogue does not know', () => {
    const providers = [
      { id: 'openai', name: 'OpenAI', models: ['typed-in'] },
      { id: 'gemini', name: 'Gemini', models: ['gemini-3.6-flash'] },
    ];
    expect(withCatalogModels(providers, catalog)).toEqual([
      { id: 'openai', name: 'OpenAI', models: ['gpt-4o-mini', 'gpt-5-nano', 'o3-mini'] },
      { id: 'gemini', name: 'Gemini', models: ['gemini-3.6-flash'] },
    ]);
    expect(withCatalogModels(providers, null)).toEqual(providers);
    expect(withCatalogModels(undefined, catalog)).toEqual([]);
  });
});

describe('describeRefresh', () => {
  it('says never, fresh, or stale with the age', () => {
    expect(describeRefresh(catalog.providers.nvidia, NOW)).toBe('List not refreshed yet');
    expect(describeRefresh(catalog.providers.openai, NOW)).toBe('List refreshed 7d ago');
    const stale = {
      refresh: { lastOk: '2026-09-20T06:15:00.000Z' },
      stale: true,
    };
    expect(describeRefresh(stale, NOW)).toBe('List is stale — refreshed 22d ago');
  });

  it('derives stale from lastOk when the API did not say', () => {
    expect(isStaleEntry({ refresh: { lastOk: '2026-10-05T06:15:00.000Z' } }, NOW)).toBe(false);
    expect(isStaleEntry({ refresh: { lastOk: '2026-10-03T06:15:00.000Z' } }, NOW)).toBe(true);
    expect(isStaleEntry({ refresh: { lastOk: null } }, NOW)).toBe(true);
    expect(
      isStaleEntry({ refresh: { lastOk: '2026-10-03T06:15:00.000Z' }, stale: false }, NOW)
    ).toBe(false);
  });

  it('relativeTime follows the card’s steps and gives a date past a month', () => {
    expect(relativeTime('2026-10-12T11:59:40.000Z', NOW)).toBe('just now');
    expect(relativeTime('2026-10-12T11:40:00.000Z', NOW)).toBe('20m ago');
    expect(relativeTime('2026-10-12T07:00:00.000Z', NOW)).toBe('5h ago');
    expect(relativeTime('2026-08-01T12:00:00.000Z', NOW)).toBe(
      new Date('2026-08-01T12:00:00.000Z').toLocaleDateString()
    );
    expect(relativeTime('not a date', NOW)).toBeNull();
  });
});
