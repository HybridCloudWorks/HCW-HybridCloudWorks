/**
 * cli.mjs — shared argument parsing, logging and connection helpers for the
 * data-migration scripts.
 */

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

/** The Firebase project the Site-Main deployment runs in. */
export const FIRESTORE_PROJECT_ID = 'hybridcloudworks-61e8d';

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
// Cosmos DB
// ---------------------------------------------------------------------------

/**
 * Connect to Cosmos DB.
 *
 * Prefers Entra credentials (`DefaultAzureCredential`) to match
 * `functions/src/lib/cosmos-client.js`, which runs on managed identity and
 * explicitly requires that COSMOS_KEY not be set. A key is still accepted for
 * a scratch account, because the rehearsal runs Migration_Plan §5 asks for are
 * usually against a throwaway account that has no RBAC assignments yet.
 *
 * @returns {{ client: CosmosClient, database: import('@azure/cosmos').Database, endpoint: string, auth: string }}
 */
export function connectCosmos() {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const databaseId = process.env.COSMOS_DATABASE || 'hcw';
  const key = process.env.COSMOS_KEY;

  if (!endpoint) {
    throw new Error('Set COSMOS_ENDPOINT (and either COSMOS_KEY, or sign in with `az login` for RBAC)');
  }

  const client = key
    ? new CosmosClient({ endpoint, key })
    : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });

  return {
    client,
    database: client.database(databaseId),
    endpoint,
    databaseId,
    auth: key ? 'account key' : 'Entra ID (DefaultAzureCredential)',
  };
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
