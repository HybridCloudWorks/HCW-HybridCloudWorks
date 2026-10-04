/**
 * The book dialog's form (ADR 0033 §4), pure: what a book opens as, what a
 * save sends, and the voice defaults the fields open showing. The provider
 * and the exam code are fixed once a book exists — they are its route and
 * its blob path — so a save of an existing book never carries them.
 */

/** The form as a book opens: its fields as text, or empty for a new one. */
export const emptyBookForm = (book) => ({
  kind: book?.kind || 'book',
  provider: book?.provider || 'azure',
  examCode: book?.examCode || '',
  title: book?.title || '',
  author: book?.author || '',
  description: book?.description || '',
  tags: Array.isArray(book?.tags) ? book.tags.join(', ') : '',
  coverImageUrl: book?.coverImageUrl || '',
  voice: book?.voice || null,
});

const splitTags = (text) =>
  text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

/**
 * What a save sends: trimmed text, empties as null, tags as a list, the
 * voice only when one was chosen, and — for a new book — its provider and,
 * for a course, the exam code.
 */
export function bookPayload(form, { editing }) {
  const fields = {
    kind: form.kind,
    title: form.title.trim(),
    author: form.author.trim() || null,
    description: form.description.trim() || null,
    tags: splitTags(form.tags),
    coverImageUrl: form.coverImageUrl.trim() || null,
  };
  if (form.voice) fields.voice = form.voice;
  if (editing) return fields;
  fields.provider = form.provider;
  const examCode = form.examCode.trim();
  if (form.kind === 'course' && examCode) fields.examCode = examCode;
  return fields;
}

/** The defaults the server applies, so the voice fields open showing what will run. */
export function catalogDefaults(catalog) {
  return {
    provider: 'auto',
    model: null,
    speakers: { Maya: 'Kore', Elena: 'Leda' },
    narrator: 'Kore',
    language: 'en-US',
    speakingRate: catalog?.speakingRate?.default ?? 1,
  };
}
