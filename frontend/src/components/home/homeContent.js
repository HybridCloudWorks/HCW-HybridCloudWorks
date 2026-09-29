/**
 * Where the home page's numbers and lists come from (2026-09-29).
 *
 * EVERY VALUE HERE IS READ, NONE IS TYPED. The home page carried a stat row
 * (24+ blueprints, 104+ articles, 22+ modules, 99.9% uptime), a "Latest from
 * the providers" list of ten sample headlines stamped "2 HRS AGO", and a
 * design carousel whose Azure, Google Cloud and FinOps cards opened
 * "Architecture Not Found". None of it was derived from anything. What
 * replaced it:
 *
 *   - Blueprints: the `staticBlueprints` every `pages/<provider>/
 *     architecture-blueprints.js` exports, which is the array each
 *     architecture page renders and the one the pre-renderer counts for the
 *     sitemap. The carousel shows those same blueprints.
 *   - Articles, and the latest list: the published content the blog pages
 *     read, from `GET public/content` in the browser (see LatestArticles).
 *   - Modules and uptime: gone. The Terraform modules page lists six cards,
 *     not 22, and the availability probe reports to monitoring the visitor
 *     cannot see, so there is no figure the page could truthfully show.
 */
import { routes } from '@/lib/routeFactory';
import { normalizeContentFields, stripHtmlTags } from '@/lib/blogUtils';
import { getCanonicalContentType, getContentPublicPath } from '@/lib/contentModel';
import { canonicalizeProvider } from '@/lib/providers';
import { toMillis } from '@/lib/dateUtils';

// Eager: the counts are needed for the first render, which the pre-renderer
// captures. Each module is plain data, a few kilobytes in all.
const BLUEPRINT_MODULES = import.meta.glob('/src/pages/*/architecture-blueprints.js', {
  eager: true,
  import: 'staticBlueprints',
});

/** `{ aws: [...], azure: [...], ... }`, providers in path order. */
export const BLUEPRINTS_BY_PROVIDER = Object.freeze(
  Object.fromEntries(
    Object.entries(BLUEPRINT_MODULES)
      .map(([file, blueprints]) => [file.split('/').at(-2), blueprints || []])
      .sort(([a], [b]) => a.localeCompare(b))
  )
);

/** How many reference blueprints the architecture pages show, all providers together. */
export const BLUEPRINT_COUNT = Object.values(BLUEPRINTS_BY_PROVIDER).reduce(
  (sum, blueprints) => sum + blueprints.length,
  0
);

/**
 * The carousel's cards: every blueprint, one provider after another, so any
 * four in a row come from different providers while each has blueprints left.
 *
 * A blueprint with a `slug` has a page of its own (AWS's six, which
 * `data/architectures.js` backs); the rest open their provider's architecture
 * page, which is where they are shown. Nothing links to a page that is not
 * there.
 */
export function blueprintCards(byProvider = BLUEPRINTS_BY_PROVIDER) {
  const lists = Object.entries(byProvider).filter(([, blueprints]) => blueprints.length > 0);
  const longest = Math.max(0, ...lists.map(([, blueprints]) => blueprints.length));
  const cards = [];
  for (let index = 0; index < longest; index += 1) {
    for (const [provider, blueprints] of lists) {
      const blueprint = blueprints[index];
      if (!blueprint) continue;
      const page = routes.architectureDesigns(provider);
      cards.push({
        key: `${provider}:${blueprint.slug || blueprint.id || blueprint.title}`,
        provider,
        title: blueprint.title,
        category: blueprint.category,
        icon: blueprint.icon,
        to: blueprint.slug ? `${page}/${blueprint.slug}` : page,
      });
    }
  }
  return cards;
}

/** How many published items the home page asks for, and shows at most. */
export const LATEST_LIMIT = 6;

const TYPE_LABELS = Object.freeze({
  blog: 'Article',
  news: 'News',
  framework: 'Framework',
  architecture: 'Architecture',
  coder_corner: 'Code',
});

/** The same field order the blog list reads a published date from (useBlogData). */
function publishedMillis(doc) {
  for (const value of [
    doc.publishedDate,
    doc.datePublished,
    doc['Published At'],
    doc.blogPublishedAt,
    doc.publishedAt,
  ]) {
    const ms = toMillis(value);
    if (ms) return ms;
  }
  return 0;
}

/** "Jun 8, 2026". Fixed locale and zone, so every visitor reads the same day. */
export function formatPublishedDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Published documents, newest first as the server sends them, reduced to what
 * a card shows. A document with no page to open (no provider or no slug) or no
 * title is left out rather than shown as a dead card, and a page listed twice
 * is shown once.
 */
export function toLatestItems(docs = [], limit = LATEST_LIMIT) {
  const seen = new Set();
  const items = [];
  for (const raw of docs || []) {
    if (items.length >= limit) break;
    const doc = normalizeContentFields(raw);
    const path = getContentPublicPath(raw);
    const title = stripHtmlTags(doc?.title || '').trim();
    if (!path || !title || seen.has(path)) continue;
    seen.add(path);
    const published = publishedMillis(raw);
    items.push({
      path,
      title,
      summary: stripHtmlTags(doc.summary || '').trim(),
      provider: canonicalizeProvider(doc.cloudProvider),
      typeLabel: TYPE_LABELS[getCanonicalContentType(raw)] || 'Article',
      publishedIso: published ? new Date(published).toISOString() : '',
      publishedLabel: formatPublishedDate(published),
    });
  }
  return items;
}
