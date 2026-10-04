/**
 * Which set a content document generates with, and the prompt it sends:
 * `resolvePromptSetForContent` finds the set (its own lineage first, then the
 * page assignment for its provider and type) and `composeSetPrompt` turns
 * set + prompt + slot + article + keyword matrix into the final text
 * (PR #841 split of image-prompts.js).
 */
import { normalizePromptConfigKey, pathToPromptPageDocId } from './shared.js';
import { pagePathsForContent } from './pages.js';
import { promptTemplateVersionFor } from './sets.js';
import { applyKeywordMatrix, keywordMatrixLines } from './keywords.js';

/** A set by name, unless it is archived or missing. */
async function readLiveSet(store, name) {
  const setName = normalizePromptConfigKey(name);
  if (!setName) return null;
  const set = await store.readDoc('image_prompt_sets', setName, setName).catch(() => null);
  return set && !set.archivedAt ? set : null;
}

async function readSetPrompt(store, setName, name) {
  const promptName = normalizePromptConfigKey(name);
  if (!promptName) return null;
  return store.readDoc('image_prompt_sets_prompts', promptName, setName).catch(() => null);
}

/** The set the document's own lineage names, with its prompt. */
async function resolveOwnSet(store, data) {
  const setName = data.imagePromptSet || data.promptSet || data.imageLineage?.promptSet;
  const set = await readLiveSet(store, setName);
  if (!set) return null;
  const promptName = data.imagePromptName || data.promptName || data.imageLineage?.promptName;
  return {
    set,
    prompt: await readSetPrompt(store, set.id, promptName),
    pagePath: null,
    source: 'content',
  };
}

/** The first page assignment for the document's pages that names a live set. */
async function resolveAssignedSet(store, data) {
  for (const pagePath of pagePathsForContent(data)) {
    const docId = pathToPromptPageDocId(pagePath);
    const assignment = await store.readDoc('image_prompt_pages', docId, docId).catch(() => null);
    const set = await readLiveSet(store, assignment?.setName);
    if (set) {
      const prompt = await readSetPrompt(store, set.id, assignment?.promptName);
      return { set, prompt, pagePath, source: 'page' };
    }
  }
  return null;
}

/**
 * The set (and prompt) a content document should generate with.
 *
 * Order: lineage already on the document (`imagePromptSet` / `imageLineage`,
 * written by the Submit URLs flow), then the page assignment for the
 * document's provider and type, then the provider landing page. A set that is
 * archived, or named but missing, resolves to null so the caller falls back.
 *
 * @returns {Promise<null | { set: object, prompt: object|null, pagePath: string|null, source: 'content'|'page' }>}
 */
export async function resolvePromptSetForContent(store, data = {}) {
  if (!store?.readDoc) return null;
  return (await resolveOwnSet(store, data)) || (await resolveAssignedSet(store, data));
}

/** Title / summary / topics lines for the article being illustrated. */
function articleLines(article = {}) {
  const lines = [];
  const title = String(article.Title || article.title || '').trim();
  const summary = String(article.summary || article.Summary || article.description || '').trim();
  const topics = Array.isArray(article.keyTopics) ? article.keyTopics.filter(Boolean) : [];
  if (title) lines.push(`Subject: ${title}.`);
  if (topics.length) lines.push(`Topics: ${topics.join(', ')}.`);
  if (summary) lines.push(`Context: ${summary.slice(0, 600)}`);
  if (article.visualTheme) lines.push(`Visual metaphor: ${String(article.visualTheme).trim()}`);
  return lines;
}

/** `${label}: ${value}` when the value has text, else nothing. */
const labelled = (label, value) => {
  const trimmed = String(value || '').trim();
  return trimmed ? [`${label}: ${trimmed}`] : [];
};

/**
 * The final prompt for one slot from a set, a prompt variation, the article
 * and the keyword matrix. The order is the order a reader would brief an
 * illustrator: the set's shared prompt, the variation, the slot's own
 * template, the article, the matrix, the style rules, then what to avoid.
 */
export function composeSetPrompt({
  set,
  prompt = null,
  slot = 'hero',
  article = {},
  keyword,
} = {}) {
  const matrix = applyKeywordMatrix(
    [article.Title, article.title, article.summary, (article.keyTopics || []).join(' ')]
      .filter(Boolean)
      .join(' '),
    keyword
  );
  const lines = [
    String(set?.primaryPrompt || '').trim(),
    ...labelled('Variation', prompt?.additionalParameters),
    ...labelled('Slot composition', prompt?.slotTemplates?.[slot]),
    ...articleLines(article),
    ...keywordMatrixLines(matrix),
    ...labelled('Style rules', set?.styleRules),
    ...labelled('Avoid', set?.negativePrompt),
    'No text overlays, labels, or written words in the image.',
  ];
  return lines.filter(Boolean).join('\n');
}

/** The lineage fields every generated image row carries (ADR 0033 §4). */
export function lineageFor({ set, prompt, promptText, slot, source }) {
  return {
    promptSetId: set?.id || '',
    promptSet: set?.name || set?.id || '',
    setId: set?.id || '',
    promptName: prompt?.name || prompt?.id || '',
    promptTemplateVersion: set ? promptTemplateVersionFor(set) : '',
    prompt: String(promptText || ''),
    promptSlot: slot || '',
    promptSource: source || '',
  };
}
