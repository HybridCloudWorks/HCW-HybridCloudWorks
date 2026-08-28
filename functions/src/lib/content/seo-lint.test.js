import { describe, it, expect } from 'vitest';
import { lintSeo, META_DESCRIPTION_MIN, META_DESCRIPTION_MAX } from './seo-lint.js';

const CLEAN = {
  title: 'Cut AKS networking cost with private endpoints',
  summary:
    'Private endpoints cut AKS egress charges by keeping traffic on the Azure backbone. Here is the measured saving and the Terraform to apply it.',
  content: [
    '## Why egress bills grow',
    'Prose.',
    '### The NAT gateway line item',
    'Prose.',
    '## The fix',
    'Prose.',
  ].join('\n\n'),
  keyTopics: ['AKS', 'private endpoints'],
};

const keys = (article) => lintSeo(article).findings.map((finding) => finding.key);

describe('lintSeo', () => {
  it('passes a clean article with zero findings', () => {
    expect(lintSeo(CLEAN).findings).toEqual([]);
  });

  it('flags meta-description length: missing, short, long', () => {
    expect(keys({ ...CLEAN, summary: '' })).toEqual(['meta_description_missing']);
    expect(keys({ ...CLEAN, summary: 'Too short.' })).toEqual(['meta_description_short']);
    const long = lintSeo({ ...CLEAN, summary: 'x'.repeat(META_DESCRIPTION_MAX + 1) });
    expect(long.findings[0].key).toBe('meta_description_long');
    // Boundary values are acceptable, not findings.
    expect(keys({ ...CLEAN, summary: 'x'.repeat(META_DESCRIPTION_MIN) })).toEqual([]);
    expect(keys({ ...CLEAN, summary: 'x'.repeat(META_DESCRIPTION_MAX) })).toEqual([]);
  });

  it('flags a slug that carries no key-topic token, and stays quiet without topics', () => {
    const misaligned = keys({ ...CLEAN, title: 'A story about something else entirely' });
    expect(misaligned).toEqual(['slug_keyword_mismatch']);
    // Multi-word topics align on any of their tokens.
    expect(keys({ ...CLEAN, title: 'Endpoints on a budget' })).toEqual([]);
    // No topics declared → nothing to align against.
    expect(keys({ ...CLEAN, title: 'Unrelated title', keyTopics: [] })).toEqual([]);
  });

  it('flags H1 in body, a too-deep first heading, and skipped levels', () => {
    expect(keys({ ...CLEAN, content: '# Big title\n\nProse.\n\n## Section\n\nProse.' })).toEqual([
      'heading_h1_in_body',
    ]);
    expect(keys({ ...CLEAN, content: '### Deep start\n\nProse.' })).toEqual([
      'heading_starts_deep',
    ]);
    const skipped = lintSeo({
      ...CLEAN,
      content: '## Section\n\nProse.\n\n#### Jumped\n\nProse.\n\n#### Second jump target',
    });
    // One skipped-level report per article — the first jump is where to start.
    expect(skipped.findings.map((finding) => finding.key)).toEqual(['heading_skipped_level']);
    expect(skipped.findings[0].message).toContain('"Jumped"');
  });

  it('ignores # lines inside code fences and module tags', () => {
    const content = [
      '## Setup',
      '```bash',
      '# this is a comment, not a heading',
      'az aks create',
      '```',
      '<module type="code" align="left">{"code":"# also not a heading"}</module>',
      '## Next',
    ].join('\n');
    expect(keys({ ...CLEAN, content })).toEqual([]);
  });

  it('tolerates a completely empty article without throwing', () => {
    expect(lintSeo({}).findings.map((finding) => finding.key)).toEqual([
      'meta_description_missing',
    ]);
    expect(lintSeo().findings).toHaveLength(1);
  });
});
