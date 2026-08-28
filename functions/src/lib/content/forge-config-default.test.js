/**
 * The singleton contract (#239 review): Forge Studio and the forge worker
 * must share ONE loader instance, or a Studio edit clears a cache the worker
 * never reads and the edit waits out the 5-minute TTL instead. The cache and
 * clear semantics themselves are covered in forge-config.test.js; what this
 * file pins is the sharing.
 */
import { describe, it, expect } from 'vitest';

const first = await import('./forge-config-default.js');
const second = await import('./forge-config-default.js');

describe('defaultForgeConfig', () => {
  it('is one instance for the whole process', () => {
    expect(first.defaultForgeConfig).toBe(second.defaultForgeConfig);
  });

  it('exposes the loader surface the Studio and the worker each need', () => {
    expect(typeof first.defaultForgeConfig.loadForgeProfile).toBe('function');
    expect(typeof first.defaultForgeConfig.loadForgePrompts).toBe('function');
    expect(typeof first.defaultForgeConfig.clearForgeConfigCache).toBe('function');
  });
});
