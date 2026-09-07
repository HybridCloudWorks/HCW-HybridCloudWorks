/**
 * cosmos-export-restore.mjs — the pure half of scripts/restore-cosmos-export.mjs.
 *
 * Everything here works on names, text and plain objects, so it is tested
 * without a storage account or a Cosmos account. The script wires these to
 * the two SDK clients.
 *
 * Layout being read (functions/src/lib/backup/cosmos-export.js, ADR 0028):
 *
 *   full/<YYYY-MM-DD>/<container>.ndjson.gz     one line per document
 *   full/<YYYY-MM-DD>/<container>.marker.json   { docs, bytes, tsHighWater, … }
 *   full/<YYYY-MM-DD>/manifest.json             present only when every marker is
 *   delta/<YYYY-MM-DD>/…                        same shape
 *   state/<container>.json                      change-feed continuations (not restored)
 *
 * A restore set is the latest COMPLETE full (manifest present) on or before
 * the as-of date, followed by every complete delta after it, in date order.
 * Documents are applied in that order, so a document that changed twice ends
 * as its latest exported version. Deletes are not in the deltas (ADR 0028 §1):
 * a document deleted since the full comes back. That is the accepted
 * property the runbook names.
 */

const BLOB = /^(full|delta)\/(\d{4}-\d{2}-\d{2})\/(.+)$/;
export const RUN_ID = /^\d{4}-\d{2}-\d{2}$/;

/** Cosmos system properties, never written back. */
export const SYSTEM_FIELDS = Object.freeze(['_rid', '_self', '_etag', '_attachments', '_ts']);

/**
 * Parse one blob name into its parts, or null for anything outside a run
 * prefix (the `state/` blobs, stray objects).
 *
 * @param {string} name
 * @returns {{ mode: 'full'|'delta', runId: string, kind: 'data'|'marker'|'manifest'|'run'|'other', container: string|null }|null}
 */
export function parseBlobName(name) {
  const m = BLOB.exec(String(name || ''));
  if (!m) return null;
  const [, mode, runId, rest] = m;
  if (rest === 'manifest.json') return { mode, runId, kind: 'manifest', container: null };
  if (rest === 'run.json') return { mode, runId, kind: 'run', container: null };
  if (rest.endsWith('.ndjson.gz')) {
    return { mode, runId, kind: 'data', container: rest.slice(0, -'.ndjson.gz'.length) };
  }
  if (rest.endsWith('.marker.json')) {
    return { mode, runId, kind: 'marker', container: rest.slice(0, -'.marker.json'.length) };
  }
  return { mode, runId, kind: 'other', container: null };
}

/**
 * Choose the runs a restore applies.
 *
 * @param {string[]} names - every blob name in the export container
 * @param {{ asOf?: string }} [options] - latest run id to consider (inclusive); default: no limit
 * @returns {{ full: string, deltas: string[], incompleteSkipped: string[] }} run ids
 */
export function selectRestoreSet(names, { asOf } = {}) {
  if (asOf !== undefined && !RUN_ID.test(asOf)) {
    throw new Error(`--as-of must be a UTC date, YYYY-MM-DD; got ${JSON.stringify(asOf)}`);
  }
  const complete = { full: new Set(), delta: new Set() };
  const seen = { full: new Set(), delta: new Set() };
  for (const name of names) {
    const parsed = parseBlobName(name);
    if (!parsed) continue;
    seen[parsed.mode].add(parsed.runId);
    if (parsed.kind === 'manifest') complete[parsed.mode].add(parsed.runId);
  }
  const within = (runId) => asOf === undefined || runId <= asOf;

  const fulls = [...complete.full].filter(within).sort();
  if (!fulls.length) {
    throw new Error(
      asOf === undefined
        ? 'no complete full export (a full/<date>/manifest.json) found'
        : `no complete full export on or before ${asOf}`
    );
  }
  const full = fulls[fulls.length - 1];
  const deltas = [...complete.delta].filter((runId) => runId > full && within(runId)).sort();
  const incompleteSkipped = [
    ...[...seen.full].filter((r) => !complete.full.has(r) && within(r)).map((r) => `full/${r}`),
    ...[...seen.delta]
      .filter((r) => !complete.delta.has(r) && r > full && within(r))
      .map((r) => `delta/${r}`),
  ].sort();
  return { full, deltas, incompleteSkipped };
}

