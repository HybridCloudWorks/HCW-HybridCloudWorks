/**
 * Editing an issue's sections never adds collected content (ADR 0030 §2a):
 * items are chosen and ordered from what is stored, a manual block is the
 * only thing that can be new, and each refusal names the rule it broke.
 * The route-level cases live in admin-handlers.amplify.test.js; these pin
 * the rules one at a time now that they are separate functions (PR #841).
 */
import { describe, it, expect } from 'vitest';
import { applySectionEdit, normalizeManualItem } from './section-edit.js';

const stored = [
  {
    id: 'articles',
    title: 'New articles',
    items: [
      { title: 'A', url: 'https://hybridcloudworks.com/a', summary: 'first' },
      { title: 'B', url: 'https://hybridcloudworks.com/b' },
    ],
  },
  {
    id: 'episodes',
    title: 'Episodes',
    items: [{ title: 'E', url: 'https://hybridcloudworks.com/e' }],
  },
];
const manual = { manual: true, title: 'Note', url: 'https://example.com/note' };

describe('applySectionEdit', () => {
  it('keeps stored items as stored, in the submitted order, and drops what is left out', () => {
    const result = applySectionEdit(stored, [
      { id: 'episodes', items: [{ url: 'https://hybridcloudworks.com/e' }] },
      { id: 'articles', items: [{ url: 'https://hybridcloudworks.com/b', title: 'B' }] },
    ]);
    expect(result.error).toBeUndefined();
    expect(result.itemCount).toBe(2);
    expect(result.sections.map((s) => s.id)).toEqual(['episodes', 'articles']);
    expect(result.sections[1].items).toEqual([
      { title: 'B', url: 'https://hybridcloudworks.com/b' },
    ]);
  });

  it('a section emptied of items is a removed section, and the issue must keep one item', () => {
    const result = applySectionEdit(stored, [
      { id: 'articles', items: [] },
      { id: 'episodes', items: [{ url: 'https://hybridcloudworks.com/e' }] },
    ]);
    expect(result.sections.map((s) => s.id)).toEqual(['episodes']);
    expect(applySectionEdit(stored, [{ id: 'articles', items: [] }]).error).toMatch(
      /at least one item/
    );
  });

  it.each([
    ['not an array', 'nope', /must be an array/],
    ['an entry without an id', [{ items: [] }], /object with the id/],
    [
      'a section the issue does not hold',
      [{ id: 'random', title: 'x', items: [] }],
      /a section was added/,
    ],
    [
      'the same section twice',
      [
        { id: 'articles', items: [] },
        { id: 'articles', items: [] },
      ],
      /listed more than once/,
    ],
    [
      'a renamed collected section',
      [{ id: 'articles', title: 'Renamed', items: [] }],
      /title cannot be edited/,
    ],
    ['a section without an items array', [{ id: 'articles' }], /needs an items array/],
    [
      'an item moved between sections',
      [{ id: 'episodes', items: [{ url: 'https://hybridcloudworks.com/a' }] }],
      /added or moved/,
    ],
    [
      'the same item twice',
      [
        {
          id: 'articles',
          items: [
            { url: 'https://hybridcloudworks.com/a' },
            { url: 'https://hybridcloudworks.com/a' },
          ],
        },
      ],
      /listed more than once/,
    ],
    [
      'an edited item field',
      [{ id: 'articles', items: [{ url: 'https://hybridcloudworks.com/a', title: 'Changed' }] }],
      /cannot be edited/,
    ],
  ])('refuses %s', (_name, submitted, message) => {
    expect(applySectionEdit(stored, submitted).error).toMatch(message);
  });

  it('a manual section is new only with a title, and a manual section can be retitled', () => {
    expect(applySectionEdit(stored, [{ id: 'manual', items: [manual] }]).error).toMatch(
      /needs a title/
    );
    const created = applySectionEdit(stored, [
      { id: 'manual-notes', title: ' Notes ', items: [manual] },
    ]);
    expect(created.sections[0]).toMatchObject({ id: 'manual-notes', title: 'Notes', manual: true });
    const retitled = applySectionEdit(
      [{ id: 'manual', title: 'Old', manual: true, items: [] }],
      [{ id: 'manual', title: 'New', items: [manual] }]
    );
    expect(retitled.sections[0].title).toBe('New');
    expect(
      applySectionEdit(
        [{ id: 'manual', title: 'Old', manual: true, items: [] }],
        [{ id: 'manual', title: '   ', items: [manual] }]
      ).error
    ).toMatch(/needs a title/);
  });

  it('a manual item may join any section and is validated, not matched', () => {
    const result = applySectionEdit(stored, [
      { id: 'articles', items: [{ url: 'https://hybridcloudworks.com/a' }, manual] },
    ]);
    expect(result.sections[0].items[1]).toEqual({
      manual: true,
      title: 'Note',
      url: 'https://example.com/note',
    });
    expect(
      applySectionEdit(stored, [{ id: 'articles', items: [{ manual: true, title: 'No link' }] }])
        .error
    ).toMatch(/needs an https link/);
  });
});

describe('normalizeManualItem', () => {
  it('keeps the optional fields it is given and refuses what is not https', () => {
    expect(
      normalizeManualItem({
        manual: true,
        title: 'T',
        url: 'https://example.com/t',
        summary: 'S',
        label: 'L',
        imageUrl: 'https://example.com/i.png',
        contentId: 42,
      })
    ).toEqual({
      item: {
        manual: true,
        title: 'T',
        url: 'https://example.com/t',
        summary: 'S',
        label: 'L',
        imageUrl: 'https://example.com/i.png',
        contentId: '42',
      },
    });
    expect(normalizeManualItem(null).error).toMatch(/must be an object/);
    expect(normalizeManualItem({ url: 'https://example.com' }).error).toMatch(/needs a title/);
    expect(
      normalizeManualItem({ title: 'T', url: 'https://example.com', imageUrl: 'http://x.test/i' })
        .error
    ).toMatch(/image must be an https URL/);
  });
});
