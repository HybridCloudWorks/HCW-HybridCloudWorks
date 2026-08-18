#!/usr/bin/env node

/**
 * migrate-firestore-to-cosmos.mjs
 *
 * Copies the Site-Main Firestore data into Azure Cosmos DB.
 *
 * The migration is split into two halves that can run independently:
 *
 *   export   Firestore → JSONL on disk. Read-only against production.
 *   import   JSONL on disk → Cosmos DB. Never touches Firestore.
 *
 * Migration_Plan §5 asks for a dry run, a reconciliation report and idempotent
 * re-runnability, and for the whole thing to be exercised many times against a
 * scratch Cosmos account first. Splitting export from import is what makes
 * that cheap: one export, many imports, each one reproducible from a file you
 * can diff, and no repeated production reads while a partition-key or
 * transform decision is still being argued over.
 *
 * Idempotency: documents are upserted under a stable id derived from the
 * Firestore document id, so re-running converges rather than duplicating.
 *
 * Prerequisites:
 *   GOOGLE_APPLICATION_CREDENTIALS   Firebase service-account key path (export)
 *   COSMOS_ENDPOINT                  target account (import)
 *   COSMOS_DATABASE                  defaults to "hybridcloudworks"
 *   COSMOS_KEY                       optional; omit to use Entra/managed identity
 *
 * Usage:
 *   # 1. measure the source first
 *   node scripts/preflight-firestore-inventory.mjs
 *
 *   # 2. export to disk (read-only)
 *   node scripts/migrate-firestore-to-cosmos.mjs --export --out export/
 *
 *   # 3. rehearse against a scratch account, as many times as you like
 *   node scripts/migrate-firestore-to-cosmos.mjs --import --from export/ --dry-run
 *   node scripts/migrate-firestore-to-cosmos.mjs --import --from export/
 *
 *   # 4. reconcile
 *   node scripts/verify-migration.mjs --from export/
 *
 * Options:
 *   --export               Read Firestore and write JSONL to --out
 *   --import               Read JSONL from --from and upsert into Cosmos DB
 *   --dry-run              With --import: transform and validate, write nothing
 *   --out <dir>            Export directory (default: export/)
 *   --from <dir>           Import directory (default: export/)
 *   --collections a,b      Restrict to these containers
 *   --concurrency <n>      Parallel Cosmos writes (default: 8)
 *   --report <path>        Reconciliation report path (default: reports/migration-<mode>.json)
 *
 * Passing neither --export nor --import is an error. There is deliberately no
 * "do everything in one shot against production" default.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';

import { flattenManifest } from './lib/migration-manifest.mjs';
import { transformDocument } from './lib/firestore-transform.mjs';
import { parseArgs, splitList, log, connectCosmos, withRetry, mapWithConcurrency, FIRESTORE_PROJECT_ID } from './lib/cli.mjs';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    flags: ['export', 'import', 'dry-run'],
    options: ['out', 'from', 'collections', 'concurrency', 'report'],
  });
} catch (err) {
  log.error(err.message);
  process.exit(1);
}

const doExport = args.flags.export;
const doImport = args.flags.import;
const isDryRun = args.flags['dry-run'];

if (!doExport && !doImport) {
  log.error('Specify --export and/or --import. See the header of this file for the intended sequence.');
  process.exit(1);
}

const exportDir = args.options.out ?? 'export';
const importDir = args.options.from ?? exportDir;
const only = splitList(args.options.collections);
const concurrency = Number(args.options.concurrency ?? 8);
const reportPath = args.options.report ?? `reports/migration-${doExport && !doImport ? 'export' : 'import'}.json`;

const targets = flattenManifest().filter((t) => !only || only.includes(t.container));

if (targets.length === 0) {
  log.error(only ? `No manifest entries match: ${only.join(', ')}` : 'Manifest selected no collections');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Export: Firestore → JSONL
// ---------------------------------------------------------------------------

/**
 * Read every document for one manifest target.
 *
 * Subcollections are read with a collection-group query rather than by walking
 * parent documents, because Firestore lets a subcollection hold documents when
 * its parent document does not exist. `config/providers/{providerId}` is
 * exactly that shape in Site-Main, and walking parents finds none of it.
 *
 * The collection-group query is filtered back down to the manifest's parent so
 * that, for example, `image_prompts/{id}/sets` does not sweep up an unrelated
 * `sets` subcollection from somewhere else in the tree.
 */
