/**
 * The creative brief as the page holds it (ADR 0033 §7 slice 2), pure.
 *
 * The form keeps every field as the string an input shows; the API takes
 * typed values (functions/src/lib/content/forge-studio.js normalizeBrief).
 * `toBriefPayload` is the crossing. `briefToMarkdown` renders the brief as
 * the markdown body the draft is created with, because the forge reads a
 * document's body as its source and refuses an empty one — the server has
 * the same function, and its test pins the same shape.
 */

/** Where a finished piece publishes; the content document's `type`. */
export const TARGET_CHANNELS = Object.freeze([
  { id: 'blog', label: 'Blog (provider news & articles)' },
  { id: 'framework', label: 'Frameworks' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'coder_corner', label: 'Coder Corner' },
]);

export const TONES = Object.freeze([
  'Direct and practical',
  'Teaching, step by step',
  'Opinionated',
  'Neutral reference',
  'Conversational',
]);

export const READING_LEVELS = Object.freeze([
  'Practitioner (assumes the basics)',
  'Senior (assumes production experience)',
  'Newcomer (explains every term)',
  'Executive (outcomes over mechanics)',
]);

/** The five ways a piece starts; each leads to the Brief. */
export const START_MODES = Object.freeze([
  {
    id: 'idea',
    label: 'From an idea',
    description: 'A title and a few lines of brief. The forge writes the first draft.',
  },
  {
    id: 'template',
    label: 'From a template',
    description: 'Pick one of the forge’s formats; the brief carries it as the requested shape.',
  },
  {
    id: 'existing',
    label: 'From existing content',
    description: 'Repurpose a piece already in the pipeline. The original is never changed.',
  },
  {
    id: 'url',
    label: 'From a URL',
    description: 'Scrape a page into a source document and forge from it (the forge-from-url job).',
  },
  {
    id: 'blank',
    label: 'Blank',
    description: 'An empty brief. Write the draft yourself and use the AI actions as you go.',
  },
]);

export const EMPTY_BRIEF = Object.freeze({
  mode: 'idea',
  templateKey: '',
  sourceContentId: '',
  sourceTitle: '',
  sourceUrl: '',
  objective: '',
  audience: '',
  kind: 'article',
  ideaOrigin: 'manual',
  tone: '',
  readingLevel: '',
  targetLength: '',
  keyMessage: '',
  requiredTopics: '',
  prohibitedTopics: '',
  callsToAction: '',
  sources: '',
  targetChannel: 'blog',
  campaign: '',
  seoKeywords: '',
});

/** How a start mode seeds the brief; the idea origin follows the mode. */
export const MODE_ORIGINS = Object.freeze({
  idea: 'manual',
  template: 'manual',
  existing: 'repurposing',
  url: 'imported-source',
  blank: 'manual',
});

export const splitList = (value) =>
  String(value || '')
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);

/** The form → the API's brief object (lists as arrays, numbers as numbers). */
export function toBriefPayload(form) {
  const length = Number(form.targetLength);
  return {
    mode: form.mode,
    templateKey: form.templateKey || '',
    sourceContentId: form.sourceContentId || '',
    sourceUrl: form.sourceUrl || '',
    objective: form.objective.trim(),
    audience: form.audience.trim(),
    tone: form.tone.trim(),
    readingLevel: form.readingLevel.trim(),
    targetLength: Number.isFinite(length) && length > 0 ? Math.round(length) : null,
    keyMessage: form.keyMessage.trim(),
    requiredTopics: splitList(form.requiredTopics),
    prohibitedTopics: splitList(form.prohibitedTopics),
    callsToAction: splitList(form.callsToAction),
    sources: splitList(form.sources),
    targetChannel: form.targetChannel || 'blog',
    campaign: form.campaign.trim(),
    seoKeywords: splitList(form.seoKeywords),
  };
}

/** Does the brief carry anything a drafter could work from? Mirrors the API's rule. */
export function briefHasSubstance(form) {
  const payload = toBriefPayload(form);
  return Boolean(
    payload.objective ||
    payload.keyMessage ||
    payload.audience ||
    payload.requiredTopics.length ||
    payload.sources.length ||
    payload.sourceContentId ||
    payload.sourceUrl
  );
}

/**
 * The brief as the draft's first body. Same field order and markers as the
 * server's briefToMarkdown so a brief saved from either reads the same.
 */
export function briefToMarkdown(form, title = '', { templateLabel = '' } = {}) {
  const brief = toBriefPayload(form);
  const lines = [];
  if (title) lines.push(`# ${title}`, '');
  const field = (label, value) => {
    if (value) lines.push(`**${label}:** ${value}`, '');
  };
  const bullets = (label, items) => {
    if (items?.length) lines.push(`**${label}:**`, ...items.map((item) => `- ${item}`), '');
  };
  field('Objective', brief.objective);
  field('Audience', brief.audience);
  field('Key message', brief.keyMessage);
  field('Tone', brief.tone);
  field('Reading level', brief.readingLevel);
  field('Target length', brief.targetLength ? `${brief.targetLength} words` : '');
  field('Requested format', templateLabel);
  bullets('Must cover', brief.requiredTopics);
  bullets('Must not cover', brief.prohibitedTopics);
  bullets('Calls to action', brief.callsToAction);
  bullets('Sources', brief.sources);
  bullets('SEO keywords', brief.seoKeywords);
  field('Campaign', brief.campaign);
  return lines.join('\n').trim();
}

/** The body of a content document, whichever spelling it uses. */
export function bodyOf(doc) {
  const d = doc || {};
  return String(d.content || d.blogDraft || d.Content || d.postContent || '');
}

/** The title of a content document, whichever spelling it uses. */
export function titleOf(doc) {
  const d = doc || {};
  return String(d.Title || d.title || '').trim();
}
