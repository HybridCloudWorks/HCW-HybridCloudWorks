/**
 * cli.mjs — shared argument parsing, logging and connection helpers for the
 * data-migration scripts.
 */

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** The Firebase project the Site-Main deployment runs in. */
export const FIRESTORE_PROJECT_ID = 'hybridcloudworks-61e8d';

/** The one GCS bucket Site-Main writes to (`functions/index.js:119` et al.). */
export const GCS_BUCKET = 'hybridcloudworks-61e8d.appspot.com';

/**
 * True when running under the migration workflow. Two behaviours key off it:
 * sample/preview printing is refused (the repository is public, so job logs
 * are world-readable), and a downloaded service-account key is refused as a
 * credential (the workflow authenticates with Workload Identity Federation,
 * and a key file appearing there means someone bypassed it).
 */
export const IS_CI = process.env.MIGRATION_CI === '1';

/**
 * Whether document samples and field previews may be printed.
 *
 * Off by default and impossible to turn on in CI. The reports these scripts
 * write carry document ids and sampled field values; the repository is public,
 * so anything that reaches a job log or a workflow artifact is published.
 * Summaries (counts, container names, warning codes) are the only thing CI
 * emits — see writeReport().
 *
 * @param {boolean} requested  the --show-samples flag
 */
export function showSamples(requested) {
  if (!requested) return false;
  if (IS_CI) {
    throw new Error('--show-samples is refused when MIGRATION_CI=1: job logs on this repository are public');
  }
  return true;
}

/**
 * Parse argv into flags and options.
 *
 * Accepts both `--collections content,blogs` and `--collections=content,blogs`.
 * The previous implementation used `args.find(a => a.startsWith('--collections'))`
 * and then read the *next* argv entry, so `--collections=content` matched the
 * find, produced an undefined value, and fell through to "migrate everything" —
 * a scoped run silently becoming a full run.
 *
 * Unknown arguments are rejected rather than ignored, for the same reason.
 *
 * @param {string[]} argv
 * @param {{ flags: string[], options: string[] }} spec
 * @returns {{ flags: Record<string, boolean>, options: Record<string, string> }}
 */
export function parseArgs(argv, spec) {
  const flags = Object.fromEntries(spec.flags.map((f) => [f, false]));
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const eq = arg.indexOf('=');
    const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).trim();

    if (spec.flags.includes(name)) {
      if (eq !== -1) throw new Error(`--${name} is a flag and takes no value`);
      flags[name] = true;
      continue;
    }

    if (spec.options.includes(name)) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`--${name} requires a value`);
      }
      options[name] = value;
      continue;
    }

    throw new Error(
      `Unknown argument: --${name}\n` +
        `  flags:   ${spec.flags.map((f) => `--${f}`).join(' ') || '(none)'}\n` +
        `  options: ${spec.options.map((o) => `--${o} <value>`).join(' ') || '(none)'}`
    );
  }

  return { flags, options };
}

