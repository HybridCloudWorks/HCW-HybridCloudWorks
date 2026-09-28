/**
 * `/education/labs/:labId`: one lab's workspace, in a pane on the site (#751).
 *
 * WHY A PANE. Owner decision 2026-09-28: the lab is reached only through
 * panes on the site (ADR 0032, amendment of that date). #750 enforces it on
 * the lab host: every name under lab.hybridcloudworks.com, Coder's included,
 * answers a top-level visit with a 302 to `/education/labs`, and only the
 * site may frame it. So the one way into a workspace is a frame on a site
 * page, and this is that page. The site's `frame-src` admits Coder's origin
 * and its workspace apps' wildcard and nothing else new (csp.test.js).
 *
 * WHAT THE PANE LOADS. The lab launcher on Coder's name (`labLauncherUrl`):
 * `https://coder.lab.hybridcloudworks.com/_hcw/lab/?lab=<id>`
 * (lab-host/coder/launcher/). Coder's dashboard opens code-server in a new
 * window or tab, which #750 turns into the labs page, so from the dashboard
 * the editor never opened in the pane. The launcher reads the learner's
 * workspace with their session, shows Coder's own create or start page in a
 * frame of its own when the learner has to confirm something, and when
 * code-server is healthy replaces itself with code-server's own name. Both
 * are Coder's names, so `frame-src`, the sandbox and `allow` below are
 * unchanged by it.
 *
 * WHAT THE PANE SAYS. The launcher posts its state to this page
 * (`{ type: 'hcw-lab', state }`), the one thing a cross-origin frame can
 * tell it. The page takes a message only from the launcher's origin, only
 * from this pane's own window, and only with a type and a state it knows
 * (`paneMessageState`). A message means the frame loaded, so it stops the
 * load watchdog; the state is shown on the toolbar; and `unavailable` shows
 * the page's own unavailable section.
 *
 * SIGN-IN RUNS IN A TAB OF ITS OWN, because GitHub refuses to be framed and
 * the site's `frame-src` does not admit it either. Worked out from Coder
 * v2.37.3's source and #750's exemption, step by step:
 *
 *   1. "Sign in with GitHub" is a link that opens a new tab at
 *      `coder.lab…/api/v2/users/oauth2/github/callback?redirect=%2F`
 *      (`coderSignInUrl`), and its click records which lab it came from
 *      (labSignIn.js). Not Coder's `/login` in the tab: #750 redirects a
 *      top-level `/login` to `/education/labs` before Coder sees it. The
 *      callback path is the one path #750 lets through at the top level, on
 *      Coder's own name only (10-coder.caddy.j2), and Coder serves the START
 *      of sign-in from it too: a request with no `code` gets Coder's
 *      `oauth_state` and `oauth_redirect` cookies and a 307 to GitHub's
 *      authorize page (coderd/httpmw/oauth2.go, ExtractOAuth2). That is the
 *      URL Coder's own GitHub button links to (OAuthSignInForm.tsx).
 *   2. GitHub signs the visitor in, at the top level in that tab, and sends
 *      the tab back to the callback with `code` and `state`. The exemption
 *      lets it through. The state cookie is SameSite=Lax (Coder allows only
 *      lax or none), which a top-level GET from GitHub carries. Coder checks
 *      the organisation, sets its session cookie on its own name, and
 *      answers 307 to `redirect`, a path on Coder (SafeRedirectPath).
 *   3. That is a top-level visit to a Coder path that is not the callback,
 *      so #750 answers it with a 302 to `/education/labs`. Every sign-in
 *      ends there, whatever `redirect` said.
 *   4. `/education/labs` (useLabSignInReturn) sees a fresh record on a page
 *      entered from outside the site, removes it, records the sign-in, and
 *      replaces its URL with this lab's page. The tab is now this page, and
 *      its pane opens signed in.
 *   5. Recording the sign-in fires a `storage` event in the first tab, where
 *      this page is still open. It leaves the sign-in step and reloads the
 *      pane with a new frame, which now carries the session.
 *
 * The session reaches the pane because coder.lab.hybridcloudworks.com and
 * hybridcloudworks.com are one site (the registrable domain), so the frame's
 * requests are same-site and send Coder's Lax cookie; no third-party cookie
 * is involved. Sign-in cannot happen inside the pane: GitHub will not load
 * in a frame. The launcher, finding no session, says to use Sign in with
 * GitHub above, and tells this page, which marks that button on the toolbar.
 *
 * What this page cannot know before the pane opens: whether the visitor is
 * signed in, since the pane is another origin. It shows the sign-in step
 * until this browser has come back from a sign-in (for Coder's default
 * 24-hour session), with "I've already signed in" for a visitor who has, and
 * keeps Sign in with GitHub on the toolbar for a session that has expired;
 * once the pane is open, the launcher's `signed-out` says so. A visitor
 * GitHub signs in but Coder refuses (outside the organisation) is sent to
 * Coder's `/login`, which #750 also turns into `/education/labs`, so the
 * return looks the same and the launcher reports no session again; the step
 * says who may sign in.
 *
 * UNAVAILABLE. Before the pane opens, the page asks the status read the labs
 * page's card shows (`GET public/labs/coder-status`, at most a minute old).
 * The pane opens only when that read says configured and reachable, which
 * needs Coder's address and Coder answering and nothing else (not the status
 * token, since 2026-09-28). Anything else (not configured, unreachable, the
 * route missing, the read failing), a frame that has not loaded within
 * PANE_LOAD_TIMEOUT_MS (a frame fires no `error` event, so the wait is the
 * only failure it can signal without the launcher), and the launcher
 * reporting `unavailable` all show one sentence, never the error. The lab
 * host's own answer for a stopped Coder is the same sentence.
 *
 * PRE-RENDER. One page per catalogue row, like the Azure certification
 * pages (scripts/prerender-entry.jsx). The first render reads no storage and
 * no clock: the status read starts in an effect, and the sign-in record is
 * read through `useSyncExternalStore`, whose server snapshot is "not signed
 * in". So the built HTML is the lab's heading and the opening sentence, and
 * hydration matches it.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, Navigate, useParams } from 'react-router';
import {
  CODER_APPS_ORIGIN,
  CODER_ORIGIN,
  coderSignInUrl,
  labById,
  labLauncherUrl,
  labPanePath,
} from '@/data/labs/catalogue';
import {
  markSignInStarted,
  markSignedIn,
  readSignedInAt,
  subscribeSignedIn,
} from '@/components/labs/labSignIn';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchCoderStatus } from '@/lib/publicApi';
import { staticRoutes } from '@/lib/routeFactory';
import { safeUrl } from '@/lib/safeUrl';

export const UNAVAILABLE_SENTENCE = "Lab workspaces aren't available right now.";
export const SIGN_IN_HEADING = 'Sign in with GitHub to open your lab workspace';
export const OPENING_SENTENCE = 'Opening your lab workspace…';
/**
 * The fallback clause is for a return this page cannot hear: storage that
 * is blocked, or a visit on www, whose storage the returning tab (always on
 * the apex, where #750 redirects) does not share.
 */
