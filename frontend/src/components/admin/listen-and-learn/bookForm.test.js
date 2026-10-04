/**
 * The book dialog's pure form rules (ADR 0033 §4): what a save sends, and
 * that a book's provider and code never travel on an edit.
 */
import { describe, it, expect } from 'vitest';
import { bookPayload, catalogDefaults, emptyBookForm } from './bookForm';

describe('emptyBookForm', () => {
  it('opens a new book with the defaults and an existing one with its fields as text', () => {
    expect(emptyBookForm(null)).toMatchObject({ kind: 'book', provider: 'azure', tags: '' });
    expect(
      emptyBookForm({
        kind: 'course',
        provider: 'aws',
        tags: ['a', 'b'],
        voice: { narrator: 'Puck' },
      })
    ).toMatchObject({ kind: 'course', provider: 'aws', tags: 'a, b', voice: { narrator: 'Puck' } });
  });
});

describe('bookPayload', () => {
  const form = {
    ...emptyBookForm(null),
    kind: 'course',
    provider: 'gcp',
    examCode: ' PCA ',
    title: ' Pro Architect ',
    author: '  ',
    tags: 'cloud, , gcp ',
  };

  it('trims text, drops empties to null, splits tags and carries the voice only when chosen', () => {
    expect(bookPayload(form, { editing: false })).toEqual({
      kind: 'course',
      title: 'Pro Architect',
      author: null,
      description: null,
      tags: ['cloud', 'gcp'],
      coverImageUrl: null,
      provider: 'gcp',
      examCode: 'PCA',
    });
    expect(bookPayload({ ...form, voice: { narrator: 'Kore' } }, { editing: false }).voice).toEqual(
      {
        narrator: 'Kore',
      }
    );
  });

  it('never sends the provider or the code for an existing book, nor a code for a plain book', () => {
    const edited = bookPayload(form, { editing: true });
    expect(edited).not.toHaveProperty('provider');
    expect(edited).not.toHaveProperty('examCode');
    expect(bookPayload({ ...form, kind: 'book' }, { editing: false })).not.toHaveProperty(
      'examCode'
    );
  });
});

describe('catalogDefaults', () => {
  it('reads the speaking rate from the catalog and falls back to 1', () => {
    expect(catalogDefaults({ speakingRate: { default: 1.1 } }).speakingRate).toBe(1.1);
    expect(catalogDefaults(null)).toMatchObject({ provider: 'auto', speakingRate: 1 });
  });
});
