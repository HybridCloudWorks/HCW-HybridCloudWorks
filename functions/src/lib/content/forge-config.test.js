import { describe, it, expect, vi } from 'vitest';
import {
  createForgeConfigLoader,
  normalizePrompts,
  normalizeProfile,
  DEFAULT_MASTER_PROMPT,
  DEFAULT_PROMPTS,
  CACHE_TTL_MS,
  numberOr,
} from './forge-config.js';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';

describe('normalizePrompts / normalizeProfile', () => {
  it('fills every field from defaults and clamps the numbers', () => {
    expect(normalizePrompts({})).toEqual(DEFAULT_PROMPTS);
    const p = normalizePrompts({
      masterPrompt: '  custom ',
      extraBannedPhrases: ['synergy', '', 3],
      styleRules: { noEmDash: false, custom: ['x'] },
      publishThreshold: 140,
      autoForge: { enabled: true, dailyLimit: 99 },
      version: '4',
    });
    expect(p).toEqual({
      masterPrompt: 'custom',
      extraBannedPhrases: ['synergy', '3'],
      styleRules: { noEmDash: false, noHyphenTells: true, custom: ['x'] },
      publishThreshold: 100,
      autoForge: { enabled: true, dailyLimit: 10 },
      version: 4,
    });
    expect(normalizePrompts({ masterPrompt: '' }).masterPrompt).toBe(DEFAULT_MASTER_PROMPT);
    const profile = normalizeProfile({
      interestAreas: [{ key: ' k ', weight: '200', keywords: ['A ', ''] }],
      wordSoup: 5,
    });
    expect(profile.interestAreas).toEqual([
      { key: 'k', label: ' k ', weight: 100, keywords: ['a'] },
    ]);
    expect(profile.wordSoup).toBe('5');
  });
});

describe('createForgeConfigLoader', () => {
  it('reads admin_config under the constant partition, caches for the TTL, falls back on error', async () => {
    let t = 1_000_000;
    const store = {
      readDoc: vi.fn(async (_c, id) => (id === 'forge_prompts' ? { publishThreshold: 60 } : null)),
    };
    const loader = createForgeConfigLoader({ store, now: () => t });
    expect((await loader.loadForgePrompts()).publishThreshold).toBe(60);
    expect((await loader.loadForgeProfile()).interestAreas).toHaveLength(5);
    expect(store.readDoc).toHaveBeenCalledWith(
      'admin_config',
      'forge_prompts',
      ADMIN_CONFIG_PARTITION
    );
    await loader.loadForgePrompts();
    expect(store.readDoc).toHaveBeenCalledTimes(2); // cached
    t += CACHE_TTL_MS + 1;
    await loader.loadForgePrompts();
    expect(store.readDoc).toHaveBeenCalledTimes(3);
    await loader.loadForgePrompts({ bypassCache: true });
    expect(store.readDoc).toHaveBeenCalledTimes(4);
    loader.clearForgeConfigCache();
    store.readDoc.mockRejectedValueOnce(new Error('down'));
    expect((await loader.loadForgePrompts()).publishThreshold).toBe(80);
  });
});

describe('zero values and empty lists (ADR 0033)', () => {
  it('keeps an explicit 0 publish threshold and 0 daily limit instead of the fallbacks', () => {
    const prompts = normalizePrompts({
      publishThreshold: 0,
      autoForge: { enabled: true, dailyLimit: 0 },
    });
    expect(prompts.publishThreshold).toBe(0);
    expect(prompts.autoForge.dailyLimit).toBe(0);
    // Absent and unusable values still fall back.
    expect(normalizePrompts({}).publishThreshold).toBe(80);
    expect(
      normalizePrompts({
        publishThreshold: 'abc',
        autoForge: { dailyLimit: null },
      })
    ).toMatchObject({
      publishThreshold: 80,
      autoForge: { dailyLimit: 3 },
    });
  });

  it('keeps an explicit empty interest-area list, and takes the defaults only when the field is missing', () => {
    expect(normalizeProfile({ interestAreas: [] }).interestAreas).toEqual([]);
    expect(normalizeProfile({}).interestAreas.length).toBeGreaterThan(0);
    expect(normalizeProfile({ interestAreas: 'nope' }).interestAreas.length).toBeGreaterThan(0);
    expect(
      normalizeProfile({ interestAreas: [{ key: 'k', weight: 0 }] }).interestAreas[0].weight
    ).toBe(0);
  });

  it('numberOr', () => {
    expect(numberOr(0, 9)).toBe(0);
    expect(numberOr('', 9)).toBe(9);
    expect(numberOr(null, 9)).toBe(9);
    expect(numberOr('12', 9)).toBe(12);
    expect(numberOr('x', 9)).toBe(9);
  });
});