async function readTarget(firestore, target) {
  if (!target.isSubcollection) {
    const snap = await firestore.collection(target.collectionId).get();
    return snap.docs.map((d) => ({ id: d.id, data: d.data(), parentPath: null }));
  }

  const snap = await firestore.collectionGroup(target.collectionId).get();
  const prefix = `${target.parent}/`;

  return snap.docs
    .filter((d) => {
      const parentPath = d.ref.parent.parent?.path ?? '';
      if (!parentPath.startsWith(prefix)) return false;
      // `config` declares an explicit parent document per subcollection.
      if (target.parentDoc) return parentPath === `${target.parent}/${target.parentDoc}`;
      return true;
    })
    .map((d) => ({
      id: d.id,
      data: d.data(),
      parentPath: d.ref.parent.parent?.path ?? null,
    }));
}

async function runExport() {
  const saKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!saKeyPath) {
    log.error('Set GOOGLE_APPLICATION_CREDENTIALS to the Firebase service-account key path');
    process.exit(1);
  }

  initializeApp({
    credential: cert(JSON.parse(readFileSync(saKeyPath, 'utf8'))),
    projectId: FIRESTORE_PROJECT_ID,
  });
  const firestore = getFirestore();

  log.banner('Export — Firestore → disk', [
    `Source: Firestore project ${FIRESTORE_PROJECT_ID}`,
    `Target: ${exportDir}/`,
    `Collections: ${targets.length}`,
    'Firestore access: READ ONLY',
  ]);

  mkdirSync(exportDir, { recursive: true });

  const summary = [];
  const allWarnings = [];

  for (const target of targets) {
    const docs = await readTarget(firestore, target);

    const outFile = join(exportDir, `${target.container}.jsonl`);
    const stream = createWriteStream(outFile);
    const seen = new Map();
    let warned = 0;

    for (const source of docs) {
      const { doc, warnings } = transformDocument(source);

      // A flattened subcollection partitioned by its parent needs that parent's
      // id as a real field on the document — Cosmos partitions on a document
      // property, and `content/{id}/versions` carries no such field of its own.
      //
      // There is no safe fallback here. A synthesised partition key would put
      // every affected document into one logical partition, which collapses id
      // uniqueness back to global within it and recreates exactly the
      // hot-partition shape the manifest exists to avoid — silently, with a
      // zero exit code. Fail the export instead; the source is still there to
      // re-read, so failing costs nothing and shipping a wrong key costs a
      // container recreate.
      if (target.partitionKeyFromParent) {
        const parentId = source.parentPath?.split('/').pop();
        if (!parentId) {
          throw new Error(
            `${target.container}: document ${source.id} has no parent path, so partition key ` +
              `${target.partitionKeyFromParent} cannot be derived. ` +
              `partitionKeyFromParent is only valid on a subcollection target.`
          );
        }
        doc[target.partitionKeyFromParent] = parentId;
      }

      // A container partitioned on a constant (admin_config) needs that
      // constant stamped as a real field — Cosmos partitions on a document
      // property, and the Firestore source documents do not carry it.
      if (target.partitionKeyConstant) {
        doc[target.partitionKey.slice(1)] = target.partitionKeyConstant;
      }

      // Two source documents that sanitise to the same Cosmos id would silently
      // overwrite each other on upsert. Catch it here, at export time, where
      // the source is still available to disambiguate.
      //
      // Cosmos requires ids to be unique per *logical partition*, not per
      // container, so the uniqueness key includes the partition value. Under
      // `/id` that reduces to the id itself; under `/contentId` two version
      // documents with the same id under different parents are legitimate and
      // must not be reported.
      const partitionValue =
        target.partitionKeyConstant ??
        (target.partitionKeyFromParent ? doc[target.partitionKeyFromParent] : doc.id);
      const uniquenessKey = `${partitionValue}\u0000${doc.id}`;

      if (seen.has(uniquenessKey)) {
        allWarnings.push({
          container: target.container,
          code: 'id-collision',
          detail:
            `${source.id} and ${seen.get(uniquenessKey)} both map to Cosmos id "${doc.id}"` +
            (target.partitionKeyFromParent ? ` in partition "${partitionValue}"` : ''),
        });
        warned += 1;
      }
      seen.set(uniquenessKey, source.id);

      for (const w of warnings) {
        allWarnings.push({ container: target.container, ...w });
        warned += 1;
      }

      stream.write(`${JSON.stringify(doc)}\n`);
    }

    await new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.end(resolve);
    });

    summary.push({ container: target.container, sourcePath: target.sourcePath, exported: docs.length, warnings: warned });
    log.info(`  ${target.container.padEnd(32)} ${String(docs.length).padStart(5)} docs → ${outFile}`);
  }

  return { summary, warnings: allWarnings };
}

