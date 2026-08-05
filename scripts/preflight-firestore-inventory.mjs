#!/usr/bin/env node

/**
 * preflight-firestore-inventory.mjs
 *
 * Measures the Firestore source before anything is migrated, and writes the
 * result to disk as the migration's baseline.
 *
 * Migration_Plan §5 quotes "1,395 documents across 16 populated collections".
 * Those numbers were measured on 2026-07-30 and Site-Main has been committed
 * to since. This script replaces the estimate with a measurement, and — more
 * importantly — answers three questions the document counts cannot:
 *
 *   1. Which collections actually exist? Firestore only materialises a
 *      collection when it holds a document, so `listCollections()` is the only
 *      honest inventory. Anything it returns that the manifest does not know
 *      about is reported as UNMANIFESTED and must be triaged before cutover.
 *   2. Which subcollections hold documents? A subcollection can be populated
 *      while its parent document does not exist. `config/providers/*` is
 *      exactly this shape, and a top-level scan misses all of it.
 *   3. What shape are the date fields? The codebase carries Timestamp, ISO
 *      string and epoch-millisecond fields simultaneously. This reports which
 *      is which so the parity fixtures know what to expect.
 *
 * Read-only. It never writes to Firestore or to Cosmos.
 *
 * Prerequisites:
 *   GOOGLE_APPLICATION_CREDENTIALS  path to a Firebase service-account key
 *
 * Usage:
 *   node scripts/preflight-firestore-inventory.mjs
 *   node scripts/preflight-firestore-inventory.mjs --out reports/preflight.json
 *   node scripts/preflight-firestore-inventory.mjs --sample 10
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { COLLECTIONS, knownCollectionIds, findCollection } from './lib/migration-manifest.mjs';
import { parseArgs, FIRESTORE_PROJECT_ID, log } from './lib/cli.mjs';

let args;
try {
  args = parseArgs(process.argv.slice(2), { flags: [], options: ['out', 'sample'] });
} catch (err) {
  log.error(err.message);
  process.exit(1);
}

const outPath = args.options.out ?? 'reports/preflight-inventory.json';
const sampleSize = Number(args.options.sample ?? 5);

// ---------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Field-shape probing
// ---------------------------------------------------------------------------

const DATE_LIKE_KEY = /(at|date|time|timestamp|expires|fetched|updated|created|published|scheduled)$/i;

/** Classify a value into the shape vocabulary used in the report. */
function classify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') return 'firestore-timestamp';
    if (typeof value._seconds === 'number') return 'firestore-timestamp';
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') return 'geopoint';
    if (typeof value.path === 'string' && typeof value.collection === 'function') return 'reference';
    if (Buffer.isBuffer(value)) return 'bytes';
    return 'object';
  }
  if (typeof value === 'number') {
    // Epoch milliseconds for any plausible content date.
    if (value > 946_684_800_000 && value < 4_102_444_800_000) return 'epoch-ms';
    if (value > 946_684_800 && value < 4_102_444_800) return 'epoch-seconds';
    return 'number';
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'iso-string';
    return 'string';
  }
  return typeof value;
}

/**
 * Walk sample documents and record, per field, which shapes were seen and
 * whether any nested value is a Timestamp (the deep-conversion risk).
 */
function probeShapes(docs) {
  const fields = new Map();
  let nestedTimestamps = 0;
  let maxDepth = 0;

  const walk = (value, path, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    const kind = classify(value);

    if (depth > 0 && (kind === 'firestore-timestamp' || kind === 'geopoint' || kind === 'reference' || kind === 'bytes')) {
      nestedTimestamps += 1;
    }

    if (!fields.has(path)) fields.set(path, new Set());
    fields.get(path).add(kind);

    if (kind === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, depth + 1);
    } else if (kind === 'array' && value.length > 0) {
      walk(value[0], `${path}[]`, depth + 1);
    }
  };

  for (const doc of docs) {
    for (const [k, v] of Object.entries(doc)) walk(v, k, 0);
  }

  const dateFields = {};
  const conflicting = {};
  for (const [path, kinds] of fields) {
    const list = [...kinds].filter((k) => k !== 'null');
    if (list.length > 1) conflicting[path] = list;
    if (DATE_LIKE_KEY.test(path.split('.').pop() ?? '') || list.some((k) => ['firestore-timestamp', 'iso-string', 'epoch-ms'].includes(k))) {
      dateFields[path] = list;
    }
  }

  return { fieldCount: fields.size, maxDepth, nestedSpecialValues: nestedTimestamps, dateFields, conflictingShapes: conflicting };
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

