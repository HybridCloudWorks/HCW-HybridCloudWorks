/**
 * The API-keys page: seed a credential from the admin portal, never read one back.
 *
 * ## The problem
 *
 * Rotating a key meant opening a Key Vault firewall window for your own IP,
 * running `scripts/cutover/06-seed-secret.ps1` from a desktop with the Azure CLI
 * signed in, and closing the window again. Three steps, one of which leaves the
 * production vault open to the internet if the operator walks away — a mistake
 * this repository has already made once. The app itself has none of that
 * problem: it is inside the integration subnet, so the vault's `default_action
 * = "Deny"` already admits it. It needed permission, not a network change.
 *
 * ## What this will not do
 *
 * **Return a secret's value, ever.** Not masked, not the last four characters,
 * not once. `secret-vault.js` has no read function and the app's custom vault
 * role has no `getSecret` action, so a future change that tries would get a 403
 * rather than a value. `admin-secrets.test.js` asserts the responses cannot
 * contain a seeded value even by accident.
 *
 * **Write a name Terraform does not reference.** `secret-catalog.js` is checked
 * against `infra/main.tf` in CI. A secret with no app setting pointing at it is
 * unreachable by application code, so seeding one creates a live credential
 * that nothing consumes and nobody owns.
 *
 * ## The four lights
 *
 * The owner asked for three — green, red, gray. The platform forces a fourth,
 * and leaving it out would make the page lie:
 *
 * - **gray / `never`** — `process.env` holds the literal `@Microsoft.KeyVault(…)`
 *   reference, or nothing. Never seeded, or the reference is not resolving.
 * - **amber / `pending`** — written AFTER this worker started. Environment
 *   variables are materialised at process start, so this worker's value cannot
 *   be the new one yet. Not a guess: a strict fact about when the write landed.
 * - **red / `failing`** — resolved to a real value, and the upstream service
 *   rejected it more recently than it accepted it. The one state
 *   `secrets-health.js` says it cannot see: "a setting whose reference resolves
 *   to the WRONG secret … only the upstream service can say it is wrong."
 * - **green / `live`** — resolved, and nothing has reported it broken.
 *
 * Amber clears when the worker answering the request started after the write.
 * On Flex Consumption workers recycle often, and the refresh call in
 * `secret-vault.js` makes the new value available to each new worker
 * immediately instead of on the 24-hour reference cache. Two workers can
 * therefore disagree for a few minutes, and the honest answer is the one the
 * answering worker can see.
 */

import { randomBytes } from 'node:crypto';

import { ADMIN_CONFIG_PARTITION } from './cosmos-client.js';
import { isUnresolvedReference } from './secrets-health.js';
import {
  SECRET_CATALOG,
  SECRET_SECTIONS,
  findBySecretName,
  isGeneratable,
  settingToSecret,
} from './secret-catalog.js';
import { refreshKeyVaultReferences, setVaultSecret } from './secret-vault.js';

// Re-exported so the AI router has one import for the whole feature.
export { settingToSecret };

/** The single `admin_config` document holding per-secret state. */
export const SECRET_STATE_DOC_ID = 'secret_state';

/** Shortest value accepted. Every real credential in this estate is far longer. */
export const MIN_SECRET_LENGTH = 12;

/**
 * Values that are obviously not credentials.
 *
 * TODO.md's rule is "do not seed a placeholder to quiet a linter" — a
 * placeholder turns a gray light green while the feature stays just as broken,
 * which is strictly worse than absent because nobody looks at it again.
 */
const PLACEHOLDER_PATTERN =
  /^(changeme|change-me|placeholder|todo|tbd|test|example|your[-_]?key([-_]?here)?|xxx+|<.*>)$/i;

/** Roles allowed to see or change credentials. Nothing below the top. */
export const SECRETS_ROLE = 'super_admin';

/**
 * When this worker process started, in epoch ms.
 *
 * `process.uptime()` rather than a module-load timestamp: a module imported
 * lazily would otherwise report a start time later than the environment it is
 * reasoning about, and amber would clear a moment too early.
 */
export function processStartedAt(now = Date.now(), uptimeSeconds = process.uptime()) {
  return now - Math.round(uptimeSeconds * 1000);
}

