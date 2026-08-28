import { describe, it, expect } from 'vitest';
import {
  scoreRelatedness,
  findRelatedPublished,
  buildRelatedReadingModule,
  RELATED_LIMIT,
} from './related-posts.js';
import { validateModules } from '../cms/content-modules.js';

const draft = {
  title: 'Cut AKS networking cost with private endpoints',
  keyTopics: ['AKS', 'Azure networking', 'private endpoints'],
};

const row = (id, Title, keyTopics, extra = {}) => ({
  id,
  Title,
  keyTopics,
  publishedUrl: `https://hybridcloudworks.com/azure/blog/${id}`,
  ...extra,
});

describe('scoreRelatedness', () => {
  it('meets on topics even when titles diverge, and zeroes on empty sides', () => {
    const topical = scoreRelatedness(draft, row('a', 'A different headline entirely', ['AKS', 'private endpoints']));
    expect(topical).toBeGreaterThan(0);
    expect(scoreRelatedness(draft, row('b', 'Unrelated FinOps piece', ['showback']))).toBe(0);
    expect(scoreRelatedness({ title: '', keyTopics: [] }, row('c', 'AKS', ['AKS']))).toBe(0);
  });
});

describe('findRelatedPublished', () => {
  it('ranks by score, floors weak matches, and never proposes a post without a URL', () => {
    const corpus = [
      row('weak', 'Terraform state locking', ['Terraform']),
      row('strong', 'AKS networking deep dive', ['AKS', 'Azure networking']),
      // Highly related but URL-less: a link the reader cannot follow is
      // worse than none, so it must drop out.
      { id: 'no-url', Title: 'AKS private endpoints explained', keyTopics: ['AKS', 'private endpoints'] },
      row('mid', 'Azure private endpoints for storage', ['private endpoints', 'Azure networking']),
    ];
    const related = findRelatedPublished(corpus, draft);
    // 'mid' shares four tokens with the draft (azure/private/endpoints/networking)
    // vs. 'strong''s three, so it outranks despite the less similar-looking title.
    expect(related.map((r) => r.id)).toEqual(['mid', 'strong']);
    expect(related[0].url).toBe('https://hybridcloudworks.com/azure/blog/mid');
    expect(related.every((r) => r.score >= 0.15)).toBe(true);
  });

  it('caps at the limit and resolves curatedSubpagePath URLs', () => {
    const corpus = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      Title: 'AKS networking notes',
      keyTopics: ['AKS', 'Azure networking', 'private endpoints'],
      curatedSubpagePath: `/azure/blog/p${i}`,
    }));
    const related = findRelatedPublished(corpus, draft);
    expect(related).toHaveLength(RELATED_LIMIT);
    expect(related[0].url).toBe('https://hybridcloudworks.com/azure/blog/p0');
  });

  it('returns [] for an empty corpus', () => {
    expect(findRelatedPublished([], draft)).toEqual([]);
    expect(findRelatedPublished(undefined, draft)).toEqual([]);
  });
});

describe('buildRelatedReadingModule', () => {
  it('emits a grammar-valid full-width links module', () => {
    const module = buildRelatedReadingModule([
      { id: 'a', title: 'AKS networking deep dive', url: 'https://x/a', score: 0.5 },
      { id: 'b', title: 'Private endpoints for storage', url: 'https://x/b', score: 0.3 },
    ]);
    const report = validateModules(module);
    expect(report.valid).toBe(true);
    expect(report.moduleCount).toBe(1);
    expect(module).toContain('align="all"');
    const parsed = JSON.parse(module.replace(/^<module[^>]*>/, '').replace(/<\/module>$/, ''));
    expect(parsed.links).toEqual([
      { title: 'AKS networking deep dive', url: 'https://x/a' },
      { title: 'Private endpoints for storage', url: 'https://x/b' },
    ]);
  });
});
