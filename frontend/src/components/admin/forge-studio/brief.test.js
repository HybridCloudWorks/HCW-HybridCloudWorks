/**
 * The brief's two crossings (ADR 0033 §7 slice 2): form → API payload, and
 * form → the markdown body the draft starts with. The server's own
 * briefToMarkdown (forge-studio.js) pins the same shape, so a brief saved
 * from either side reads the same.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_BRIEF,
  briefHasSubstance,
  briefToMarkdown,
  splitList,
  toBriefPayload,
} from './brief';

const form = (over = {}) => ({ ...EMPTY_BRIEF, ...over });

describe('toBriefPayload', () => {
  it('splits lists on newlines and commas, rounds the length, trims text', () => {
    const payload = toBriefPayload(
      form({
        objective: '  Teach X ',
        requiredTopics: 'peering, firewall\nroutes',
        sources: 'https://a.test\nhttps://b.test',
        targetLength: '1200.6',
        seoKeywords: 'azure, hub-spoke',
      })
    );
    expect(payload.objective).toBe('Teach X');
    expect(payload.requiredTopics).toEqual(['peering', 'firewall', 'routes']);
    expect(payload.sources).toEqual(['https://a.test', 'https://b.test']);
    expect(payload.targetLength).toBe(1201);
    expect(payload.seoKeywords).toEqual(['azure', 'hub-spoke']);
    expect(toBriefPayload(form()).targetLength).toBeNull();
  });

  it('splitList drops blanks and trims', () => {
    expect(splitList(' a ,, b \n\n c ')).toEqual(['a', 'b', 'c']);
    expect(splitList('')).toEqual([]);
  });
});

describe('briefHasSubstance', () => {
  it('needs an objective, key message, audience, topic or source', () => {
    expect(briefHasSubstance(form())).toBe(false);
    expect(briefHasSubstance(form({ tone: 'dry', campaign: 'x' }))).toBe(false);
    expect(briefHasSubstance(form({ objective: 'x' }))).toBe(true);
    expect(briefHasSubstance(form({ requiredTopics: 'a' }))).toBe(true);
    expect(briefHasSubstance(form({ sourceUrl: 'https://a.test' }))).toBe(true);
    expect(briefHasSubstance(form({ sourceContentId: 'c1' }))).toBe(true);
  });
});

describe('briefToMarkdown', () => {
  it('renders the title, each filled field in order, and the template as the requested format', () => {
    const md = briefToMarkdown(
      form({ objective: 'Teach X', requiredTopics: 'a, b', targetLength: '900' }),
      'My title',
      { templateLabel: 'How-To / Tutorial' }
    );
    expect(md.startsWith('# My title')).toBe(true);
    expect(md).toContain('**Objective:** Teach X');
    expect(md).toContain('**Target length:** 900 words');
    expect(md).toContain('**Requested format:** How-To / Tutorial');
    expect(md).toContain('**Must cover:**\n- a\n- b');
    expect(md).not.toContain('Audience');
    expect(md.indexOf('Objective')).toBeLessThan(md.indexOf('Must cover'));
  });

  it('is empty for an empty brief with no title', () => {
    expect(briefToMarkdown(form())).toBe('');
  });
});
