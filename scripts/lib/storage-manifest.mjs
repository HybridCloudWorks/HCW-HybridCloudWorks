/**
 * storage-manifest.mjs
 *
 * The single source of truth for the Firebase Storage → Azure Blob migration,
 * the way migration-manifest.mjs is for Firestore → Cosmos.
 *
 * Site-Main writes to exactly one GCS bucket. Its objects are organised by
 * first path segment, and `platform/firebase/storage.rules` there grants access
 * per segment. This file maps each segment to an Azure container and a blob
 * prefix, and says which ones move.
 *
 * ---------------------------------------------------------------------------
 * Where the mapping comes from
 * ---------------------------------------------------------------------------
 * `functions/src/lib/gallery-images.js` on this side states the contract: the
 * Azure containers Terraform creates carry THE SAME NAMES as the GCS path
 * prefixes for `blogs`, `covers`, `certifications`, `speakerevents` and
 * `content` — first segment selects the container, the rest is the blob name.
 * `parseStorageRef()` there reads both legacy Google URL shapes and maps a
 * known prefix across; anything else returns null.
 *
 * Every other prefix therefore has to land somewhere explicit. The port's
 * upload path (`ImageGalleryPage.jsx` → container `content`, blob
 * `image-gallery/manual/...`) sets the precedent: unknown families go under
 * `content` with their original prefix PRESERVED, so a legacy path can still
 * be recognised and nothing collides.
 *
 * ---------------------------------------------------------------------------
 * Dispositions
 * ---------------------------------------------------------------------------
 *   migrate   copy the objects.
 *   probe     copy, but report loudly; drop if nothing on Azure reads them.
 *   skip      do not copy, on purpose — the note says why.
 *
 * A prefix found in the bucket that is not listed here fails the inventory
 * with exit code 2, the same contract as the Firestore preflight.
 */

/** Storage containers Terraform creates on the content account (infra/main.tf). */
export const AZURE_CONTAINERS = Object.freeze(['blogs', 'covers', 'certifications', 'speakerevents', 'content']);

/**
 * @typedef {object} PrefixRule
 * @property {string} prefix        GCS prefix, always with a trailing slash
 * @property {'migrate'|'probe'|'skip'} disposition
 * @property {string|null} container   Azure container, or null when skipped
 * @property {string} blobPrefix    what replaces `prefix` in the blob name ('' strips it)
 * @property {string} note
 */

