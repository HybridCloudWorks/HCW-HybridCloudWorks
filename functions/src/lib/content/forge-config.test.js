import { describe, it, expect, vi } from 'vitest';
import {
  createForgeConfigLoader,
  normalizePrompts,
  normalizeProfile,
  DEFAULT_MASTER_PROMPT,
  DEFAULT_PROMPTS,
  CACHE_TTL_MS,
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
