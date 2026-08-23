#!/usr/bin/env node
/**
 * Build-time cache of the public snapshot endpoints.
 *
 * The /about page and the speaker widget need certifications and speaker
 * events. Both already have a runtime path — `fetchPublicSnapshotItems` calls
 * `GET /api/public/snapshots/{id}` — and both prefer a static file when one
 * exists, because a static file costs a CDN hit instead of a function
 * invocation and a Cosmos read per visitor.
 *
 * So this writes the static file, and it writes EXACTLY what the runtime
 * fallback would have fetched. Same endpoint, same payload, same consumers,
 * same normalisers. There is no second copy of the shaping logic here to drift
 * out of step with the API — verified 2026-08-23 against both sources: 109
 * certifications, identical field sets, zero differences.
 *
 * WHY THIS REPLACED A FIRESTORE DUMP. It used to read Firestore directly with
 * `firebase-admin` and Application Default Credentials, and to `return 0`
 * — succeed — when no GCP credentials were present. The deploy workflow has no
 * GCP credentials, so on the first real frontend deploy it skipped, exited
 * green, and shipped a site with no /data files at all. Nothing failed. The
 * runtime fallback quietly absorbed it, and the only visible symptom was two
 * 404s that nobody was looking for.
 *
 * It now reads the platform's own API, which means the frontend build no longer
 * depends on GCP at all.
 *
 * IT FAILS LOUDLY. A build that cannot produce these files is a build whose
 * output is worse than the last one, and shipping that silently is precisely
 * what went wrong before. The runtime fallback is a safety net for visitors,
 * not a licence for the build to be quietly wrong.
 *
 * Env:
 *   AZURE_FUNCTIONS_URL   API base including /api. The deploy workflow already
 *                         sets it for this step from the FUNCTIONS_URL variable.
 */
const fs = require('node:fs');
const path = require('node:path');

/** Snapshot id -> output file. Ids are allowlisted server-side; see public-reads.js. */
const SNAPSHOTS = [
  { id: 'certifications', outFile: 'certifications.json' },
  { id: 'speakerevents', outFile: 'speakerevents.json' },
];

const OUT_DIR = path.join(__dirname, '..', 'public', 'data');
const TIMEOUT_MS = 30_000;

function apiBase() {
  const raw = process.env.AZURE_FUNCTIONS_URL || process.env.VITE_AZURE_FUNCTIONS_URL || '';
  const base = raw.trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error(
      'AZURE_FUNCTIONS_URL is not set. It must be the API base INCLUDING the /api prefix, ' +
        'e.g. https://api-azure.hybridcloudworks.com/api'
    );
  }
  if (!/\/api$/.test(base)) {
    // The same trap functionsBase.js guards against: routes are registered
    // relative to /api, so a base without it 404s uniformly and the failure
    // looks like a missing endpoint rather than a missing path segment.
    throw new Error(`AZURE_FUNCTIONS_URL must end in /api — got "${base}"`);
  }
  return base;
}

async function fetchSnapshot(base, id) {
  const url = `${base}/public/snapshots/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      // Named rather than left as the runtime default. Edge bot rules treat an
      // absent or generic agent as suspicious, and a build that is refused by
      // the edge should at least be identifiable in the logs that refused it.
      'User-Agent': 'hcw-build-generate-public-data',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // The status alone is not enough to act on. A 403 from the application
    // says "Origin not allowed" as JSON; a 403 from the edge is an HTML
    // challenge page; a 403 from the origin lock is different again. Whoever
    // reads this failure needs to know which, without redeploying to find out.
    const body = await response.text().catch(() => '');
    const server = response.headers.get('server') || 'unknown';
    const ray = response.headers.get('cf-ray');
    const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 300);
    throw new Error(
      `GET ${url} -> HTTP ${response.status}
` +
        `  server: ${server}${ray ? `  cf-ray: ${ray}` : ''}
` +
        `  body:   ${snippet || '(empty)'}`
    );
  }

  const body = await response.json();
  const items = body?.snapshot?.items;
  if (!Array.isArray(items)) {
    throw new Error(`GET ${url} returned no snapshot.items array`);
  }
  if (items.length === 0) {
    // An empty snapshot is almost always a publish that has not happened or a
    // wrong id, not a genuinely empty collection. Writing it would replace a
    // good file with a useless one and look like success.
    throw new Error(`GET ${url} returned zero items — refusing to write an empty snapshot`);
  }

  return { items, generatedAt: body.snapshot.generatedAt || null };
}

async function main() {
  const base = apiBase();
  console.log(`[generate-public-data] source: ${base}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const { id, outFile } of SNAPSHOTS) {
    const { items, generatedAt } = await fetchSnapshot(base, id);

    // Shape kept identical to the previous Firestore dump: consumers read
    // `items`, and loadPublicDataSnapshot returns [] unless it finds that key.
    const payload = {
      generatedAt: generatedAt || new Date().toISOString(),
      count: items.length,
      items,
    };

    const outPath = path.join(OUT_DIR, outFile);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(
      `[generate-public-data] ${outFile}: ${items.length} items, ${fs.statSync(outPath).size} bytes`
    );
  }
}

main().catch((error) => {
  console.error(`[generate-public-data] FAILED: ${error.message}`);
  console.error(
    '  This build would ship without /data/*.json, falling back to a per-visitor API call.\n' +
      '  That is a silent regression, so the build stops here instead.'
  );
  process.exit(1);
});
