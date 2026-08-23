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
 * IT WARNS LOUDLY AND CONTINUES, which is not the silent skip it replaced —
 * and the difference is the whole point. The old version printed a friendly
 * note and exited 0, indistinguishable from success. This emits a ::warning::
 * that surfaces on the run summary and the pull request, names the status and
 * the response body, and says which layer refused it. You cannot miss it; it
 * simply does not stop a deploy over a performance optimisation.
 *
 * It DID fail the build, for about an hour on 2026-08-23, and that was wrong.
 * Cloudflare answers a GitHub runner with a managed challenge — datacenter IP,
 * not user agent — so the only way to make it succeed was a permanent
 * bot-protection exception on the API host. Poor trade against one extra API
 * call per visitor on two pages. Issue #175 carries the decision.
 *
 * A CONFIGURATION MISTAKE STILL FAILS: a missing AZURE_FUNCTIONS_URL or a base
 * without the /api suffix is a broken build, not an unreachable dependency.
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

/**
 * A mistake in how the build is configured, as distinct from a dependency being
 * unreachable. Typed rather than matched on message text, because which of the
 * two it is decides whether the build stops.
 */
class ConfigError extends Error {}

const TIMEOUT_MS = 30_000;

function apiBase() {
  const raw = process.env.AZURE_FUNCTIONS_URL || process.env.VITE_AZURE_FUNCTIONS_URL || '';
  const base = raw.trim().replace(/\/+$/, '');
  if (!base) {
    throw new ConfigError(
      'AZURE_FUNCTIONS_URL is not set. It must be the API base INCLUDING the /api prefix, ' +
        'e.g. https://api-azure.hybridcloudworks.com/api'
    );
  }
  if (!/\/api$/.test(base)) {
    // The same trap functionsBase.js guards against: routes are registered
    // relative to /api, so a base without it 404s uniformly and the failure
    // looks like a missing endpoint rather than a missing path segment.
    throw new ConfigError(`AZURE_FUNCTIONS_URL must end in /api — got "${base}"`);
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
      [
        `GET ${url} -> HTTP ${response.status}`,
        `  server: ${server}${ray ? `  cf-ray: ${ray}` : ''}`,
        `  body:   ${snippet || '(empty)'}`,
      ].join('\n')
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
  // A configuration mistake is the build's own fault and fails it. An
  // unreachable or refusing API is not, and the site has a designed fallback
  // for exactly that.
  if (error instanceof ConfigError) {
    console.error(`[generate-public-data] FAILED: ${error.message}`);
    process.exit(1);
  }

  // ::warning:: is picked up by GitHub and shown on the run summary and on the
  // pull request, so this cannot pass unnoticed the way the old silent skip
  // did. That visibility is the whole difference between the two.
  console.log(`::warning::generate-public-data could not reach the API — ${error.message}`);
  console.error(`[generate-public-data] SKIPPED: ${error.message}`);
  console.error(
    '  The site falls back to fetchPublicSnapshotItems at runtime, which is the\n' +
      '  path these components already had. Visitors get correct data; it costs\n' +
      '  one extra API call on /about and the speaker widget. See issue #175.'
  );
  process.exit(0);
});
