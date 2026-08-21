#!/usr/bin/env node

/**
 * migration-probe.mjs
 *
 * One read against the target Cosmos account, and a named cause when it fails.
 *
 * Two different problems both surface from this tooling as a 403, and they
 * need opposite fixes:
 *
 *   firewall  the runner is not admitted to the account. Production admits
 *             Azure datacenter IPs (the "0.0.0.0" sentinel) precisely so
 *             GitHub-hosted runners pass — if that was turned off, or the
 *             scratch account was created without it, the request never
 *             reaches authorization.
 *   rbac      the request reached Cosmos and the identity was refused. The
 *             migration needs Cosmos DB Built-in Data Contributor at DATABASE
 *             scope; the deploy identity holds only two container-scoped
 *             grants on production today. The healer workflow's 2026-08-20
 *             failure was this shape.
 *
 * Without this step an export runs to completion, the import fails on its
 * first upsert, and the error names neither cause. With it, the workflow
 * stops before the export and says which one.
 *
 * Read-only: a `SELECT VALUE COUNT(1)` on one container. Writes
 * reports/connectivity-probe.json and its summary. Exits 1 on any failure.
 *
 * Usage:
 *   COSMOS_ENDPOINT=https://<account>.documents.azure.com:443/ node scripts/migration-probe.mjs
 *   node scripts/migration-probe.mjs --container content --report reports/probe.json
 */

import { parseArgs, log, connectCosmos, classifyCosmosError, writeReport } from './lib/cli.mjs';

let args;
try {
  args = parseArgs(process.argv.slice(2), { flags: [], options: ['container', 'report'] });
} catch (err) {
  log.error(err.message);
  process.exit(1);
}

const containerName = args.options.container ?? 'content';
const reportPath = args.options.report ?? 'reports/connectivity-probe.json';

async function main() {
  let cosmos;
  try {
    cosmos = connectCosmos();
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }

  log.banner('Cosmos connectivity probe', [
    `Target: ${cosmos.endpoint}`,
    `Database: ${cosmos.databaseId}`,
    `Container: ${containerName}`,
    `Auth: ${cosmos.auth}`,
  ]);

  const started = Date.now();
  const result = {
    generatedAt: new Date().toISOString(),
    endpoint: cosmos.endpoint,
    database: cosmos.databaseId,
    container: containerName,
    ok: false,
    count: null,
    elapsedMs: null,
    cause: null,
    status: null,
    hint: null,
  };

  try {
    const { resources } = await cosmos.database
      .container(containerName)
      .items.query('SELECT VALUE COUNT(1) FROM c')
      .fetchAll();
    result.ok = true;
    result.count = resources[0] ?? 0;
    result.elapsedMs = Date.now() - started;
    log.ok(`Reached ${containerName} — ${result.count} document(s), ${result.elapsedMs} ms`);
  } catch (err) {
    const classified = classifyCosmosError(err);
    result.elapsedMs = Date.now() - started;
    result.cause = classified.cause;
    result.status = classified.status;
    result.hint = classified.hint;
    log.error(`Cannot reach ${containerName}: ${classified.cause.toUpperCase()}${classified.status ? ` (HTTP ${classified.status})` : ''}`);
    log.error(`  ${classified.hint}`);
  }

  // The probe result contains nothing sensitive — endpoint, a count, a cause
  // — so full and summary are the same document.
  const { summaryPath } = writeReport(reportPath, result, result);
  log.ok(`Report written to ${reportPath} (summary: ${summaryPath})`);

  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  log.error(err.stack ?? String(err));
  process.exit(1);
});
