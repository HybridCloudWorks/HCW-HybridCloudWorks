/**
 * How many published items each `/<provider>/<section>` page has, so the
 * pre-render can keep a section with nothing in it out of `sitemap.xml`
 * (issue #373).
 *
 * ## Why this is server-side
 *
 * `scripts/build-content-manifest.mjs` counted `framework` items itself, from
 * the corpus this route already returns. That works for exactly one section:
 * frameworks read the `content` container and nothing else. Every other
 * section page reads something the builder cannot see —
 *
 *   - `blog`, `coder-corner` and `code` fall back to the legacy `blogs`
 *     container when `content` has nothing for that provider
 *     (useBlogData.js, useCoderCornerData.js, useFrameworkData.js). Measured
 *     2026-09-07: `blogs` holds five published documents and every one of
 *     them is a slug-duplicate of a `content` document, so the fallback
 *     currently puts nothing on any page — but it is reached on precisely the
 *     providers this whole mechanism declares empty, so a count that read
 *     `content` alone would be a count of a different set of documents than
 *     the page reads. Retiring the fallback is a separate decision about
 *     data; counting both containers is correct either way, and costs one
 *     bounded query.
 *   - `audio` and `audio-architecture` read `podcasts` and
 *     `listen_and_learn_episodes` (useAudioEpisodes.js), neither of which is
 *     content at all.
 *
 * So the counting moves to the app, which already holds Cosmos access to all
 * four containers, and the builder fetches the answer with the corpus.
 *
 * ## The counts mean what the page shows
 *
 * Each rule below mirrors one hook, filter for filter — the same public
 * predicate (`isPublicDocument`, not this route's own `PUBLISHED_PREDICATE`,
 * which answers a different question for a different consumer), the same type
 * test, the same provider matching. The one liberty taken is that a section's
 * two containers are SUMMED where the hook prefers `content` and falls back to
 * `blogs`. The sum differs from what the page displays whenever both hold
 * items — but it is zero exactly when the page is empty, and zero is the only
 * value anything acts on.
 *
 * ## Nothing here is allowed to guess
 *
 * A zero drops a URL out of the sitemap, so a zero that is really an "I don't
 * know" is the expensive mistake. Two guards:
 *
 *   - `_unattributed` counts items of a section's type that name no
 *     recognised provider, for the sections whose page INFERS a provider from
 *     titles, summaries and URLs when the document does not carry one
 *     (`blog`, `frameworks`). Such an item can surface on any provider's
 *     page, so while one exists no provider's zero for that section is
 *     trusted — `sitemapRoutes` in frontend/scripts/prerender.mjs reads the
 *     bucket for exactly that. The remaining sections filter on a stored
 *     field in SQL (`c.provider = @provider`, or the `Cloud Provider` alias
 *     match), so an item naming no recognised provider is fetched by no page
 *     and is deliberately counted nowhere: putting it in `_unattributed`
 *     would block sixteen audio pages on behalf of two podcast rows that no
 *     visitor can reach.
 *
 *     `provider: 'main'` on a `podcasts` row is not such a row and must not be
 *     mistaken for one. It is the site's own show: the listing returns it to
 *     every provider and every provider's audio page shows it, so it is
 *     counted for each of them BY NAME rather than parked in the "could
 *     surface anywhere" bucket. `_unattributed` says we do not know which
 *     pages an item reaches; for the show we do.
 *   - `countSections` returns null when any query fills its window, because a
 *     truncated read cannot tell an absent item from an unread one. The route
 *     then answers `sections: null` — the key is present and null, not absent,
 *     which is the same thing a caller sees either way because the consumer
 *     tests the VALUE: `serverSections()` in scripts/build-content-manifest.mjs
 *     treats null, and anything else that is not a plain object, as "no counts
 *     from the route" and falls back to its own frameworks-only count. A
 *     deployed revision predating the field omits the key entirely and lands in
 *     the same branch, which is why the two cases need no telling apart.
 */
