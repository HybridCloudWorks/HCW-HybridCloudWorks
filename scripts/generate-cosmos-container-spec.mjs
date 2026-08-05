#!/usr/bin/env node

/**
 * generate-cosmos-container-spec.mjs
 *
 * Renders `infra/cosmos-containers.json` from the migration manifest.
 *
 * Terraform reads that file with `jsondecode(file(...))`, so the manifest is
 * the only place a container list is maintained. Before this existed the list
 * was written out three times — in `infra/main.tf`, in the migrator's
 * COLLECTION_MAP and in the verifier's hardcoded array — and all three had
 * drifted from each other and from the source repository.
 *
 * Usage:
 *   node scripts/generate-cosmos-container-spec.mjs
 *   node scripts/generate-cosmos-container-spec.mjs --check   # CI: fail if stale
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { COLLECTIONS, PROVISIONED_DISPOSITIONS, DEFAULT_PARTITION_KEY } from './lib/migration-manifest.mjs';
import { parseArgs, log } from './lib/cli.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'infra', 'cosmos-containers.json');

let args;
try {
  args = parseArgs(process.argv.slice(2), { flags: ['check'], options: [] });
} catch (err) {
  log.error(err.message);
  process.exit(1);
}

// Partition keys come from the manifest, which carries the evidence for each
// choice. Containers default to /id; content_versions overrides to /contentId
// because every access to version history is scoped to one parent document.

/**
 * Large free-text fields, excluded from indexing so they do not inflate RU
 * cost and index size. Cosmos indexes every property by default.
 */
const LARGE_TEXT_PATHS = [
  '/contentMarkdown/*',
  '/contentHtml/*',
  '/contentPlainText/*',
  '/scraped/*',
];

/** Per-container indexing overrides; everything else gets `/*` fully indexed. */
const INDEXING_OVERRIDES = {
  content: { included: ['/*'], excluded: LARGE_TEXT_PATHS },
  content_versions: { included: ['/*'], excluded: LARGE_TEXT_PATHS },
  blogs: { included: ['/*'], excluded: LARGE_TEXT_PATHS },
  audits: { included: ['/action/?', '/timestamp/?', '/userId/?'], excluded: ['/*'] },
  admin_audit_logs: { included: ['/action/?', '/timestamp/?', '/userId/?'], excluded: ['/*'] },
  lab_jobs: { included: ['/status/?', '/type/?', '/createdAt/?', '/agentId/?'], excluded: ['/*'] },
};

/**
 * Composite indexes, transcribed 1:1 from Site-Main's
 * `platform/firebase/firestore.indexes.json` (18 composites, read at commit
 * 07f3123). That file is a specification of exactly which multi-property sorts
 * the application performs, so it is the right source for these.
 *
 * This is not an optimisation. Cosmos requires a composite index for an
 * ORDER BY over two or more properties — without one the query does not run
 * slowly, it fails. Declaring them up front avoids discovering each missing
 * index as a production error during the API port.
 *
 * Firestore ASCENDING/DESCENDING map to Cosmos ascending/descending. Cosmos
 * also needs the mirrored form for a reversed sort, but the SDK handles the
 * full reversal automatically, so only the declared direction is listed.
 *
 * Note `episodes` here is the TOP-LEVEL episodes collection, which is what the
 * Firestore index targets; `listen_and_learn_episodes` is a different thing.
 */
const COMPOSITE_INDEXES = {
  content: [
    [['Live', 'ascending'], ['scheduledPublishDate', 'ascending']],
    [['type', 'ascending'], ['Live', 'ascending'], ['publishedAt', 'descending']],
    [['source', 'ascending'], ['fetchedAt', 'descending']],
    [['contentStatus', 'ascending'], ['updatedAt', 'descending']],
    [['contentStatus', 'ascending'], ['fetchedAt', 'descending']],
    [['contentStatus', 'ascending'], ['fetchedAt', 'ascending']],
    [['Live', 'ascending'], ['contentStatus', 'ascending'], ['blogPublishedAt', 'descending']],
    [['Live', 'ascending'], ['contentStatus', 'ascending'], ['updatedAt', 'descending']],
    [['Live', 'ascending'], ['publishedAt', 'descending']],
  ],
  episodes: [[['status', 'ascending'], ['order', 'ascending']]],
  rss_cache: [[['provider', 'ascending'], ['lastFetched', 'descending']]],
  ai_insights: [
    [['provider', 'ascending'], ['active', 'ascending'], ['generatedAt', 'descending']],
  ],
  podcasts: [[['provider', 'ascending'], ['publishedAt', 'descending']]],
  certEvents: [
    [['type', 'ascending'], ['pubDate', 'descending']],
    [['source', 'ascending'], ['pubDate', 'descending']],
  ],
  social_posts: [[['status', 'ascending'], ['createdAt', 'descending']]],
  roadmap_items: [[['archived', 'ascending'], ['sortOrder', 'ascending']]],
  lab_jobs: [
    [['status', 'ascending'], ['type', 'ascending'], ['createdAt', 'ascending']],
  ],
};

/** Why a container exists when no documents are migrated into it. */
const DISPOSITION_NOTE = {
  reseed: 'seed data — re-seeded on the far side, not migrated',
  regenerate: 'cache — refilled by a scheduled job, not migrated',
  transient: 'transient runtime state — written at runtime, not migrated',
};

function build() {
  const containers = [];

  const add = (name, partitionKey, note) => {
    const override = INDEXING_OVERRIDES[name] ?? { included: ['/*'], excluded: [] };
    containers.push({
      name,
      partition_key_path: partitionKey,
      included_paths: override.included,
      excluded_paths: override.excluded,
      composite_indexes: (COMPOSITE_INDEXES[name] ?? []).map((index) =>
        index.map(([path, order]) => ({ path: `/${path}`, order }))
      ),
      note: note ?? null,
    });
  };

  for (const entry of COLLECTIONS) {
    if (!PROVISIONED_DISPOSITIONS.has(entry.disposition)) continue;
    add(entry.name, entry.partitionKey ?? DEFAULT_PARTITION_KEY, DISPOSITION_NOTE[entry.disposition] ?? null);
    for (const sub of entry.subcollections ?? []) {
      // Carry the manifest's own note through — infra/cosmos-containers.json is
      // the file an operator reads, and for a container with a non-default
      // partition key "subcollection of content" alone explains nothing.
      add(
        sub.container,
        sub.partitionKey ?? DEFAULT_PARTITION_KEY,
        [`subcollection of ${entry.name}`, sub.note].filter(Boolean).join(' — ')
      );
    }
  }

  containers.sort((a, b) => a.name.localeCompare(b.name));

  return {
    _comment:
      'GENERATED FILE — do not edit. Run `node scripts/generate-cosmos-container-spec.mjs` ' +
      'after changing scripts/lib/migration-manifest.mjs. Read by infra/main.tf.',
    _source: 'scripts/lib/migration-manifest.mjs',
    containers,
  };
}

const rendered = `${JSON.stringify(build(), null, 2)}\n`;

if (args.flags.check) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  if (current !== rendered) {
    log.error('infra/cosmos-containers.json is out of date — run node scripts/generate-cosmos-container-spec.mjs');
    process.exit(1);
  }
  log.ok('infra/cosmos-containers.json is up to date');
} else {
  writeFileSync(outPath, rendered);
  log.ok(`Wrote ${outPath} (${build().containers.length} containers)`);
}