/**
 * Reject a value before it reaches the vault.
 *
 * Ported from `06-seed-secret.ps1`, which refuses the same things for the same
 * reasons. A bad value written to the vault is worse than a rejected paste: it
 * shows green and fails upstream.
 *
 * @returns {string|null} the reason it is unacceptable, or null
 */
export function rejectSecretValue(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return 'no value was supplied';
  if (raw !== raw.trim()) {
    // Copying from a terminal or a PDF picks up a trailing newline or NBSP.
    // The vault stores it happily and the upstream service rejects it, which
    // presents as "the key is wrong" rather than "the key has a space on it".
    return 'the value has leading or trailing whitespace — copy it again without the surrounding space';
  }
  if (raw.startsWith('@Microsoft.KeyVault(')) {
    return 'that is a Key Vault REFERENCE, not a secret value — paste the credential itself';
  }
  if (raw.length < MIN_SECRET_LENGTH) {
    return `the value is shorter than ${MIN_SECRET_LENGTH} characters, which no credential in this estate is`;
  }
  if (PLACEHOLDER_PATTERN.test(raw)) {
    return 'that looks like a placeholder — a placeholder turns the light green while the feature stays broken';
  }
  return null;
}

/**
 * Which light one secret shows.
 *
 * Pure, so the state machine is testable without Cosmos, Azure or a clock.
 *
 * @param {{setting: string}} entry catalogue entry
 * @param {object} ctx
 * @param {Record<string, unknown>} ctx.env
 * @param {object} ctx.record per-secret state, may be empty
 * @param {number} ctx.startedAt when this worker started, epoch ms
 * @returns {'never'|'pending'|'failing'|'live'}
 */
export function computeSecretState(entry, { env = {}, record = {}, startedAt = 0 } = {}) {
  const written = Date.parse(record?.lastWriteAt ?? '');

  // A write this worker cannot yet have seen. Checked BEFORE the env read: a
  // rotation over an already-live key leaves a real value in env, and calling
  // that green would report the OLD credential as the new one's status.
  if (Number.isFinite(written) && written > startedAt) return 'pending';

  const value = env?.[entry.setting];
  if (typeof value !== 'string' || !value.trim() || isUnresolvedReference(value)) return 'never';

  const failedAt = Date.parse(record?.lastFailAt ?? '');
  if (Number.isFinite(failedAt)) {
    const okAt = Date.parse(record?.lastOkAt ?? '');
    if (!Number.isFinite(okAt) || failedAt > okAt) return 'failing';
  }
  return 'live';
}

const strOrNull = (value) => (typeof value === 'string' && value ? value : null);

/**
 * Everything the page renders for one secret — and nothing else.
 *
 * Deliberately built by naming each field rather than spreading `record`: a
 * spread would carry any field a future writer added, and the one field this
 * response must never carry is a value.
 */
export function presentSecret(entry, ctx) {
  const record = ctx.record ?? {};
  return {
    secret: entry.secret,
    setting: entry.setting,
    section: entry.section,
    label: entry.label,
    help: entry.help,
    state: computeSecretState(entry, ctx),
    generatable: isGeneratable(entry.secret),
    hasLivenessCheck: Boolean(entry.probe),
    lastWriteAt: strOrNull(record.lastWriteAt),
    lastWriteBy: strOrNull(record.lastWriteBy),
    lastOkAt: strOrNull(record.lastOkAt),
    lastFailAt: strOrNull(record.lastFailAt),
    lastFailStatus: Number.isFinite(record.lastFailStatus) ? record.lastFailStatus : null,
  };
}

async function readState(store) {
  const doc = await store.readDoc('admin_config', SECRET_STATE_DOC_ID, ADMIN_CONFIG_PARTITION);
  return doc?.secrets && typeof doc.secrets === 'object' ? doc.secrets : {};
}

async function writeState(store, secrets) {
  await store.upsertDoc('admin_config', {
    id: SECRET_STATE_DOC_ID,
    configScope: ADMIN_CONFIG_PARTITION,
    secrets,
  });
}

/**
 * Record how an upstream service answered for a credential.
 *
 * This is what turns a light red, and back green again. Called from the AI
 * router, which already distinguishes "the key was rejected" (401/403) from
 * "the request was bad" — see `isProviderUnusable`.
 */
