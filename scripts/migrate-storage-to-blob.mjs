#!/usr/bin/env node

/**
 * migrate-storage-to-blob.mjs
 *
 * Copies Site-Main's Firebase Storage objects into Azure Blob Storage, driven
 * by scripts/lib/storage-manifest.mjs.
 *
 * Replaces a one-line azcopy wrapper that had no manifest, no dry run, no
 * verification, and could only authenticate to GCS with a downloaded
 * service-account key — which the rest of this tooling refuses to use.
 * Both sides here authenticate with Application Default Credentials:
 * Workload Identity Federation (or `gcloud auth application-default login`)
 * for GCS, DefaultAzureCredential for Blob.
 *
 * Three modes, each usable alone:
 *
 *   --inventory   list the bucket, group by prefix, report counts and bytes,
 *                 and FAIL (exit 2) on any prefix the manifest does not know.
 *   --copy        stream each manifested object into its container. Idempotent:
 *                 a blob whose `gcsmd5` metadata matches the source is skipped.
 *                 --dry-run plans without writing. --overwrite forces.
 *   --verify      per prefix: count and bytes on both sides, every blob's
 *                 stored md5 against the current GCS md5, and a deterministic
 *                 sample downloaded from both sides and compared byte-for-byte
 *                 — which catches a truncated stream that metadata cannot.
 *
 * Object names can contain document ids, so in CI (MIGRATION_CI=1) the log
 * carries counts only. Per-object detail goes to the full report, which is
 * never uploaded; the workflow publishes the .summary.json beside it.
 *
 * Prerequisites:
 *   STORAGE_ACCOUNT     target Azure storage account (scratch or production)
 *   GCS_BUCKET          optional override of the Site-Main bucket
 *
 * Options:
 *   --prefixes a,b      restrict to these manifest prefixes (match on `prefix`)
 *   --concurrency <n>   parallel copies (default 8)
 *   --sample <n>        objects per prefix to byte-compare in --verify (default 5)
 *   --report <path>     default reports/storage-<mode>.json
 *   --show-samples      print object names (terminal only; refused in CI)
 */

import { createHash } from 'node:crypto';
import { Storage } from '@google-cloud/storage';

import { PREFIXES, mapObject, ruleFor, topPrefixOf, copiedPrefixes } from './lib/storage-manifest.mjs';
import {
  parseArgs,
  splitList,
  log,
  connectBlob,
  withRetry,
  mapWithConcurrency,
  writeReport,
  showSamples,
  FIRESTORE_PROJECT_ID,
  GCS_BUCKET,
} from './lib/cli.mjs';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

let args;
let samples;
try {
  args = parseArgs(process.argv.slice(2), {
    flags: ['inventory', 'copy', 'verify', 'dry-run', 'overwrite', 'show-samples'],
    options: ['prefixes', 'concurrency', 'sample', 'report'],
  });
  samples = showSamples(args.flags['show-samples']);
} catch (err) {
  log.error(err.message);
  process.exit(1);
}

const mode = ['inventory', 'copy', 'verify'].filter((m) => args.flags[m]);
if (mode.length !== 1) {
  log.error('Specify exactly one of --inventory, --copy, --verify');
  process.exit(1);
}
const [MODE] = mode;
const isDryRun = args.flags['dry-run'];
const overwrite = args.flags.overwrite;
const onlyPrefixes = splitList(args.options.prefixes);
const concurrency = Number(args.options.concurrency ?? 8);
const sampleSize = Number(args.options.sample ?? 5);
const reportPath = args.options.report ?? `reports/storage-${MODE}.json`;
const bucketName = process.env.GCS_BUCKET || GCS_BUCKET;

