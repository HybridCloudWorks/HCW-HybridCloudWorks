/**
 * mcp-policy.js — what an MCP server document may name, and how its
 * credential is resolved (ADR 0033, security finding). Split from mcp.js,
 * which re-exports everything here, so the transport and the policy read as
 * two pages. Every check is the same as it was in mcp.js: a disallowed key
 * name resolves to no header, a plain-http URL off loopback is refused, and
 * an unresolved Key Vault reference is not a secret.
 */

/**
 * Treat an environment value as a usable secret only when it is resolved.
 * Azure Key Vault references that fail to resolve arrive as a literal string;
 * sending that literal as a bearer token creates a misleading upstream 401.
 */
export function readMcpSecret(env, name) {
  if (!name || typeof env?.[name] !== 'string') return '';
  const value = env[name].replace(/^﻿/, '').trim();
  if (!value || value.startsWith('@Microsoft.KeyVault(')) return '';
  return value;
}

/**
 * The app settings an MCP server may name as its bearer key (ADR 0033,
 * security finding). Until this, `apiKeyEnvVar` was any string: an editor
 * could save a custom server at a URL they control with
 * `apiKeyEnvVar: "COSMOS_CONNECTION_STRING"` and receive that setting as a
 * Bearer header on the next Sync. The allowlist is the MCP_* namespace plus
 * the integration keys the seeded servers already use; anything else is
 * refused at save time and again at call time.
 */
export const MCP_KEY_ENV_PATTERN = /^MCP_[A-Z0-9_]+$/;
export const KNOWN_INTEGRATION_KEY_NAMES = Object.freeze([
  'FIRECRAWL_API_KEY',
  'REPLICATE_API_KEY',
  'VPS_API_TOKEN',
]);

/**
 * Validate the name of the app setting a server reads its key from. Empty
 * (no key, or OAuth) is fine and returns null; a name outside the allowlist
 * throws with the rule in the message.
 */
export function validateMcpApiKeyEnvVar(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error('apiKeyEnvVar must be a string app-setting name or empty');
  }
  const name = value.trim();
  if (!name) return null;
  if (MCP_KEY_ENV_PATTERN.test(name) || KNOWN_INTEGRATION_KEY_NAMES.includes(name)) {
    return name;
  }
  throw new Error(
    `apiKeyEnvVar must be an MCP_* app setting or one of ${KNOWN_INTEGRATION_KEY_NAMES.join(', ')}; "${name}" is not allowed`
  );
}

/** Resolve OAuth first, then the configured Azure Function App setting. */
export function resolveMcpAuthHeaders({ oauthToken, apiKeyEnvVar, env = process.env }) {
  const stored = typeof oauthToken === 'string' ? oauthToken.replace(/^﻿/, '').trim() : '';
  // A disallowed name resolves to no header, never to the setting it names:
  // the save-time check is the first line, this is the one that holds for a
  // document written before the allowlist existed.
  let keyName = null;
  try {
    keyName = validateMcpApiKeyEnvVar(apiKeyEnvVar);
  } catch {
    keyName = null;
  }
  const bearerToken = stored || readMcpSecret(env, keyName);
  return bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {};
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Reject malformed or credential-bearing URLs before making an outbound call.
 * https is required (ADR 0033): a bearer token over plain http is readable on
 * the wire. The one exception is a loopback host, where no wire is crossed —
 * the seeded Hostinger entry points at localhost.
 */
export function validateMcpUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('MCP server URL must be a valid URL');
  }
  if (parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('MCP server URL must use https (http is allowed for localhost only)');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('MCP server URL must use https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('MCP server URL must not contain embedded credentials');
  }
  return parsed.toString();
}
