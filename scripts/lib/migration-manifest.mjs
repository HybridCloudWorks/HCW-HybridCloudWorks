/**
 * migration-manifest.mjs
 *
 * The single source of truth for the Firestore → Cosmos DB data migration.
 *
 * Every other piece of migration tooling — the preflight inventory, the
 * migrator, the verifier, and the Terraform container list — is derived from
 * this file. If a collection is not described here, it does not get migrated,
 * and the preflight will flag it loudly rather than let it disappear quietly.
 *
 * Source of the inventory: `platform/firebase/firestore.rules` in
 * HybridCloudWorks/Site-Main (65 top-level `match` blocks) cross-checked
 * against `collection(...)` call sites in that repo's `src/`, `functions/` and
 * `scripts/`. Reviewed at Site-Main commit 07f3123.
 *
 * ---------------------------------------------------------------------------
 * Dispositions
 * ---------------------------------------------------------------------------
 *   migrate   — copy the documents across. The default.
 *   reseed    — seed data; re-created on the far side by a seeding script, so
 *               migrating it only imports drift. Container still provisioned.
 *   regenerate— cache; a scheduled job refills it. Do not migrate.
 *   transient — in-flight job/quota records with no value after cutover.
 *   probe     — declared in firestore.rules but with no code that writes it.
 *               The preflight decides: 0 docs → drop, >0 docs → promote to
 *               `migrate` and work out where they came from before cutover.
 *
 * Provisioning and migrating are separate questions. A cache or a transient
 * job record does not get its *data* copied, but the runtime still writes to
 * it — `functions/src/functions/labs-http.js` reads and writes `lab_jobs` on
 * every request — so the container must exist. Everything except `probe` gets
 * a container; only `migrate` gets documents.
 *
 * ---------------------------------------------------------------------------
 * Partition keys
 * ---------------------------------------------------------------------------
 * Every container is partitioned on `/id`, deliberately:
 *
 *   1. `functions/src/lib/cosmos-client.js` defaults the partition key to the
 *      document id in both `readDoc()` and `deleteDoc()`
 *      (`container.item(id, partitionKey || id)`). Any container partitioned
 *      on something else silently 404s on every point read that does not pass
 *      an explicit key — and no caller passes one today.
 *   2. The whole dataset is ~1,100 small documents. There is no partition to
 *      spread; the only thing a partition key buys us at this size is cheap
 *      point reads, which `/id` gives us and a low-cardinality key does not.
 *   3. The Firestore composite indexes that describe the real query load
 *      (`(Live, scheduledPublishDate)`, `(type, Live, publishedAt)`) do not
 *      filter on a provider or an owner, so a "natural" partition key would
 *      fan out on the list queries *and* on the point reads.
 *
 * A partition key path is immutable once the container exists. Changing one
 * later means recreating the container and re-importing. See
 * `docs/data-migration/README.md` for the full rationale.
 */

/**
 * Top-level collections.
 *
 * @type {Array<{
 *   name: string,
 *   disposition: 'migrate'|'reseed'|'regenerate'|'transient'|'probe',
 *   note?: string,
 *   subcollections?: Array<{ name: string, container: string, note?: string }>
 * }>}
 */
