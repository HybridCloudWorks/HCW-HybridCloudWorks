import { describe, it, expect, vi } from 'vitest';
import { buildSections, keywordPrescreen, computeOverall, createGrader } from './forge-grader.js';
import { DEFAULT_PROFILE, normalizeProfile } from './forge-config.js';

describe('sections and prescreen', () => {
  it('builds certification, speaking and interest-area sections with fixed weights, dropping weight 0', () => {
    const profile = normalizeProfile({
      certifications: [
        { name: 'AZ-305', issuer: 'Microsoft', keywords: ['AZ-305', 'Azure Architect'] },
      ],
      speakingTopics: [{ title: 'Hybrid talks', keywords: ['Hybrid'] }],
      interestAreas: [
        { key: 'a', label: 'A', weight: 50, keywords: ['alpha'] },
        { key: 'z', label: 'Zero', weight: 0, keywords: ['zero'] },
      ],
    });
    const sections = buildSections(profile);
    expect(sections.map((s) => [s.key, s.weight])).toEqual([
      ['certifications', 80],
      ['speaking', 75],
      ['a', 50],
    ]);
    expect(sections[0].keywords).toEqual(['az-305', 'azure architect']);
    const { hitsBySection, totalHits } = keywordPrescreen(
      { title: 'Passing AZ-305', content: 'alpha beta' },
      profile
    );
    expect(hitsBySection).toEqual({ certifications: 1, speaking: 0, a: 1 });
    expect(totalHits).toBe(2);
  });

  it('overall is the best weighted fit plus a capped breadth bonus, never an average', () => {
    const sections = [
      { key: 'x', weight: 90 },
      { key: 'y', weight: 80 },
      { key: 'z', weight: 70 },
    ];
    expect(
      computeOverall(
        [
          { key: 'x', score: 100 },
          { key: 'y', score: 20 },
          { key: 'z', score: 20 },
        ],
        sections
      )
    ).toBe(90);
    expect(
      computeOverall(
        [
          { key: 'x', score: 100 },
          { key: 'y', score: 75 },
          { key: 'z', score: 70 },
        ],
        sections
      )
    ).toBe(96);
    expect(computeOverall([], sections)).toBe(0);
  });
});

describe('gradeArticle', () => {
  const ai = (subs) => ({ generateJsonResponse: vi.fn(async () => ({ subs })) });

  it('skips the model when the profile has no weighted sections or no keyword overlap', async () => {
    const empty = normalizeProfile({
      interestAreas: [{ key: 'a', label: 'A', weight: 0, keywords: ['x'] }],
    });
    const a = ai([]);
    expect(await createGrader({ ai: a }).gradeArticle({ title: 't' }, empty)).toMatchObject({
      overall: 0,
      skippedLlm: true,
    });
    const r = await createGrader({ ai: a }).gradeArticle(
      { title: 'nothing relevant here' },
      DEFAULT_PROFILE
    );
    expect(r).toMatchObject({ overall: 5, skippedLlm: true });
    expect(r.subs).toHaveLength(5);
    expect(a.generateJsonResponse).not.toHaveBeenCalled();
  });

  it('grades through the model, clamps scores, fills missing sections, recomputes overall', async () => {
    const a = ai([
      { key: 'hybrid_arch', score: 140, rationale: 'all of it' },
      { key: 'bogus', score: 99 },
    ]);
    const usageOut = [];
    const r = await createGrader({ ai: a }).gradeArticle(
      { title: 'Hybrid cloud landing zone on VMware' },
      DEFAULT_PROFILE,
      { usageOut }
    );
    expect(r.skippedLlm).toBe(false);
    expect(r.subs.find((s) => s.key === 'hybrid_arch')).toMatchObject({
      score: 100,
      rationale: 'all of it',
      label: 'Hybrid Architecture',
    });
    expect(r.subs.find((s) => s.key === 'cloud_arch')).toMatchObject({
      score: 0,
      rationale: 'No rationale returned.',
    });
    expect(r.overall).toBe(90);
    expect(a.generateJsonResponse.mock.calls[0][0]).toMatchObject({
      purpose: 'analysis',
      usageOut,
    });
    expect(a.generateJsonResponse.mock.calls[0][0].prompt).toMatch(/key: "hybrid_arch"/);
  });
});
