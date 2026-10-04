/**
 * Image-prompt configuration — the manageImagePromptConfig RPC (ported from
 * Site-Main cms-functions.js :5329-5507) plus the read/keyword endpoints that
 * replace useImagePrompts.js's direct Firestore access.
 *
 * ADR 0033 (Creative slice): a prompt set IS an image set. The set document
 * grew the fields that make it a creative object rather than a bare prompt —
 * `purpose`, `theme`, `styleRules`, `negativePrompt`, `aspectRatio`, `tags`,
 * `archivedAt`, a `version` counter and a `history[]` of prior primary
 * prompts — plus the actions a library needs (`duplicateSet`, `renameSet`,
 * `archiveSet`, `restoreSet`). The same module also composes the prompt a
 * generator sends: `resolvePromptSetForContent` finds the set a content
 * document should use (its own lineage first, then the page assignment for
 * its provider and type) and `composeSetPrompt` turns set + prompt + slot +
 * article + keyword matrix into the final text. Before this the AI cover
 * trigger never read the library at all, and the keyword matrix was read by
 * nothing.
 *
 * Container mapping (scripts/lib/migration-manifest.mjs):
 *   image_prompt_sets          /id       doc id = set name
 *   image_prompt_sets_prompts  /setName  doc id = prompt name (unique per set)
 *   image_prompt_pages         /id       doc id = pathToPromptPageDocId(path)
 *   image_prompts              /id       legacy pages
 *   image_prompts_sets         /pageId   legacy per-page sets (set-name ids)
 *   prompt_keyword_synonyms, prompt_keyword_augmentations  /id
 *
 * The code lives in ./image-prompts/ (PR #841), one module per concern;
 * this file is the import path every caller and test already uses:
 *   shared.js    the key normalisers and the Firestore-shaped store helpers
 *   pages.js     the page allowlist and content → page resolution
 *   sets.js      the set's creative fields, version and history rules
 *   keywords.js  the keyword matrix
 *   resolve.js   content → set resolution and prompt composition
 *   store.js     the multi-document set operations
 *   actions.js   the manageConfig actions
 *   handlers.js  the HTTP handlers and their factory
 */
export {
  normalizePromptConfigKey,
  pathToPromptPageDocId,
  hasLegacyPromptFields,
} from './image-prompts/shared.js';
export {
  ADMIN_PROMPT_PAGE_ALLOWLIST,
  assertAllowedPromptPage,
  providerSlugFor,
  pagePathsForContent,
} from './image-prompts/pages.js';
export {
  SET_ASPECT_RATIOS,
  SET_HISTORY_LIMIT,
  SET_TAG_LIMIT,
  buildSetSaveFields,
  promptTemplateVersionFor,
} from './image-prompts/sets.js';
export {
  applyKeywordMatrix,
  keywordMatrixLines,
  loadKeywordMatrix,
} from './image-prompts/keywords.js';
export {
  resolvePromptSetForContent,
  composeSetPrompt,
  lineageFor,
} from './image-prompts/resolve.js';
export { createImagePromptHandlers } from './image-prompts/handlers.js';