export const COLLECTIONS = [
  // --- Content -------------------------------------------------------------
  {
    name: 'content',
    disposition: 'migrate',
    note: 'The real one. ~947 docs. Carries the largest field payloads (contentMarkdown/contentHtml).',
    subcollections: [
      {
        name: 'versions',
        container: 'content_versions',
        note: 'Editor version history. Written server-side; read by VersionHistoryDialog.jsx. Not covered by an explicit rules match.',
      },
    ],
  },
  {
    name: 'blogs',
    disposition: 'migrate',
    note: 'Legacy, ~242 docs, reached only via a fallback path. Migration_Plan §3.6 decides whether this ships at all — until that decision lands, migrate it.',
  },
  { name: 'content_templates', disposition: 'migrate' },
  { name: 'certifications', disposition: 'migrate', note: '~110 docs, partly machine-generated from Microsoft Learn.' },
  { name: 'certEvents', disposition: 'migrate' },
  { name: 'speakerevents', disposition: 'migrate', note: '~18 docs.' },
  { name: 'podcasts', disposition: 'migrate' },
  { name: 'episodes', disposition: 'migrate', note: 'Top-level `episodes`. Distinct from listen_and_learn/{setId}/episodes.' },
  { name: 'youtubevideos', disposition: 'migrate' },
  { name: 'recordings', disposition: 'migrate' },
  { name: 'newsletters', disposition: 'probe', note: 'One call site, no rules match.' },
  { name: 'roadmap_items', disposition: 'migrate' },
  { name: 'wiki_pages', disposition: 'migrate' },
  {
    name: 'listen_and_learn',
    disposition: 'migrate',
    subcollections: [{ name: 'episodes', container: 'listen_and_learn_episodes' }],
  },

  // --- Architecture / frameworks -------------------------------------------
  { name: 'designs', disposition: 'migrate' },
  { name: 'frameworks', disposition: 'migrate' },
  { name: 'pillar_details', disposition: 'migrate' },
  { name: 'pillar_items', disposition: 'migrate' },
  { name: 'azure_landing_content', disposition: 'probe', note: 'One call site, no rules match.' },
  { name: 'articles', disposition: 'probe', note: 'One call site, no rules match. Possibly superseded by `content`.' },

  // --- Identity and configuration ------------------------------------------
  {
    name: 'admins',
    disposition: 'migrate',
    note: 'AUTHORISATION-CRITICAL. firestore.rules isAdmin() reads this collection; client access is explicitly denied. Losing it locks every admin out of the Azure deployment. Was absent from the previous COLLECTION_MAP.',
  },
  { name: 'admin_config', disposition: 'migrate', note: 'ContentForge config (forge_profile, forge_prompts).' },
  { name: 'admin_settings', disposition: 'migrate' },
  { name: 'site_settings', disposition: 'migrate' },
  { name: 'system', disposition: 'migrate' },
  { name: 'metadata', disposition: 'probe', note: 'One call site, no rules match.' },
  {
    name: 'users',
    disposition: 'probe',
    note: 'Has a rules match but zero collection() call sites in Site-Main. The previous COLLECTION_MAP migrated it unconditionally. Preflight decides.',
  },
  {
    name: 'config',
    disposition: 'migrate',
    note:
      'TRAP: `config` holds no documents of its own. firestore.rules matches ' +
      '`config/providers/{providerId}`, `config/tags/{tagId}` and ' +
      '`config/settings/{settingId}` — the payload lives in three ' +
      'subcollections under three (possibly non-existent) parent documents. ' +
      '`firestore.collection("config").get()` returns zero docs, so the ' +
      'previous script migrated nothing here and the count check passed at 0=0.',
    subcollections: [
      { name: 'providers', container: 'config_providers', parentDoc: 'providers' },
      { name: 'tags', container: 'config_tags', parentDoc: 'tags' },
      { name: 'settings', container: 'config_settings', parentDoc: 'settings' },
    ],
  },

  // --- Audit ---------------------------------------------------------------
  { name: 'audits', disposition: 'migrate' },
  { name: 'admin_audit_logs', disposition: 'migrate' },
  { name: '_snapshots', disposition: 'migrate', note: 'Leading underscore is legal in Cosmos container names.' },

  // --- Social --------------------------------------------------------------
  { name: 'social_posts', disposition: 'migrate', note: '~15 docs.' },
  { name: 'social_workspaces', disposition: 'migrate' },
  { name: 'social_libraries', disposition: 'migrate' },
  { name: 'social_library_items', disposition: 'migrate' },
  { name: 'social_schedule_slots', disposition: 'migrate' },
  { name: 'social_analytics', disposition: 'migrate' },
  { name: 'telegram_bot_activity', disposition: 'migrate' },
  { name: 'plaud_ingest', disposition: 'probe', note: 'One call site, no rules match.' },

  // --- AI / prompts / images -----------------------------------------------
  { name: 'ai_providers', disposition: 'migrate' },
  { name: 'ai_insights', disposition: 'migrate' },
  { name: 'ai_usage', disposition: 'migrate' },
  { name: 'mcp_servers', disposition: 'migrate' },
  { name: 'prompts', disposition: 'migrate' },
  { name: 'prompt_keyword_synonyms', disposition: 'migrate' },
  { name: 'prompt_keyword_augmentations', disposition: 'migrate' },
  {
    name: 'image_prompts',
    disposition: 'migrate',
    subcollections: [
      {
        name: 'sets',
        container: 'image_prompts_sets',
        note: 'Deliberately NOT `image_prompt_sets` — that name is already a distinct top-level collection.',
      },
    ],
  },
  {
    name: 'image_prompt_sets',
    disposition: 'migrate',
    subcollections: [{ name: 'prompts', container: 'image_prompt_sets_prompts' }],
  },
  { name: 'image_prompt_pages', disposition: 'migrate' },
  { name: 'generated_content_images', disposition: 'migrate' },
  { name: 'curated_article_images', disposition: 'migrate' },
  { name: 'character_profiles', disposition: 'migrate' },
  { name: 'character_modules', disposition: 'migrate' },
  { name: 'character_images', disposition: 'migrate' },
  { name: 'character_tag_adjectives', disposition: 'migrate' },
  { name: 'homepage_feeds', disposition: 'probe', note: 'One call site, no rules match.' },

  // --- Workflow ------------------------------------------------------------
  { name: 'workflow_digests', disposition: 'migrate' },
  { name: 'workflow_alerts', disposition: 'migrate' },

  // --- Cloud Tools ---------------------------------------------------------
  {
    name: 'tool_service_catalog',
    disposition: 'reseed',
    note: 'Seed data (~8 docs). Re-seed on the far side rather than import drift.',
  },
  {
    name: 'tool_service_cache',
    disposition: 'regenerate',
    note: 'Cache (~8 docs). The scheduled refresh rebuilds it.',
  },
  { name: 'tool_workspaces', disposition: 'migrate' },
  { name: 'tool_migration_workspaces', disposition: 'migrate' },
  { name: 'tool_assessment_sessions', disposition: 'migrate' },
  { name: 'tool_architecture_plans', disposition: 'migrate' },
  { name: 'tool_exports', disposition: 'migrate' },
  { name: 'tool_export_quota', disposition: 'transient', note: 'Per-user rate-limit counters. Let them reset at cutover.' },
  { name: 'tool_ai_plan_quota', disposition: 'transient', note: 'Per-user rate-limit counters. Let them reset at cutover.' },

  // --- Labs ----------------------------------------------------------------
  { name: 'lab_jobs', disposition: 'transient', note: '~11 in-flight job records. Worthless after cutover.' },
  { name: 'lab_public_quota', disposition: 'transient', note: 'Per-uid rate-limit counters.' },
  { name: 'lab_agents', disposition: 'migrate', note: 'Agent registrations — coordinate with vps-agent before cutover.' },

  // --- Caches --------------------------------------------------------------
  {
    name: 'rss_cache',
    disposition: 'regenerate',
    note: '~24 docs. Regenerable — let the scheduled fetch refill it.',
  },
];

