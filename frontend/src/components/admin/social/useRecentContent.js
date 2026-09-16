/**
 * The live pages on hybridcloudworks.com, newest first — the list Compose
 * schedules from and Published shows as its first section (#575).
 *
 * Read per tab rather than once at page level, per the Newsletter Hub standard:
 * the list is read-only here, so there is nothing for two tabs to disagree
 * about, and a failure while reading it for Published must not empty the
 * composer's picker.
 *
 * Race-safe the way #555 hardened the Newsletter Hub: the read carries a
 * generation, a superseded or unmounted read paints nothing, and a FAILED read
 * empties the list rather than leaving rows beside an error saying they could
 * not be read.
 *
 * The hook only holds state; the read below is a module-level function over one
 * state bag with a single exit.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPublicContentList } from '@/lib/publicApi';
import { recordLegacyBlogsRead } from '@/lib/legacyBlogsTelemetry';
import { selectLivePages } from './socialView';

const EMPTY = Object.freeze([]);

/**
 * Both containers, tagged with which they came from, as `{ items }` or
 * `{ error }` — never throws.
 *
 * The legacy `blogs` container is read only when `content` came back empty, and
 * that read is telemetered because it is the one that has to stop. Reading it
 * unconditionally would report the fallback as used on every page load, which
 * is the opposite of what the telemetry is for.
 */
async function fetchLivePages() {
  let outcome;
  try {
    const contentMerged = (await fetchPublicContentList({ limit: 250 })).map((item) => ({
      __source: 'content',
      ...item,
    }));
    const shouldLoadLegacy = contentMerged.length === 0;
    const legacyItems = shouldLoadLegacy
      ? await fetchPublicContentList({ limit: 250, source: 'blogs' }).catch(() => [])
      : [];
    if (shouldLoadLegacy) {
      recordLegacyBlogsRead({
        source: 'SocialHubPage',
        details: { collectionPath: 'blogs', limit: 250 },
      });
    }
    outcome = {
      items: selectLivePages([
        ...contentMerged,
        ...legacyItems.map((item) => ({ __source: 'blogs', ...item })),
      ]),
    };
  } catch (error) {
    outcome = { error: error?.message || 'Could not read published content.' };
  }
  return outcome;
}

/** Read as generation `mine`. A superseded read paints nothing. */
async function readLivePages(state) {
  const mine = ++state.generation.current;
  const outcome = await fetchLivePages();
  if (mine !== state.generation.current) return;
  if (outcome.error) {
    state.setItems(EMPTY);
    state.setError(outcome.error);
  } else {
    state.setItems(outcome.items);
    state.setError('');
  }
  state.setLoading(false);
}

export default function useRecentContent(ready) {
  const [items, setItems] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Bumped by every read; a read whose number is no longer current has been
  // superseded — by a remount, or by auth arriving — and must paint nothing.
  const generation = useRef(0);

  const state = useMemo(() => ({ setItems, setLoading, setError, generation }), []);

  useEffect(() => {
    if (!ready) return undefined;
    readLivePages(state);
    // Bumping the generation supersedes the read in flight: it resolves into a
    // component that is gone, and paints nothing.
    return () => {
      generation.current += 1;
    };
  }, [ready, state]);

  return { items, loading, error };
}
