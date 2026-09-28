/**
 * The lab launcher's logic: what the site's pane shows between "open this
 * lab" and the editor (ADR 0032, amendment "Coder in the site's panes", note
 * of 2026-09-28 on the launcher).
 *
 * WHY IT EXISTS. The lab is reached only through panes on
 * https://hybridcloudworks.com, and Caddy redirects any top-level visit
 * (lab_panes_only). Coder's dashboard opens code-server in a new window or
 * tab (`open_in` has no same-frame value in Coder v2.37.3), and a new window
 * is a top-level visit, so from the dashboard the editor can never open in
 * the pane. The launcher is a page on Coder's own name that the pane loads
 * instead. It reads the learner's workspace with the learner's own Coder
 * session, and when code-server is healthy it replaces itself with
 * code-server's own subdomain. code-server stays on its own origin, away
 * from Coder's API.
 *
 * WHAT IT MAY DO, and nothing more:
 *   - GET only, same origin, with the learner's session cookie. No request
 *     here changes anything in Coder, so it needs no CSRF token. Creating or
 *     starting a workspace is Coder's own UI in a frame of the same origin,
 *     with Coder's own consent dialog and buttons.
 *   - Everything it builds comes from constants below: the lab id and the
 *     workspace name from LAB_WORKSPACES, the template name, and the host
 *     suffix it navigates to. The query string only selects a key of
 *     LAB_WORKSPACES, and no text from it reaches the page.
 *   - The one value it takes from Coder is code-server's `subdomain_name`,
 *     and only after it matches the shape Coder v2.37.3 builds
 *     (`code-server--<workspace>--<owner>`, coderd/database/db2sdk
 *     AppSubdomain: no agent segment for a named app) for this workspace.
 *
 * Pure: no DOM, no globals. main.js wires it to the page, and
 * scripts/lab-host-launcher.test.mjs drives it with a mocked fetch, clock and
 * navigation.
 */

/** Where code-server's subdomain lives: CODER_WILDCARD_ACCESS_URL in lab-host/coder/docker-compose.yml. */
export const APPS_HOST_SUFFIX = '.coder.lab.hybridcloudworks.com';

/** The one workspace template (lab-host/coder/templates/hcw-lab). */
export const TEMPLATE = 'hcw-lab';

/** code-server's app slug: the module's default, which the template keeps. */
export const APP_SLUG = 'code-server';

/**
 * Where the site's pages live: both names, because www serves the site with
 * a 200 rather than redirecting (caddy_frame_ancestors in
 * lab-host/ansible/group_vars/all.yml). Each gets a post of its own; the
 * browser delivers only the one that matches the parent.
 */
export const SITE_ORIGINS = Object.freeze([
  'https://hybridcloudworks.com',
  'https://www.hybridcloudworks.com',
]);

/** The `type` of every message this page posts to the site. */
export const MESSAGE_TYPE = 'hcw-lab';

/**
 * Lab id to workspace name, one workspace per lab per learner. The ids are
 * the catalogue's (frontend/src/data/labs/catalogue.js), and its
 * `workspaceName` for each is the same string; both
 * scripts/lab-host-launcher.test.mjs and the catalogue's own test fail when
 * they differ.
 *
 * Short on purpose. Coder serves code-server at
 * `code-server--<workspace>--<owner>`, one DNS label of at most 63
 * characters, and an owner name can be 32 (codersdk/name.go), so a
 * workspace name has 16 at most. Lowercase letters, digits and single
 * hyphens, which is Coder's own rule for a name.
 */
export const LAB_WORKSPACES = Object.freeze({
  'landing-zone-builder-output': 'lab-lzb',
  'terraform-validate-walkthrough': 'lab-tfv',
  'ansible-syntax-check-walkthrough': 'lab-asc',
});

/** Every state this page reports, in the order a visit can move through them. */
export const STATES = Object.freeze([
  'checking',
  'signed-out',
  'create',
  'stopped',
  'starting',
  'ready',
  'unavailable',
]);

/**
 * Everything a visitor reads here. It renders inside the site's pane, so it
 * follows the site's public-pages rule: "your lab workspace", never the name
 * of a tool, the host or a setting (scripts/lab-host-visitor-copy.test.mjs).
 * `unavailable` is the site's own sentence for the same state
 * (UNAVAILABLE_SENTENCE in frontend/src/pages/shared/LabPanePage.jsx).
 */
