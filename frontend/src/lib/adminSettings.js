/**
 * Admin integration settings — small API-backed settings doc so values like
 * the Sessionize speaker ID are editable from the Integrations page instead of
 * being hard-coded.
 *
 * Backed by GET/PUT /api/cms/settings (the admin_settings/integrations doc);
 * PUT is a merge-save and the server stamps updatedAt. A PUT that carries
 * `sessionizeSpeakerId` also writes a `platform_setting_updated` audit row,
 * so the save appears in Platform Settings → Change history beside every
 * other setting (ADR 0033 Platform); the Platform Settings "All settings"
 * index lists this document with the others.
 */
import { getJSON, sendJSON } from '@/lib/api';

/** Fallback used when the settings doc is missing or unreadable. */
export const DEFAULT_SESSIONIZE_SPEAKER_ID = 'c6yicoezls';

let cachedSettings = null;

/** Fetch the integrations settings doc (cached per session). */
export async function getIntegrationSettings({ force = false } = {}) {
  if (cachedSettings && !force) return cachedSettings;
  try {
    const res = await getJSON('cms/settings');
    cachedSettings = res.settings || {};
  } catch {
    cachedSettings = {};
  }
  return cachedSettings;
}

/** Merge-save settings fields. */
export async function saveIntegrationSettings(updates) {
  await sendJSON('cms/settings', 'PUT', updates);
  cachedSettings = { ...(cachedSettings || {}), ...updates };
  return cachedSettings;
}

/** Sessionize speaker ID with constant fallback. */
export async function getSessionizeSpeakerId() {
  const settings = await getIntegrationSettings();
  const id = String(settings?.sessionizeSpeakerId || '').trim();
  return id || DEFAULT_SESSIONIZE_SPEAKER_ID;
}
