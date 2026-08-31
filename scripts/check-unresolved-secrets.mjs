#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

// Report app settings whose Key Vault reference is NOT resolving (T-720).
//
// WHY THIS IS A WORKFLOW AND NOT THE ALERT RULE THE TRACKER ASKED FOR.
//
// TODO.md carried "a scheduled-query alert on unresolvedSecrets ... needs an
// apply" for weeks. There was nothing to apply, and there could not be: the
// count exists only as a field in the /api/health RESPONSE BODY. Nothing writes
// it to Log Analytics, so a scheduled-query rule would run against a table that
// never receives it and return zero rows forever — an alert that reads as
// healthy precisely because it can never fire.
//
// The obvious second design fails too. A workflow cannot simply curl
// /api/health: through Cloudflare a GitHub-hosted runner gets a Bot Fight Mode
// 403, and direct to origin it gets the origin lock's 403, because the site
// denies every address outside Cloudflare's ranges. validate-deployed.yml
// documents that it cannot pass from a runner for exactly this reason.
//
// So this reads the CONDITION through ARM instead, which is the same argument
// monitor-functions-registered.yml already makes and wins on the same axes: it
// survives the Log Analytics daily cap that silences every rule in
// observability.tf, it does not traverse Cloudflare, it needs no metric that
// does not exist, and it names WHICH setting is broken rather than a count.
//
// NAMES, NEVER VALUES. A reference that fails to resolve is a credential
// problem, and the standing rule in this repository is that a missing
// credential is recorded by name, owner and location — never by value. This
// prints setting names and statuses. It deliberately does not print the vault
// URI, which carries the vault name, secret name and version.

/** Statuses the platform reports for a healthy reference. */
export const HEALTHY_STATUS = 'resolved';

/**
 * Pull {name, status, details} out of an ARM KeyVaultReferenceCollection.
 *
 * TWO SHAPES ARE ACCEPTED because the payload could not be verified against a
 * live tenant from the environment this was written in, and shipping a guess
 * that silently reports "healthy" is the exact failure this whole file exists
 * to avoid. Anything that matches NEITHER shape throws — see the note on
 * assertKnownShape. If a future run proves only one shape real, delete the
 * other; do not relax the throw.
 */
export function parseReferenceStatuses(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('The ARM response was not a JSON object.');
  }

  // Shape A: { properties: { keyToReferenceStatuses: { NAME: {status, ...} } } }
  const map = payload?.properties?.keyToReferenceStatuses;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    return Object.entries(map).map(([name, entry]) => ({
      name,
      status: typeof entry?.status === 'string' ? entry.status : '(no status reported)',
      details: typeof entry?.details === 'string' ? entry.details : '',
    }));
  }

  // Shape B: { value: [ { name, properties: { status, ... } } ] }
  if (Array.isArray(payload?.value)) {
    return payload.value.map((row) => ({
      name: typeof row?.name === 'string' ? row.name : '(unnamed)',
      status:
        typeof row?.properties?.status === 'string'
          ? row.properties.status
          : '(no status reported)',
      details: typeof row?.properties?.details === 'string' ? row.properties.details : '',
    }));
  }

  return null;
}

/**
 * Turn an unrecognised payload into a stop, not a clean bill of health.
 *
 * This is the same guard as workspace-query.psm1's row-shape assertion, for the
 * same reason. A call that succeeds and answers a different question is worse
 * than one that fails, because its output looks like data. On 2026-08-30 a
 * truncated query reported 57,984 invocations and no worker traces in the same
 * run, and both numbers were real — about the wrong subject.
 */
export function assertKnownShape(statuses, raw) {
  if (statuses !== null) return statuses;
  const keys = raw && typeof raw === 'object' ? Object.keys(raw).join(', ') : String(raw);
  throw new Error(
    'The ARM response carried neither known Key Vault reference shape ' +
      `(top-level keys: ${keys || '(none)'}). This is NOT "every reference is healthy" — ` +
      'the shape was not understood, so nothing about the references is known. ' +
      'Read the payload by hand before trusting any run of this check.',
  );
}

/** References that are not reporting healthy. Comparison is case-insensitive. */
export function unresolvedFrom(statuses) {
  return statuses.filter((s) => String(s.status).toLowerCase() !== HEALTHY_STATUS);
}

/** One line per finding: name and status only. No vault URI, no value. */
export function formatReport(unresolved) {
  return unresolved
    .map((s) => `  ${s.name}: ${s.status}${s.details ? ` — ${s.details}` : ''}`)
    .join('\n');
}

export function evaluate(payload) {
  const statuses = assertKnownShape(parseReferenceStatuses(payload), payload);
  const unresolved = unresolvedFrom(statuses);
  return { checked: statuses.length, unresolved };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const text = await readStdin();
  if (!text.trim()) {
    console.error('No ARM response on stdin. Nothing was checked.');
    process.exit(2);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    console.error(`The ARM response was not valid JSON: ${err.message}`);
    process.exit(2);
  }

  let result;
  try {
    result = evaluate(payload);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  if (result.unresolved.length === 0) {
    console.log(`All ${result.checked} Key Vault reference(s) are resolving.`);
    process.exit(0);
  }

  console.error(
    `${result.unresolved.length} of ${result.checked} Key Vault reference(s) are NOT resolving:`,
  );
  console.error(formatReport(result.unresolved));
  console.error('');
  console.error(
    'Each one is a feature that has quietly turned itself off in production: the code ' +
      'takes a clean fallback path, so there is no exception in Application Insights. ' +
      'Unseeded, RBAC revoked, vault firewall denying, and rotated-and-broken all look ' +
      'identical from here — the status above narrows it.',
  );
  process.exit(1);
}

// pathToFileURL, not a `file://` template — matching check-tfc-plan.mjs:301.
// Node resolves process.argv[1] to an absolute path, so the naive form does
// match for an ordinary invocation. It stops matching when the path needs
// escaping: pathToFileURL percent-encodes a space, and string concatenation
// does not, so the two URLs differ and main() silently never runs. The process
// then exits 0 having checked nothing — a monitor reporting healthy because it
// did not execute, which is the same failure this file's shape assertion
// exists to prevent, one layer up. check-unresolved-secrets.invocation.test.mjs
// pins it by spawning the script for real.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