/** Dispositions that result in documents being copied. */
export const MIGRATED_DISPOSITIONS = new Set(['migrate']);

/**
 * Dispositions that need a Cosmos container provisioned.
 *
 * Everything except `probe`: a cache or a quota counter carries no data across
 * the migration, but the runtime writes to it from the first request onwards.
 * `probe` collections stay unprovisioned until the preflight confirms they
 * exist and hold something.
 */
export const PROVISIONED_DISPOSITIONS = new Set(['migrate', 'reseed', 'regenerate', 'transient']);

/**
 * Flatten the manifest into one entry per Cosmos container.
 *
 * Subcollections become their own containers. Firestore's implicit-parent
 * behaviour means a subcollection can hold documents while its parent document
 * does not exist, so subcollections are enumerated with a collection-group
 * query rather than by walking parents.
 *
 * @param {{ includeNonMigrated?: boolean }} [options]
 * @returns {Array<{
 *   container: string,
 *   sourcePath: string,
 *   collectionId: string,
 *   isSubcollection: boolean,
 *   parent: string|null,
 *   disposition: string,
 *   note?: string
 * }>}
 */
export function flattenManifest({ includeNonMigrated = false } = {}) {
  const out = [];

  for (const entry of COLLECTIONS) {
    const keep = includeNonMigrated || MIGRATED_DISPOSITIONS.has(entry.disposition);

    if (keep) {
      out.push({
        container: entry.name,
        sourcePath: entry.name,
        collectionId: entry.name,
        isSubcollection: false,
        parent: null,
        disposition: entry.disposition,
        note: entry.note,
      });
    }

    for (const sub of entry.subcollections ?? []) {
      if (!keep) continue;
      out.push({
        container: sub.container,
        sourcePath: sub.parentDoc
          ? `${entry.name}/${sub.parentDoc}/${sub.name}`
          : `${entry.name}/{parentId}/${sub.name}`,
        collectionId: sub.name,
        isSubcollection: true,
        parent: entry.name,
        parentDoc: sub.parentDoc ?? null,
        disposition: entry.disposition,
        note: sub.note,
      });
    }
  }

  return out;
}

/**
 * The container list Terraform should provision, sorted for a stable diff.
 * `infra/main.tf` reads the same list; keep them in step.
 *
 * @returns {string[]}
 */
export function provisionedContainers() {
  const names = new Set();

  for (const entry of COLLECTIONS) {
    if (!PROVISIONED_DISPOSITIONS.has(entry.disposition)) continue;
    names.add(entry.name);
    for (const sub of entry.subcollections ?? []) names.add(sub.container);
  }

  return [...names].sort();
}

/** Every collection id the source is expected to contain, for preflight diffing. */
export function knownCollectionIds() {
  const ids = new Set();
  for (const entry of COLLECTIONS) {
    ids.add(entry.name);
    for (const sub of entry.subcollections ?? []) ids.add(sub.name);
  }
  return ids;
}

/** Look up a manifest entry by top-level collection name. */
export function findCollection(name) {
  return COLLECTIONS.find((c) => c.name === name) ?? null;
}
