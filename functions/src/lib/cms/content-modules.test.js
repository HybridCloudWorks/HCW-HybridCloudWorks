import { describe, it, expect } from 'vitest';
import {
  BANNED_PHRASES,
  KNOWN_MODULE_TYPES,
  JSON_MODULE_TYPES,
  MAX_MODULES,
  MAX_STAT_BOARD_STATS,
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

  it('rejects a JSON body that is not an object', () => {
    expect(validateModules('<module type="callout">5</module>').issues[0]).toMatch(
      /JSON body is not an object/
    );
    expect(validateModules('<module type="links">["a","b"]</module>').issues[0]).toMatch(
      /JSON body is not an object/
    );
  });

  it('pull_quote requires text; attribution is optional', () => {
    expect(validateModules('<module type="pull_quote">{"attribution":"Me"}</module>').issues[0]).toMatch(
      /has no text/
    );
    expect(
      validateModules('<module type="pull_quote">{"text":"Ship it"}</module>').valid
    ).toBe(true);
  });

  it('stat_board requires 2-4 stats, each with value and label', () => {
    const stat = (value, label) => JSON.stringify({ value, label });
    const board = (stats) => `<module type="stat_board">{"stats":[${stats}]}</module>`;
    expect(validateModules(board(stat('1', 'one'))).issues[0]).toMatch(/needs 2-4 stats, has 1/);
    expect(
      validateModules(board(Array.from({ length: 5 }, (_, i) => stat(`${i}`, `s${i}`)).join(',')))
        .issues[0]
    ).toMatch(/needs 2-4 stats, has 5/);
    expect(validateModules(board([stat('40%', 'lower cost'), stat('', 'nodes')].join(','))).issues[0]).toMatch(
      /missing value or label/
    );
    expect(
      validateModules(board([stat('40%', 'lower cost'), stat('3', 'nodes')].join(','))).valid
    ).toBe(true);
  });

  it('comparison requires >=2 columns, >=1 row, and row length matching columns', () => {
    const cmp = (body) => validateModules(`<module type="comparison">${body}</module>`);
    expect(cmp('{"columns":["A"],"rows":[["x"]]}').issues[0]).toMatch(/at least 2 columns and 1 row/);
    expect(cmp('{"columns":["A","B"],"rows":[]}').issues[0]).toMatch(/at least 2 columns and 1 row/);
    expect(cmp('{"columns":["A","B"],"rows":[["x"]]}').issues[0]).toMatch(
      /does not match its 2 columns/
    );
    expect(cmp('{"columns":["A","B"],"rows":[["x","y"]]}').valid).toBe(true);
  });

  it('timeline requires >=2 titled steps', () => {
    const tl = (body) => validateModules(`<module type="timeline">${body}</module>`);
    expect(tl('{"steps":[{"title":"Only"}]}').issues[0]).toMatch(/at least 2 steps/);
    expect(tl('{"steps":[{"title":"A"},{"body":"no title"}]}').issues[0]).toMatch(
      /step with no title/
    );
    expect(tl('{"steps":[{"title":"A"},{"title":"B","body":"detail"}]}').valid).toBe(true);
  });

  it('callout requires both title and body', () => {
    expect(validateModules('<module type="callout">{"title":"Heads up"}</module>').issues[0]).toMatch(
      /both title and body/
    );
    expect(
      validateModules(
        '<module type="callout">{"eyebrow":"Note","title":"Heads up","body":"Details."}</module>'
      ).valid
    ).toBe(true);
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

describe('module grammar contract', () => {
  // The set documented in wiki/Blog-Machine.md. The frontend twin of this test
  // lives in frontend/src/lib/moduleParser.test.js — a type added on one side
  // must land on the other in the same change.
  it('KNOWN_MODULE_TYPES matches the documented grammar exactly', () => {
    expect([...KNOWN_MODULE_TYPES].sort()).toEqual(
      [
        'fact', 'recommendation', 'text', 'code', 'design',
        'links', 'picture', 'video', 'spacer',
        'pull_quote', 'stat_board', 'comparison', 'timeline', 'callout',
      ].sort()
    );
  });

  it('JSON types are a subset of known types', () => {
    expect([...JSON_MODULE_TYPES].sort()).toEqual(
      [
        'links', 'picture', 'video', 'spacer',
        'pull_quote', 'stat_board', 'comparison', 'timeline', 'callout',
      ].sort()
    );
    for (const type of JSON_MODULE_TYPES) expect(KNOWN_MODULE_TYPES.has(type)).toBe(true);
  });

  it('caps match the documented limits', () => {
    expect(MAX_MODULES).toBe(14);
    expect(MAX_STAT_BOARD_STATS).toBe(4);
  });
});
