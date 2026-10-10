/**
 * read-setting.js — an app setting that is actually set.
 *
 * Non-empty, and not the literal an unseeded Key Vault reference resolves
 * to (`@Microsoft.KeyVault(…)`), which arrives in `process.env` as a string
 * like any other value. Same normalisation as the AI router's `readKey`,
 * without importing the router into a public read. Lifted out of
 * lib/labs/coder-status.js (ADR 0035) so the AddOn status proxy
 * (lib/addons/status.js) reads settings the same way without importing the
 * labs module; coder-status.js re-exports it, so nothing that imported it
 * from there changed.
 */
import { isUnresolvedReference } from '../secrets-health.js';

/**
 * @param {Record<string, string|undefined>|undefined} env
 * @param {string} name
 * @returns {string} the trimmed value, or '' when absent, blank or unresolved
 */
export function readSetting(env, name) {
  const raw = env?.[name];
  if (typeof raw !== 'string') return '';
  const value = raw.replace(/^﻿/, '').trim();
  return isUnresolvedReference(value) ? '' : value;
}
