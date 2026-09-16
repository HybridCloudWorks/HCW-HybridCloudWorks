/**
 * The Linkie Hub's two page-level reads (#577).
 *
 * The profile probe is here rather than in a tab because it is not a readiness
 * check that happens to resolve the profile — it IS the profile resolve. Every
 * posts and analytics path is profile-scoped, so nothing on this page can run
 * until `/profiles` has answered, and both working tabs need the answer.
 *
 * The live-pages read joins it because the Links tab pushes from that list and
 * the profile selector above the tabs is rendered from the other.
 *
 * Race-safe per #555: each read carries a generation, so a superseded read
 * paints nothing, and a failed probe empties the profile list rather than
 * leaving the previous key's profiles beside a notice saying it failed.
 *
 * The hook only holds state; the reads are module-level functions over one
 * state bag, each with a single exit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getJSON } from '@/lib/api';
import { describeLinkieFailure, extractProfiles, unwrapLinkie } from '@/lib/linkie';
import { ltGetProfiles } from './linkieApi';
import { getLiveUrl, isLiveRecord } from './linkieView';

const EMPTY = Object.freeze([]);

/** The published pages this hub can push, as `{ items }` or `{ error }`. */
async function fetchLivePages() {
  let outcome;
  try {
    const res = await getJSON('cms/content?limit=500');
    const live = (res.items || []).filter(isLiveRecord).filter((item) => getLiveUrl(item));
    outcome = { items: live.slice(0, 50) };
  } catch (error) {
    outcome = { error: error?.message || 'Could not read published content.' };
  }
  return outcome;
}

/**
 * The profile probe, as the three outcomes the page renders differently.
 *
 * A key that owns no profiles is `connected` — Linkie answered — but has
 * nothing to work against, which is a different sentence from a key Linkie
 * refused.
 */
async function fetchProfiles() {
  let outcome;
  try {
    const response = await ltGetProfiles();
    const unwrapped = unwrapLinkie(response);
    if (unwrapped.notConfigured || unwrapped.failed) {
      outcome = {
        connected: false,
        profiles: EMPTY,
        notice:
          (unwrapped.notConfigured ? unwrapped.reason : describeLinkieFailure(unwrapped)) ||
          'Linkie could not be reached',
      };
    } else {
      const list = extractProfiles(response);
      outcome = {
        connected: true,
        profiles: list,
        notice:
          list.length === 0 ? 'This Linkie API key owns no profiles — check the Settings tab.' : '',
      };
    }
  } catch (error) {
    outcome = { connected: false, profiles: EMPTY, notice: error?.message };
  }
  return outcome;
}

async function readLivePages(state) {
  const mine = ++state.contentGeneration.current;
  const outcome = await fetchLivePages();
  if (mine !== state.contentGeneration.current) return;
  state.setRecentContent(outcome.items || EMPTY);
}

async function readProfiles(state) {
  const mine = ++state.profileGeneration.current;
  const outcome = await fetchProfiles();
  if (mine !== state.profileGeneration.current) return;
  state.setConnected(outcome.connected);
  state.setProfiles(outcome.profiles);
  state.setProfileNotice(outcome.notice || '');
}

export default function useLinkie(ready) {
  const [connected, setConnected] = useState('checking');
  const [profiles, setProfiles] = useState(EMPTY);
  const [profileNotice, setProfileNotice] = useState('');
  const [recentContent, setRecentContent] = useState(EMPTY);

  const contentGeneration = useRef(0);
  const profileGeneration = useRef(0);

  const state = useMemo(
    () => ({
      setConnected,
      setProfiles,
      setProfileNotice,
      setRecentContent,
      contentGeneration,
      profileGeneration,
    }),
    []
  );

  useEffect(() => {
    if (ready) readLivePages(state);
    return () => {
      contentGeneration.current += 1;
    };
  }, [ready, state]);

  useEffect(() => {
    if (ready) readProfiles(state);
    return () => {
      profileGeneration.current += 1;
    };
  }, [ready, state]);

  /**
   * A Settings test that succeeds means the credential changed under us.
   *
   * The probe keyed on readiness alone, so it ran once and never again. An
   * operator who arrived with a broken key, fixed it, and pressed Test
   * Connection got a green header and Links and Analytics still disabled —
   * because `profiles` was still the empty array from the failed probe, and
   * nothing short of a page reload would refill it. Caught in review on #429.
   *
   * Re-running is the whole point: the probe IS the profile resolve, so a key
   * that started working has to be re-asked before anything else can work.
   * Only a success re-reads; a failed test has nothing new to learn.
   */
  const onConnectionTested = useCallback(
    (ok) => {
      setConnected(ok);
      if (ok) readProfiles(state);
    },
    [state]
  );

  return { connected, profiles, profileNotice, recentContent, onConnectionTested };
}
