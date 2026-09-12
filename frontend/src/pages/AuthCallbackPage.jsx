/**
 * Where Entra sends the browser back to after a sign-in (#520).
 *
 * ===========================================================================
 * WHY THIS PAGE EXISTS AT ALL
 * ===========================================================================
 * `msalConfig.js` used to set `redirectUri: window.location.origin`, so Entra
 * returned the user to `/` — the PUBLIC home page. Nothing there had ever
 * touched MSAL, because `AdminAuthGuard` is lazy-loaded and mounted only under
 * `/admin`. So the authorization code sat in the fragment and nothing consumed
 * it.
 *
 * The fix at the time was `useAuthRedirectLanding`, a hook mounted from
 * `App.jsx` on EVERY route — including every anonymous visit to a provider news
 * page — whose whole job was to run a regex against `window.location.hash` and,
 * on the rare occasion it matched, dynamically import MSAL and finish the job.
 *
 * A dedicated redirect route is what Microsoft recommends and what removes the
 * need for any of that: the fragment lands here, on a page whose only purpose
 * is to consume it, and the public site goes back to knowing nothing about
 * authentication.
 *
 * ===========================================================================
 * WHY IT NEEDS ALMOST NO CODE
 * ===========================================================================
 * `initializeAuth()` calls `handleRedirectPromise()`, which consumes the
 * fragment and completes the token exchange. MSAL's `navigateToLoginRequestUrl`
 * defaults to `true`, so it then returns the browser to whichever page started
 * the sign-in — which is the mechanism `redirectUri: origin` was working
 * around rather than using.
 *
 * ===========================================================================
 * THE 2026-08-23 INCIDENT, CARRIED OVER SO IT IS NOT LOST
 * ===========================================================================
 * Observed on www.hybridcloudworks.com: sign-in returned to
 * `https://www.hybridcloudworks.com/#code=1.AUYA…&state=…` with
 * `interactionType: "popup"`, rendered the home page, and sat there. MSAL
 * normally has the OPENER poll the popup and read the hash out of it, so the
 * popup page need not run MSAL at all — and that only works while the opener
 * holds a live handle to it. It breaks when the browser opens a top-level
 * window instead of a child popup, which is the same failure that made mobile
 * sign-in hang and is why `signIn()` is redirect-only.
 *
 * A failure here must never be thrown. It is rendered, with a way out, because
 * a stack trace on a blank page is the one thing a signed-out admin cannot act
 * on. `initializeAuth()` already clears a stale fragment for the recoverable
 * cases (see RECOVERABLE_INIT_ERRORS in entraAuth.js); this catches the rest.
 */
import React, { useEffect, useState } from 'react';

export default function AuthCallbackPage() {
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    /**
     * Drop the auth fragment, whatever happened.
     *
     * `initializeAuth()` already does this for the errors it recognises as
     * recoverable. This covers the rest: a fragment left in the address bar is
     * re-processed on every reload, so the same failure reproduces forever and
     * reads as permanent — the behaviour #196 and the 2026-08-23 incident both
     * turned on. It is also an authorization code sitting in history, and in
     * whatever the user pastes when they ask someone what went wrong.
     */
    const clearFragment = () => {
      const hash = window.location.hash || '';
      // Only an auth response, matching `clearAuthFragment()` in entraAuth.js.
      // Stripping any hash would eat a legitimate in-page anchor if this route
      // ever gains one, and the narrower rule is the one already established.
      if (!/[#&](code|error|state|id_token|access_token)=/.test(hash)) return;
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch {
        // A browser that refuses replaceState is not worth failing sign-in over.
      }
    };

    import('@/lib/entraAuth')
      .then(({ initializeAuth }) => initializeAuth())
      .then(() => {
        if (cancelled) return;
        clearFragment();
        // Reaching here in an ordinary tab means MSAL did not navigate away —
        // either the sign-in had no request URL to return to, or this page was
        // opened directly. Either way `/admin` is where the user was going.
        window.location.replace('/admin');
      })
      .catch((err) => {
        // The detail goes to the console, not to the page. MSAL's messages name
        // the authority, the client id and the failure mode, and this page is
        // reachable by anyone with the URL. The same reasoning as the 401
        // descriptions in require-role.js (#517): the reader cannot act on the
        // difference, and every one of them means the same thing here.
        console.error('[auth-callback] sign-in could not be completed:', err);
        if (cancelled) return;
        clearFragment();
        setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      {error ? (
        <>
          <h1 className="text-lg font-semibold">Sign-in could not be completed</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Try signing in again. If it keeps happening, the browser console has the detail.
          </p>
          <a href="/admin" className="text-sm underline underline-offset-2">
            Back to the admin portal
          </a>
        </>
      ) : (
        <>
          <div className="h-10 w-10 animate-spin rounded-full border-t-2 border-b-2 border-slate-blue" />
          <p className="text-sm text-muted-foreground">Completing sign-in…</p>
        </>
      )}
    </div>
  );
}
