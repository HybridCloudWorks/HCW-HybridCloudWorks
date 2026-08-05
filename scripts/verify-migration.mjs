#!/usr/bin/env node

/**
 * verify-migration.mjs
 *
 * Reconciles the Cosmos DB target against the exported Firestore source.
 *
 * Migration_Plan §5 asks for "a reconciliation report (source count vs target
 * count vs field-level spot checks)". Counts alone are the weakest possible
 * check: a transform that drops a field, flattens a nested Timestamp into
 * `{_seconds, _nanoseconds}`, or writes `null` where a value should be, passes
 * a count comparison every time. So this does three things:
 *
 *   1. Count parity per container, source vs target.
 *   2. Existence parity — which specific ids are missing or extra, not just
 *      how many.
 *   3. Field-level comparison of a sample of documents, deep-equal against the
 *      exported source document, ignoring only the properties Cosmos adds.
 *
 * It reads the export produced by `migrate-firestore-to-cosmos.mjs --export`
 * rather than re-reading Firestore, so it can be run repeatedly against a
 * scratch account without touching production, and so that what it verifies is
 * exactly what was imported.
 *
 * Prerequisites:
 *   COSMOS_ENDPOINT, optionally COSMOS_KEY (omit for Entra/managed identity)
 *
 * Usage:
 *   node scripts/verify-migration.mjs --from export/
 *   node scripts/verify-migration.mjs --from export/ --sample 25
 *   node scripts/verify-migration.mjs --from export/ --collections content,admins
 *
 * Exits non-zero if anything fails to reconcile.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { flattenManifest } from './lib/migration-manifest.mjs';
import { parseArgs, splitList, log, connectCosmos, withRetry } from './lib/cli.mjs';

// Properties Cosmos DB adds to every document. Not a migration defect.
const COSMOS_SYSTEM_PROPS = new Set(['_rid', '_self', '_etag', '_attachments', '_ts']);

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    flags: [],
    options: ['from', 'collections', 'sample', 'report'],
  });
} catch (err) {
  log.error(err.message);
  process.exit(1);
}

const sourceDir = args.options.from ?? 'export';
const only = splitList(args.options.collections);
const sampleSize = Number(args.options.sample ?? 20);
const reportPath = args.options.report ?? 'reports/reconciliation.json';

if (!existsSync(sourceDir)) {
  log.error(`Export directory not found: ${sourceDir} — run migrate-firestore-to-cosmos.mjs --export first`);
  process.exit(1);
}

const targets = flattenManifest().filter((t) => !only || only.includes(t.container));

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Strip Cosmos system properties so the comparison sees only our own data. */
function stripSystem(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!COSMOS_SYSTEM_PROPS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Deep-compare two values, returning the dotted paths that differ.
 * Order-sensitive for arrays, which is correct here: the source order is the
 * order the site renders in.
 */
function diffPaths(expected, actual, path = '', acc = []) {
  if (expected === actual) return acc;

  const bothObjects =
    expected !== null && actual !== null && typeof expected === 'object' && typeof actual === 'object';

  if (!bothObjects) {
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      acc.push({ path: path || '(root)', expected: preview(expected), actual: preview(actual) });
    }
    return acc;
  }

  if (Array.isArray(expected) !== Array.isArray(actual)) {
    acc.push({ path: path || '(root)', expected: preview(expected), actual: preview(actual) });
    return acc;
  }

  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    diffPaths(expected[key], actual[key], path ? `${path}.${key}` : key, acc);
  }

  return acc;
}

