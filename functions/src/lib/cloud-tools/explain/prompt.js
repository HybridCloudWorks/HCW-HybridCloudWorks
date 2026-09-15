/**
 * What POST public/cloud-tools/explain says to the model, and what it does to
 * the answer (#613 Phase 3; the route's header is in handler.js).
 */

/** The AI_FEATURES key (lib/ai/ai-config.js) the route runs under. */
export const EXPLAIN_FEATURE = 'pricingExplain';

/** More than this and the model is padding; the page shows two paragraphs. */
const MAX_TEXT_CHARS = 2000;

export const EXPLAIN_SYSTEM_PROMPT = [
  'You are writing two short paragraphs for a public cloud-pricing comparison page.',
  'The user message is a JSON object: a scenario priced on up to three cloud providers, with each',
  "provider's monthly total, its base cost, the cost each extra adds, and the services it could",
  'not price. Use only the numbers given; do not invent, estimate or recall any price.',
  'Say which provider is cheapest for this scenario and by how much, what the extras add, and one',
  'thing that could flip the answer. No marketing, no recommendations to buy, no links, at most',
  '180 words, plain text with no headings, lists or markdown.',
].join(' ');

const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const URL_LIKE = /(?:https?:\/\/|www\.)[^\s<>()"']+/gi;
const BARE_DOMAIN =
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|cloud|ai|co|us|uk|eu|info|biz|xyz|app)\b(?:\/[^\s<>()"']*)?/gi;

/**
 * Generated text with anything URL-shaped removed: markdown links keep their
 * text, `https://…` and `www.…` go, and so does a bare domain with a common
 * TLD. The prompt carries visitor-supplied strings (a scenario label, extra
 * labels), and a link written into generated text on a public page is the
 * one thing an injected label could usefully produce. A defence, not a
 * guarantee; the page renders the result as text, never as HTML.
 */
export function stripUrls(value) {
  return String(value ?? '')
    .replace(MARKDOWN_LINK, '$1')
    .replace(URL_LIKE, '')
    .replace(BARE_DOMAIN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:])/g, '$1')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}
