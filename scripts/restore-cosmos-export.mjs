/**
 * restore-cosmos-export.mjs — restore the Cosmos out-of-account export into a
 * target account (ADR 0028 §6, issue #231; runbook docs/runbooks/cosmos-restore.md).
 *
 * Reads the latest complete full export and every complete delta after it
 * from the `cosmos-export` blob container, and upserts every document into
 * the target database, container by container, full first, deltas in date
 * order. `--dry-run` reads the same blobs and only counts.
 *
 * Both clients authenticate with DefaultAzureCredential — `az login` on a
 * workstation. The signed-in identity needs Storage Blob Data Reader on the
 * export container and Cosmos DB Built-in Data Contributor on the TARGET
 * account. It never needs anything on the production Cosmos account: the
 * restore reads blobs, not the source.
 *
 * Output is the report: one row per container with the documents in the full,
 * in the deltas, the distinct ids written, and the elapsed time; a final
 * total. With `--verify` each target container is counted after the write and
 * the count printed beside the expected distinct total.
 *
 * Usage:
 *   node scripts/restore-cosmos-export.mjs --storage-account stsiteprodcus01 --dry-run
 *   node scripts/restore-cosmos-export.mjs --storage-account stsiteprodcus01 --target-endpoint https://cosmos-site-sbx-cus.documents.azure.com:443/ --verify
 *
 * Options:
 *   --storage-account <name>    account holding the cosmos-export container (required)
 *   --target-endpoint <url>     Cosmos endpoint to write to (required unless --dry-run)
 *   --database <id>             target database (default hcw)
 *   --as-of <YYYY-MM-DD>        latest run to apply (default: everything complete)
 *   --containers <a,b,c>        restore only these (default: every container in the full)
 *   --concurrency <n>           upserts in flight per container (default 8, max 32)
 *   --dry-run                   read and count; write nothing
 *   --verify                    after writing, count each target container
 *   --help
 */
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { pathToFileURL } from 'node:url';

import { parseArgs, splitList } from './lib/cli.mjs';
import {
  selectRestoreSet,
  restoreLayers,
  containersToRestore,
  dataBlobName,
  manifestBlobName,
  parseLine,
  assertLayerBlobPresent,
  requireBody,
  countRestore,
  formatRow,
  parseConcurrency,
  forEachConcurrent,
} from './lib/cosmos-export-restore.mjs';

export const EXPORT_CONTAINER = 'cosmos-export';

const HELP = `Usage: node scripts/restore-cosmos-export.mjs --storage-account <name> [--target-endpoint <url>] [options]

  --storage-account <name>    account holding the cosmos-export container (required)
  --target-endpoint <url>     Cosmos endpoint to write to (required unless --dry-run)
  --database <id>             target database (default hcw)
  --as-of <YYYY-MM-DD>        latest run to apply (default: everything complete)
  --containers <a,b,c>        restore only these containers
  --concurrency <n>           upserts in flight per container (default 8, max 32)
  --dry-run                   read and count; write nothing
  --verify                    after writing, count each target container
  --help

Authenticates with DefaultAzureCredential (az login). Needs Storage Blob Data
Reader on the cosmos-export container and, unless --dry-run, Cosmos DB
Built-in Data Contributor on the TARGET account. Never touches the source.
`;

/** Parse argv into the options the run needs. Throws on anything malformed. */
export function parseOptions(argv) {
  const { flags, options } = parseArgs(argv, {
    flags: ['dry-run', 'verify', 'help'],
    options: [
      'storage-account',
      'target-endpoint',
      'database',
      'as-of',
      'containers',
      'concurrency',
    ],
  });
  if (flags.help) return { help: true };
  const storageAccount = (options['storage-account'] || '').trim();
  if (!storageAccount) throw new Error('--storage-account is required');
  const targetEndpoint = (options['target-endpoint'] || '').trim();
  if (!flags['dry-run'] && !targetEndpoint) {
    throw new Error('--target-endpoint is required unless --dry-run');
  }
  if (targetEndpoint && !/^https:\/\//.test(targetEndpoint)) {
    throw new Error('--target-endpoint must be an https URL');
  }
  // An absent --database means hcw; a present-but-blank one is a mistake to
  // name here, not an SDK error about a resource with no id later.
  const database = options.database === undefined ? 'hcw' : options.database.trim();
  if (!database) throw new Error('--database must name the target database (the default is hcw)');
  return {
    help: false,
    storageAccount,
    targetEndpoint: targetEndpoint || null,
    database,
    // Trimmed like the other string options; selectRestoreSet validates the shape.
    asOf: options['as-of'] === undefined ? undefined : options['as-of'].trim(),
    containers: splitList(options.containers),
    concurrency: parseConcurrency(options.concurrency),
    dryRun: flags['dry-run'],
    verify: flags.verify,
  };
}

async function exportContainerClient(storageAccount) {
  const { BlobServiceClient } = await import('@azure/storage-blob');
  const { DefaultAzureCredential } = await import('@azure/identity');
  const service = new BlobServiceClient(
    `https://${storageAccount}.blob.core.windows.net`,
    new DefaultAzureCredential()
  );
  return service.getContainerClient(EXPORT_CONTAINER);
}