export const SIGN_IN_PENDING_SENTENCE =
  "Finish signing in with GitHub in the new tab. Your workspace opens here when you're done; if it doesn't, choose I've already signed in.";

/** A frame that has not loaded in this long is treated as unavailable. */
export const PANE_LOAD_TIMEOUT_MS = 30_000;

/** The canonical origin, as scripts/prerender.mjs writes it. */
const SITE_ORIGIN = 'https://hybridcloudworks.com';

/** `usePublicData` key for the status read, as this page asks it. */
export const WORKSPACE_STATUS_KEY = 'labs:workspace-status';

/**
 * The states the launcher reports (STATES in
 * lab-host/coder/launcher/launcher.js), and the words the toolbar shows for
 * each. `unavailable` has no words here: it shows the unavailable section.
 */
export const PANE_STATE_WORDS = Object.freeze({
  checking: 'Opening your workspace…',
  'signed-out': 'Sign in to open your workspace',
  create: 'Confirm to create your workspace',
  stopped: 'Start your workspace to continue',
  starting: 'Starting your workspace…',
  ready: 'Workspace ready',
});
export const PANE_STATES = Object.freeze([...Object.keys(PANE_STATE_WORDS), 'unavailable']);

/** The `type` the launcher puts on every message it posts. */
export const PANE_MESSAGE_TYPE = 'hcw-lab';

