/**
 * What the speaking widget loads (ADR 0033, Spotlight slice): the published
 * `speakerevents` snapshot — the newer of the deploy-time JSON and the live
 * publish — and the Sessionize feed for the speaker it names, merged
 * (sessionizeEvents.js) and placed (sessionizeGeocode.js).
 */
import { fetchPublicSnapshot } from '@/lib/publicApi';
import { DEFAULT_SESSIONIZE_SPEAKER_ID } from '@/lib/adminSettings';
import { newerSnapshot } from '@/lib/speakingEvents';
import { combineEvents } from './sessionizeEvents';
import { resolveLocations } from './sessionizeGeocode';

/**
 * The build-time copy of the snapshot, whole: `loadPublicDataSnapshot` answers
 * only the rows, and choosing between the deploy-time copy and the live
 * publish needs the stamp on each (ADR 0033 §1). Null when the file is absent
 * or not JSON — the live snapshot then stands alone.
 */
async function loadStaticSnapshot(path) {
  try {
    const response = await fetch(path, {
      headers: { Accept: 'application/json' },
      cache: 'default',
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.toLowerCase().includes('application/json')) return null;
    const payload = await response.json();
    return Array.isArray(payload?.items) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * The published speaking snapshot to render: the newer of the deploy-time
 * JSON and the live `_snapshots` document, so a publish shows before the next
 * deploy. Either read failing leaves the other.
 */
export async function loadSpeakingSnapshot() {
  const [staticDoc, liveDoc] = await Promise.all([
    loadStaticSnapshot('/data/speakerevents.json'),
    fetchPublicSnapshot('speakerevents').catch(() => null),
  ]);
  return newerSnapshot(staticDoc, liveDoc) || { items: [], meta: null };
}

/**
 * The speaker id to read: the snapshot's `meta` (the Settings tab's speaker
 * ID, copied in by Publish snapshot), then the prop, then the one default the
 * admin settings module holds. No second hard-coded id lives here.
 */
export function speakerIdFrom(snapshotDoc, speakerIdProp) {
  const speakerId = String(
    snapshotDoc?.meta?.speakerId || speakerIdProp || DEFAULT_SESSIONIZE_SPEAKER_ID
  ).trim();
  if (!/^[a-zA-Z0-9]+$/.test(speakerId)) throw new Error('Invalid speaker ID');
  return speakerId;
}

async function fetchSessionizeEvents(speakerId) {
  const response = await fetch(`https://sessionize.com/api/speaker/json/${speakerId}`);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const data = await response.json();
  return data.events || data.sessions || [];
}

/** Everything the widget renders: Sessionize merged with the snapshot, locations resolved. */
export async function loadSessions(speakerIdProp) {
  const snapshotDoc = await loadSpeakingSnapshot();
  const events = await fetchSessionizeEvents(speakerIdFrom(snapshotDoc, speakerIdProp));
  return resolveLocations(combineEvents(events, snapshotDoc.items));
}
