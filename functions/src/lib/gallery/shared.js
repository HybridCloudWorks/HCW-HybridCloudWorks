/**
 * What the gallery modules share: the JSON reply, the refusal shape, the two
 * image containers, and the small field cleaners every record writer uses
 * (PR #841 split of gallery-images.js).
 */
export const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** A refusal on its way to `json(status, { error })`. */
export const refuse = (status, error) => ({ ok: false, status, error });

export const GALLERY_COLLECTIONS = Object.freeze([
  'generated_content_images',
  'curated_article_images',
]);

export const cleanTagList = (value) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .map((tag) =>
              String(tag || '')
                .trim()
                .toLowerCase()
            )
            .filter(Boolean)
        ),
      ]
    : [];

export const cleanFolder = (value) =>
  String(value || 'default')
    .trim()
    .toLowerCase() || 'default';

export const optionalInt = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
};

export const lower = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

export const trimmed = (value, max, fallback = '') =>
  String(value || '')
    .trim()
    .slice(0, max) || fallback;