/** Split a comma-separated option value into a trimmed, non-empty list. */
export function splitList(value) {
  if (!value) return null;
  const list = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const line = '═'.repeat(63);

export const log = {
  banner(title, details = []) {
    process.stdout.write(`${line}\n  ${title}\n${line}\n`);
    for (const d of details) process.stdout.write(`  ${d}\n`);
    process.stdout.write(`${line}\n\n`);
  },
  section(title) {
    process.stdout.write(`\n--- ${title} ---\n\n`);
  },
  info(msg) {
    process.stdout.write(`${msg}\n`);
  },
  ok(msg) {
    process.stdout.write(`OK    ${msg}\n`);
  },
  warn(msg) {
    process.stdout.write(`WARN  ${msg}\n`);
  },
  error(msg) {
    process.stderr.write(`FAIL  ${msg}\n`);
  },
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * Write a full report and its redacted summary side by side.
 *
 * The full report (`<name>.json`) carries whatever the script found — document
 * ids, field previews, per-object paths. It stays on the machine that produced
 * it. The summary (`<name>.summary.json`) carries only what is safe to publish
 * from a public repository's workflow: counts, container names, warning codes
 * and their counts, pass/fail. The workflow uploads summaries and nothing else.
 *
 * Callers build the summary explicitly rather than this function deriving it,
 * because what counts as "safe" is a per-report judgement and a generic
 * redactor that guesses wrong fails silently.
 *
 * @param {string} path      full-report path, e.g. reports/migration-export.json
 * @param {object} full
 * @param {object} summary
 * @returns {{ fullPath: string, summaryPath: string }}
 */
export function writeReport(path, full, summary) {
  const summaryPath = path.replace(/\.json$/, '.summary.json');
  if (summaryPath === path) throw new Error(`Report path must end in .json: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(full, null, 2)}\n`);
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return { fullPath: path, summaryPath };
}

/** Count warnings by code — the publishable shape of a warnings list. */
export function tallyByCode(warnings) {
  const out = {};
  for (const w of warnings) out[w.code] = (out[w.code] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------------------------
// Firestore / GCS (Application Default Credentials)
// ---------------------------------------------------------------------------

/**
 * Describe the credential ADC will resolve, without loading it.
 *
 * ADC resolves, in order: GOOGLE_APPLICATION_CREDENTIALS (a file), then the
 * gcloud user credential, then the metadata server. Only the first is
 * inspectable from here; the `type` field in that file says which shape it is:
 *
 *   external_account   Workload Identity Federation — what the workflow uses.
 *                      No key exists; the file holds a pointer to the OIDC
 *                      token and the STS endpoint that exchanges it.
 *   authorized_user    `gcloud auth application-default login` — an operator
 *                      at a terminal.
 *   service_account    a downloaded key. Refused in CI; discouraged anywhere.
 */
function describeAdc() {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) return { source: 'gcloud user credential or metadata server', type: null };
  try {
    const { type } = JSON.parse(readFileSync(path, 'utf8'));
    return { source: path, type: type ?? 'unknown' };
  } catch {
    return { source: path, type: 'unreadable' };
  }
}

let firestoreApp = null;

/**
 * Connect to the Site-Main Firestore project, read-only by intent.
 *
 * Uses Application Default Credentials rather than a key file. The previous
 * implementation did `cert(JSON.parse(readFileSync(GOOGLE_APPLICATION_CREDENTIALS)))`,
 * which validates `private_key` and `client_email` and therefore throws on a
 * Workload Identity Federation credential file — the only credential the
 * migration workflow has. `applicationDefault()` is a thin wrapper over
 * google-auth-library's GoogleAuth, which consumes external_account files
 * natively.
 *
 * The project id is explicit because an external_account file carries none.
 *
 * @returns {{ firestore: import('firebase-admin/firestore').Firestore, credential: string }}
 */
export function connectFirestore() {
  const adc = describeAdc();

  if (IS_CI && adc.type === 'service_account') {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS points at a service-account KEY, but MIGRATION_CI=1. ' +
        'The workflow authenticates with Workload Identity Federation; a key file here means it was bypassed.'
    );
  }

  if (!firestoreApp) {
    firestoreApp =
      getApps()[0] ??
      initializeApp({
        credential: applicationDefault(),
        projectId: FIRESTORE_PROJECT_ID,
      });
  }

  const credential = adc.type ? `${adc.type} (${adc.source})` : adc.source;
  return { firestore: getFirestore(firestoreApp), credential };
}

// ---------------------------------------------------------------------------
// Azure Blob Storage
// ---------------------------------------------------------------------------

/**
 * Connect to an Azure storage account's blob service with Entra credentials.
 *
 * No key path at all. The account denies public traffic and the deploy
 * identity reaches it through a per-run firewall window the workflow opens;
 * Storage Blob Data Contributor on the account is the whole authorization.
 *
 * @param {string} accountName
 * @returns {{ service: BlobServiceClient, accountName: string, endpoint: string }}
 */
export function connectBlob(accountName) {
  if (!accountName) throw new Error('Set STORAGE_ACCOUNT to the target storage account name');
  const endpoint = `https://${accountName}.blob.core.windows.net`;
  const service = new BlobServiceClient(endpoint, new DefaultAzureCredential());
  return { service, accountName, endpoint };
}

// ---------------------------------------------------------------------------
// Cosmos DB
// ---------------------------------------------------------------------------

/**
 * Connect to Cosmos DB with Entra credentials.
 *
 * `DefaultAzureCredential` only, matching `functions/src/lib/cosmos-client.js`.
 * There is deliberately no key path. `cosmos_local_auth_disabled = true` on the
 * production account, and the scratch account is created the same way, so a
 * key could only ever work against an account configured differently from the
 * one the rehearsal exists to rehearse for. A key-authenticated import that
 * passes proves nothing about the path production will take.
 *
 * COSMOS_KEY set in the environment is an error rather than a fallback, so a
 * stale value cannot silently select a different auth path.
 *
 * @returns {{ client: CosmosClient, database: import('@azure/cosmos').Database, endpoint: string, databaseId: string, auth: string }}
 */
export function connectCosmos() {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const databaseId = process.env.COSMOS_DATABASE || 'hcw';

  if (!endpoint) {
    throw new Error('Set COSMOS_ENDPOINT, and sign in with `az login` (or run under azure/login) for RBAC');
  }
  if (process.env.COSMOS_KEY) {
    throw new Error(
      'COSMOS_KEY is set. Key authentication is disabled on every account this tooling targets; ' +
        'unset it — the credential is DefaultAzureCredential.'
    );
  }

  const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });

  return {
    client,
    database: client.database(databaseId),
    endpoint,
    databaseId,
    auth: 'Entra ID (DefaultAzureCredential)',
  };
}