/** @type {readonly PrefixRule[]} Longest prefix first, so `database/certifications/` wins over a bare `database/`. */
export const PREFIXES = Object.freeze([
  {
    prefix: 'database/certifications/',
    disposition: 'migrate',
    container: 'certifications',
    blobPrefix: 'database/',
    note: 'Site-Main fix-svg-content-types.js treats this and certifications/ as one family. `database` is not a known container, so the path is kept under the one it belongs to.',
  },
  // The other two members of the `database/<family>/` pattern, surfaced by the
  // first live inventory (run 32438131444, 2026-08-21): 13 objects between them.
  // Same treatment as database/certifications/ — kept under the family's own
  // container with the `database/` segment preserved, so nothing collides with
  // the top-level family and nothing is orphaned under a container that does
  // not exist.
  {
    prefix: 'database/blogs/',
    disposition: 'migrate',
    container: 'blogs',
    blobPrefix: 'database/',
    note: 'Sibling of database/certifications/. Found by the 2026-08-21 inventory; no storage.rules match at 088f458.',
  },
  {
    prefix: 'database/speakerevents/',
    disposition: 'migrate',
    container: 'speakerevents',
    blobPrefix: 'database/',
    note: 'Sibling of database/certifications/. Found by the 2026-08-21 inventory; no storage.rules match at 088f458.',
  },
  { prefix: 'covers/', disposition: 'migrate', container: 'covers', blobPrefix: '', note: 'AI and uploaded cover images, served via the public media route.' },
  { prefix: 'blogs/', disposition: 'migrate', container: 'blogs', blobPrefix: '', note: 'Legacy blog images, served via the public media route.' },
  { prefix: 'certifications/', disposition: 'migrate', container: 'certifications', blobPrefix: '', note: 'Certification badges, served via the public media route.' },
  { prefix: 'speakerevents/', disposition: 'migrate', container: 'speakerevents', blobPrefix: '', note: 'Event assets, served through the API (container is private).' },
  {
    prefix: 'image-gallery/',
    disposition: 'migrate',
    container: 'content',
    blobPrefix: 'image-gallery/',
    note: 'Matches where the ported ImageGalleryPage uploads new gallery images.',
  },
  { prefix: 'character/', disposition: 'migrate', container: 'content', blobPrefix: 'character/', note: 'Generated character images (character_images collection).' },
  { prefix: 'listen-and-learn/', disposition: 'migrate', container: 'content', blobPrefix: 'listen-and-learn/', note: 'Generated study-podcast audio. Measure size in the inventory before copying.' },
  { prefix: 'draft-images/', disposition: 'migrate', container: 'content', blobPrefix: 'draft-images/', note: 'Admin-only draft images; small.' },
  {
    prefix: 'published-images/',
    disposition: 'migrate',
    container: 'content',
    blobPrefix: 'published-images/',
    note: 'PUBLIC in Firebase Storage. `content` is NOT in PUBLIC_MEDIA_CONTAINERS (functions/src/lib/blob-paths.js), so these are not anonymously reachable after the copy. That is a disclosure decision for the API layer, not for this tool — flagged so it is made rather than discovered.',
  },
  {
    prefix: 'content-submissions/',
    disposition: 'probe',
    container: 'content',
    blobPrefix: 'content-submissions/',
    note: '3 objects under hero/ and secondary1/ — images attached to public content submissions. No Site-Main storage.rules match and no reader found at 088f458; the Azure port (functions/src/lib/submissions.js) decides the path it writes. Owner decides at runbook step 10.',
  },
  {
    prefix: 'designs/',
    disposition: 'probe',
    container: 'content',
    blobPrefix: 'designs/',
    note: '1 object under a single design id — pairs with the 1-document `designs` collection. No storage.rules match at 088f458. Owner decides at runbook step 10.',
  },
  {
    prefix: 'thumbnails/',
    disposition: 'probe',
    container: 'content',
    blobPrefix: 'thumbnails/',
    note: 'Auto-generated thumbnails. If nothing on the Azure side reads them, drop this prefix rather than carry it.',
  },
  {
    prefix: 'articles/',
    disposition: 'skip',
    container: null,
    blobPrefix: '',
    note: 'Scraped article images on a 90-day lifecycle in GCS. Regenerated by the RSS/blog-listing jobs; copying imports staleness. (The equivalent Azure lifecycle rule in infra/main.tf is inert — it matches a container named `articles` that does not exist.)',
  },
  {
    prefix: 'uploads/',
    disposition: 'skip',
    container: null,
    blobPrefix: '',
    note: 'Per-user temporary uploads keyed by Firebase uid. Those uids do not exist on the Azure side.',
  },
]);

/**
 * Classify a GCS object path against the manifest.
 *
 * @param {string} gcsPath  e.g. "covers/abc123/hero.png"
 * @returns {PrefixRule|null}  the matching rule, or null when no prefix matches
 */
export function ruleFor(gcsPath) {
  for (const rule of PREFIXES) {
    if (gcsPath.startsWith(rule.prefix)) return rule;
  }
  return null;
}

/**
 * Map a GCS object path to its Azure destination.
 *
 * @param {string} gcsPath
 * @returns {{ container: string, blobName: string, rule: PrefixRule }|null}
 *   null when the object is skipped by disposition or unmanifested.
 */
export function mapObject(gcsPath) {
  const rule = ruleFor(gcsPath);
  if (!rule || rule.disposition === 'skip') return null;
  const rest = gcsPath.slice(rule.prefix.length);
  if (!rest) return null; // the prefix "directory" marker itself, if one exists
  return { container: rule.container, blobName: `${rule.blobPrefix}${rest}`, rule };
}

/** First path segment of a GCS object, with trailing slash, for grouping unmanifested objects. */
export function topPrefixOf(gcsPath) {
  const i = gcsPath.indexOf('/');
  return i === -1 ? gcsPath : `${gcsPath.slice(0, i)}/`;
}

/** The rules that result in a copy. */
export function copiedPrefixes() {
  return PREFIXES.filter((r) => r.disposition !== 'skip');
}
