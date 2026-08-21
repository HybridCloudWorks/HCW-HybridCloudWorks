import { describe, it, expect } from 'vitest';
import {
  scrubDashes,
  repairModules,
  buildForgeModuleInstruction,
  findSimilarTitle,
  titleTokens,
} from './forge-pipeline.js';
import { validateModules } from '../cms/content-modules.js';

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
      ...Array.from({ length: 6 }, (_, i) => tag('fact', `fact ${i}`)),
    ];
    const { markdown, repairs } = repairModules(mods.join('\n\n'));
    const report = validateModules(markdown);
    expect(report.valid).toBe(true);
    expect(report.moduleCount).toBe(10);
    expect(repairs.filter((r) => r === 'Removed excess spacer module')).toHaveLength(2);
    expect(repairs.filter((r) => r === 'Removed excess picture placeholder module')).toHaveLength(
      1
    );
    expect(repairs).toHaveLength(3);
    expect(markdown).toContain('fact 5'); // prose never lost
  });

  it('unwraps code/design/links to plain markdown when they must go', () => {
    const mods = [
      ...Array.from({ length: 10 }, (_, i) => tag('fact', `f${i}`)),
      tag('code', 'ls -la'),
      tag('links', '{"links":[{"title":"Doc","url":"https://d"}]}'),
    ];
    const { markdown, repairs } = repairModules(mods.join('\n'));
    expect(markdown).toContain('- [Doc](https://d)');
    expect(markdown).toContain('```\nls -la\n```');
    expect(repairs).toEqual([
      'Unwrapped links module over the 10-module cap',
      'Unwrapped code module over the 10-module cap',
    ]);
  });
});

describe('forge instruction + title dedupe', () => {
  it('names the format modules and overrides the picture/spacer prohibition', () => {
    const text = buildForgeModuleInstruction({ modules: { use: ['design', 'code'] } });
    expect(text).toContain('(design, code)');
    expect(text).toContain('OVERRIDE');
    expect(buildForgeModuleInstruction(null)).toContain('(fact, recommendation)');
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