export async function recordSecretVerdict(store, secretName, { ok, status = null, now = () => new Date().toISOString() }) {
  if (!store || !findBySecretName(secretName)) return;
  const secrets = await readState(store);
  const previous = secrets[secretName] ?? {};
  secrets[secretName] = ok
    ? { ...previous, lastOkAt: now() }
    : { ...previous, lastFailAt: now(), lastFailStatus: Number.isFinite(status) ? status : null };
  await writeState(store, secrets);
}

/**
 * @param {object} deps
 * @param {{requireRole: Function}} deps.guard
 * @param {object} deps.store readDoc/upsertDoc over Cosmos
 */
export function createAdminSecretHandlers({
  guard,
  store,
  env = process.env,
  now = () => new Date().toISOString(),
  startedAt = null,
  vault = { setVaultSecret, refreshKeyVaultReferences },
  randomSecret = defaultRandomSecret,
  log = console,
}) {
  const workerStartedAt = () => startedAt ?? processStartedAt();

  /** Every secret and its light. Values are never included. */
  async function getSecretStatus(request, context) {
    const auth = await guard.requireRole(request, SECRETS_ROLE);
    if (auth.error) return auth.error;

    const secrets = await readState(store);
    const ctx = { env, startedAt: workerStartedAt() };

    return {
      status: 200,
      jsonBody: {
        success: true,
        sections: SECRET_SECTIONS,
        secrets: SECRET_CATALOG.map((entry) =>
          presentSecret(entry, { ...ctx, record: secrets[entry.secret] ?? {} })
        ),
      },
    };
  }

  /** Seed or rotate one secret. */
  async function putSecret(request, context) {
    const auth = await guard.requireRole(request, SECRETS_ROLE);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const name = String(body?.secret ?? '');
    const entry = findBySecretName(name);

    if (!entry) {
      // Named, because the catalogue is not sensitive — it is derived from
      // Terraform, which is in the repository.
      return bad(400, `${name || 'that name'} is not a secret this estate declares`);
    }

    let value = typeof body?.value === 'string' ? body.value : '';
    if (body?.generate === true) {
      if (!isGeneratable(name)) {
        return bad(
          400,
          `${name} is issued by an upstream service — a generated value would be wrong, not weak`
        );
      }
      value = randomSecret();
    }

    const rejection = rejectSecretValue(value);
    if (rejection) return bad(400, rejection);

    let version = null;
    try {
      ({ version } = await vault.setVaultSecret(name, value, { env }));
    } catch (error) {
      // The message names the secret and the HTTP status, never the body.
      log.error?.(`[admin-secrets] could not set ${name}: ${error?.message ?? error}`);
      return bad(502, `Key Vault refused the write for ${name}. The value was not stored.`);
    }

    // The secret is safely in the vault from here on. Nothing below may fail
    // the request — see secret-vault.js on why the refresh is best-effort.
    const refresh = await vault.refreshKeyVaultReferences({ env });

    const secrets = await readState(store);
    secrets[name] = {
      ...(secrets[name] ?? {}),
      lastWriteAt: now(),
      lastWriteBy: auth.user?.oid ?? auth.user?.preferred_username ?? 'unknown',
      lastWriteVersion: version,
      // A rotation makes any previous verdict meaningless: the old key's 401
      // says nothing about the new one.
      lastOkAt: null,
      lastFailAt: null,
      lastFailStatus: null,
    };
    await writeState(store, secrets);

    return {
      status: 200,
      jsonBody: {
        success: true,
        secret: presentSecret(entry, {
          env,
          record: secrets[name],
          startedAt: workerStartedAt(),
        }),
        refreshed: refresh.refreshed,
        // What the operator should expect, in the words of what actually happened.
        message: refresh.refreshed
          ? 'Stored. New workers pick it up immediately; this one keeps the old value until it recycles.'
          : `Stored. It goes live within 24 hours or at the next deploy (${refresh.reason}).`,
      },
    };
  }

  return { getSecretStatus, putSecret };
}

function bad(status, message) {
  return { status, jsonBody: { success: false, error: message } };
}

/** 48 random bytes, base64url. Used only for values this estate invents. */
function defaultRandomSecret() {
  return randomBytes(48).toString('base64url');
}