import {
  MAIN_PODCAST_PROVIDER,
  PROVIDER_ALIASES,
  SQL_NOT_SOFT_DELETED,
  SQL_PUBLIC_CLAUSE,
  isPodcastMediaRetired,
  isPublicDocument,
  isSoftDeleted,
} from './public-reads.js';

/**
 * The providers with `/<provider>/<section>` pages, derived from the alias
 * table rather than listed again: that table is what the public list endpoint
 * matches a document's provider against, so a provider it does not know has no
 * content-backed page to count for. Mirrors VALID_PROVIDERS in
 * frontend/src/context/ProviderContext.jsx.
 */
export const PROVIDERS = Object.freeze(Object.keys(PROVIDER_ALIASES));

/** The bucket for items that could still surface on some provider's page. */
export const UNATTRIBUTED = '_unattributed';

/**
 * The sections counted, and whether their page can infer a provider.
 *
 * `providerInferred` is not a style choice; it decides whether an item with no
 * recognised provider blocks that section's zeros. See the header.
 *
 *   blog                — ProviderBlogPage / useBlogData: the whole corpus,
 *                         everything except architecture and framework types,
 *                         provider inferred from explicit fields, then the
 *                         curated path, then URLs, then title and summary text.
 *   frameworks          — useFrameworkData: type framework, same inference.
 *   coder-corner, code  — useCoderCornerData: type coder_corner, provider sent
 *                         to the API and matched there against PROVIDER_ALIASES.
 *                         Both sections render the same query for the same
 *                         provider (ProviderCodeDispatcher in App.jsx), so they
 *                         carry the same number.
 *   audio,              — useAudioEpisodes: podcasts and Listen & Learn rows
 *   audio-architecture    for that provider, plus every episode of the site's
 *                         own show, which the listing returns to all of them.
 *                         Both routes render
 *                         SharedPodcastPage for the provider in the path, so
 *                         they too carry the same number.
 *
 * `architecture-designs` is deliberately NOT here, and the reason is worth
 * writing down because the section looks exactly like the others. Its pages
 * merge API documents with `staticBlueprints`, a list hardcoded in each
 * provider's ArchitecturePage.jsx: on 2026-09-07 the whole corpus held ONE
 * architecture document and four of the five architecture pages rendered
 * fine, so a count of zero says nothing about whether that page is empty.
 * `/vmware/architecture-designs` — the one that is — has to leave the sitemap
 * some other way.
 */
export const SECTIONS = Object.freeze({
  blog: { providerInferred: true },
  frameworks: { providerInferred: true },
  'coder-corner': { providerInferred: false },
  code: { providerInferred: false },
  audio: { providerInferred: false },
  'audio-architecture': { providerInferred: false },
});

/** Sections whose items come from `content` and `blogs`, keyed by type test. */
const CONTENT_SECTION_TYPES = Object.freeze({
  // Everything the blog listing does NOT exclude — including a document with
  // no type at all, which useBlogData renders (EXCLUDED_TYPES is a denylist).
  blog: (type) => type !== 'architecture' && type !== 'framework',
  frameworks: (type) => type === 'framework',
  'coder-corner': (type) => type === 'coder_corner',
  code: (type) => type === 'coder_corner',
});

/** Sections served by the two audio containers. */
const AUDIO_SECTIONS = Object.freeze(['audio', 'audio-architecture']);

/** Container this reads for Listen & Learn; mirrors public-reads.js. */
export const LISTEN_AND_LEARN_EPISODE_CONTAINER = 'listen_and_learn_episodes';
const LISTEN_AND_LEARN_PUBLISHED_STATUS = 'published';

/** `Azure` -> `azure`, exactly as the list endpoint's ARRAY_CONTAINS does. */
const PROVIDER_BY_LABEL = new Map(
  Object.entries(PROVIDER_ALIASES).flatMap(([provider, labels]) =>
    labels.map((label) => [label, provider])
  )
);

