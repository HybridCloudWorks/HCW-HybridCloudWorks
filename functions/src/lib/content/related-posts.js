/**
 * related-posts.js — series detection + interlinking (Blog Machine backlog
 * #5). Pure: given the published corpus a forge run already fetched for its
 * dedupe gate, find the posts most related to the freshly forged draft and
 * propose a "Related reading" links module plus `relatedContentIds` series
 * metadata.
 *
 * Relatedness reuses the dedupe gate's own token machinery (titleTokens,
 * Jaccard) but over title + keyTopics — topics are where two posts about the
 * same service under different titles actually meet. The floor (0.15) keeps
 * "mentions the same cloud" from counting as a series; there is no ceiling,
 * because linking to a very similar published post is exactly what a series
 * is (true duplicates never reach this code — the dedupe gate refused to
 * forge them).
 *
 * Only posts with a real public URL are proposed: a related-reading link the
 * reader cannot follow is worse than none, so URL-less rows drop out rather
 * than being guessed at.
 */
import { titleTokens } from './forge-pipeline.js';
import { publicUrlOf } from '../cms/publish.js';

export const RELATED_LIMIT = 3;
export const RELATED_MIN_SCORE = 0.15;

function relatednessTokens(title, keyTopics) {
  const topics = Array.isArray(keyTopics) ? keyTopics.join(' ') : '';
  return titleTokens(`${title || ''} ${topics}`);
}

/** Jaccard over title+topic tokens. Pure; 0 when either side is empty. */
export function scoreRelatedness(candidate, published) {
  const a = relatednessTokens(candidate.title, candidate.keyTopics);
  const b = relatednessTokens(published.Title || published.title, published.keyTopics);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * The top related published posts for a draft.
 * @param {object[]} corpusRows - rows with Title/title, keyTopics, id + URL fields
 * @param {{ title: string, keyTopics?: string[] }} draft
 * @returns {{ id: string, title: string, url: string, score: number }[]}
 */
export function findRelatedPublished(
  corpusRows = [],
  draft,
  { limit = RELATED_LIMIT, minScore = RELATED_MIN_SCORE } = {}
) {
  return (corpusRows || [])
    .map((row) => ({
      id: row?.id,
      title: row?.Title || row?.title || '',
      url: publicUrlOf(row || {}),
      score: scoreRelatedness(draft, row || {}),
    }))
    .filter((entry) => entry.id && entry.title && entry.url && entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The proposed sibling-links module — deletable in the editor like any other. */
export function buildRelatedReadingModule(related) {
  const links = related.map(({ title, url }) => ({ title, url }));
  return `<module type="links" align="all">${JSON.stringify({ links })}</module>`;
}