function preview(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (s === undefined) return '(absent)';
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/** Deterministic sample so successive runs check the same documents. */
function pickSample(docs, n) {
  if (docs.length <= n) return docs;
  const step = Math.floor(docs.length / n);
  return Array.from({ length: n }, (_, i) => docs[i * step]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function verifyContainer(cosmos, target, sourceDocs) {
  const container = cosmos.database.container(target.container);

  const { resources: countRows } = await withRetry(() =>
    container.items.query('SELECT VALUE COUNT(1) FROM c').fetchAll()
  );
  const targetCount = countRows[0] ?? 0;

  const { resources: targetIds } = await withRetry(() =>
    container.items.query('SELECT VALUE c.id FROM c').fetchAll()
  );
  const targetIdSet = new Set(targetIds);
  const sourceIdSet = new Set(sourceDocs.map((d) => d.id));

  const missing = [...sourceIdSet].filter((id) => !targetIdSet.has(id));
  const extra = [...targetIdSet].filter((id) => !sourceIdSet.has(id));

  // Field-level spot checks.
  const sample = pickSample(sourceDocs, sampleSize);
  const fieldMismatches = [];

  for (const expected of sample) {
    if (!targetIdSet.has(expected.id)) continue;

    const { resources } = await withRetry(() =>
      container.items
        .query({ query: 'SELECT * FROM c WHERE c.id = @id', parameters: [{ name: '@id', value: expected.id }] })
        .fetchAll()
    );

    if (resources.length === 0) {
      fieldMismatches.push({ id: expected.id, differences: [{ path: '(document)', expected: 'present', actual: 'not readable' }] });
      continue;
    }

    const differences = diffPaths(expected, stripSystem(resources[0]));
    if (differences.length) fieldMismatches.push({ id: expected.id, differences });
  }

  return {
    container: target.container,
    sourcePath: target.sourcePath,
    sourceCount: sourceDocs.length,
    targetCount,
    countsMatch: sourceDocs.length === targetCount,
    missingIds: missing,
    extraIds: extra,
    sampled: sample.length,
    fieldMismatches,
    passed: sourceDocs.length === targetCount && missing.length === 0 && extra.length === 0 && fieldMismatches.length === 0,
  };
}

async function main() {
  const cosmos = connectCosmos();

  log.banner('Migration reconciliation', [
    `Source export: ${sourceDir}/`,
    `Target: ${cosmos.endpoint}`,
    `Database: ${cosmos.databaseId}`,
    `Auth: ${cosmos.auth}`,
    `Field-level sample: ${sampleSize} documents per container`,
  ]);

  const available = new Set(
    readdirSync(sourceDir).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, ''))
  );

  const results = [];

  for (const target of targets) {
    if (!available.has(target.container)) {
      log.warn(`${target.container.padEnd(32)} no export file — skipped`);
      continue;
    }

    const sourceDocs = readFileSync(join(sourceDir, `${target.container}.jsonl`), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));

    let result;
    try {
      result = await verifyContainer(cosmos, target, sourceDocs);
    } catch (err) {
      result = {
        container: target.container,
        sourceCount: sourceDocs.length,
        targetCount: null,
        countsMatch: false,
        error: err.message,
        passed: false,
      };
    }

    results.push(result);

    const status = result.passed ? 'OK  ' : 'FAIL';
    const detail = result.error
      ? `error: ${result.error}`
      : `source=${result.sourceCount} target=${result.targetCount}` +
        (result.missingIds?.length ? ` missing=${result.missingIds.length}` : '') +
        (result.extraIds?.length ? ` extra=${result.extraIds.length}` : '') +
        (result.fieldMismatches?.length ? ` fieldMismatches=${result.fieldMismatches.length}` : '');

    log.info(`${status}  ${result.container.padEnd(32)} ${detail}`);
  }

  // --- Detail on failures --------------------------------------------------
  const failed = results.filter((r) => !r.passed);

  if (failed.length) {
    log.section(`Failures (${failed.length})`);
    for (const r of failed) {
      log.warn(`${r.container}:`);
      if (r.error) log.warn(`    error: ${r.error}`);
      if (r.missingIds?.length) log.warn(`    missing from Cosmos: ${r.missingIds.slice(0, 10).join(', ')}${r.missingIds.length > 10 ? ` … (+${r.missingIds.length - 10})` : ''}`);
      if (r.extraIds?.length) log.warn(`    present in Cosmos but not in the export: ${r.extraIds.slice(0, 10).join(', ')}${r.extraIds.length > 10 ? ` … (+${r.extraIds.length - 10})` : ''}`);
      for (const m of (r.fieldMismatches ?? []).slice(0, 5)) {
        log.warn(`    ${m.id}:`);
        for (const d of m.differences.slice(0, 5)) {
          log.warn(`        ${d.path}: expected ${d.expected}, got ${d.actual}`);
        }
      }
    }
  }

  // --- Totals --------------------------------------------------------------
  log.section('Totals');
  const sourceTotal = results.reduce((n, r) => n + (r.sourceCount ?? 0), 0);
  const targetTotal = results.reduce((n, r) => n + (r.targetCount ?? 0), 0);
  log.info(`Containers verified: ${results.length}`);
  log.info(`Source documents:    ${sourceTotal}`);
  log.info(`Target documents:    ${targetTotal}`);

  const report = {
    generatedAt: new Date().toISOString(),
    sourceExport: sourceDir,
    cosmosEndpoint: cosmos.endpoint,
    database: cosmos.databaseId,
    sampleSize,
    totals: { containers: results.length, sourceDocuments: sourceTotal, targetDocuments: targetTotal, failed: failed.length },
    results,
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  log.ok(`Report written to ${reportPath}`);

  if (failed.length) {
    log.error(`${failed.length} container(s) did not reconcile`);
    process.exit(1);
  }

  log.ok('All containers reconciled — counts, ids and sampled fields match');
}

main().catch((err) => {
  log.error(err.stack ?? String(err));
  process.exit(1);
});
