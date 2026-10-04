/**
 * The image-set editor's pure helpers (ADR 0033): form values read from a
 * set or prompt, the Pages tab's per-row state, grouping, and the small
 * sentences the dialogs and the sample result show.
 */
import { describe, it, expect } from 'vitest';
import {
  EMPTY_SLOT_TEMPLATES,
  SET_FIELD_ROWS,
  assignmentLabel,
  deleteSetDescription,
  groupPages,
  hasSlotTemplates,
  imageState,
  isLiveImage,
  pageRowState,
  parseTags,
  plural,
  promptFieldsFrom,
  promptOptions,
  sampleOptions,
  sampleProviderLine,
  setFieldsFrom,
  setPayloadFrom,
} from './promptSetEditorModel';

describe('set fields', () => {
  it('reads every field of the brief, tags joined, with empty strings for a missing set', () => {
    const fields = setFieldsFrom({
      primaryPrompt: 'Chibi engineers',
      purpose: 'Covers',
      tags: ['azure', 'chibi'],
    });
    expect(fields).toEqual({
      primaryPrompt: 'Chibi engineers',
      purpose: 'Covers',
      theme: '',
      styleRules: '',
      negativePrompt: '',
      aspectRatio: '',
      tags: 'azure, chibi',
    });
    expect(Object.keys(setFieldsFrom(null)).sort()).toEqual(
      SET_FIELD_ROWS.flat()
        .map((field) => field.key)
        .sort()
    );
    expect(setFieldsFrom(null).tags).toBe('');
  });

  it('turns the tags text back into a trimmed list for the payload', () => {
    expect(parseTags(' azure, , chibi ,covers')).toEqual(['azure', 'chibi', 'covers']);
    expect(setPayloadFrom({ primaryPrompt: 'x', tags: 'a, b' })).toEqual({
      primaryPrompt: 'x',
      tags: ['a', 'b'],
    });
  });
});

describe('prompt fields', () => {
  it('fills every slot so one prompt cannot inherit another slot text', () => {
    expect(promptFieldsFrom({ name: 'Hero', slotTemplates: { hero: 'Wide' } })).toEqual({
      name: 'Hero',
      additionalParameters: '',
      slotTemplates: { ...EMPTY_SLOT_TEMPLATES, hero: 'Wide' },
    });
    expect(promptFieldsFrom(null)).toEqual({
      name: '',
      additionalParameters: '',
      slotTemplates: EMPTY_SLOT_TEMPLATES,
    });
  });

  it('knows which prompts carry slot templates', () => {
    expect(hasSlotTemplates({ slotTemplates: { hero: 'Wide' } })).toBe(true);
    expect(hasSlotTemplates({ slotTemplates: { hero: '' } })).toBe(false);
    expect(hasSlotTemplates({})).toBe(false);
  });

  it('offers the primary prompt first in every prompt dropdown', () => {
    expect(promptOptions([{ name: 'Hero' }])).toEqual([
      { value: '', label: 'Primary prompt only' },
      { value: 'Hero', label: 'Hero' },
    ]);
    const options = sampleOptions([]);
    expect(options.slot[0]).toEqual({ value: 'hero', label: 'Hero slot' });
    expect(options.provider.find((option) => option.value === '').label).toBe('No provider');
  });
});

describe('pages', () => {
  it('groups allowlisted paths by provider with readable labels', () => {
    expect(groupPages(['/azure', '/azure/blog', '/vmware/code'])).toEqual([
      {
        provider: 'azure',
        label: 'Azure',
        pages: [
          { path: '/azure', label: 'Landing' },
          { path: '/azure/blog', label: 'Blog' },
        ],
      },
      { provider: 'vmware', label: 'VMware', pages: [{ path: '/vmware/code', label: 'Code' }] },
    ]);
  });

  it('labels an assignment as ours, another set, or unassigned', () => {
    expect(assignmentLabel(undefined, false)).toBe('unassigned');
    expect(assignmentLabel({ setName: 'A', promptName: 'Hero' }, true)).toBe('this set / Hero');
    expect(assignmentLabel({ setName: 'Other' }, false)).toBe('Other');
  });

  it('shows the unsaved dropdown choice over the saved prompt, and the saved prompt only when ours', () => {
    const page = { path: '/azure/blog', label: 'Blog' };
    const assignments = { '/azure/blog': { setName: 'A', promptName: 'Hero' } };
    expect(
      pageRowState({ page, setName: 'A', pageAssignments: assignments, pageChoice: {} })
    ).toEqual({ mine: true, label: 'this set / Hero', choice: 'Hero' });
    expect(
      pageRowState({
        page,
        setName: 'A',
        pageAssignments: assignments,
        pageChoice: { '/azure/blog': 'Minimal' },
      }).choice
    ).toBe('Minimal');
    expect(
      pageRowState({ page, setName: 'B', pageAssignments: assignments, pageChoice: {} })
    ).toEqual({ mine: false, label: 'A / Hero', choice: '' });
  });
});

describe('images and sentences', () => {
  it('ranks trash over archived over rejected over selected over draft', () => {
    expect(imageState({ softDeletedAt: 'x', archivedAt: 'y' }).id).toBe('trash');
    expect(imageState({ archivedAt: 'y', approvalStatus: 'rejected' }).id).toBe('archived');
    expect(imageState({ approvalStatus: 'rejected' }).id).toBe('rejected');
    expect(imageState({ approvalStatus: 'approved' }).id).toBe('selected');
    expect(imageState({}).id).toBe('draft');
    expect(isLiveImage({})).toBe(true);
    expect(isLiveImage({ archivedAt: 'y' })).toBe(false);
  });

  it('pluralises and counts in the delete sentence', () => {
    expect(plural(1, 'prompt')).toBe('1 prompt');
    expect(plural(2, 'prompt')).toBe('2 prompts');
    expect(deleteSetDescription({ pages: [{}] }, [{}, {}])).toContain(
      'its 2 prompts and its 1 page assignment are removed'
    );
    expect(deleteSetDescription(null, [])).toContain('its 0 prompts and its 0 page assignments');
  });

  it('describes the sample provider with model and price when known', () => {
    expect(sampleProviderLine({ imageModel: 'gpt-image-1', costPerImageUsd: 0.04 })).toBe(
      ' · gpt-image-1 · about $0.040 per image'
    );
    expect(sampleProviderLine({})).toBe(
      ' · per-image price not configured (CONTENTFORGE_IMAGE_COST_USD)'
    );
  });
});