/**
 * The launcher's state from a `message` event, or null for anything else: a
 * message from another origin (code-server's own name included, once the
 * pane has moved there), from a window that is not this pane's frame (a
 * frame inside it, or another tab), or without the launcher's type and one
 * of its states. Nothing else in the message is read.
 */
export function paneMessageState(event, frame) {
  if (event?.origin !== CODER_ORIGIN) return null;
  if (!frame || event.source !== frame.contentWindow) return null;
  const { data } = event;
  if (data === null || typeof data !== 'object' || data.type !== PANE_MESSAGE_TYPE) return null;
  return PANE_STATES.includes(data.state) ? data.state : null;
}

/**
 * The pane's sandbox: what code-server, the launcher and Coder's own pages
 * need, and nothing more. The launcher (lab-host/coder/launcher/) changed
 * none of it: it is a page on Coder's name, the frame it shows Coder's pages
 * in is Coder's name too and inherits this sandbox, and code-server is where
 * it was before.
 *   - allow-scripts: all three are JavaScript applications.
 *   - allow-same-origin: keeps the frame its own origin (Coder's name, or
 *     the workspace app's), so it can send its session cookie, keep its
 *     storage and open its WebSockets. Without it the frame is an opaque
 *     origin and is signed out, and the launcher cannot read the learner's
 *     workspace. Paired with allow-scripts this only unlocks a frame that is
 *     SAME-origin with the page, which could then remove its own sandbox;
 *     the pane is always another origin, and cannot reach the site's page.
 *   - allow-forms: Coder's create and workspace forms submit through
 *     `onSubmit` handlers, and a sandboxed frame without this flag never
 *     fires `submit` at all.
 *   - allow-popups: code-server opens links in a new tab, for example the
 *     device sign-in page `az login --use-device-code` prints. Such a tab
 *     inherits this sandbox; there is no allow-popups-to-escape-sandbox.
 * Deliberately absent: allow-top-navigation (the pane may never navigate
 * the site away), allow-modals, allow-downloads, allow-storage-access-by-
 * user-activation (the frame is same-site, so it needs no storage access
 * grant).
 */
export const PANE_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups';

/**
 * The pane's `allow` list: clipboard read and write, which code-server's
 * copy and paste use, and fullscreen, which its own full-screen view uses.
 * Each is granted to Coder's name and to the workspace apps' names by
 * origin, not with the default `'src'`, because `'src'` is the origin of the
 * frame's first URL (the launcher, on Coder's name) and would not follow the
 * frame to code-server's own name, where the launcher sends it. A Permissions Policy origin can only wildcard a
 * whole label, so the grant also covers any other app or forwarded port the
 * learner opens under their workspace's names. Those run the learner's own
 * code, and the pane reaches them only by navigating within Coder's names
 * (`frame-src`); a page from anywhere else never gets the clipboard. Accepted
 * for code-server's paste (security review of #751). Dropping
 * clipboard-read would leave Ctrl+V working, which needs no permission, and
 * lose the context menu's Paste.
 */
const PANE_ORIGINS = `${CODER_ORIGIN} ${CODER_APPS_ORIGIN}`;
export const PANE_ALLOW = [
  `clipboard-read ${PANE_ORIGINS}`,
  `clipboard-write ${PANE_ORIGINS}`,
  `fullscreen ${PANE_ORIGINS}`,
].join('; ');

