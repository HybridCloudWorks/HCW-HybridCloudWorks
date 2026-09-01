/**
 * Module grammar tests. The serialize→parse round-trip cases are the
 * regression net for the "design" bug: design was a known backend type the
 * frontend had no branch for, so a design module round-tripped to
 * `<module ...></module>` with its body destroyed.
 */
import { describe, it, expect } from 'vitest';
import {
  RAW_MODULE_TYPES,
  JSON_MODULE_TYPES,
  MAX_MODULES,
  parseModulesFromMarkdown,
  rebuildMarkdownWithModules,
  moduleDataToString,
  insertModuleIntoMarkdown,
} from './moduleParser.js';

describe('module grammar contract', () => {
  // The set documented in wiki/Blog-Machine.md. The backend twin of this test
  // lives in functions/src/lib/cms/content-modules.test.js — a type added on
  // one side must land on the other in the same change.
  it('the type lists match the documented grammar exactly', () => {
    expect([...RAW_MODULE_TYPES].sort()).toEqual(
      ['fact', 'recommendation', 'text', 'code', 'design'].sort()
    );
    expect([...JSON_MODULE_TYPES].sort()).toEqual(
      [
        'links',
        'picture',
        'video',
        'spacer',
        'pull_quote',
        'stat_board',
        'comparison',
        'timeline',
        'callout',
      ].sort()
    );
    expect(MAX_MODULES).toBe(14);
  });
});

describe('parseModulesFromMarkdown', () => {
  it('extracts a raw module and leaves a positional placeholder', () => {
    const { text, modules } = parseModulesFromMarkdown(
      'Before\n<module type="fact" align="right">A fact</module>\nAfter'
    );
    expect(modules).toEqual([{ type: 'fact', align: 'right', content: 'A fact' }]);
    expect(text).toBe('Before\n<!-- MODULE_0 -->\nAfter');
  });

  it('parses JSON payloads into flat module data', () => {
    const { modules } = parseModulesFromMarkdown(
      '<module type="pull_quote">{"text":"Ship it","attribution":"Saul"}</module>'
    );
    expect(modules).toEqual([
      { type: 'pull_quote', align: 'left', text: 'Ship it', attribution: 'Saul' },
    ]);
  });

  it('falls back to spacer defaults on broken spacer JSON', () => {
    const { modules } = parseModulesFromMarkdown('<module type="spacer">oops</module>');
    expect(modules[0]).toMatchObject({ type: 'spacer', style: 'gradient', height: 'h-1' });
  });

  it('keeps an unknown type as a bare shell', () => {
    const { modules } = parseModulesFromMarkdown('<module type="bogus">whatever</module>');
    expect(modules).toEqual([{ type: 'bogus', align: 'left' }]);
  });
});

describe('serialize → parse round-trip', () => {
  const rawFixtures = {
    fact: 'Compact fact.',
    recommendation: 'Do the thing.',
    text: 'Some prose.',
    code: 'az group list',
    design: 'graph TD;A-->B', // the regression case
  };

  for (const type of RAW_MODULE_TYPES) {
    it(`round-trips a ${type} module without losing content`, () => {
      const module = { type, align: 'all', content: rawFixtures[type] };
      const { modules } = parseModulesFromMarkdown(moduleDataToString(module));
      expect(modules).toEqual([module]);
    });
  }

  const jsonFixtures = {
    links: { links: [{ title: 'Doc', url: 'https://d' }] },
    picture: { imageUrl: 'https://img', caption: 'A caption' },
    video: { videoUrl: 'https://v', caption: 'Clip' },
    spacer: { style: 'dots', height: 'h-1' },
    pull_quote: { text: 'Ship weekly', attribution: 'Saul' },
    stat_board: {
      stats: [
        { value: '40%', label: 'lower cost' },
        { value: '3', label: 'nodes', sublabel: 'per region' },
      ],
    },
    comparison: { columns: ['AKS', 'EKS'], rows: [['fast', 'slow']] },
    timeline: { steps: [{ title: 'Plan' }, { title: 'Ship', body: 'cut the release' }] },
    callout: { eyebrow: 'Note', title: 'Heads up', body: 'Quota applies.' },
  };

  for (const type of JSON_MODULE_TYPES) {
    it(`round-trips a ${type} module without losing content`, () => {
      const module = { type, align: 'left', ...jsonFixtures[type] };
      const { modules } = parseModulesFromMarkdown(moduleDataToString(module));
      expect(modules).toEqual([module]);
    });
  }

  it('serializes a raw module with missing content as an empty body, not "undefined"', () => {
    expect(moduleDataToString({ type: 'text', align: 'left' })).toBe(
      '<module type="text" align="left"></module>'
    );
  });

  it('serializes an unknown type to nothing', () => {
    expect(moduleDataToString({ type: 'bogus', align: 'left' })).toBe('');
  });
});

describe('rebuildMarkdownWithModules', () => {
  it('reassembles the original document from text + modules', () => {
    const original = 'Intro\n\n<module type="design" align="all">graph TD;A-->B</module>\n\nOutro';
    const { text, modules } = parseModulesFromMarkdown(original);
    expect(rebuildMarkdownWithModules(text, modules)).toBe(original);
  });

  it('appends surplus modules and drops surplus placeholders', () => {
    const rebuilt = rebuildMarkdownWithModules('a <!-- MODULE_0 --> b <!-- MODULE_1 -->', [
      { type: 'fact', align: 'left', content: 'only one' },
    ]);
    expect(rebuilt).toBe('a <module type="fact" align="left">only one</module> b');
  });
});

describe('insertModuleIntoMarkdown', () => {
  const first = '<module type="fact" align="left">first</module>';
  const second = '<module type="fact" align="left">second</module>';
  const inserted = { type: 'text', align: 'left', content: 'inserted' };
  const insertedStr = '<module type="text" align="left">inserted</module>';

  it('appends with the default position of -1', () => {
    expect(insertModuleIntoMarkdown('Prose', inserted)).toBe(`Prose\n\n${insertedStr}\n\n`);
  });

  it('inserts before the module at the given index', () => {
    const result = insertModuleIntoMarkdown(`Intro\n\n${first}\n\n${second}`, inserted, 1);
    const { modules } = parseModulesFromMarkdown(result);
    expect(modules.map((m) => m.content)).toEqual(['first', 'inserted', 'second']);
  });

  it('inserts at position 0 ahead of every existing module', () => {
    const result = insertModuleIntoMarkdown(`Intro\n\n${first}`, inserted, 0);
    const { modules } = parseModulesFromMarkdown(result);
    expect(modules.map((m) => m.content)).toEqual(['inserted', 'first']);
  });

  it('appends when the position is past the last module', () => {
    const result = insertModuleIntoMarkdown(`Intro\n\n${first}`, inserted, 5);
    const { modules } = parseModulesFromMarkdown(result);
    expect(modules.map((m) => m.content)).toEqual(['first', 'inserted']);
  });
});