/**
 * Classify a Cosmos failure into the cause an operator has to fix.
 *
 * Two different problems both surface as a 403 from this tooling, and the
 * error text is the only thing that separates them:
 *
 *   firewall   "Request originated from IP ... through public internet" —
 *              the runner is not admitted. On the production account that
 *              means cosmos_allow_azure_datacenter_ips was turned off; on a
 *              scratch account it means the sentinel was not set.
 *   rbac       "cannot be authorized by AAD token in data plane" — the
 *              identity reached Cosmos and was refused: it lacks a Cosmos SQL
 *              role at the scope being touched. Database-scope Data
 *              Contributor is what the migration needs; the deploy identity
 *              holds only two container-scoped grants on production today.
 *   token      401 — no usable Entra token at all (not signed in; OIDC
 *              exchange failed).
 *
 * @param {Error & { code?: number, statusCode?: number }} err
 * @returns {{ cause: 'firewall'|'rbac'|'token'|'not-found'|'unknown', status: number|null, hint: string }}
 */
export function classifyCosmosError(err) {
  const status = err.code ?? err.statusCode ?? null;
  const text = String(err.message ?? err);

  if (/Request originated from|blocked by your Cosmos DB account firewall|IP address.*not allowed/i.test(text)) {
    return {
      cause: 'firewall',
      status,
      hint: 'Runner not admitted by the account firewall. Check cosmos_allow_azure_datacenter_ips (production) or the scratch account ip_range_filter.',
    };
  }
  if (/cannot be authorized by AAD token|Request blocked by Auth|does not have the required permission/i.test(text) || status === 403) {
    return {
      cause: 'rbac',
      status,
      hint: 'Identity reached Cosmos and was refused. Grant Cosmos DB Built-in Data Contributor (…0002) at DATABASE scope for this identity on this account.',
    };
  }
  if (status === 401) {
    return { cause: 'token', status, hint: 'No Entra token. Sign in with `az login`, or check the azure/login step ran before this one.' };
  }
  if (status === 404) {
    return { cause: 'not-found', status, hint: 'Database or container does not exist on this account — has Terraform applied here?' };
  }
  return { cause: 'unknown', status, hint: text.slice(0, 200) };
}

/**
 * Run an operation, retrying on Cosmos throttling (429) and transient 503s.
 * Honours `retryAfterInMs` when Cosmos supplies it.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, label?: string }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { attempts = 5, label = 'operation' } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const code = err.code ?? err.statusCode;
      const retryable = code === 429 || code === 503 || code === 'ETIMEDOUT' || code === 'ECONNRESET';
      if (!retryable || attempt === attempts) throw err;

      const suggested = err.retryAfterInMs ?? err.retryAfterInMilliseconds ?? 0;
      const backoff = Math.max(suggested, 2 ** (attempt - 1) * 250);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw lastError;
}

/**
 * Run tasks with bounded concurrency, preserving input order in the results.
 *
 * @template TIn, TOut
 * @param {TIn[]} items
 * @param {number} limit
 * @param {(item: TIn, index: number) => Promise<TOut>} worker
 * @returns {Promise<TOut[]>}
 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
