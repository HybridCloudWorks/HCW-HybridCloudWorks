/**
 * The pure reads over the image-prompt config tree, pinned now that they are
 * module functions rather than useCallback bodies (PR #841). The fixtures are
 * the tree GET cms/image-prompts returns; the legacy page and set are there
 * because the merge of the two older collections is the part worth pinning.
 */
import { describe, it, expect } from 'vitest';
import {
  asConfigTree,
  buildPromptLibrary,
  findAssignmentInTree,
  findPromptInTree,
  findSetInTree,
  promptNamesInTree,
  promptSetNames,
  resolvePromptFromTree,
} from './imagePromptLibrary';

const tree = asConfigTree({
  sets: [
    { id: 'Zulu', primaryPrompt: 'a zulu', tags: 'not-a-list', version: '3' },
    { id: 'Azure Chibi', name: 'Azure Chibi', primaryPrompt: 'a chibi', tags: ['azure'] },
  ],
  prompts: [
    { id: 'wide', setName: 'Azure Chibi', additionalParameters: 'wide', slotTemplates: {} },
    { id: 'default', setName: 'Azure Chibi', additionalParameters: 'plain' },
    { id: 'orphan', setName: 'Nobody' },
  ],
  pages: [
    { id: 'learn_azure', pagePath: '/learn/azure', setName: 'Azure Chibi', promptName: 'wide' },
    { id: 'learn_aws', setName: ' Azure Chibi ', promptName: '' },
  ],
  images: [
    { id: 'i1', promptSet: 'Azure Chibi', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'i2', promptSetId: 'Azure Chibi', createdAt: '2026-02-01T00:00:00Z' },
    { id: 'i3', promptSet: 'Nobody' },
  ],
  legacyPages: [
    {
      id: 'old_page',
      title: 'Old Look',
      primaryPrompt: 'old primary',
      secondaryPrompt: 'old extra',
    },
    { id: 'set_page' },
  ],
  legacySets: [
    {
      id: 'Legacy Set',
      pageId: 'set_page',
      primaryPrompt: 'legacy primary',
      secondaryPrompt: 'legacy extra',
    },
  ],
});

describe('buildPromptLibrary', () => {
  const library = buildPromptLibrary(tree);
  const byName = Object.fromEntries(library.sets.map((set) => [set.name, set]));

  it('lists every configured and legacy set, A-Z, with defaults filled in', () => {
    expect(library.sets.map((set) => set.name)).toEqual([
      'Azure Chibi',
      'Legacy Set',
      'Old Look',
      'Zulu',
    ]);
    expect(byName.Zulu).toMatchObject({ tags: [], history: [], version: 3, legacy: false });
  });

  it('attaches prompts, pages and images to their set, sorted, and drops orphans', () => {
    expect(byName['Azure Chibi'].prompts.map((p) => p.name)).toEqual(['default', 'wide']);
    expect(byName['Azure Chibi'].pages).toEqual([
      { pagePath: '/learn/aws', promptName: '' },
      { pagePath: '/learn/azure', promptName: 'wide' },
    ]);
    expect(byName['Azure Chibi'].images.map((i) => i.id)).toEqual(['i2', 'i1']);
    expect(library.sets.flatMap((set) => set.prompts).some((p) => p.id === 'orphan')).toBe(false);
  });

  it('flags legacy sets and gives each its one legacy prompt', () => {
    expect(byName['Legacy Set']).toMatchObject({ legacy: true, primaryPrompt: 'legacy primary' });
    expect(byName['Legacy Set'].prompts).toEqual([
      expect.objectContaining({ id: 'default', additionalParameters: 'legacy extra' }),
    ]);
    expect(byName['Old Look'].prompts[0]).toMatchObject({
      id: 'Old Look',
      additionalParameters: 'old extra',
    });
  });
});

describe('the tree reads', () => {
  it('name every set once, global and legacy', () => {
    expect(promptSetNames(tree)).toEqual(['Azure Chibi', 'Legacy Set', 'Old Look', 'Zulu']);
  });

  it('find a set by name, trimming, falling back to legacy, and null for nothing', () => {
    expect(findSetInTree(tree, ' Zulu ').id).toBe('Zulu');
    expect(findSetInTree(tree, 'Old Look')).toMatchObject({
      legacy: true,
      legacyPageDocId: 'old_page',
    });
    expect(findSetInTree(tree, 'Nobody')).toBeNull();
    expect(findSetInTree(tree, '')).toBeNull();
  });

  it('list prompt names, or the legacy one, or nothing', () => {
    expect(promptNamesInTree(tree, 'Azure Chibi')).toEqual(['default', 'wide']);
    expect(promptNamesInTree(tree, 'Legacy Set')).toEqual(['default']);
    expect(promptNamesInTree(tree, 'Missing')).toEqual([]);
  });

  it('find a prompt, configured or legacy, and null for a name the set does not have', () => {
    expect(findPromptInTree(tree, 'Azure Chibi', 'wide').additionalParameters).toBe('wide');
    expect(findPromptInTree(tree, 'Old Look', 'Old Look')).toMatchObject({
      legacy: true,
      additionalParameters: 'old extra',
    });
    expect(findPromptInTree(tree, 'Old Look', 'wide')).toBeNull();
    expect(findPromptInTree(tree, '', 'wide')).toBeNull();
  });

  it('find a page assignment, or derive one from a legacy page', () => {
    expect(findAssignmentInTree(tree, '/learn/azure')).toMatchObject({ setName: 'Azure Chibi' });
    expect(findAssignmentInTree(tree, '/old/page')).toEqual({
      pagePath: '/old/page',
      setName: 'Old Look',
      promptName: 'Old Look',
      legacy: true,
    });
    expect(findAssignmentInTree(tree, '/nothing')).toBeNull();
  });
});

describe('resolvePromptFromTree', () => {
  it('joins the assignment, the set and the prompt into what a generation uses', () => {
    expect(resolvePromptFromTree(tree, '/learn/azure')).toEqual({
      setName: 'Azure Chibi',
      promptName: 'wide',
      primaryPrompt: 'a chibi',
      additionalParameters: 'wide',
      slotTemplates: {},
      legacy: false,
    });
  });

  it('resolves a legacy page through its synthetic set and prompt', () => {
    expect(resolvePromptFromTree(tree, '/old/page')).toMatchObject({
      setName: 'Old Look',
      primaryPrompt: 'old primary',
      additionalParameters: 'old extra',
      legacy: true,
    });
  });

  it('is null for a page nothing configured', () => {
    expect(resolvePromptFromTree(tree, '/nothing')).toBeNull();
  });
});
