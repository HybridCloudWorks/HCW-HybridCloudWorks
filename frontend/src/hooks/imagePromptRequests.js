/**
 * The request bodies and row shapes useImagePrompts sends and reads (split
 * for PR #841): pure, so the hook itself is one guarded call per method.
 *
 * Writes go through the manageImagePromptConfig RPC (sets/prompts/
 * assignments) and cms/keyword-config (synonym/augmentation collections):
 *   synonyms/{id}      { canonical, patterns:[string] }
 *   augmentations/{id} { label, patterns:[string], directive }
 */
import { normalizeKey, normalizeSlotTemplates, pathToDocId } from './imagePromptLibrary';

/** `CODE: message`, the shape every error the hook surfaces has. */
export function describeError(err, failure = 'Unknown error') {
  return `${err?.code || 'UNKNOWN'}: ${err?.message || failure}`;
}

/**
 * `savePromptSet(name, 'prompt text')` as before, or
 * `savePromptSet(name, { primaryPrompt, purpose, theme, styleRules,
 * negativePrompt, aspectRatio, tags })` — fields absent from the object are
 * left as they are on the server.
 */
export function saveSetBody(setName, primaryPromptOrFields) {
  const fields =
    primaryPromptOrFields && typeof primaryPromptOrFields === 'object'
      ? primaryPromptOrFields
      : { primaryPrompt: primaryPromptOrFields };
  return {
    action: 'saveSet',
    setName: normalizeKey(setName),
    ...fields,
    primaryPrompt: String(fields.primaryPrompt || '').trim(),
  };
}

export function savePromptBody(setName, promptName, additionalParameters, slotTemplates = {}) {
  return {
    action: 'savePrompt',
    setName: normalizeKey(setName),
    promptName: normalizeKey(promptName),
    additionalParameters: String(additionalParameters || '').trim(),
    slotTemplates: normalizeSlotTemplates(slotTemplates),
  };
}

export function savePageAssignmentBody(pagePath, setName, promptName) {
  return {
    action: 'savePageAssignment',
    pagePath,
    setName: normalizeKey(setName),
    promptName: normalizeKey(promptName),
  };
}

/** True when a page path names a document at all. */
export function hasPageDocId(pagePath) {
  return Boolean(pathToDocId(pagePath));
}

const trimmedPatterns = (patterns) =>
  (patterns || []).map((p) => String(p || '').trim()).filter(Boolean);

export function synonymRows(res) {
  return (res.synonyms || []).map((d) => ({
    id: d.id,
    canonical: String(d.canonical || '').trim(),
    patterns: Array.isArray(d.patterns) ? d.patterns : [],
  }));
}

export function augmentationRows(res) {
  return (res.augmentations || []).map((d) => ({
    id: d.id,
    label: String(d.label || '').trim(),
    patterns: Array.isArray(d.patterns) ? d.patterns : [],
    directive: String(d.directive || '').trim(),
  }));
}

/** The PUT for one synonym group; throws when neither id nor canonical names it. */
export function synonymRequest(id, { canonical, patterns }) {
  const docId = normalizeKey(id) || normalizeKey(canonical);
  if (!docId) throw new Error('Canonical tag required.');
  return {
    url: `cms/keyword-config/synonyms/${encodeURIComponent(docId)}`,
    body: { canonical: normalizeKey(canonical), patterns: trimmedPatterns(patterns) },
  };
}

/** The PUT for one augmentation; throws when neither id nor label names it. */
export function augmentationRequest(id, { label, patterns, directive }) {
  const docId = normalizeKey(id) || normalizeKey(label);
  if (!docId) throw new Error('Label required.');
  return {
    url: `cms/keyword-config/augmentations/${encodeURIComponent(docId)}`,
    body: {
      label: normalizeKey(label),
      patterns: trimmedPatterns(patterns),
      directive: String(directive || '').trim(),
    },
  };
}