/** `mode/runId/container.ndjson.gz` */
export function dataBlobName(mode, runId, container) {
  return `${mode}/${runId}/${container}.ndjson.gz`;
}

/** `mode/runId/manifest.json` */
export function manifestBlobName(mode, runId) {
  return `${mode}/${runId}/manifest.json`;
}

/** The layers a restore applies, in order: the full, then each delta. */
export function restoreLayers({ full, deltas }) {
  return [{ mode: 'full', runId: full }, ...deltas.map((runId) => ({ mode: 'delta', runId }))];
}

/**
 * The containers a restore covers: those the full's manifest lists, optionally
 * narrowed by an explicit list (unknown names are an error, not a silent skip).
 *
 * @param {{ containers?: {container: string}[] }} fullManifest
 * @param {string[]|null} [only]
 */
export function containersToRestore(fullManifest, only = null) {
  const all = (fullManifest?.containers || []).map((c) => c.container).sort();
  if (!all.length) throw new Error('the full manifest lists no containers');
  if (!only) return all;
  const known = new Set(all);
  const unknown = only.filter((name) => !known.has(name));
  if (unknown.length) {
    throw new Error(
      `--containers names containers the full export does not carry: ${unknown.join(', ')}`
    );
  }
  return [...new Set(only)].sort();
}

/** One NDJSON line → a document, with Cosmos system fields removed. Blank lines are skipped by the caller. */
export function parseLine(line) {
  const doc = JSON.parse(line);
  if (!doc || typeof doc !== 'object' || typeof doc.id !== 'string' || !doc.id) {
    throw new Error('a line is not a document with a string id');
  }
  return stripSystemFields(doc);
}

export function stripSystemFields(doc) {
  const out = { ...doc };
  for (const field of SYSTEM_FIELDS) delete out[field];
  return out;
}

/**
 * Count what a set of layers would restore for one container, without
 * writing anything. Later layers overwrite earlier ones by id.
 *
 * @param {Array<{ layer: string, ids: Iterable<string> }>} layers
 * @returns {{ perLayer: Record<string, number>, distinct: number, overwritten: number }}
 */
export function countRestore(layers) {
  const perLayer = {};
  const seen = new Set();
  let overwritten = 0;
  for (const { layer, ids } of layers) {
    let n = 0;
    for (const id of ids) {
      n += 1;
      if (seen.has(id)) overwritten += 1;
      seen.add(id);
    }
    perLayer[layer] = n;
  }
  return { perLayer, distinct: seen.size, overwritten };
}

/** A fixed-width report row; the report is the script's output. */
export function formatRow(cells, widths) {
  return cells
    .map((cell, i) => String(cell).padEnd(widths[i]))
    .join('  ')
    .trimEnd();
}

/** Parse `--concurrency`: a positive integer, default 8, capped at 32. */
export function parseConcurrency(value) {
  if (value === undefined) return 8;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 32) {
    throw new Error(`--concurrency must be an integer from 1 to 32; got ${JSON.stringify(value)}`);
  }
  return n;
}

/**
 * Run `work(item)` over an async iterable with at most `limit` in flight.
 * Rejects on the first failure after draining what is in flight.
 */
export async function forEachConcurrent(items, limit, work) {
  const inFlight = new Set();
  let failure = null;
  for await (const item of items) {
    if (failure) break;
    const p = work(item).then(
      () => inFlight.delete(p),
      (err) => {
        inFlight.delete(p);
        failure ??= err;
      }
    );
    inFlight.add(p);
    if (inFlight.size >= limit) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  if (failure) throw failure;
}
