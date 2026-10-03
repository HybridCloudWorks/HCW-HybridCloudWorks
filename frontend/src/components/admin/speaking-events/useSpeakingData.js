/**
 * The Speaking Events Hub's three reads (#573), each through the shared
 * `useGuardedLoad` (ADR 0033 §2).
 *
 * Sessionize and the stored overrides feed three tabs (Upcoming, Past,
 * Sources), so the page holds them and switching tabs never refetches. The
 * public snapshot is Publishing's alone and is read by that tab while it is
 * open — PAST EVERY CACHE, every time: the tab exists to say what a publish
 * just wrote, and the thirty-second client cache was exactly the copy that
 * had just gone stale (ADR 0033, Spotlight slice).
 */

import { getJSON } from '@/lib/api';
import { getSessionizeSpeakerId } from '@/lib/adminSettings';
import { fetchPublicSnapshot } from '@/lib/publicApi';
import useGuardedLoad from '@/components/admin/shared/useGuardedLoad';
import { mapSessionizeEvents, sessionizeUrl } from './eventModel';

const NO_ROWS = Object.freeze([]);
export const EMPTY_SNAPSHOT = Object.freeze({ items: NO_ROWS, generatedAt: null, meta: null });

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

/** The whole public snapshot — items and the publish stamp — or the empty shape when none exists. */
async function loadSnapshot() {
  const snapshot = await fetchPublicSnapshot('speakerevents', { fresh: true });
  if (!snapshot) return EMPTY_SNAPSHOT;
  return { items: snapshot.items, generatedAt: snapshot.generatedAt, meta: snapshot.meta || null };
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

/** What the public speaking page reads: the `speakerevents` snapshot, with its stamp. */
export function usePublicSnapshot() {
  return useGuardedLoad(loadSnapshot, {
    empty: EMPTY_SNAPSHOT,
    describeError: describeSnapshot,
  });
}
