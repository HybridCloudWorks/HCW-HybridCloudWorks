/**
 * The agent's API settings, read from the environment in one place.
 *
 * Two entry points need them: index.js, the long-running agent, and
 * bin/report-coder-automation.js, the one-shot the lab host's Coder upkeep
 * calls (2026-10-08). Both are started with the same environment file
 * (labs-agent.env, rendered by the labs_agent role from
 * vps-agent/.env.example's names), so both must read the same names the
 * same way, and the one-shot must not grow a second, slightly different
 * idea of where the API is or which agent it is. These six lines were
 * index.js's, moved unchanged.
 *
 * ONLY THE API SETTINGS. The job limits and the poll interval stay in
 * index.js, as `process.env.LABS_AGENT_* || <default>`, because
 * lab-image/sandbox-check.mjs and scripts/lab-job-limits.test.mjs read
 * those defaults from index.js's source text (it cannot be imported: it
 * starts the agent), and the one-shot has no use for them.
 *
 * Nothing here is a secret: the certificate is a PATH, read by the Entra
 * credential when a token is needed (lib/api.js).
 */
import os from 'node:os';

/** The settings the API client cannot work without, by environment name. */
export const REQUIRED_SETTINGS = Object.freeze([
  ['LABS_AGENT_API_BASE', 'apiBase'],
  ['LABS_AGENT_TENANT_ID', 'tenantId'],
  ['LABS_AGENT_CLIENT_ID', 'clientId'],
  ['LABS_AGENT_CERT_PATH', 'certificatePath'],
  ['LABS_AGENT_API_SCOPE', 'scope'],
]);

/**
 * What lib/api.js's createApiClient takes.
 *
 * @param {Record<string, string|undefined>} [env]
 * @param {() => string} [hostname] - LABS_AGENT_ID's fallback, as it always was
 */
export function readApiConfig(env = process.env, hostname = os.hostname) {
  return {
    apiBase: (env.LABS_AGENT_API_BASE || '').replace(/\/+$/, ''),
    tenantId: env.LABS_AGENT_TENANT_ID,
    clientId: env.LABS_AGENT_CLIENT_ID,
    certificatePath: env.LABS_AGENT_CERT_PATH,
    scope: env.LABS_AGENT_API_SCOPE,
    agentId: env.LABS_AGENT_ID || hostname(),
  };
}

/** The environment names of the required settings `config` lacks, in REQUIRED_SETTINGS order. */
export function missingConfig(config) {
  return REQUIRED_SETTINGS.filter(([, key]) => !config[key]).map(([name]) => name);
}