/**
 * Every provider a content document is filed under.
 *
 * A LIST, not one value, because the endpoint's filter is an OR across two
 * fields: a document whose `Cloud Provider` and `cloudProvider` disagree is
 * returned for both providers and appears on both pages. Counting it once
 * would leave one of those pages with a zero it does not deserve.
 *
 * Matching is exact against the alias spellings, again because that is what
 * the SQL does. A document reading `AZURE` is returned for nobody, so it is
 * unattributed here too.
 */
export function providersOfContent(doc) {
  const found = new Set();
  for (const field of ['Cloud Provider', 'cloudProvider']) {
    const provider = PROVIDER_BY_LABEL.get(doc?.[field]);
    if (provider) found.add(provider);
  }
  return [...found];
}

/** Every provider and section at zero — the shape a caller adds into. */
export function emptySections() {
  const sections = {};
  for (const provider of [...PROVIDERS, UNATTRIBUTED]) {
    sections[provider] = Object.fromEntries(Object.keys(SECTIONS).map((s) => [s, 0]));
  }
  return sections;
}

/**
 * Add one container's worth of `content`-shaped documents.
 *
 * `isPublicDocument` runs again here even though the query asserts it: the SQL
 * is written wide on purpose (see SQL_PUBLIC_CLAUSE) and the JS filter is the
 * authority everywhere else in the public read path.
 */
export function countContentDocs(sections, docs) {
  for (const doc of docs || []) {
    if (!isPublicDocument(doc)) continue;
    const type = String(doc?.type ?? '')
      .trim()
      .toLowerCase();
    const providers = providersOfContent(doc);
    for (const [section, matchesType] of Object.entries(CONTENT_SECTION_TYPES)) {
      if (!matchesType(type)) continue;
      if (providers.length > 0) {
        for (const provider of providers) sections[provider][section] += 1;
      } else if (SECTIONS[section].providerInferred) {
        sections[UNATTRIBUTED][section] += 1;
      }
    }
  }
  return sections;
}

/**
 * Add `podcasts` rows, with the two filters the public listing applies: a
 * soft-deleted row, and a row whose media host has been retired (#372), are
 * both absent from the page and must be absent from the count.
 *
 * An episode of the site's own show (`provider === 'main'`) counts for EVERY
 * provider, because the listing returns it to every provider and the page
 * leads with it — `c.provider IN (@provider, @mainProvider)` in
 * `listPodcasts`. This is the one rule here that adds an item to more than one
 * page without the document naming more than one provider, and it is the same
 * principle as `providersOfContent` returning a list: the count is of what the
 * page shows, and this page shows the show.
 */
export function countPodcastDocs(sections, docs) {
  for (const doc of docs || []) {
    if (isSoftDeleted(doc) || isPodcastMediaRetired(doc)) continue;
    if (doc?.provider === MAIN_PODCAST_PROVIDER) {
      for (const provider of PROVIDERS) addAudioRow(sections, provider);
      continue;
    }
    addAudioRow(sections, doc?.provider);
  }
  return sections;
}

/**
 * Add published Listen & Learn episodes. An episode with no `audioUrl` is
 * omitted by the listing — a podcast row that plays nothing — so it is not an
 * item this page has.
 */
export function countListenAndLearnDocs(sections, docs) {
  for (const doc of docs || []) {
    if (isSoftDeleted(doc)) continue;
    if (doc?.status !== LISTEN_AND_LEARN_PUBLISHED_STATUS) continue;
    if (typeof doc?.audioUrl !== 'string' || doc.audioUrl === '') continue;
    addAudioRow(sections, doc?.provider);
  }
  return sections;
}

/**
 * Both audio containers key on the lowercase route slug in SQL, so an exact
 * match against a known provider is the whole of the rule here — and a row
 * carrying anything else is reachable from no page, which is why it is dropped
 * rather than counted as unattributed. The site's show is the one value that
 * is neither: `countPodcastDocs` resolves it to every provider before calling
 * this, so what arrives is always a provider slug.
 */
