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

const entry = (id, label, description) => ({ id, label, description, enabled: true });

export const DEFAULT_KINDS = Object.freeze([
  entry('article', 'Article', 'A written piece for a provider blog.'),
  entry('tutorial', 'Tutorial', 'Step-by-step instructions the reader follows along.'),
  entry('documentation', 'Documentation page', 'Reference material kept current over time.'),
  entry('course-lesson', 'Course lesson', 'One lesson inside a course or study guide.'),
  entry('lab', 'Lab', 'A hands-on exercise with an environment to work in.'),
  entry('newsletter', 'Newsletter', 'An issue or a block destined for the newsletter.'),
  entry('social-post', 'Social post', 'A short post for LinkedIn, X or another network.'),
  entry('video-script', 'Video script', 'The spoken script for a recorded video.'),
  entry('podcast-script', 'Podcast script', 'A two-host dialogue for a podcast episode.'),
  entry('audiobook-chapter', 'Audiobook chapter', 'A chapter of a book or course read aloud.'),
  entry('training-audio', 'Training audio', 'Spoken training material outside a book.'),
  entry('event-announcement', 'Event announcement', 'A talk, webinar or meetup to promote.'),
  entry('case-study', 'Case study', 'A real engagement, its problem and its outcome.'),
  entry('white-paper', 'White paper', 'A longer argued document on one topic.'),
  entry('landing-page', 'Landing page', 'A page built to introduce one thing.'),
  entry('reference-guide', 'Reference guide', 'A framework, blueprint or lookup table.'),
  entry('certification-content', 'Certification content', 'Material tied to an exam objective.'),
  entry('speaker-content', 'Speaker content', 'An abstract, slides or notes for a talk.'),
  entry('ambassador-evidence', 'Ambassador evidence', 'Proof of community contribution.'),
  entry('image-set', 'Image set', 'A coordinated set of images on one theme.'),
]);

export const DEFAULT_IDEA_ORIGINS = Object.freeze([
  entry('manual', 'Manually entered', 'Someone typed the idea in.'),
  entry('content-gap', 'Content gap', 'Something the site should cover and does not.'),
  entry('search-trend', 'Search trend', 'People are searching for it.'),
  entry('audience-question', 'Audience question', 'A reader, viewer or attendee asked.'),
  entry('content-refresh', 'Existing content refresh', 'An older piece needs updating.'),
  entry('support-request', 'Support request', 'A ticket or question from a client.'),
  entry('product-update', 'Product update', 'A vendor shipped or changed something.'),
  entry('conference', 'Conference or event', 'Prompted by a talk, booth or hallway chat.'),
  entry('certification-objective', 'Certification objective', 'Maps to an exam skill.'),
  entry('speaker-engagement', 'Speaker engagement', 'Material for or from a speaking slot.'),
  entry('ambassador-requirement', 'Ambassador requirement', 'Needed for a program application.'),
  entry('ai-recommendation', 'AI recommendation', 'Suggested by the forge or an assistant.'),
  entry('imported-source', 'Imported source', 'Drafted from a URL or document someone imported.'),
  entry('rss-feed', 'RSS or external feed', 'Arrived through a subscribed feed.'),
  entry('recording', 'Recording', 'Started as a Plaud or uploaded recording.'),
  entry(
    'performance-insight',
    'Performance insight',
    'Earlier content did well and warrants more.'
  ),
  entry('repurposing', 'Content repurposing', 'Reshaped from something already published.'),
  entry('team-request', 'Team request', 'A colleague asked for it.'),
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
