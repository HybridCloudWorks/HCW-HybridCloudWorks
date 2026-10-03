/**
 * Content taxonomy — the two editorial dimensions every content record can
 * carry, kept apart on purpose (ADR 0033 §4):
 *
 *   kind        WHAT the item will become (article, tutorial, newsletter,
 *               audiobook chapter, image set, …). Editorial; it does not
 *               decide where the item publishes — `type`/`publishTarget`
 *               (publish-targets.js) still does that.
 *   ideaOrigin  HOW it became an idea (manual, content gap, audience
 *               question, conference, certification objective, RSS feed, …).
 *
 * Both lists live in one `admin_config` document, `content_taxonomy`, edited
 * on Platform Settings → Content types & origins. Administrators add, rename,
 * reorder and disable entries; a built-in id can be disabled but never
 * removed, so a record classified years ago still resolves to a label.
 *
 * A record with neither field set is classified at read time from what the
 * pipeline already knows — its `type` and its `source` — so nothing needs a
 * backfill and the taxonomy can be adopted one screen at a time.
 */
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';

export const CONTENT_TAXONOMY_CONFIG_ID = 'content_taxonomy';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
const MAX_LABEL = 60;
const MAX_DESCRIPTION = 200;
const MAX_ENTRIES = 60;

const entry = (id, label, description) => Object.freeze({ id, label, description });

/** What an item becomes. The order is the order the pickers show. */
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
  entry('ambassador-evidence', 'Ambassador evidence', 'Proof of community contribution for a program.'),
  entry('image-set', 'Image set', 'A coordinated set of images on one theme.'),
]);

/** How an item became an idea. */
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
  entry('performance-insight', 'Performance insight', 'Earlier content did well and warrants more.'),
  entry('repurposing', 'Content repurposing', 'Reshaped from something already published.'),
  entry('team-request', 'Team request', 'A colleague asked for it.'),
]);

const DEFAULT_KIND_IDS = new Set(DEFAULT_KINDS.map((k) => k.id));
const DEFAULT_ORIGIN_IDS = new Set(DEFAULT_IDEA_ORIGINS.map((o) => o.id));

/** The stored shape when nothing has been saved: every default, enabled, in order. */
export function defaultTaxonomy() {
  const enable = (list) => list.map((item, index) => ({ ...item, enabled: true, order: index }));
  return { kinds: enable(DEFAULT_KINDS), ideaOrigins: enable(DEFAULT_IDEA_ORIGINS) };
}

/** `source` values the pipeline writes → the idea origin they imply. */
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

/** `type` values → the kind they imply when none was chosen. */
const TYPE_TO_KIND = Object.freeze({
  blog: 'article',
  news: 'article',
  framework: 'reference-guide',
  architecture: 'reference-guide',
  coder_corner: 'tutorial',
});

/**
 * The idea origin of a record: the stored one, else what its `source` says,
 * else `manual`. Never null, so a list can always group by it.
 */
export function resolveIdeaOrigin(item = {}) {
  const stored = String(item.ideaOrigin || '').trim();
  if (stored) return stored;
  const source = String(item.source || '').trim();
  return SOURCE_TO_ORIGIN[source] || 'manual';
}

/** The kind of a record: the stored one, else what its `type` says. */
export function resolveKind(item = {}) {
  const stored = String(item.kind || '').trim();
  if (stored) return stored;
  const type = String(item.type || item.contentType || item.publishTarget || 'blog')
    .trim()
    .toLowerCase();
  return TYPE_TO_KIND[type] || 'article';
}

class TaxonomyError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}
const fail = (message) => {
  throw new TaxonomyError(message);
};

function normalizeList(list, { field, requiredIds }) {
  if (!Array.isArray(list)) fail(`${field} must be an array`);
  if (list.length > MAX_ENTRIES) fail(`${field} may hold at most ${MAX_ENTRIES} entries`);
  const seen = new Set();
  const out = list.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail(`${field}[${index}] must be an object`);
    }
    const id = String(raw.id ?? '').trim();
    if (!ID_PATTERN.test(id)) {
      fail(`${field}[${index}].id must be 2-40 lower-case letters, digits or hyphens`);
    }
    if (seen.has(id)) fail(`${field} lists ${id} twice`);
    seen.add(id);
    const label = String(raw.label ?? '').trim();
    if (!label || label.length > MAX_LABEL) {
      fail(`${field}.${id}.label must be 1-${MAX_LABEL} characters`);
    }
    const description = String(raw.description ?? '').trim();
    if (description.length > MAX_DESCRIPTION) {
      fail(`${field}.${id}.description must be at most ${MAX_DESCRIPTION} characters`);
    }
    if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
      fail(`${field}.${id}.enabled must be true or false`);
    }
    return { id, label, description, enabled: raw.enabled !== false, order: index };
  });
  for (const required of requiredIds) {
    if (!seen.has(required)) {
      fail(`${field} must keep the built-in entry ${required}; disable it instead of removing it`);
    }
  }
  return out;
}

/**
 * Validate a save. Every built-in id must still be present (disabled is
 * fine); order is the array order; unknown keys are refused.
 */
export function normalizeContentTaxonomy(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('body must be an object');
  const unknown = Object.keys(body).filter((key) => key !== 'kinds' && key !== 'ideaOrigins');
  if (unknown.length) fail(`unknown keys: ${unknown.join(', ')}`);
  return {
    kinds: normalizeList(body.kinds, { field: 'kinds', requiredIds: DEFAULT_KIND_IDS }),
    ideaOrigins: normalizeList(body.ideaOrigins, {
      field: 'ideaOrigins',
      requiredIds: DEFAULT_ORIGIN_IDS,
    }),
  };
}

/**
 * Read the taxonomy the way a consumer does: the stored document if it
 * validates, else the defaults. `store.readDoc` is the Cosmos client's.
 */
export async function resolveContentTaxonomy(store) {
  try {
    const doc = await store.readDoc(
      'admin_config',
      CONTENT_TAXONOMY_CONFIG_ID,
      ADMIN_CONFIG_PARTITION
    );
    if (!doc) return defaultTaxonomy();
    return normalizeContentTaxonomy({ kinds: doc.kinds, ideaOrigins: doc.ideaOrigins });
  } catch {
    return defaultTaxonomy();
  }
}
