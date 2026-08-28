import { describe, it, expect } from 'vitest';
import {
  scrubDashes,
  repairModules,
  buildForgeModuleInstruction,
  findSimilarTitle,
  titleTokens,
} from './forge-pipeline.js';
import { validateModules, MAX_MODULES } from '../cms/content-modules.js';

describe('scrubDashes', () => {
  it('replaces em/en dashes in prose but not inside code or design modules', () => {
    const input =
      'Cost — 40% lower, 2–3 nodes. <module type="code" align="left">aws ec2 --region us-east-1 — run</module> after — done. <module type="design" align="all">A --> B</module>';
    const out = scrubDashes(input);
    expect(out).toContain('Cost, 40% lower, 2-3 nodes.');
    expect(out).toContain('aws ec2 --region us-east-1 — run');
    expect(out).toContain('after, done.');
    expect(out).toContain('A --> B');
  });
});

describe('repairModules', () => {
  const tag = (type, content, align = 'left') =>
    `<module type="${type}" align="${align}">${content}</module>`;

  it('leaves a valid document untouched', () => {
    const md = `Intro\n\n${tag('fact', 'A fact')}\n\nBody`;
    expect(repairModules(md)).toEqual({ markdown: md, repairs: [] });
  });

  it('unwraps unknown types, drops empty/broken modules, strips bad aligns', () => {
    const md = [
      tag('mystery', 'kept as prose'),
      tag('fact', '   '),
      tag('links', '{not json'),
      tag('picture', '{"imageUrl":"","caption":"x"}'),
      tag('recommendation', 'Do this', 'center'),
    ].join('\n\n');
    const { markdown, repairs } = repairModules(md);
    expect(markdown).toContain('kept as prose');
    expect(markdown).not.toContain('type="mystery"');
    expect(markdown).not.toContain('type="fact"');
    expect(markdown).not.toContain('type="picture"');
    expect(markdown).toContain('<module type="recommendation">Do this</module>');
    expect(repairs).toEqual([
      'Unwrapped unknown module type "mystery"',
      'Removed empty fact module',
      'Removed links module with invalid JSON',
      'Removed picture module with neither imageUrl nor imagePrompt',
      'Dropped invalid align "center" on a recommendation module',
    ]);
    expect(validateModules(markdown).valid).toBe(true);
  });

  it('thins spacers and picture placeholders first, then unwraps from the end, to reach the cap', () => {
    const mods = [
      ...Array.from({ length: 4 }, () => tag('spacer', '{"style":"gradient"}')),
      ...Array.from({ length: 3 }, (_, i) =>
        tag('picture', `{"imageUrl":"","imagePrompt":"p${i}"}`)
      ),
      ...Array.from({ length: MAX_MODULES - 4 }, (_, i) => tag('fact', `fact ${i}`)),
    ];
    const { markdown, repairs } = repairModules(mods.join('\n\n'));
    const report = validateModules(markdown);
    expect(report.valid).toBe(true);
    expect(report.moduleCount).toBe(MAX_MODULES);
    expect(repairs.filter((r) => r === 'Removed excess spacer module')).toHaveLength(2);
    expect(repairs.filter((r) => r === 'Removed excess picture placeholder module')).toHaveLength(
      1
    );
    expect(repairs).toHaveLength(3);
    expect(markdown).toContain(`fact ${MAX_MODULES - 5}`); // prose never lost
  });

  it('unwraps code/design/links to plain markdown when they must go', () => {
    const mods = [
      ...Array.from({ length: MAX_MODULES }, (_, i) => tag('fact', `f${i}`)),
      tag('code', 'ls -la'),
      tag('links', '{"links":[{"title":"Doc","url":"https://d"}]}'),
    ];
    const { markdown, repairs } = repairModules(mods.join('\n'));
    expect(markdown).toContain('- [Doc](https://d)');
    expect(markdown).toContain('```\nls -la\n```');
    expect(repairs).toEqual([
      `Unwrapped links module over the ${MAX_MODULES}-module cap`,
      `Unwrapped code module over the ${MAX_MODULES}-module cap`,
    ]);
  });

  it('unwraps the new rich types to faithful plain markdown when over the cap', () => {
    const mods = [
      ...Array.from({ length: MAX_MODULES }, (_, i) => tag('fact', `f${i}`)),
      tag('pull_quote', '{"text":"Ship weekly","attribution":"Saul"}'),
      tag('stat_board', '{"stats":[{"value":"40%","label":"lower cost"},{"value":"3","label":"nodes"}]}'),
      tag('comparison', '{"columns":["AKS","EKS"],"rows":[["fast","slow"]]}'),
      tag('timeline', '{"steps":[{"title":"Plan"},{"title":"Ship","body":"cut the release"}]}'),
      tag('callout', '{"title":"Heads up","body":"Quota applies."}'),
      tag('design', 'graph TD;A-->B'),
    ];
    const { markdown, repairs } = repairModules(mods.join('\n'));
    expect(markdown).toContain('> Ship weekly\n>\n> Saul');
    expect(markdown).toContain('- lower cost: 40%');
    expect(markdown).toContain('| AKS | EKS |');
    expect(markdown).toContain('| fast | slow |');
    expect(markdown).toContain('1. Plan');
    expect(markdown).toContain('2. Ship: cut the release');
    expect(markdown).toContain('**Heads up**: Quota applies.');
    expect(markdown).toContain('```mermaid\ngraph TD;A-->B\n```');
    expect(repairs).toHaveLength(6);
    expect(validateModules(markdown).valid).toBe(true);
  });

  it('repairs semantically-broken rich modules by unwrapping them', () => {
    const md = [
      tag('pull_quote', '{"attribution":"nobody"}'),
      tag('stat_board', '{"stats":[{"value":"1","label":"only"}]}'),
      tag('comparison', '{"columns":["A","B"],"rows":[["x"]]}'),
      tag('timeline', '{"steps":[{"title":"solo"}]}'),
      tag('callout', '{"title":"No body"}'),
      tag('callout', '5'),
    ].join('\n\n');
    const { markdown, repairs } = repairModules(md);
    expect(markdown).not.toContain('<module');
    // Salvageable content survives as prose; unsalvageable is dropped.
    expect(markdown).toContain('- only: 1');
    expect(markdown).toContain('| A | B |');
    expect(markdown).toContain('1. solo');
    expect(markdown).toContain('**No body**');
    expect(repairs).toEqual([
      'Unwrapped pull_quote module with no text',
      'Unwrapped stat_board module with 1 stats (needs 2-4)',
      'Unwrapped comparison module with a row that does not match its columns',
      'Unwrapped timeline module with fewer than 2 steps',
      'Unwrapped callout module missing title or body',
      'Removed callout module whose JSON body is not an object',
    ]);
    expect(validateModules(markdown).valid).toBe(true);
  });

  it('leaves semantically-valid rich modules alone', () => {
    const md = [
      tag('pull_quote', '{"text":"Keep it"}'),
      tag('callout', '{"eyebrow":"Note","title":"T","body":"B"}'),
      tag('stat_board', '{"stats":[{"value":"1","label":"a"},{"value":"2","label":"b"}]}', 'all'),
    ].join('\n\n');
    expect(repairModules(md)).toEqual({ markdown: md, repairs: [] });
  });
});