async function targetDatabase(endpoint, database) {
  const { CosmosClient } = await import('@azure/cosmos');
  const { DefaultAzureCredential } = await import('@azure/identity');
  const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  return client.database(database);
}

async function listNames(container) {
  const names = [];
  for await (const blob of container.listBlobsFlat()) names.push(blob.name);
  return names;
}

async function readJson(container, name) {
  const res = await container.getBlobClient(name).download(0);
  const chunks = [];
  for await (const chunk of requireBody(res, name)) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Stream one data blob as documents, one per non-empty line. */
async function* readDocuments(container, name) {
  const res = await container.getBlobClient(name).download(0);
  const lines = createInterface({
    input: requireBody(res, name).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (line.trim()) yield parseLine(line);
  }
}

async function blobExists(container, name) {
  return container.getBlobClient(name).exists();
}

export async function main(argv = process.argv.slice(2), out = console) {
  const opts = parseOptions(argv);
  if (opts.help) {
    out.log(HELP);
    return 0;
  }
  const startedAt = Date.now();
  const exportBlobs = await exportContainerClient(opts.storageAccount);
  const names = await listNames(exportBlobs);
  const set = selectRestoreSet(names, { asOf: opts.asOf });
  const layers = restoreLayers(set);
  const fullManifest = await readJson(exportBlobs, manifestBlobName('full', set.full));
  const containers = containersToRestore(fullManifest, opts.containers);

  out.log(
    `${opts.dryRun ? 'DRY RUN — counting' : 'Restoring'} full/${set.full} + ${set.deltas.length} delta(s)` +
      (set.deltas.length ? ` (${set.deltas[0]} … ${set.deltas[set.deltas.length - 1]})` : '') +
      ` — ${containers.length} container(s)` +
      (opts.dryRun ? '' : ` → ${opts.targetEndpoint} / ${opts.database}`)
  );
  if (set.incompleteSkipped.length) {
    out.log(`Skipped incomplete runs (no manifest): ${set.incompleteSkipped.join(', ')}`);
  }

  const db = opts.dryRun ? null : await targetDatabase(opts.targetEndpoint, opts.database);
  const widths = [32, 10, 10, 10, 10, 10];
  out.log(
    formatRow(
      ['container', 'full', 'deltas', 'distinct', opts.verify ? 'target' : '', 'ms'],
      widths
    )
  );

  let totalDistinct = 0;
  let totalWritten = 0;
  let mismatches = 0;
  for (const name of containers) {
    const t0 = Date.now();
    const layerIds = [];
    let written = 0;
    const target = db ? db.container(name) : null;
    for (const layer of layers) {
      const blob = dataBlobName(layer.mode, layer.runId, name);
      // Every layer was selected because its manifest exists, and the manifest
      // is written only once every container's marker is present — so a
      // missing data blob is a corrupted or expired set, never an empty
      // container (those still have a blob). Loud, in --dry-run too.
      assertLayerBlobPresent(await blobExists(exportBlobs, blob), blob);
      const ids = [];
      if (target) {
        await forEachConcurrent(readDocuments(exportBlobs, blob), opts.concurrency, async (doc) => {
          await target.items.upsert(doc);
          ids.push(doc.id);
          written += 1;
        });
      } else {
        for await (const doc of readDocuments(exportBlobs, blob)) ids.push(doc.id);
      }
      layerIds.push({ layer: `${layer.mode}/${layer.runId}`, ids });
    }
    const counts = countRestore(layerIds);
    const fullCount = counts.perLayer[`full/${set.full}`] ?? 0;
    const deltaCount = Object.entries(counts.perLayer)
      .filter(([layer]) => layer.startsWith('delta/'))
      .reduce((n, [, c]) => n + c, 0);
    let verified = '';
    if (target && opts.verify) {
      const { resources } = await target.items.query('SELECT VALUE COUNT(1) FROM c').fetchAll();
      const inTarget = Number(resources[0]) || 0;
      verified = inTarget === counts.distinct ? String(inTarget) : `${inTarget} MISMATCH`;
      if (inTarget !== counts.distinct) mismatches += 1;
    }
    totalDistinct += counts.distinct;
    totalWritten += written;
    out.log(
      formatRow([name, fullCount, deltaCount, counts.distinct, verified, Date.now() - t0], widths)
    );
  }

  const elapsedMs = Date.now() - startedAt;
  out.log(
    `${opts.dryRun ? 'Would restore' : 'Restored'} ${totalDistinct} distinct document(s)` +
      (opts.dryRun ? '' : ` (${totalWritten} upserts)`) +
      ` across ${containers.length} container(s) in ${elapsedMs} ms (${(elapsedMs / 60000).toFixed(1)} min)`
  );
  if (mismatches) {
    out.log(
      `${mismatches} container(s) MISMATCH between the target count and the export — investigate before calling the drill passed`
    );
    return 1;
  }
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err?.message || err);
      process.exit(2);
    }
  );
}
