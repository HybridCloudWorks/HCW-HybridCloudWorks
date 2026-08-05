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

import { COLLECTIONS, PROVISIONED_DISPOSITIONS } from './lib/migration-manifest.mjs';
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

/**
 * Every container is partitioned on `/id`.
 *
 * `functions/src/lib/cosmos-client.js` defaults the partition key to the
 * document id in `readDoc()` and `deleteDoc()`, and no caller overrides it.
 * A container partitioned on anything else returns 404 for every point read.
 * See `docs/data-migration/README.md` for the full argument.
 */
const PARTITION_KEY_PATH = '/id';

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

/** Why a container exists when no documents are migrated into it. */
const DISPOSITION_NOTE = {
  reseed: 'seed data — re-seeded on the far side, not migrated',
  regenerate: 'cache — refilled by a scheduled job, not migrated',
  transient: 'transient runtime state — written at runtime, not migrated',
};

function build() {
  const containers = [];

  const add = (name, note) => {
    const override = INDEXING_OVERRIDES[name] ?? { included: ['/*'], excluded: [] };
    containers.push({
      name,
      partition_key_path: PARTITION_KEY_PATH,
      included_paths: override.included,
      excluded_paths: override.excluded,
      note: note ?? null,
    });
  };

  for (const entry of COLLECTIONS) {
    if (!PROVISIONED_DISPOSITIONS.has(entry.disposition)) continue;
    add(entry.name, DISPOSITION_NOTE[entry.disposition] ?? null);
    for (const sub of entry.subcollections ?? []) {
      add(sub.container, `subcollection of ${entry.name}`);
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
