/**
 * The creative brief (ADR 0033 §7 slice 2): its bounds, its normalised
 * shape, whether it says anything, and the markdown a forge run reads it as
 * (PR #841 split of forge-studio.js).
 */
export const MAX_BRIEF_TEXT = 2000;
export const MAX_BRIEF_LIST = 12;

/** Where a finished piece publishes; the content document's `type`. */
export const TARGET_CHANNELS = Object.freeze(['blog', 'framework', 'architecture', 'coder_corner']);

/** How the brief was started; stored so the Finish tab can say so. */
export const BRIEF_MODES = Object.freeze(['idea', 'template', 'existing', 'url', 'blank']);

/** A value as trimmed text of at most `max` characters. */
export const text = (value, max) =>
  String(value ?? '')
    .trim()
    .slice(0, max);

const list = (value, maxItems = MAX_BRIEF_LIST, maxLen = 300) => {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(/\r?\n|,/)
        .map((entry) => entry.trim());
  return [...new Set(raw.map((entry) => String(entry || '').trim()).filter(Boolean))]
    .map((entry) => entry.slice(0, maxLen))
    .slice(0, maxItems);
};
const urls = (value) =>
  list(value, MAX_BRIEF_LIST, 2000).filter((entry) => /^https?:\/\//i.test(entry));

/**
 * The creative brief, normalised. Every field is optional except that the
 * whole thing must say something; the handler refuses an empty brief.
 */
export function normalizeBrief(raw = {}) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const targetLength = Number(input.targetLength);
  const channel = String(input.targetChannel || '')
    .trim()
    .toLowerCase();
  const mode = String(input.mode || '')
    .trim()
    .toLowerCase();
  return {
    mode: BRIEF_MODES.includes(mode) ? mode : 'idea',
    templateKey: text(input.templateKey, 60),
    sourceContentId: text(input.sourceContentId, 200),
    sourceUrl: urls([input.sourceUrl])[0] || '',
    objective: text(input.objective, MAX_BRIEF_TEXT),
    audience: text(input.audience, MAX_BRIEF_TEXT),
    tone: text(input.tone, 200),
    readingLevel: text(input.readingLevel, 100),
    targetLength:
      Number.isFinite(targetLength) && targetLength > 0
        ? Math.min(20000, Math.round(targetLength))
        : null,
    keyMessage: text(input.keyMessage, MAX_BRIEF_TEXT),
    requiredTopics: list(input.requiredTopics),
    prohibitedTopics: list(input.prohibitedTopics),
    callsToAction: list(input.callsToAction),
    sources: urls(input.sources),
    targetChannel: TARGET_CHANNELS.includes(channel) ? channel : 'blog',
    campaign: text(input.campaign, 200),
    seoKeywords: list(input.seoKeywords, 20, 80),
  };
}

/** The brief fields a drafter could work from; a list counts when it has entries. */
const SUBSTANCE_FIELDS = [
  'objective',
  'keyMessage',
  'audience',
  'requiredTopics',
  'sources',
  'sourceContentId',
  'sourceUrl',
];

/** Does the brief carry anything a drafter could work from? */
export function briefHasSubstance(brief) {
  return SUBSTANCE_FIELDS.some((key) => {
    const value = brief[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}

/**
 * The brief as the markdown body a forge run reads as its source
 * (forge.js resolveForgeSource reads `content` and refuses an empty one).
 * Written by the page into the draft via the Drafts route; the server has
 * the same function so a test can pin that the two agree on the shape.
 */
export function briefToMarkdown(brief, title = '') {
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
  bullets('Must cover', brief.requiredTopics);
  bullets('Must not cover', brief.prohibitedTopics);
  bullets('Calls to action', brief.callsToAction);
  bullets('Sources', brief.sources);
  bullets('SEO keywords', brief.seoKeywords);
  field('Campaign', brief.campaign);
  return lines.join('\n').trim();
}