export const MESSAGES = Object.freeze({
  checking: 'Opening your lab workspace…',
  'signed-out':
    "You're not signed in. Use Sign in with GitHub above to open your lab workspace here.",
  create: "Your lab workspace is new. Confirm below to create it, and it opens here when it's ready.",
  stopped:
    "Your lab workspace isn't running. Start it on the page below, and it opens here when it's ready.",
  starting: 'Getting your lab workspace ready. This can take a minute or two.',
  ready: 'Your lab workspace is ready. Opening it…',
  unavailable: "Lab workspaces aren't available right now.",
  'unknown-lab': "There's no lab at this address.",
  'frame-title': 'Your lab workspace',
});

/**
 * How often, and for how long. The wait grows from one second to five, so
 * a workspace that starts in seconds opens in seconds and one that takes
 * minutes is asked about every five. Ten minutes covers a first start (the
 * image is on the host already; code-server installs once per workspace)
 * with time to confirm the create dialog. Six failed reads in a row, about
 * thirteen seconds, is an outage rather than a blip.
 */
export const POLL = Object.freeze({
  firstDelayMs: 1_000,
  factor: 1.5,
  maxDelayMs: 5_000,
  capMs: 10 * 60 * 1_000,
  maxErrors: 6,
});

export const ME_PATH = '/api/v2/users/me';

/** Coder's API for one of the signed-in learner's workspaces, by name. */
export function workspaceApiPath(workspace) {
  return `/api/v2/users/me/workspace/${encodeURIComponent(workspace)}`;
}

/**
 * Coder's own create page, with the name and the lab set. `mode=auto` shows
 * Coder's consent dialog and creates on confirm, then moves that frame to
 * the new workspace's page.
 */
export function createPagePath(labId, workspace) {
  const query = `mode=auto&name=${encodeURIComponent(workspace)}&param.lab=${encodeURIComponent(labId)}`;
  return `/templates/${TEMPLATE}/workspace?${query}`;
}

/** Coder's page for the learner's workspace, where Start is. `me` resolves to the learner. */
export function workspacePagePath(workspace) {
  return `/@me/${encodeURIComponent(workspace)}`;
}

/** The lab and workspace a query string names, or null for anything but exactly one known `lab`. */
export function resolveLab(search) {
  let params;
  try {
    params = new URLSearchParams(typeof search === 'string' ? search : '');
  } catch {
    return null;
  }
  const ids = params.getAll('lab');
  if (ids.length !== 1 || !Object.hasOwn(LAB_WORKSPACES, ids[0])) return null;
  return { lab: ids[0], workspace: LAB_WORKSPACES[ids[0]] };
}

const SUBDOMAIN = /^code-server--[a-z0-9-]+--[a-z0-9-]+$/;
const DNS_LABEL_MAX = 63;

/**
 * code-server's address, or null when Coder's `subdomain_name` is not the
 * shape it builds for this workspace. Lowercased first: a Coder username may
 * carry capitals, and a host name is case-insensitive. The suffix is fixed
 * here and never read from anywhere.
 */
export function codeServerUrl(app, workspace) {
  if (app?.subdomain !== true || typeof app.subdomain_name !== 'string') return null;
  const name = app.subdomain_name.toLowerCase();
  if (name.length > DNS_LABEL_MAX || !SUBDOMAIN.test(name)) return null;
  if (!name.startsWith(`${APP_SLUG}--${workspace}--`)) return null;
  return `https://${name}${APPS_HOST_SUFFIX}/`;
}

/** code-server's app and the agent that serves it, from a workspace's latest build. */
export function findCodeServer(workspace) {
  const resources = workspace?.latest_build?.resources;
  if (!Array.isArray(resources)) return null;
  for (const resource of resources) {
    for (const agent of Array.isArray(resource?.agents) ? resource.agents : []) {
      for (const app of Array.isArray(agent?.apps) ? agent.apps : []) {
        if (app?.slug === APP_SLUG) return { agent, app };
      }
    }
  }
  return null;
}