// ---------------------------------------------------------------------------
// Import: JSONL → Cosmos DB
// ---------------------------------------------------------------------------

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

async function runImport() {
  if (!existsSync(importDir)) {
    log.error(`Export directory not found: ${importDir} — run with --export first`);
    process.exit(1);
  }

  const cosmos = connectCosmos();

  log.banner(isDryRun ? 'Import — DRY RUN' : 'Import — writing to Cosmos DB', [
    `Source: ${importDir}/`,
    `Target: ${cosmos.endpoint}`,
    `Database: ${cosmos.databaseId}`,
    `Auth: ${cosmos.auth}`,
    `Concurrency: ${concurrency}`,
    isDryRun ? 'Mode: DRY RUN — nothing will be written' : 'Mode: LIVE — documents will be upserted',
  ]);

  const available = new Set(readdirSync(importDir).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, '')));
  const missing = targets.filter((t) => !available.has(t.container));
  if (missing.length) {
    log.warn(`No export file for: ${missing.map((m) => m.container).join(', ')} — these will be skipped`);
  }

  const summary = [];
  const allWarnings = [];

  for (const target of targets) {
    if (!available.has(target.container)) continue;

    const docs = readJsonl(join(importDir, `${target.container}.jsonl`));

    if (isDryRun) {
      log.info(`  ${target.container.padEnd(32)} ${String(docs.length).padStart(5)} docs would be upserted`);
      if (docs.length > 0) {
        const preview = JSON.stringify(docs[0]).slice(0, 240);
        log.info(`  ${' '.repeat(32)} sample: ${preview}${preview.length === 240 ? '…' : ''}`);
      }
      summary.push({ container: target.container, read: docs.length, imported: 0, failed: 0 });
      continue;
    }

    const container = cosmos.database.container(target.container);
    let imported = 0;
    let failed = 0;

    const results = await mapWithConcurrency(docs, concurrency, async (doc) => {
      try {
        await withRetry(() => container.items.upsert(doc), { label: `${target.container}/${doc.id}` });
        imported += 1;
        return null;
      } catch (err) {
        failed += 1;
        return { container: target.container, code: 'upsert-failed', detail: `${doc.id}: ${err.message}` };
      }
    });

    for (const r of results) if (r) allWarnings.push(r);

    summary.push({ container: target.container, read: docs.length, imported, failed });
    log.info(
      `  ${target.container.padEnd(32)} ${String(imported).padStart(5)} imported` +
        (failed ? `, ${failed} FAILED` : '')
    );
  }

  return { summary, warnings: allWarnings };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    mode: { export: doExport, import: doImport, dryRun: isDryRun },
    collectionsSelected: targets.map((t) => t.container),
    export: null,
    import: null,
  };

  if (doExport) report.export = await runExport();
  if (doImport) report.import = await runImport();

  // --- Summary -------------------------------------------------------------
  log.section('Summary');

  const warnings = [...(report.export?.warnings ?? []), ...(report.import?.warnings ?? [])];
  const failures = warnings.filter((w) => w.code === 'upsert-failed' || w.code === 'id-collision');

  if (report.export) {
    const total = report.export.summary.reduce((n, s) => n + s.exported, 0);
    log.info(`Exported ${total} documents across ${report.export.summary.length} collections`);
  }
  if (report.import) {
    const read = report.import.summary.reduce((n, s) => n + s.read, 0);
    const imported = report.import.summary.reduce((n, s) => n + s.imported, 0);
    const failed = report.import.summary.reduce((n, s) => n + s.failed, 0);
    log.info(
      isDryRun
        ? `Dry run: ${read} documents would be upserted across ${report.import.summary.length} containers`
        : `Imported ${imported}/${read} documents, ${failed} failed`
    );
  }

  if (warnings.length) {
    log.section(`Warnings (${warnings.length})`);
    for (const w of warnings.slice(0, 40)) log.warn(`[${w.container}] ${w.code}: ${w.detail}`);
    if (warnings.length > 40) log.warn(`… and ${warnings.length - 40} more — see ${reportPath}`);
  } else {
    log.ok('No warnings');
  }

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  log.ok(`Report written to ${reportPath}`);

  if (failures.length) {
    log.error(`${failures.length} document(s) collided or failed to import — the migration is NOT complete`);
    process.exit(1);
  }

  if (doImport && !isDryRun) {
    log.info('\nNext: node scripts/verify-migration.mjs --from ' + importDir);
  }
}

main().catch((err) => {
  log.error(err.stack ?? String(err));
  process.exit(1);
});
