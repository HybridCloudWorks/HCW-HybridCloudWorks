/**
 * The gallery's derived lists and folder rules.
 *
 * These were `useMemo` bodies and inline handler guards inside
 * ImageGalleryPage, which is why the component measured 16 exits (#602). They
 * are pure functions of the items on screen, so they are testable now — and
 * the two folder rules are the ones that decide whether an operator can
 * destroy something, which is worth pinning rather than reading.
 */
import { describe, it, expect } from 'vitest';
import {
  customTagOptions,
  deleteFolderProblem,
  folderOptions,
  newFolderProblem,
  providerOptions,
  SEED_FOLDERS,
  slotOptions,
  toggledSelection,
  uniqueTags,
} from './imageGallery';

const items = [
  { provider: ' azure ', slot: 'Hero', customTags: ['Cloud', ' finops '], folder: 'Architecture' },
  { provider: 'aws', slot: 'hero', customTags: ['cloud'], folder: 'default' },
  { provider: '', slot: '', customTags: null, folder: '' },
];

describe('filter options', () => {
  it('lead with `all`, because that is the default selection', () => {
    expect(providerOptions(items)[0]).toBe('all');
    expect(slotOptions(items)[0]).toBe('all');
    expect(customTagOptions(items)[0]).toBe('all');
  });

  it('uppercase providers and lowercase slots, as each is displayed', () => {
    expect(providerOptions(items)).toEqual(['all', 'AWS', 'AZURE']);
    expect(slotOptions(items)).toEqual(['all', 'hero']);
  });

  it('drop blanks rather than offering an empty option', () => {
    // The third item has an empty provider, slot and folder, and null tags.
    expect(providerOptions(items)).not.toContain('');
    expect(customTagOptions(items)).not.toContain('');
  });

  it('take one item’s several tags, trimmed and deduplicated', () => {
    expect(customTagOptions(items)).toEqual(['all', 'cloud', 'finops']);
  });

  it('survive an empty or missing list', () => {
    for (const empty of [[], null, undefined]) {
      expect(providerOptions(empty)).toEqual(['all']);
      expect(uniqueTags(empty)).toEqual([]);
    }
  });
});

describe('uniqueTags', () => {
  it('omits `all`, which is not a tag', () => {
    // It drives the tag-toggle row, where `all` would be offered as something
    // to attach to an image.
    expect(uniqueTags(items)).toEqual(['cloud', 'finops']);
    expect(uniqueTags(items)).not.toContain('all');
  });
});

describe('folderOptions', () => {
  it('always offers the seed folders, even with nothing filed in them', () => {
    expect(folderOptions([], [])).toEqual([...SEED_FOLDERS].sort());
  });

  it('adds folders in use and folders created but still empty', () => {
    const folders = folderOptions(items, ['Reports']);
    expect(folders).toContain('architecture');
    expect(folders).toContain('reports');
  });

  it('files an item with no folder under default rather than under ""', () => {
    expect(folderOptions([{ folder: '' }], [])).not.toContain('');
  });
});

describe('newFolderProblem', () => {
  it('refuses an empty name and a duplicate, and allows anything else', () => {
    expect(newFolderProblem('', ['default'])).toBe('Folder name cannot be empty');
    expect(newFolderProblem('default', ['default'])).toBe('Folder already exists');
    expect(newFolderProblem('reports', ['default'])).toBe('');
  });
});

describe('deleteFolderProblem', () => {
  it('never deletes default', () => {
    expect(deleteFolderProblem('Default', [])).toBe('Cannot delete Default folder');
  });

  it('refuses a folder that still holds images, and counts them', () => {
    // The guard that stops an operator orphaning images they cannot then find.
    const held = [{ folder: 'aws' }, { folder: 'AWS' }];
    expect(deleteFolderProblem('aws', held)).toContain('2 image(s)');
  });

  it('allows an empty folder', () => {
    expect(deleteFolderProblem('aws', [{ folder: 'azure' }])).toBe('');
  });
});

describe('toggledSelection', () => {
  it('adds what is absent and removes what is present, without mutating', () => {
    const before = new Set(['a']);
    expect([...toggledSelection(before, 'b')].sort()).toEqual(['a', 'b']);
    expect([...toggledSelection(before, 'a')]).toEqual([]);
    expect([...before]).toEqual(['a']);
  });
});
