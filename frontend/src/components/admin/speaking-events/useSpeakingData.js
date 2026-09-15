/**
 * The Speaking Events Hub's three reads (#573), each through `useGuardedLoad`.
 *
 * Sessionize and the stored overrides feed three tabs (Upcoming, Past,
 * Sources), so the page holds them and switching tabs never refetches. The
 * public snapshot is Publishing's alone and is read by that tab while it is
 * open. The calls are the ones the one-scroll page made, unchanged.
 */

import { getJSON } from '@/lib/api';
import { getSessionizeSpeakerId } from '@/lib/adminSettings';
import { fetchPublicSnapshotItems } from '@/lib/publicApi';
import { mapSessionizeEvents, sessionizeUrl } from './eventModel';
import useGuardedLoad from './useGuardedLoad';

const NO_ROWS = Object.freeze([]);

async function loadSessionize() {
  // Speaker ID lives in the admin settings doc (edited on the Integrations
  // Hub's Sessionize card) with a constant fallback.
  const speakerId = await getSessionizeSpeakerId();
  const res = await fetch(sessionizeUrl(speakerId));
  if (!res.ok) throw new Error(`Sessionize HTTP ${res.status}`);
  return mapSessionizeEvents(await res.json());
}

async function loadStored() {
  const res = await getJSON('cms/speakerevents');
  return (res.items || []).map((item) => ({ _docId: item.id, ...item }));
}

const describeSessionize = (err) => `Failed to load Sessionize: ${err?.message}`;
const describeStored = (err) => `Failed to load stored event data: ${err?.message}`;
const describeSnapshot = (err) => `Failed to read the public snapshot: ${err?.message}`;

/** The speaker's events, read live from Sessionize in the browser. */
export function useSessionizeEvents() {
  return useGuardedLoad(loadSessionize, { empty: NO_ROWS, describeError: describeSessionize });
}

/** The stored overrides and manual entries, once auth is ready. */
export function useStoredEvents(authReady) {
  return useGuardedLoad(loadStored, {
    enabled: authReady,
    empty: NO_ROWS,
    describeError: describeStored,
  });
}

/** What the public speaking page reads: the `speakerevents` snapshot. */
export function usePublicSnapshot() {
  return useGuardedLoad(fetchPublicSnapshotItemsForEvents, {
    empty: NO_ROWS,
    describeError: describeSnapshot,
  });
}

function fetchPublicSnapshotItemsForEvents() {
  return fetchPublicSnapshotItems('speakerevents');
}