describe('forge instruction + title dedupe', () => {
  it('names the format modules and overrides the picture/spacer prohibition', () => {
    const text = buildForgeModuleInstruction({ modules: { use: ['design', 'code'] } });
    expect(text).toContain('(design, code)');
    expect(text).toContain('OVERRIDE');
    expect(buildForgeModuleInstruction(null)).toContain('(fact, recommendation)');
    // Spacer styles must name renderer keys — 'dots', never the old 'dotted'.
    expect(text).toContain('gradient, solid, dots, double, glow, accent');
    expect(text).toContain('pull_quote, stat_board, comparison, timeline, callout');
  });

  it('finds near-duplicate titles by token overlap and ignores stopwords', () => {
    expect([...titleTokens('How to Optimize the AKS Networking')]).toEqual([
      'optimize',
      'aks',
      'networking',
    ]);
    const dupe = findSimilarTitle('AKS networking deep dive', [
      'Deep dive into AKS networking',
      'EKS cost tips',
    ]);
    expect(dupe).toEqual({
      similar: true,
      bestScore: 1,
      bestTitle: 'Deep dive into AKS networking',
    });
    expect(
      findSimilarTitle('AKS storage classes explained', ['Deep dive into AKS networking']).similar
    ).toBe(false);
    expect(findSimilarTitle('', ['x'])).toEqual({ similar: false, bestScore: 0, bestTitle: null });
  });
});