const MUTED = 'text-slate-600 dark:text-slate-400';
const BUTTON =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:opacity-90`;
const SECONDARY = `${BUTTON} border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800`;

/** What the status read says about the workspaces: 'checking', 'available' or 'unavailable'. */
export function workspaceService({ data, loading, error }) {
  if (error) return 'unavailable';
  if (loading && data === null) return 'checking';
  return data?.configured === true && data.reachable === true ? 'available' : 'unavailable';
}

const serverSignedInAt = () => 0;
const subscribeFullscreen = (onChange) => {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
};
const readFullscreen = () => Boolean(document.fullscreenElement);
const readFullscreenEnabled = () => document.fullscreenEnabled === true;
const serverFalse = () => false;
const noSubscription = () => () => {};

export default function LabPanePage() {
  const { labId } = useParams();
  const lab = labById(labId);
  if (!lab) return <Navigate to={staticRoutes.labs} replace />;
  return <LabPane key={lab.id} lab={lab} />;
}

/** "I've already signed in": record it, which shows the pane. No argument, so the click event is not taken for a time. */
const alreadySignedIn = () => markSignedIn();

function LabPane({ lab }) {
  const status = usePublicData(() => fetchCoderStatus(), WORKSPACE_STATUS_KEY);
  const signedInAt = useSyncExternalStore(subscribeSignedIn, readSignedInAt, serverSignedInAt);
  const [pending, setPending] = useState(false);

  const signInHref = safeUrl(coderSignInUrl());
  const startSignIn = () => {
    markSignInStarted(lab.id);
    setPending(true);
  };

  return (
    <>
      <Helmet>
        <title>{`${lab.title} — Browser labs | Hybrid Cloud Works`}</title>
        <meta name="description" content={lab.summary} />
        <link rel="canonical" href={`${SITE_ORIGIN}${labPanePath(lab.id)}`} />
      </Helmet>

      <div className="relative z-10 max-w-[1400px] mx-auto w-full px-4 md:px-8 py-8 flex flex-col gap-6">
        <header>
          <p className="flex flex-wrap gap-x-1.5 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            <Link to={staticRoutes.education} className="underline-offset-4 hover:underline">
              Learn any cloud
            </Link>
            <span aria-hidden="true">/</span>
            <Link to={staticRoutes.labs} className="underline-offset-4 hover:underline">
              Labs
            </Link>
            <span aria-hidden="true">/</span>
            <span>{lab.title}</span>
          </p>
          <h1 className="display-heading text-2xl sm:text-3xl text-slate-950 dark:text-white mb-2">
            {lab.title}
          </h1>
          <p className={`${MUTED} max-w-3xl`}>{lab.summary}</p>
        </header>
        <PaneBody
          service={workspaceService(status)}
          signedInAt={signedInAt}
          lab={lab}
          pending={pending}
          signInHref={signInHref}
          onStartSignIn={startSignIn}
        />
      </div>
    </>
  );
}

/** Exactly one of: opening, unavailable, the sign-in step, or the pane. */
function PaneBody({ service, signedInAt, lab, pending, signInHref, onStartSignIn }) {
  if (service === 'checking') {
    return (
      <p role="status" className={`text-sm ${MUTED}`} data-testid="lab-opening">
        {OPENING_SENTENCE}
      </p>
    );
  }
  if (service === 'unavailable') return <Unavailable />;
  if (!signedInAt) {
    return <SignInStep signInHref={signInHref} pending={pending} onStart={onStartSignIn} />;
  }
  return <Pane key={signedInAt} lab={lab} signInHref={signInHref} onStartSignIn={onStartSignIn} />;
}

function Unavailable() {
  return (
    <section
      data-testid="lab-unavailable"
      className="glass rounded-xl p-6 flex flex-col gap-3 max-w-2xl"
    >
      <p role="status" className="font-semibold text-slate-900 dark:text-slate-100">
        {UNAVAILABLE_SENTENCE}
      </p>
      <p className={`text-sm ${MUTED}`}>
        You can still run this lab on your own machine: the labs page has the two lines for it,
        under Run it locally.
      </p>
      <Link to={staticRoutes.labs} className={`${SECONDARY} self-start`}>
        Back to labs
      </Link>
    </section>
  );
}

function SignInStep({ signInHref, pending, onStart }) {
  return (
    <section
      aria-labelledby="lab-sign-in-heading"
      data-testid="lab-sign-in"
      className="glass rounded-xl p-6 flex flex-col gap-3 max-w-2xl"
    >
      <h2 id="lab-sign-in-heading" className="text-lg font-bold text-slate-950 dark:text-white">
        {SIGN_IN_HEADING}
      </h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Sign-in opens in a new tab. When it finishes, that tab brings you back to this lab, and the
        workspace opens here as well.
      </p>
      <p className={`text-sm ${MUTED}`}>
        Lab workspaces are for members of the HybridCloudWorks organization on GitHub.
      </p>
      {pending ? (
        <p role="status" className="text-sm text-slate-900 dark:text-slate-100">
          {SIGN_IN_PENDING_SENTENCE}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {signInHref ? (
          <a
            href={signInHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onStart}
            data-testid="lab-sign-in-link"
            className={PRIMARY}
          >
            Sign in with GitHub <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
        <button type="button" onClick={alreadySignedIn} className={SECONDARY}>
          I&apos;ve already signed in
        </button>
        <Link to={staticRoutes.labs} className={SECONDARY}>
          Back to labs
        </Link>
      </div>
    </section>
  );
}

/**
 * The launcher's latest state, from the messages the pane's frame posts
 * (`paneMessageState` decides which count); null until it says anything.
 */
function useLauncherState(frameRef) {
  const [state, setState] = useState(null);
  useEffect(() => {
    const onMessage = (event) => {
      const next = paneMessageState(event, frameRef.current);
      if (next !== null) setState(next);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameRef]);
  return state;
}

/**
 * The toolbar and the frame. Keyed by the sign-in time above it, so a new
 * sign-in in another tab mounts a new one: that is the reload.
 */
function Pane({ lab, signInHref, onStartSignIn }) {
  const paneRef = useRef(null);
  const frameRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const paneState = useLauncherState(frameRef);
  const fullscreenEnabled = useSyncExternalStore(
    noSubscription,
    readFullscreenEnabled,
    serverFalse
  );
  const fullscreen = useSyncExternalStore(subscribeFullscreen, readFullscreen, serverFalse);

  // A frame that never loads says nothing; the watchdog says it for it. Any
  // state the launcher sends means the frame loaded.
  const heard = paneState !== null;
  useEffect(() => {
    if (loaded || heard || timedOut) return undefined;
    const timer = window.setTimeout(() => setTimedOut(true), PANE_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [loaded, heard, timedOut]);

  // Full screen is the pane, this page's own element: never Coder's page on
  // its own, which #750 would redirect.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      paneRef.current?.requestFullscreen?.().catch(() => {});
    }
  };

  if (timedOut || paneState === 'unavailable') return <Unavailable />;

  const src = safeUrl(labLauncherUrl(lab));
  const signedOut = paneState === 'signed-out';
  return (
    <div className="flex flex-col gap-2">
      <section
        ref={paneRef}
        aria-label={`Lab workspace: ${lab.title}`}
        data-testid="lab-pane"
        className="flex flex-col rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 h-[calc(100dvh-14rem)] min-h-[32rem]"
      >
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {lab.title}
          </span>
          {/* Not a live region: the launcher's own status line in the pane is
              announced, and this would say the same thing a second time. */}
          <span data-testid="lab-pane-state" className={`mr-auto text-xs ${MUTED}`}>
            {paneState ? PANE_STATE_WORDS[paneState] : ''}
          </span>
          {fullscreenEnabled ? (
            <button type="button" onClick={toggleFullscreen} className={SECONDARY}>
              {fullscreen ? 'Exit full screen' : 'Open full screen'}
            </button>
          ) : null}
          {signInHref ? (
            <a
              href={signInHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onStartSignIn}
              data-testid="lab-pane-sign-in"
              className={signedOut ? PRIMARY : SECONDARY}
            >
              Sign in with GitHub <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : null}
          <Link to={staticRoutes.labs} className={SECONDARY}>
            Back to labs
          </Link>
        </div>
        {src ? (
          <iframe
            ref={frameRef}
            src={src}
            title={`Lab workspace: ${lab.title}`}
            sandbox={PANE_SANDBOX}
            allow={PANE_ALLOW}
            onLoad={() => setLoaded(true)}
            className="block w-full flex-1 border-0"
          />
        ) : null}
      </section>
      <p className={`text-xs ${MUTED}`}>
        If your workspace says you&apos;re not signed in, use Sign in with GitHub above: it opens in
        a new tab and brings you back here.
      </p>
    </div>
  );
}
