/**
 * "Sync from Sessionize" on the Sources tab (#573), moved from
 * SpeakingEventsPage.jsx with its rules unchanged: an event with no stored
 * record gets one; a stored record gets only its EMPTY fields filled; nothing
 * else is ever touched.
 *
 * Race-safety: an in-flight ref, checked before any await, so a double click
 * runs one sync rather than two creating the same rows. The stored overrides
 * are re-read after the sync whether it finished or stopped part-way, because
 * a failure after some writes would otherwise leave rows on screen that no
 * longer match the store.
 */

import { useRef, useState } from 'react';
import { postJSON } from '@/lib/api';
import { buildSessionizeCreatePayload, buildSyncPatch, fdNumericId } from './eventModel';

async function syncOne(se, storedDocs, counts) {
  const seId = Number(se.id);
  // Match ONLY by eventId — name matching is no longer used for sync
  const existing = storedDocs.find((fd) => fdNumericId(fd) === seId) || null;
  if (!existing) {
    // No matching eventId — create a new row with everything the API provides
    await postJSON('upsertSpeakerEvent', {
      docId: `event-${seId}`,
      merge: false,
      data: buildSessionizeCreatePayload(se, seId),
    });
    counts.created++;
    return;
  }
  const patch = buildSyncPatch(existing, se, seId);
  if (Object.keys(patch).length === 0) {
    counts.skipped++;
    return;
  }
  await postJSON('upsertSpeakerEvent', { docId: existing._docId, data: patch, merge: true });
  counts.patched++;
}

/** Writes the sync one event at a time, in order; throws on the first failure. */
export async function runSync(sessionizeEvents, storedDocs) {
  const counts = { created: 0, patched: 0, skipped: 0 };
  for (const se of sessionizeEvents) {
    await syncOne(se, storedDocs, counts);
  }
  return counts;
}

export default function useSessionizeSync(sessionize, stored) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const syncingRef = useRef(false);

  const sync = async () => {
    if (syncingRef.current) return;
    // `loaded`, not a row count: Sessionize can answer with no events, and the
    // store can be empty, and both are real answers a sync can act on. Syncing
    // before the store has landed could create records that already exist.
    if (!sessionize.loaded || !stored.loaded) {
      setError('Sessionize and stored data are not loaded yet — hit Refresh first.');
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    setResult(null);
    setError('');
    try {
      const counts = await runSync(sessionize.data, stored.data);
      await stored.refresh();
      setResult(counts);
    } catch (err) {
      setError(`Sync failed: ${err?.message}`);
      await stored.refresh();
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  };

  return {
    sync,
    syncing,
    result,
    error,
    dismissResult: () => setResult(null),
    dismissError: () => setError(''),
  };
}
