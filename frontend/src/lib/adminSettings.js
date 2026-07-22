/**
 * Admin integration settings — small Firestore-backed settings doc so values
 * like the Sessionize speaker ID are editable from the Connections page
 * instead of being hard-coded.
 *
 * Doc: admin_settings/integrations
 */
import { db } from '@/lib/firebaseConfig';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export const ADMIN_SETTINGS_DOC_PATH = ['admin_settings', 'integrations'];

/** Fallback used when the settings doc is missing or unreadable. */
export const DEFAULT_SESSIONIZE_SPEAKER_ID = 'c6yicoezls';

let cachedSettings = null;

/** Fetch the integrations settings doc (cached per session). */
export async function getIntegrationSettings({ force = false } = {}) {
  if (cachedSettings && !force) return cachedSettings;
  try {
    const snap = await getDoc(doc(db, ...ADMIN_SETTINGS_DOC_PATH));
    cachedSettings = snap.exists() ? snap.data() : {};
  } catch {
    cachedSettings = {};
  }
  return cachedSettings;
}

/** Merge-save settings fields. */
export async function saveIntegrationSettings(updates) {
  await setDoc(
    doc(db, ...ADMIN_SETTINGS_DOC_PATH),
    { ...updates, updatedAt: serverTimestamp() },
    { merge: true }
  );
  cachedSettings = { ...(cachedSettings || {}), ...updates };
  return cachedSettings;
}

/** Sessionize speaker ID with constant fallback. */
export async function getSessionizeSpeakerId() {
  const settings = await getIntegrationSettings();
  const id = String(settings?.sessionizeSpeakerId || '').trim();
  return id || DEFAULT_SESSIONIZE_SPEAKER_ID;
}
