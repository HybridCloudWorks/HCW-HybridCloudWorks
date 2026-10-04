/**
 * What every image-prompt module shares: the JSON reply, the key and
 * page-id normalisers, the container window, and the two Firestore-shaped
 * store operations the port keeps (PR #841 split of image-prompts.js).
 *
 * Firestore `set(..., {merge:true})` becomes read-then-patch/upsert (the
 * settings-endpoint pattern); batch deletes become sequential deletes with
 * 404s tolerated — Firestore's batch.delete on a missing doc is a no-op and
 * this port keeps that behavior.
 */
export const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function normalizePromptConfigKey(value = '') {
  return String(value || '').trim();
}

export function pathToPromptPageDocId(pagePath = '') {
  return String(pagePath || '')
    .replace(/\//g, '_')
    .replace(/^_/, '');
}

export function hasLegacyPromptFields(data = {}) {
  return Boolean(data?.primaryPrompt || data?.secondaryPrompt || data?.title);
}

export const KEYWORD_COLLECTIONS = {
  synonyms: 'prompt_keyword_synonyms',
  augmentations: 'prompt_keyword_augmentations',
};

export const LIST_WINDOW = 1000;

/** Firestore set(..., {merge:true}): patch when present, create when absent. */
export async function mergeSet(store, container, id, fields, partitionKey = id) {
  const existing = await store.readDoc(container, id, partitionKey);
  if (existing) {
    return store.patchDoc(container, id, fields, { partitionKey });
  }
  return store.upsertDoc(container, { id, ...fields });
}

/** Firestore batch.delete tolerance: a missing doc is a no-op, not an error. */
export async function deleteIgnoringMissing(store, container, id, partitionKey = id) {
  try {
    await store.deleteDoc(container, id, partitionKey);
  } catch (err) {
    if (err?.code !== 404) throw err;
  }
}

/** A document without Cosmos's system fields. */
export function stripSystem(doc) {
  // eslint-disable-next-line no-unused-vars
  const { _rid, _self, _etag, _attachments, _ts, ...rest } = doc || {};
  return rest;
}
