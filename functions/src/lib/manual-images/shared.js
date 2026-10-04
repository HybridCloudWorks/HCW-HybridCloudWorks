/**
 * What the manual image handlers share: the JSON reply, the blob-path
 * stamp, the model description a caller is told, the preview slots and the
 * named-set read (PR #841 split of manual-images.js).
 */
import { normalizePromptConfigKey } from '../cms/image-prompts.js';

export const PREVIEW_SLOTS = ['hero', 'secondary1', 'secondary2', 'secondary3'];

export const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** An ISO stamp as the 14 digits a blob path carries. */
export const compact = (iso) =>
  String(iso || '')
    .replace(/[-:TZ]/g, '')
    .replace(/\..*$/, '')
    .slice(0, 14);

/** What a caller is told about the model behind a generation. */
export function modelInfo(replicate) {
  return {
    imageProvider: replicate?.provider || 'replicate',
    imageModel: replicate?.model || '',
    costPerImageUsd:
      typeof replicate?.costPerImageUsd === 'number' ? replicate.costPerImageUsd : null,
  };
}

/** The set (and prompt) a request names, when it names one and it exists. */
export async function readNamedSet(store, setName, promptName) {
  const set = normalizePromptConfigKey(setName);
  if (!set || typeof store.readDoc !== 'function') return { set: null, prompt: null };
  const setDoc = await store.readDoc('image_prompt_sets', set, set).catch(() => null);
  if (!setDoc) return { set: null, prompt: null };
  const prompt = normalizePromptConfigKey(promptName);
  const promptDoc = prompt
    ? await store.readDoc('image_prompt_sets_prompts', prompt, set).catch(() => null)
    : null;
  return { set: setDoc, prompt: promptDoc };
}

/** The 500 every generation route answers when the generator or the store throws. */
export function generationFailure(context, label, error, message) {
  context.error(`${label} failed:`, error);
  return json(500, { error: message, message: error?.message || 'Unknown error' });
}
