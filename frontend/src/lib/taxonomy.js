/**
 * Content taxonomy, client side (ADR 0033 §4). The server owns the lists
 * (functions/src/lib/cms/taxonomy.js, saved at
 * cms/platform-settings/content-taxonomy); this module reads them once per
 * session, falls back to the same defaults, and classifies records that
 * predate the taxonomy from their `type` and `source` the same way the server
 * does — so a list and a picker never disagree about what an item is.
 *
 *   kind        what the item will become (article, tutorial, newsletter…)
 *   ideaOrigin  how it became an idea (manual, audience question, RSS feed…)
 */
import { getJSON } from '@/lib/api';

/**
 * The built-in entries, as `[id, label, description]` rows; `entries` turns a
 * table into the enabled records a picker reads. The ids and labels are the
 * server's (functions/src/lib/cms/taxonomy.js) — a client-side copy because
 * that module reads Cosmos and cannot be bundled here.
 */
const entries = (rows) =>
  Object.freeze(
    rows.map(([id, label, description]) => ({ id, label, description, enabled: true }))
  );

export const DEFAULT_KINDS = entries([
  ['article', 'Article', 'A written piece for a provider blog.'],
  ['tutorial', 'Tutorial', 'Step-by-step instructions the reader follows along.'],
  ['documentation', 'Documentation page', 'Reference material kept current over time.'],
  ['course-lesson', 'Course lesson', 'One lesson inside a course or study guide.'],
  ['lab', 'Lab', 'A hands-on exercise with an environment to work in.'],
  ['newsletter', 'Newsletter', 'An issue or a block destined for the newsletter.'],
  ['social-post', 'Social post', 'A short post for LinkedIn, X or another network.'],
  ['video-script', 'Video script', 'The spoken script for a recorded video.'],
  ['podcast-script', 'Podcast script', 'A two-host dialogue for a podcast episode.'],
  ['audiobook-chapter', 'Audiobook chapter', 'A chapter of a book or course read aloud.'],
  ['training-audio', 'Training audio', 'Spoken training material outside a book.'],
  ['event-announcement', 'Event announcement', 'A talk, webinar or meetup to promote.'],
  ['case-study', 'Case study', 'A real engagement, its problem and its outcome.'],
  ['white-paper', 'White paper', 'A longer argued document on one topic.'],
  ['landing-page', 'Landing page', 'A page built to introduce one thing.'],
  ['reference-guide', 'Reference guide', 'A framework, blueprint or lookup table.'],
  ['certification-content', 'Certification content', 'Material tied to an exam objective.'],
  ['speaker-content', 'Speaker content', 'An abstract, slides or notes for a talk.'],
  ['ambassador-evidence', 'Ambassador evidence', 'Proof of community contribution.'],
  ['image-set', 'Image set', 'A coordinated set of images on one theme.'],
]);

export const DEFAULT_IDEA_ORIGINS = entries([
  ['manual', 'Manually entered', 'Someone typed the idea in.'],
  ['content-gap', 'Content gap', 'Something the site should cover and does not.'],
  ['search-trend', 'Search trend', 'People are searching for it.'],
  ['audience-question', 'Audience question', 'A reader, viewer or attendee asked.'],
  ['content-refresh', 'Existing content refresh', 'An older piece needs updating.'],
  ['support-request', 'Support request', 'A ticket or question from a client.'],
  ['product-update', 'Product update', 'A vendor shipped or changed something.'],
  ['conference', 'Conference or event', 'Prompted by a talk, booth or hallway chat.'],
  ['certification-objective', 'Certification objective', 'Maps to an exam skill.'],
  ['speaker-engagement', 'Speaker engagement', 'Material for or from a speaking slot.'],
  ['ambassador-requirement', 'Ambassador requirement', 'Needed for a program application.'],
  ['ai-recommendation', 'AI recommendation', 'Suggested by the forge or an assistant.'],
  ['imported-source', 'Imported source', 'Drafted from a URL or document someone imported.'],
  ['rss-feed', 'RSS or external feed', 'Arrived through a subscribed feed.'],
  ['recording', 'Recording', 'Started as a Plaud or uploaded recording.'],
  ['performance-insight', 'Performance insight', 'Earlier content did well and warrants more.'],
  ['repurposing', 'Content repurposing', 'Reshaped from something already published.'],
  ['team-request', 'Team request', 'A colleague asked for it.'],
]);

const SOURCE_TO_ORIGIN = Object.freeze({
  rss: 'rss-feed',
  firecrawl: 'imported-source',
  manual_url: 'imported-source',
  'forge-url': 'imported-source',
  recording: 'recording',
  drafts: 'manual',
  repo: 'manual',
  'template-form': 'audience-question',
});

const TYPE_TO_KIND = Object.freeze({
  blog: 'article',
  news: 'article',
  framework: 'reference-guide',
  architecture: 'reference-guide',
  coder_corner: 'tutorial',
});

export function defaultTaxonomy() {
  return {
    kinds: DEFAULT_KINDS.map((k, order) => ({ ...k, order })),
    ideaOrigins: DEFAULT_IDEA_ORIGINS.map((o, order) => ({ ...o, order })),
  };
}

/** The idea origin of a record: stored, else derived from `source`, else manual. */
export function resolveIdeaOrigin(item = {}) {
  const stored = String(item.ideaOrigin || '').trim();
  if (stored) return stored;
  return SOURCE_TO_ORIGIN[String(item.source || '').trim()] || 'manual';
}

/** The kind of a record: stored, else derived from its publish type. */
export function resolveKind(item = {}) {
  const stored = String(item.kind || '').trim();
  if (stored) return stored;
  const type = String(item.type || item.contentType || item.publishTarget || 'blog')
    .trim()
    .toLowerCase();
  return TYPE_TO_KIND[type] || 'article';
}

/** A label for an id, from the given list; the raw id when it is unknown. */
export function labelFor(list, id) {
  return list?.find((x) => x.id === id)?.label || id;
}

let cached = null;
let inflight = null;

/**
 * The taxonomy as saved, cached per session. A failed read falls back to the
 * defaults so pickers always have something to offer; `force` re-reads after
 * the Settings tab saves.
 */
export async function loadTaxonomy({ force = false } = {}) {
  if (cached && !force) return cached;
  if (inflight && !force) return inflight;
  inflight = getJSON('cms/platform-settings/content-taxonomy')
    .then((res) => {
      const value = res?.value;
      cached =
        value && Array.isArray(value.kinds) && Array.isArray(value.ideaOrigins)
          ? value
          : defaultTaxonomy();
      return cached;
    })
    .catch(() => {
      cached = defaultTaxonomy();
      return cached;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Forget the cached lists (the Settings tab calls this after a save). */
export function resetTaxonomyCache() {
  cached = null;
  inflight = null;
}

/** Only the enabled entries, in saved order, for a picker. */
export function enabledEntries(list) {
  return (list || []).filter((x) => x.enabled !== false);
}
