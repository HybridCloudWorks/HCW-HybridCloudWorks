import { describe, it, expect } from 'vitest';
import {
  BANNED_PHRASES,
  MAX_MODULES,
  mergeBannedPhrases,
  findBannedPhrases,
  scanBannedPhrases,
  validateModules,
} from './content-modules.js';

describe('banned phrases', () => {
  it('mergeBannedPhrases dedups and trims extras', () => {
    const merged = mergeBannedPhrases(['  Custom Phrase  ', 'cutting-edge', '']);
    expect(merged).toContain('Custom Phrase');
    // 'cutting-edge' already in the base set is not duplicated
    expect(merged.filter((p) => p === 'cutting-edge')).toHaveLength(1);
    expect(merged).not.toContain('');
  });

  it('findBannedPhrases is case-insensitive and skips the "..." display patterns', () => {
    const hits = findBannedPhrases('This is a GAME-CHANGER and truly cutting-edge.');
    expect(hits).toEqual(expect.arrayContaining(['game-changer', 'cutting-edge']));
    // 'take your ... to the next level' contains '...', must never match
    expect(findBannedPhrases('take your app to the next level')).not.toContain(
      'take your ... to the next level'
    );
  });

  it('findBannedPhrases honours caller-supplied extras', () => {
    expect(findBannedPhrases('the widget is synergistic', ['synergistic'])).toContain('synergistic');
  });

  it('scanBannedPhrases is the stricter literal variant — no "..." skipping, no extras', () => {
    // scan does not skip '...' phrases, so a literal match on one still counts;
    // and it ignores extras entirely.
    expect(scanBannedPhrases('we seamlessly integrate everything')).toContain('seamlessly integrate');
    expect(scanBannedPhrases('synergistic', ['synergistic'])).toEqual([]);
  });

  it('clean prose trips nothing', () => {
    expect(findBannedPhrases('A concrete note about az cli version 2.61 behaviour.')).toEqual([]);
    expect(scanBannedPhrases('A concrete note about az cli version 2.61 behaviour.')).toEqual([]);
  });

  it('the banned list is the exact Site-Main set (spot-checks)', () => {
    for (const p of ['delve into', 'in conclusion', 'unlock the power of']) {
      expect(BANNED_PHRASES).toContain(p);
    }
  });
});

describe('validateModules', () => {
  it('accepts a well-formed text module', () => {
    const r = validateModules('<module type="text" align="left">A callout</module>');
    expect(r).toEqual({ valid: true, moduleCount: 1, issues: [], picturePrompts: [] });
  });

  it('flags an unknown type and stops scoring that block', () => {
    const r = validateModules('<module type="bogus">x</module>');
    expect(r.valid).toBe(false);
    expect(r.issues[0]).toMatch(/Unknown module type "bogus"/);
  });

  it('flags an invalid align value', () => {
    const r = validateModules('<module type="text" align="center">x</module>');
    expect(r.issues.some((i) => /invalid align "center"/.test(i))).toBe(true);
  });

  it('requires JSON body for links and reports non-JSON', () => {
    expect(validateModules('<module type="links">not json</module>').issues[0]).toMatch(/not valid JSON/);
    const empty = validateModules('<module type="links">{"links":[]}</module>');
    expect(empty.issues[0]).toMatch(/has no links/);
    const ok = validateModules('<module type="links">{"links":[{"title":"t","url":"u"}]}</module>');
    expect(ok.valid).toBe(true);
  });

  it('extracts picture prompts and flags a picture with neither url nor prompt', () => {
    const withPrompt = validateModules('<module type="picture">{"imagePrompt":"a diagram"}</module>');
    expect(withPrompt.picturePrompts).toEqual(['a diagram']);
    expect(withPrompt.valid).toBe(true);
    const bare = validateModules('<module type="picture">{}</module>');
    expect(bare.issues[0]).toMatch(/neither imageUrl nor imagePrompt/);
  });

  it('flags an empty free-text module', () => {
    expect(validateModules('<module type="fact">   </module>').issues[0]).toMatch(/is empty/);
  });

  it('caps the module count', () => {
    const many = '<module type="text">x</module>'.repeat(MAX_MODULES + 1);
    const r = validateModules(many);
    expect(r.moduleCount).toBe(MAX_MODULES + 1);
    expect(r.issues.some((i) => /Too many modules/.test(i))).toBe(true);
  });

  it('is re-entrant despite the global regex (lastIndex reset each call)', () => {
    const doc = '<module type="text">a</module>';
    // Two calls in a row must give identical results — proves lastIndex reset.
    expect(validateModules(doc)).toEqual(validateModules(doc));
  });

  it('handles empty and non-string input', () => {
    expect(validateModules('')).toEqual({ valid: true, moduleCount: 0, issues: [], picturePrompts: [] });
    expect(validateModules(undefined).moduleCount).toBe(0);
  });
});