async function inventoryCollection(ref, path) {
  const snapshot = await ref.get();
  const docs = snapshot.docs;
  const sample = docs.slice(0, sampleSize).map((d) => d.data());

  // Firestore ids that Cosmos cannot take verbatim.
  const problematicIds = docs
    .map((d) => d.id)
    .filter((id) => /[/\\?#]/.test(id) || id !== id.trimEnd() || Buffer.byteLength(id, 'utf8') > 1023);

  // Documents carrying their own `id` field that disagrees with the doc id.
  const idFieldConflicts = docs.filter((d) => {
    const v = d.data().id;
    return v !== undefined && String(v) !== d.id;
  }).length;

  // Subcollections that actually hold documents, discovered per parent doc.
  // Capped so a large collection does not turn into thousands of round trips.
  const subcollections = {};
  for (const doc of docs.slice(0, 200)) {
    for (const sub of await doc.ref.listCollections()) {
      const subSnap = await sub.get();
      if (subSnap.size === 0) continue;
      subcollections[sub.id] = (subcollections[sub.id] ?? 0) + subSnap.size;
    }
  }

  return {
    path,
    documentCount: docs.length,
    sampledDocuments: sample.length,
    problematicIds,
    idFieldConflicts,
    subcollections,
    subcollectionScanTruncated: docs.length > 200,
    shapes: probeShapes(sample),
  };
}

async function main() {
  log.banner('Firestore preflight inventory', [
    `Project: ${FIRESTORE_PROJECT_ID}`,
    `Sample size: ${sampleSize} documents per collection`,
    'Mode: READ ONLY',
  ]);

  const rootCollections = await firestore.listCollections();
  const rootIds = rootCollections.map((c) => c.id).sort();
  const known = knownCollectionIds();

  const unmanifested = rootIds.filter((id) => !known.has(id));
  const manifestedButAbsent = COLLECTIONS.map((c) => c.name).filter((n) => !rootIds.includes(n));

  const report = {
    generatedAt: new Date().toISOString(),
    projectId: FIRESTORE_PROJECT_ID,
    rootCollections: rootIds,
    unmanifested,
    manifestedButAbsent,
    collections: {},
    totals: { documents: 0, migrated: 0, skipped: 0 },
  };

  for (const ref of rootCollections) {
    const entry = findCollection(ref.id);
    const disposition = entry?.disposition ?? 'UNMANIFESTED';
    process.stdout.write(`  scanning ${ref.id} … `);

    const result = await inventoryCollection(ref, ref.id);
    result.disposition = disposition;
    report.collections[ref.id] = result;
    report.totals.documents += result.documentCount;

    if (disposition === 'migrate') report.totals.migrated += result.documentCount;
    else report.totals.skipped += result.documentCount;

    const subs = Object.entries(result.subcollections);
    process.stdout.write(
      `${result.documentCount} docs` +
        (subs.length ? `, subcollections: ${subs.map(([k, v]) => `${k}=${v}`).join(' ')}` : '') +
        `  [${disposition}]\n`
    );
  }

  // `config` is the case a root-collection scan cannot see: its documents may
  // not exist while its subcollections do. Probe the declared paths directly.
  const configEntry = findCollection('config');
  report.configSubcollections = {};
  for (const sub of configEntry?.subcollections ?? []) {
    const snap = await firestore.collection('config').doc(sub.parentDoc).collection(sub.name).get();
    report.configSubcollections[`config/${sub.parentDoc}/${sub.name}`] = snap.size;
    if (snap.size > 0) report.totals.migrated += snap.size;
    process.stdout.write(`  probing config/${sub.parentDoc}/${sub.name} … ${snap.size} docs\n`);
  }

  // --- Findings ------------------------------------------------------------
  log.section('Findings');

  if (unmanifested.length) {
    log.warn(`${unmanifested.length} collection(s) exist in Firestore but are NOT in the manifest:`);
    for (const id of unmanifested) {
      log.warn(`    ${id} (${report.collections[id].documentCount} docs) — triage before cutover`);
    }
  } else {
    log.ok('No unmanifested collections');
  }

  if (manifestedButAbsent.length) {
    log.info(`${manifestedButAbsent.length} manifested collection(s) hold no documents: ${manifestedButAbsent.join(', ')}`);
    log.info('    `probe` entries here can be dropped from the manifest; others need explaining.');
  }

  const withProblemIds = Object.entries(report.collections).filter(([, v]) => v.problematicIds.length > 0);
  if (withProblemIds.length) {
    log.warn('Document ids that Cosmos DB cannot accept verbatim:');
    for (const [name, v] of withProblemIds) log.warn(`    ${name}: ${v.problematicIds.join(', ')}`);
  } else {
    log.ok('All document ids are valid Cosmos DB ids');
  }

  const withIdConflicts = Object.entries(report.collections).filter(([, v]) => v.idFieldConflicts > 0);
  if (withIdConflicts.length) {
    log.warn('Documents whose `id` data field disagrees with the document id:');
    for (const [name, v] of withIdConflicts) log.warn(`    ${name}: ${v.idFieldConflicts} document(s)`);
  }

  const withNested = Object.entries(report.collections).filter(([, v]) => v.shapes.nestedSpecialValues > 0);
  if (withNested.length) {
    log.warn('Timestamps/GeoPoints nested below the top level (deep conversion required):');
    for (const [name, v] of withNested) log.warn(`    ${name}: ${v.shapes.nestedSpecialValues} in the sample`);
  }

  const withConflicts = Object.entries(report.collections).filter(
    ([, v]) => Object.keys(v.shapes.conflictingShapes).length > 0
  );
  if (withConflicts.length) {
    log.warn('Fields that hold more than one shape across sampled documents:');
    for (const [name, v] of withConflicts) {
      for (const [field, kinds] of Object.entries(v.shapes.conflictingShapes)) {
        log.warn(`    ${name}.${field}: ${kinds.join(' | ')}`);
      }
    }
  }

  log.section('Totals');
  log.info(`Documents in Firestore:     ${report.totals.documents}`);
  log.info(`To migrate (disposition):   ${report.totals.migrated}`);
  log.info(`Skipped (cache/transient):  ${report.totals.skipped}`);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  log.ok(`Report written to ${outPath}`);

  if (unmanifested.length) {
    log.error('Unmanifested collections found — add them to scripts/lib/migration-manifest.mjs before migrating');
    process.exit(2);
  }
}

main().catch((err) => {
  log.error(err.stack ?? String(err));
  process.exit(1);
});
