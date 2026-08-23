import { useEffect } from 'react';

/**
 * Complete a sign-in that lands on the site root.
 *
 * WHAT WENT WRONG. `msalConfig.js` sets `redirectUri: window.location.origin`,
 * so Entra sends the user back to `/` — but `AdminAuthGuard`, the only thing in
 * the application that calls `initializeAuth()`, is lazy-loaded and mounted
 * only under `/admin`. Nothing on the root page has ever touched MSAL.
 *
 * Observed 2026-08-23 on www.hybridcloudworks.com: the sign-in popup returned
 * to `https://www.hybridcloudworks.com/#code=1.AUYA…&state=…` with
 * `interactionType: "popup"`, rendered the home page, and sat there. The code
 * was in the fragment and nothing consumed it.
 *
 * WHY THE POPUP DID NOT CLOSE ITSELF. msal-browser normally has the OPENER poll
 * the popup and read the hash out of it, so the popup page does not need to run
 * MSAL. That only works while the opener holds a live handle to it — and it
 * breaks when the browser opens a top-level window instead of a child popup,
 * which is the same failure that made mobile sign-in hang and prompted
 * `prefersRedirect()`. When it breaks, the popup is a normal page load on `/`
 * with an auth fragment, and the only thing that can finish the job is the page
 * itself.
 *
 * SO THE ROOT LEARNS TO FINISH IT. `initializeAuth()` calls
 * `handleRedirectPromise()`, which consumes the fragment, completes the token
 * exchange, and — when this page is a popup — lets MSAL hand the result to the
 * opener and close the window.
 *
 * IT RUNS ONLY WHEN A FRAGMENT IS PRESENT. Loading MSAL on every visit to the
 * home page would put an admin-only dependency on the public site's critical
 * path for no benefit, which is exactly why vite.config.js gives it its own
 * chunk. A visitor with no `#code=` in the URL never touches it.
 */
export function useAuthRedirectLanding() {
  useEffect(() => {
    const hash = window.location.hash || '';
    // The shapes MSAL leaves behind: an authorization code, an implicit-flow
    // token, or an error the user needs told about rather than swallowed.
    if (!/[#&](code|id_token|access_token|error)=/.test(hash)) return;

    let cancelled = false;
    import('@/lib/entraAuth')
      .then(({ initializeAuth }) => initializeAuth())
      .then(() => {
        if (cancelled) return;
        // If this window was a popup, MSAL has already handed the result back
        // and closed it. Reaching here means it is an ordinary tab, so the
        // fragment is spent and must go: left in the address bar it is
        // re-processed on every reload and reproduces the original error.
        if (window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      })
      .catch((error) => {
        // Never rethrow into the public home page. A failed admin sign-in must
        // not take down the site for a visitor who is not signing in at all.
        console.error('Sign-in could not be completed on the landing page:', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);
}

export default useAuthRedirectLanding;
