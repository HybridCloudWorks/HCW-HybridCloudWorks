/**
 * The two facts the lab panes keep about GitHub sign-in (#751), in this
 * browser's localStorage, and the hook that finishes the round trip.
 *
 * WHY THE SITE KEEPS ANYTHING. The site cannot see whether a visitor is
 * signed in to the lab workspaces: the pane is another origin, so the page
 * cannot read it, and `connect-src` stays closed to it (ADR 0032). What the
 * site can know is what happened in its own tabs, and that is all this
 * records:
 *
 *   - PENDING: "a sign-in was started from this lab's pane", written when the
 *     visitor clicks Sign in with GitHub. The tab that sign-in opens ends on
 *     `/education/labs` (LabPanePage.jsx has the whole flow), which reads it
 *     to know which pane to return to.
 *   - SIGNED IN: when this browser last came back from a sign-in, or said it
 *     was already signed in. The pane page shows the pane rather than the
 *     sign-in step while it is fresh. Writing it fires a `storage` event in
 *     every other tab of the site, which is how the pane that started the
 *     sign-in hears that it finished and reloads.
 *
 * Neither is a credential or a claim to one. The session is Coder's cookie on
 * its own name, which this site never sees; a stale or forged record only
 * decides whether the sign-in step or the pane is shown first, and the pane
 * still asks for sign-in if there is no session.
 *
 * Storage can be missing or throw (a private window, blocked site data), so
 * every access is guarded, and a failure reads as "nothing recorded": the
 * visitor sees the sign-in step, which works without storage apart from the
 * automatic return.
 */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { labById, labPanePath } from '@/data/labs/catalogue';

export const SIGN_IN_PENDING_KEY = 'hcw.labs.signInPending';
export const SIGNED_IN_KEY = 'hcw.labs.signedInAt';

/**
 * How long a started sign-in is waited for. GitHub's authorize page, a
 * two-factor prompt and a slow connection fit in fifteen minutes; a record
 * older than that is a sign-in abandoned, not one returning.
 */
export const SIGN_IN_PENDING_MS = 15 * 60 * 1000;

/**
 * How long a completed sign-in is trusted to still hold: Coder's default
 * browser session, `CODER_SESSION_DURATION` 24h in v2.37.3, which Coder
 * extends while the session is in use. After it the page shows the sign-in
 * step again, where "I've already signed in" opens the pane at once.
 */
export const SIGNED_IN_MS = 24 * 60 * 60 * 1000;

function storage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(key) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Nothing recorded; see the header.
  }
}

function remove(key) {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing recorded; see the header.
  }
}

/** Record that the visitor started a sign-in from this lab's pane. */
export function markSignInStarted(labId, now = Date.now()) {
  write(SIGN_IN_PENDING_KEY, JSON.stringify({ labId, at: now }));
}

/**
 * The lab a fresh started sign-in came from, removing the record so it is
 * acted on once; null when there is none, it is stale, or it is not readable.
 */
export function takePendingSignIn(now = Date.now()) {
  const raw = read(SIGN_IN_PENDING_KEY);
  if (raw === null) return null;
  remove(SIGN_IN_PENDING_KEY);
  try {
    const { labId, at } = JSON.parse(raw);
    const age = now - at;
    return typeof labId === 'string' && age >= 0 && age <= SIGN_IN_PENDING_MS ? labId : null;
  } catch {
    return null;
  }
}

/**
 * Listeners in this tab. A `storage` event reaches only the OTHER tabs, so a
 * write here tells this tab's subscribers itself.
 */
const localListeners = new Set();

/** Record that this browser is signed in, and tell every tab of the site. */
export function markSignedIn(now = Date.now()) {
  write(SIGNED_IN_KEY, String(now));
  for (const listener of localListeners) listener();
}

/**
 * When this browser last signed in, while that is fresh; 0 otherwise. A
 * number rather than a flag so that a new sign-in is a new value: the pane
 * page keys its frame on it, and a new key is a reloaded pane.
 */
export function readSignedInAt(now = Date.now()) {
  const at = Number(read(SIGNED_IN_KEY));
  if (!Number.isFinite(at) || at <= 0) return 0;
  const age = now - at;
  return age >= 0 && age <= SIGNED_IN_MS ? at : 0;
}

/**
 * `useSyncExternalStore`'s subscribe for the signed-in record: another tab's
 * write arrives as a `storage` event (key null is a `clear()`), this tab's as
 * a direct call.
 */
export function subscribeSignedIn(onChange) {
  const onStorage = (event) => {
    if (event.key === null || event.key === SIGNED_IN_KEY) onChange();
  };
  localListeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    localListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * On `/education/labs`: finish a sign-in that a lab's pane started. The tab
 * the sign-in opened lands here, sent by #750's redirect, as a fresh page
 * load, which React Router gives the location key `'default'`. A visit that
 * came by the site's own links has a key of its own and is left alone, so
 * "Back to labs" in the tab that is still waiting does not bounce back to
 * the pane. A fresh record for a lab the catalogue has is taken once:
 * sign-in is recorded, which reloads the waiting pane in the first tab, and
 * this tab goes on to the same lab's pane.
 */
export function useLabSignInReturn() {
  const navigate = useNavigate();
  const { key } = useLocation();
  useEffect(() => {
    if (key !== 'default') return;
    const labId = takePendingSignIn();
    if (!labId || !labById(labId)) return;
    markSignedIn();
    navigate(labPanePath(labId), { replace: true });
  }, [key, navigate]);
}