function addAudioRow(sections, rawProvider) {
  if (!PROVIDERS.includes(rawProvider)) return;
  for (const section of AUDIO_SECTIONS) sections[rawProvider][section] += 1;
}

/**
 * The read ceiling, and the reason it is not just a big number.
 *
 * Every other bound in the public read path guards a RESPONSE: truncating it
 * costs a visitor some rows. This one guards a COUNT, and a truncated count is
 * not a smaller answer, it is a wrong one — the rows that fell outside the
 * window are indistinguishable from rows that do not exist, and a provider
 * whose only items were cut reads as zero and loses its URL from the sitemap.
 * So `countSections` refuses rather than truncating, and the window is set far
 * above the corpus (~1k documents in `content`, per public-reads.js) with a
 * projection of a handful of fields per row.
 */
export const SECTION_COUNT_WINDOW = 5000;

/** `c["Cover Image"]`-style quoting handles the spaced and cased names. */
const project = (fields) => fields.map((field) => `c["${field}"]`).join(', ');

/**
 * The visibility fields ride along because `isPublicDocument` and
 * `isSoftDeleted` read them after the projection has already happened.
 * Nothing else is fetched: this is a counting read, and article bodies would
 * make it the most expensive query in the app.
 */
export const CONTENT_COUNT_FIELDS = Object.freeze([
  'type',
  'Cloud Provider',
  'cloudProvider',
  'Live',
  'Status',
  'contentStatus',
  'softDeletedAt',
  'softDeleteExpiresAt',
]);

export const CONTENT_COUNT_QUERY =
  `SELECT TOP ${SECTION_COUNT_WINDOW} ${project(CONTENT_COUNT_FIELDS)} FROM c ` +
  `WHERE ${SQL_PUBLIC_CLAUSE} AND ${SQL_NOT_SOFT_DELETED}`;

export const PODCAST_COUNT_FIELDS = Object.freeze([
  'provider',
  'mediaUrl',
  'mediaUnavailableAt',
  'softDeletedAt',
  'softDeleteExpiresAt',
]);

export const PODCAST_COUNT_QUERY = `SELECT TOP ${SECTION_COUNT_WINDOW} ${project(PODCAST_COUNT_FIELDS)} FROM c`;

export const LISTEN_AND_LEARN_COUNT_FIELDS = Object.freeze([
  'provider',
  'status',
  'audioUrl',
  'softDeletedAt',
  'softDeleteExpiresAt',
]);

export const LISTEN_AND_LEARN_COUNT_QUERY =
  `SELECT TOP ${SECTION_COUNT_WINDOW} ${project(LISTEN_AND_LEARN_COUNT_FIELDS)} FROM c ` +
  'WHERE c.status = @status';

/**
 * The four reads, as one map of counts — or null when any of them filled its
 * window and the answer would be a guess.
 *
 * @param {{ store: { queryDocs: Function } }} deps
 * @returns {Promise<object|null>}
 */
export async function countSections({ store }) {
  const [content, blogs, podcasts, episodes] = await Promise.all([
    store.queryDocs('content', CONTENT_COUNT_QUERY, []),
    store.queryDocs('blogs', CONTENT_COUNT_QUERY, []),
    store.queryDocs('podcasts', PODCAST_COUNT_QUERY, []),
    store.queryDocs(LISTEN_AND_LEARN_EPISODE_CONTAINER, LISTEN_AND_LEARN_COUNT_QUERY, [
      { name: '@status', value: LISTEN_AND_LEARN_PUBLISHED_STATUS },
    ]),
  ]);

  const rows = [content, blogs, podcasts, episodes].map((r) => (Array.isArray(r) ? r : []));
  if (rows.some((r) => r.length >= SECTION_COUNT_WINDOW)) return null;

  const sections = emptySections();
  countContentDocs(sections, rows[0]);
  countContentDocs(sections, rows[1]);
  countPodcastDocs(sections, rows[2]);
  countListenAndLearnDocs(sections, rows[3]);
  return sections;
}