const selected = copiedPrefixes().filter((r) => !onlyPrefixes || onlyPrefixes.includes(r.prefix));
if (!selected.length) {
  log.error(`No manifest prefixes match: ${onlyPrefixes?.join(', ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function connectGcs() {
  // ADC. An external_account (WIF) file, a gcloud user credential, or the
  // metadata server — never a key file passed explicitly.
  const storage = new Storage({ projectId: FIRESTORE_PROJECT_ID });
  return storage.bucket(bucketName);
}

/** List every object in the bucket once; callers group and filter in memory. */
async function listAllObjects(bucket) {
  const out = [];
  let pageToken;
  do {
    const [files, nextQuery] = await withRetry(() =>
      bucket.getFiles({ autoPaginate: false, maxResults: 1000, pageToken })
    );
    for (const f of files) {
      out.push({
        name: f.name,
        size: Number(f.metadata.size ?? 0),
        md5: f.metadata.md5Hash ?? null, // base64
        generation: String(f.metadata.generation ?? ''),
        contentType: f.metadata.contentType ?? null,
        cacheControl: f.metadata.cacheControl ?? null,
        contentEncoding: f.metadata.contentEncoding ?? null,
        contentDisposition: f.metadata.contentDisposition ?? null,
      });
    }
    pageToken = nextQuery?.pageToken;
  } while (pageToken);
  return out;
}

/** List one container's blobs with metadata, keyed by name. */
async function listBlobs(containerClient) {
  const out = new Map();
  for await (const item of containerClient.listBlobsFlat({ includeMetadata: true })) {
    out.set(item.name, {
      name: item.name,
      size: item.properties.contentLength ?? 0,
      gcsmd5: item.metadata?.gcsmd5 ?? null,
      gcsgeneration: item.metadata?.gcsgeneration ?? null,
    });
  }
  return out;
}

function md5Base64(buffer) {
  return createHash('md5').update(buffer).digest('base64');
}

/** Deterministic sample so successive runs check the same objects. */
function pickSample(items, n) {
  if (items.length <= n) return items;
  const step = Math.floor(items.length / n);
  return Array.from({ length: n }, (_, i) => items[i * step]);
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

async function runInventory() {
  const bucket = connectGcs();
  log.banner('Storage inventory — GCS', [`Bucket: ${bucketName}`, 'Access: READ ONLY']);

  const objects = await listAllObjects(bucket);

  const byPrefix = {};
  const unmanifested = {};
  for (const o of objects) {
    const rule = ruleFor(o.name);
    const key = rule ? rule.prefix : topPrefixOf(o.name);
    const bag = rule ? byPrefix : unmanifested;
    bag[key] ??= { count: 0, bytes: 0, disposition: rule?.disposition ?? 'UNMANIFESTED', container: rule?.container ?? null, names: [] };
    bag[key].count += 1;
    bag[key].bytes += o.size;
    bag[key].names.push(o.name);
  }

  log.section('By manifest prefix');
  for (const rule of PREFIXES) {
    const s = byPrefix[rule.prefix];
    const line = `${rule.prefix.padEnd(28)} ${String(s?.count ?? 0).padStart(6)} objects ${fmtBytes(s?.bytes ?? 0).padStart(11)}  [${rule.disposition}]`;
    log.info(`  ${line}`);
  }

  const unmanifestedKeys = Object.keys(unmanifested).sort();
  log.section('Findings');
  if (unmanifestedKeys.length) {
    log.warn(`${unmanifestedKeys.length} prefix(es) in the bucket are NOT in the manifest:`);
    for (const k of unmanifestedKeys) {
      log.warn(`    ${k} (${unmanifested[k].count} objects, ${fmtBytes(unmanifested[k].bytes)}) — add to scripts/lib/storage-manifest.mjs`);
    }
  } else {
    log.ok('Every prefix in the bucket is manifested');
  }

  const totalBytes = objects.reduce((n, o) => n + o.size, 0);
  log.section('Totals');
  log.info(`Objects: ${objects.length}`);
  log.info(`Bytes:   ${fmtBytes(totalBytes)}`);

  const strip = (bag) => Object.fromEntries(Object.entries(bag).map(([k, v]) => [k, { count: v.count, bytes: v.bytes, disposition: v.disposition, container: v.container }]));
  const full = { generatedAt: new Date().toISOString(), bucket: bucketName, totals: { objects: objects.length, bytes: totalBytes }, byPrefix, unmanifested };
  const summary = { ...full, byPrefix: strip(byPrefix), unmanifested: strip(unmanifested) };
  const { summaryPath } = writeReport(reportPath, full, summary);
  log.ok(`Report written to ${reportPath} (summary: ${summaryPath})`);

  if (unmanifestedKeys.length) {
    log.error('Unmanifested prefixes found — the manifest must name every prefix before a copy runs');
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

async function runCopy() {
  const bucket = connectGcs();
  const blob = connectBlob(process.env.STORAGE_ACCOUNT);

  log.banner(isDryRun ? 'Storage copy — DRY RUN' : 'Storage copy — writing to Azure Blob', [
    `Source: gs://${bucketName}`,
    `Target: ${blob.endpoint}`,
    `Prefixes: ${selected.map((r) => r.prefix).join(', ')}`,
    `Concurrency: ${concurrency}`,
    isDryRun ? 'Mode: DRY RUN — nothing will be written' : `Mode: LIVE${overwrite ? ' (overwrite)' : ''}`,
  ]);

  const objects = (await listAllObjects(bucket)).filter((o) => {
    const rule = ruleFor(o.name);
    return rule && selected.includes(rule) && mapObject(o.name);
  });

  // Existing blobs per container, once, so the idempotency check is a map hit
  // rather than a HEAD per object.
  const containers = [...new Set(selected.map((r) => r.container))];
  const existing = {};
  if (!isDryRun) {
    for (const c of containers) existing[c] = await listBlobs(blob.service.getContainerClient(c));
  }

  const perPrefix = {};
  const detail = [];
  const bump = (prefix, k, bytes = 0) => {
    perPrefix[prefix] ??= { planned: 0, copied: 0, unchanged: 0, failed: 0, bytes: 0 };
    perPrefix[prefix][k] += 1;
    perPrefix[prefix].bytes += bytes;
  };

  if (isDryRun) {
    for (const o of objects) bump(mapObject(o.name).rule.prefix, 'planned', o.size);
    log.section('Plan');
    for (const [p, s] of Object.entries(perPrefix)) log.info(`  ${p.padEnd(28)} ${String(s.planned).padStart(6)} objects ${fmtBytes(s.bytes).padStart(11)}`);
  } else {
    await mapWithConcurrency(objects, concurrency, async (o) => {
      const { container, blobName, rule } = mapObject(o.name);
      const have = existing[container]?.get(blobName);
      if (have && have.gcsmd5 && o.md5 && have.gcsmd5 === o.md5 && !overwrite) {
        bump(rule.prefix, 'unchanged', o.size);
        return;
      }
      try {
        const client = blob.service.getContainerClient(container).getBlockBlobClient(blobName);
        await withRetry(
          () =>
            client.uploadStream(bucket.file(o.name).createReadStream(), 4 * 1024 * 1024, 4, {
              blobHTTPHeaders: {
                blobContentType: o.contentType ?? undefined,
                blobCacheControl: o.cacheControl ?? undefined,
                blobContentEncoding: o.contentEncoding ?? undefined,
                blobContentDisposition: o.contentDisposition ?? undefined,
              },
              metadata: { gcsmd5: o.md5 ?? '', gcsgeneration: o.generation, gcssource: o.name },
            }),
          { label: o.name }
        );
        bump(rule.prefix, 'copied', o.size);
        if (samples) log.info(`  copied  ${o.name} → ${container}/${blobName}`);
      } catch (err) {
        bump(rule.prefix, 'failed');
        detail.push({ object: o.name, container, blobName, error: err.message });
      }
    });
    log.section('Result');
    for (const [p, s] of Object.entries(perPrefix)) {
      log.info(`  ${p.padEnd(28)} copied=${s.copied} unchanged=${s.unchanged}${s.failed ? ` FAILED=${s.failed}` : ''}`);
    }
  }

  const totals = Object.values(perPrefix).reduce(
    (t, s) => ({ planned: t.planned + s.planned, copied: t.copied + s.copied, unchanged: t.unchanged + s.unchanged, failed: t.failed + s.failed, bytes: t.bytes + s.bytes }),
    { planned: 0, copied: 0, unchanged: 0, failed: 0, bytes: 0 }
  );
  const full = { generatedAt: new Date().toISOString(), dryRun: isDryRun, overwrite, bucket: bucketName, target: blob.endpoint, totals, perPrefix, failures: detail };
  const summary = { ...full, failures: detail.length };
  const { summaryPath } = writeReport(reportPath, full, summary);
  log.ok(`Report written to ${reportPath} (summary: ${summaryPath})`);

  if (totals.failed) {
    log.error(`${totals.failed} object(s) failed to copy`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

async function runVerify() {
  const bucket = connectGcs();
  const blob = connectBlob(process.env.STORAGE_ACCOUNT);

  log.banner('Storage verification', [
    `Source: gs://${bucketName}`,
    `Target: ${blob.endpoint}`,
    `Prefixes: ${selected.map((r) => r.prefix).join(', ')}`,
    `Byte-compare sample: ${sampleSize} per prefix`,
  ]);

  const objects = (await listAllObjects(bucket)).filter((o) => {
    const rule = ruleFor(o.name);
    return rule && selected.includes(rule) && mapObject(o.name);
  });
  const containers = [...new Set(selected.map((r) => r.container))];
  const target = {};
  for (const c of containers) target[c] = await listBlobs(blob.service.getContainerClient(c));

  const results = {};
  const missing = [];
  const md5Mismatch = [];
  const byteMismatch = [];

  for (const rule of selected) {
    const src = objects.filter((o) => ruleFor(o.name) === rule);
    const r = { sourceCount: src.length, sourceBytes: 0, targetCount: 0, targetBytes: 0, missing: 0, md5Mismatch: 0, sampled: 0, byteMismatch: 0, passed: false };

    for (const o of src) {
      const { container, blobName } = mapObject(o.name);
      const t = target[container].get(blobName);
      r.sourceBytes += o.size;
      if (!t) {
        r.missing += 1;
        missing.push(o.name);
        continue;
      }
      r.targetCount += 1;
      r.targetBytes += t.size;
      if (o.md5 && t.gcsmd5 !== o.md5) {
        r.md5Mismatch += 1;
        md5Mismatch.push(o.name);
      }
    }

    // Byte-for-byte on a deterministic sample — the only check that catches a
    // stream that ended early with the right metadata on it.
    for (const o of pickSample(src, sampleSize)) {
      const { container, blobName } = mapObject(o.name);
      if (!target[container].has(blobName)) continue;
      r.sampled += 1;
      const [gcsBuf] = await withRetry(() => bucket.file(o.name).download());
      const azBuf = await withRetry(() => blob.service.getContainerClient(container).getBlockBlobClient(blobName).downloadToBuffer());
      if (md5Base64(gcsBuf) !== md5Base64(azBuf)) {
        r.byteMismatch += 1;
        byteMismatch.push(o.name);
      }
    }

    r.passed = r.missing === 0 && r.md5Mismatch === 0 && r.byteMismatch === 0 && r.sourceBytes === r.targetBytes;
    results[rule.prefix] = r;
    log.info(
      `${r.passed ? 'OK  ' : 'FAIL'}  ${rule.prefix.padEnd(28)} source=${r.sourceCount} target=${r.targetCount}` +
        (r.missing ? ` missing=${r.missing}` : '') +
        (r.md5Mismatch ? ` md5Mismatch=${r.md5Mismatch}` : '') +
        (r.byteMismatch ? ` byteMismatch=${r.byteMismatch}` : '')
    );
  }

  const failed = Object.values(results).filter((r) => !r.passed).length;
  const full = { generatedAt: new Date().toISOString(), bucket: bucketName, target: blob.endpoint, sampleSize, results, failed, missing, md5Mismatch, byteMismatch };
  const summary = { ...full, missing: missing.length, md5Mismatch: md5Mismatch.length, byteMismatch: byteMismatch.length };
  const { summaryPath } = writeReport(reportPath, full, summary);
  log.ok(`Report written to ${reportPath} (summary: ${summaryPath})`);

  if (failed) {
    log.error(`${failed} prefix(es) did not verify`);
    process.exit(1);
  }
  log.ok('All prefixes verified — counts, bytes, stored md5 and sampled content match');
}

// ---------------------------------------------------------------------------

const run = { inventory: runInventory, copy: runCopy, verify: runVerify }[MODE];
run().catch((err) => {
  log.error(err.stack ?? String(err));
  process.exit(1);
});