/** Build states where the learner acts on Coder's workspace page (Start, or Retry after a failure). */
const NEEDS_THE_LEARNER = new Set(['stopped', 'failed', 'canceled']);

/**
 * What a workspace read means: `{ state }`, plus `url` when it is ready.
 * Anything this does not recognise is waited on, and the poll cap ends a
 * wait that never resolves.
 */
export function assess(workspace, workspaceName) {
  const status = workspace?.latest_build?.status;
  if (status === 'deleted') return { state: 'create' };
  if (NEEDS_THE_LEARNER.has(status)) return { state: 'stopped' };
  if (status !== 'running') return { state: 'starting' };

  const found = findCodeServer(workspace);
  if (!found) return { state: 'starting' };
  const { agent, app } = found;
  // A startup script that failed never becomes ready; the workspace page
  // shows why and has Restart.
  if (agent.lifecycle_state === 'start_error') return { state: 'stopped' };
  if (agent.status !== 'connected' || agent.lifecycle_state !== 'ready') return { state: 'starting' };
  if (app.health !== 'healthy') return { state: 'starting' };

  const url = codeServerUrl(app, workspaceName);
  return url ? { state: 'ready', url } : { state: 'unavailable' };
}

/** One GET: `{ kind: 'ok', body }`, `'signed-out'` (401), `'missing'` (404) or `'error'`. */
async function read(fetchImpl, path, wantBody) {
  try {
    const response = await fetchImpl(path, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 401) return { kind: 'signed-out' };
    if (response.status === 404) return { kind: 'missing' };
    if (!response.ok) return { kind: 'error' };
    return { kind: 'ok', body: wantBody ? await response.json() : null };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * Run the launcher once, to one of its ends: `ready` (navigated),
 * `signed-out` or `unavailable`.
 *
 * @param {object} deps
 * @param {string} deps.search  the page's query string
 * @param {(path: string, init: object) => Promise<Response>} deps.fetch
 * @param {{ say: (text: string) => void, frame: (path: string | null) => void }} deps.ui
 * @param {(state: string) => void} deps.post  tells the site the state
 * @param {(url: string) => void} deps.navigate  replaces the page, leaving no history entry
 * @param {(ms: number) => Promise<void>} deps.sleep
 * @param {() => number} deps.now
 * @param {typeof POLL} [deps.poll]
 */
export async function runLauncher({ search, fetch: fetchImpl, ui, post, navigate, sleep, now, poll = POLL }) {
  let reported = null;
  let framePath = null;

  const report = (state, text = MESSAGES[state]) => {
    ui.say(text);
    if (state !== reported) {
      reported = state;
      post(state);
    }
  };
  const showFrame = (path) => {
    if (path === framePath) return;
    framePath = path;
    ui.frame(path);
  };
  const end = (state, text) => {
    showFrame(null);
    report(state, text);
    return state;
  };

  const target = resolveLab(search);
  if (!target) return end('unavailable', MESSAGES['unknown-lab']);
  report('checking');

  const started = now();
  let delay = poll.firstDelayMs;
  let errors = 0;
  let signedIn = false;

  for (;;) {
    const result = signedIn
      ? await read(fetchImpl, workspaceApiPath(target.workspace), true)
      : await read(fetchImpl, ME_PATH, false);

    if (result.kind === 'signed-out') return end('signed-out');

    if (result.kind === 'error' || (!signedIn && result.kind === 'missing')) {
      errors += 1;
      if (errors >= poll.maxErrors) return end('unavailable');
    } else if (!signedIn) {
      errors = 0;
      signedIn = true;
      continue;
    } else {
      errors = 0;
      const verdict =
        result.kind === 'missing' ? { state: 'create' } : assess(result.body, target.workspace);
      if (verdict.state === 'unavailable') return end('unavailable');
      if (verdict.state === 'ready') {
        report('ready');
        navigate(verdict.url);
        return 'ready';
      }
      if (verdict.state === 'create') showFrame(createPagePath(target.lab, target.workspace));
      if (verdict.state === 'stopped') showFrame(workspacePagePath(target.workspace));
      report(verdict.state);
    }

    if (now() - started >= poll.capMs) return end('unavailable');
    await sleep(delay);
    delay = Math.min(delay * poll.factor, poll.maxDelayMs);
  }
}
