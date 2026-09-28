/**
 * The lab launcher (lab-host/coder/launcher/): the page the site's panes
 * load on Coder's name, which opens code-server inside the pane.
 *
 * It runs with the learner's Coder session, so what it may do is narrow and
 * this holds it there:
 *
 *   1. THE LOGIC, driven with a mocked fetch, clock, frame and navigation:
 *      only allowlisted labs, GET only, only two API paths; a visitor with
 *      no session is told to sign in above; a missing workspace shows
 *      Coder's own create page and a stopped one Coder's own workspace page;
 *      the pane moves to code-server only when the build is running, the
 *      agent connected and ready, and code-server healthy, and only to the
 *      one name Coder builds for this workspace, under a fixed suffix; the
 *      wait backs off and ends.
 *   2. THE FILES: no inline script or style, text only through textContent,
 *      nothing else in the directory Caddy serves.
 *   3. THE ROUTE: the launcher's handle comes before Coder's, has the strict
 *      policy and no-store, and no top-level exemption.
 *   4. THE MAP: the workspace names are the site catalogue's, and the lab
 *      ids are the template's.
 *
 * `caddy adapt` on the rendered route, and the answers through Caddy, are
 * in the container rehearsal the pull request records; the visitor wording
 * is in lab-host-visitor-copy.test.mjs.
 *
 * In the CI matrix this runs in the `scripts (operations)` row, whose filter
 * covers lab-host/ and the catalogue.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPS_HOST_SUFFIX,
  LAB_WORKSPACES,
  ME_PATH,
  MESSAGES,
  POLL,
  SITE_ORIGINS,
  STATES,
  assess,
  codeServerUrl,
  createPagePath,
  ownerName,
  resolveLab,
  runLauncher,
  workspaceApiPath,
  workspacePagePath,
} from '../lab-host/coder/launcher/launcher.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');
const LAUNCHER_DIR = 'lab-host/coder/launcher';
const ROUTE = 'lab-host/ansible/roles/coder/templates/10-coder.caddy.j2';

// ---------------------------------------------------------------------------
// Coder's answers, shaped as v2.37.3 sends them (codersdk.Workspace), with
// only the fields the launcher reads.

const OWNER = 'saulpatinojr';
/** `GET /api/v2/users/me` for that learner, capitals and all, as GitHub gave the name. */
const ME = { id: '3f1c6a2e-5f0b-4b7e-9d1a-0c2b4e6f8a10', username: 'SaulPatinoJr' };
const TFV = 'terraform-validate-walkthrough';

function workspace({
  status = 'running',
  agentStatus = 'connected',
  lifecycle = 'ready',
  health = 'healthy',
  subdomainName = `code-server--lab-tfv--${OWNER}`,
  subdomain = true,
  apps,
} = {}) {
  return {
    name: 'lab-tfv',
    latest_build: {
      status,
      transition: 'start',
      resources: [
        { name: 'workspace', agents: [] },
        {
          name: 'main',
          agents: [
            {
              name: 'main',
              status: agentStatus,
              lifecycle_state: lifecycle,
              apps: apps ?? [
                { slug: 'terminal', health: 'disabled', subdomain: false },
                { slug: 'code-server', health, subdomain, subdomain_name: subdomainName },
              ],
            },
          ],
        },
      ],
    },
  };
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/**
 * One scripted answer: a body (200), a number (that status, no body), an
 * Error (the fetch rejects), or `'bad-json'` (a 200 whose body does not parse).
 */
function answer(spec) {
  if (spec instanceof Error) throw spec;
  if (spec === 'bad-json') return { ok: true, status: 200, json: async () => JSON.parse('{') };
  return typeof spec === 'number' ? json(spec, {}) : json(200, spec);
}

/**
 * A launcher run against a scripted Coder. `me` answers /users/me; `reads`
 * answers the workspace reads in order, the last repeating (see `answer`).
 */
async function launch({ search = `?lab=${TFV}`, me = ME, reads = [404], poll = POLL } = {}) {
  let clock = 0;
  const calls = [];
  const says = [];
  const frames = [];
  const posts = [];
  const navigations = [];
  const sleeps = [];
  let index = 0;

  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url === ME_PATH) return answer(me);
    const spec = reads[Math.min(index, reads.length - 1)];
    index += 1;
    return answer(spec);
  };

  const end = await runLauncher({
    search,
    fetch,
    ui: { say: (text) => says.push(text), frame: (p) => frames.push(p) },
    post: (state) => posts.push(state),
    navigate: (url) => navigations.push(url),
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    poll,
  });
  return { end, calls, says, frames, posts, navigations, sleeps, clock };
}

// ---------------------------------------------------------------------------

describe('the allowlist', () => {
  it('maps each lab to a short workspace name Coder accepts', () => {
    for (const [lab, name] of Object.entries(LAB_WORKSPACES)) {
      expect(lab).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(name, lab).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(name.length, lab).toBeLessThanOrEqual(16);
      // code-server--<workspace>--<owner>, with a 32-character Coder username, is one DNS label.
      expect(`code-server--${name}--${'u'.repeat(32)}`.length).toBeLessThanOrEqual(63);
    }
    const names = Object.values(LAB_WORKSPACES);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.isFrozen(LAB_WORKSPACES)).toBe(true);
  });

  it('takes exactly one known lab from the query, and nothing else', () => {
    expect(resolveLab(`?lab=${TFV}`)).toEqual({ lab: TFV, workspace: 'lab-tfv' });
    expect(resolveLab('?lab=landing-zone-builder-output&x=1')).toEqual({
      lab: 'landing-zone-builder-output',
      workspace: 'lab-lzb',
    });
    for (const search of [
      '',
      '?',
      '?lab=',
      '?lab=no-such-lab',
      `?lab=${TFV}&lab=${TFV}`,
      '?lab=__proto__',
      '?lab=constructor',
      '?lab=hasOwnProperty',
      `?lab=${TFV.toUpperCase()}`,
      `?lab=${TFV}%00`,
      '?lab=<script>alert(1)</script>',
      undefined,
    ]) {
      expect(resolveLab(search), String(search)).toBeNull();
    }
  });

  it('builds Coder paths from its own values only', () => {
    expect(workspaceApiPath('lab-tfv')).toBe('/api/v2/users/me/workspace/lab-tfv');
    expect(createPagePath(TFV, 'lab-tfv')).toBe(
      `/templates/hcw-lab/workspace?mode=auto&name=lab-tfv&param.lab=${TFV}`
    );
    expect(workspacePagePath('lab-tfv')).toBe('/@me/lab-tfv');
  });
});

describe('ownerName', () => {
  it('is the signed-in username, lowercased', () => {
    expect(ownerName(ME)).toBe(OWNER);
    expect(ownerName({ username: 'a-b-9' })).toBe('a-b-9');
  });

  it.each([
    ['no body', null],
    ['no username', {}],
    ['a number', { username: 42 }],
    ['nothing', { username: '' }],
    ['a double hyphen, which Coder never makes', { username: 'a--b' }],
    ['a leading hyphen', { username: '-a' }],
    ['a dot', { username: 'a.b' }],
    ['a non-ASCII letter', { username: 'sömeone' }],
  ])('refuses %s', (_label, me) => {
    expect(ownerName(me)).toBeNull();
  });
});

describe('codeServerUrl', () => {
  const app = (subdomain_name, extra = {}) => ({ slug: 'code-server', subdomain: true, subdomain_name, ...extra });

  it('is the learner’s own code-server for this workspace, under the fixed suffix', () => {
    expect(APPS_HOST_SUFFIX).toBe('.coder.lab.hybridcloudworks.com');
    expect(codeServerUrl(app(`code-server--lab-tfv--${OWNER}`), 'lab-tfv', OWNER)).toBe(
      `https://code-server--lab-tfv--${OWNER}.coder.lab.hybridcloudworks.com/`
    );
    // A Coder username may carry capitals; a host name is case-insensitive.
    expect(codeServerUrl(app('code-server--lab-tfv--SaulPatinoJr'), 'lab-tfv', OWNER)).toBe(
      'https://code-server--lab-tfv--saulpatinojr.coder.lab.hybridcloudworks.com/'
    );
  });

  it.each([
    ['another learner’s code-server for the same lab', 'code-server--lab-tfv--someone'],
    ['an owner that only ends with the learner’s name', `code-server--lab-tfv--x--${OWNER}`],
    ['another workspace', `code-server--lab-lzb--${OWNER}`],
    ['another app', `terminal--lab-tfv--${OWNER}`],
    ['a longer workspace name that starts the same', `code-server--lab-tfvx--${OWNER}`],
    ['an agent segment, which v2.37.3 does not build for a named app', `code-server--main--lab-tfv--${OWNER}`],
    ['a dot, which would leave the suffix', `code-server--lab-tfv--${OWNER}.evil.example`],
    ['a slash', `code-server--lab-tfv--${OWNER}/x`],
    ['a port', `code-server--lab-tfv--${OWNER}:8443`],
    ['an at sign', `code-server--lab-tfv--${OWNER}@evil.example`],
    ['a space', `code-server--lab-tfv--${OWNER} `],
    ['no owner', 'code-server--lab-tfv--'],
    ['nothing', ''],
    ['a non-ASCII letter', 'code-server--lab-tfv--sömeone'],
  ])('refuses %s', (_label, name) => {
    expect(codeServerUrl(app(name), 'lab-tfv', OWNER)).toBeNull();
  });

  it('refuses a label over 63 characters even for the learner’s own name', () => {
    const long = 'a'.repeat(42);
    expect(codeServerUrl(app(`code-server--lab-tfv--${long}`), 'lab-tfv', long)).toBeNull();
  });

  it('refuses everything without a learner to match', () => {
    for (const owner of [null, undefined, '', 'a--b', 'Saul']) {
      expect(codeServerUrl(app(`code-server--lab-tfv--${owner}`), 'lab-tfv', owner)).toBeNull();
    }
  });

  it('refuses an app that is not a subdomain app, or has no name', () => {
    expect(codeServerUrl(app(`code-server--lab-tfv--${OWNER}`, { subdomain: false }), 'lab-tfv', OWNER)).toBeNull();
    expect(codeServerUrl({ slug: 'code-server', subdomain: true, subdomain_name: 42 }, 'lab-tfv', OWNER)).toBeNull();
    expect(codeServerUrl(null, 'lab-tfv', OWNER)).toBeNull();
  });
});

describe('assess', () => {
  it.each([
    ['pending', 'starting'],
    ['starting', 'starting'],
    ['stopping', 'starting'],
    ['canceling', 'starting'],
    ['deleting', 'starting'],
    ['something new', 'starting'],
    ['stopped', 'stopped'],
    ['failed', 'stopped'],
    ['canceled', 'stopped'],
    ['deleted', 'create'],
  ])('a latest build %s is %s', (status, state) => {
    expect(assess(workspace({ status }), 'lab-tfv', OWNER)).toEqual({ state });
  });

  it.each([
    ['the agent still connecting', { agentStatus: 'connecting' }],
    ['the agent disconnected', { agentStatus: 'disconnected' }],
    ['the startup script still running', { lifecycle: 'starting' }],
    ['code-server initializing', { health: 'initializing' }],
    ['code-server unhealthy', { health: 'unhealthy' }],
    ['code-server with no health check', { health: 'disabled' }],
    ['no code-server app yet', { apps: [] }],
  ])('running with %s is still starting', (_label, over) => {
    expect(assess(workspace(over), 'lab-tfv', OWNER)).toEqual({ state: 'starting' });
  });

  it('sends a startup script that failed to the workspace page, where Restart is', () => {
    expect(assess(workspace({ lifecycle: 'start_error' }), 'lab-tfv', OWNER)).toEqual({ state: 'stopped' });
  });

  it('is ready only when all three hold, with the checked address', () => {
    expect(assess(workspace(), 'lab-tfv', OWNER)).toEqual({
      state: 'ready',
      url: `https://code-server--lab-tfv--${OWNER}.coder.lab.hybridcloudworks.com/`,
    });
  });

  it('is unavailable, not ready, when Coder’s name for code-server is not the shape it builds', () => {
    expect(assess(workspace({ subdomainName: 'code-server--lab-tfv--x.evil.example' }), 'lab-tfv', OWNER)).toEqual({
      state: 'unavailable',
    });
  });

  it('waits on a body that is not a workspace, rather than guessing', () => {
    for (const body of [null, {}, { latest_build: null }, { latest_build: { status: 'running', resources: 'x' } }]) {
      expect(assess(body, 'lab-tfv', OWNER)).toEqual({ state: 'starting' });
    }
  });
});

describe('runLauncher', () => {
  it('refuses a lab it does not know, before any request', async () => {
    const run = await launch({ search: '?lab=no-such-lab' });
    expect(run.end).toBe('unavailable');
    expect(run.calls).toEqual([]);
    expect(run.says).toEqual([MESSAGES['unknown-lab']]);
    expect(run.posts).toEqual(['unavailable']);
    expect(run.navigations).toEqual([]);
  });

  it('asks a visitor with no session to sign in above, and reads nothing else', async () => {
    const run = await launch({ me: 401 });
    expect(run.end).toBe('signed-out');
    expect(run.calls.map((c) => c.url)).toEqual([ME_PATH]);
    expect(run.says.at(-1)).toBe(MESSAGES['signed-out']);
    expect(run.says.at(-1)).toMatch(/Sign in with GitHub above/);
    expect(run.posts).toEqual(['checking', 'signed-out']);
    expect(run.frames).toEqual([]);
  });

  it('sends only GETs, same origin, to the two API paths', async () => {
    const run = await launch({ reads: [404, workspace({ status: 'starting' }), workspace()] });
    const paths = new Set(run.calls.map((c) => c.url));
    expect([...paths].sort()).toEqual([ME_PATH, workspaceApiPath('lab-tfv')].sort());
    for (const { init } of run.calls) {
      expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      expect(init).not.toHaveProperty('body');
    }
  });

  it('shows Coder’s own create page for a workspace that does not exist, then opens the editor', async () => {
    const run = await launch({ reads: [404, 404, workspace({ status: 'pending' }), workspace({ status: 'starting' }), workspace({ health: 'initializing' }), workspace()] });
    expect(run.end).toBe('ready');
    expect(run.frames).toEqual([createPagePath(TFV, 'lab-tfv')]);
    expect(run.posts).toEqual(['checking', 'create', 'starting', 'ready']);
    expect(run.says).toContain(MESSAGES.create);
    expect(run.says).toContain(MESSAGES.starting);
    expect(run.says.at(-1)).toBe(MESSAGES.ready);
    expect(run.navigations).toEqual([`https://code-server--lab-tfv--${OWNER}.coder.lab.hybridcloudworks.com/`]);
  });

  it('shows Coder’s own workspace page for a stopped workspace, where Start is', async () => {
    const run = await launch({ reads: [workspace({ status: 'stopped' }), workspace({ status: 'stopped' }), workspace({ status: 'starting' }), workspace()] });
    expect(run.end).toBe('ready');
    expect(run.frames).toEqual(['/@me/lab-tfv']);
    expect(run.posts).toEqual(['checking', 'stopped', 'starting', 'ready']);
    expect(run.says).toContain(MESSAGES.stopped);
    expect(run.navigations).toHaveLength(1);
  });

  it('waits on a workspace that is already starting, with no frame of Coder’s', async () => {
    const run = await launch({ reads: [workspace({ status: 'starting' }), workspace({ agentStatus: 'connecting' }), workspace({ lifecycle: 'starting' }), workspace()] });
    expect(run.end).toBe('ready');
    expect(run.frames).toEqual([]);
    expect(run.posts).toEqual(['checking', 'starting', 'ready']);
  });

  it('opens a healthy workspace straight away', async () => {
    const run = await launch({ reads: [workspace()] });
    expect(run.end).toBe('ready');
    expect(run.sleeps).toEqual([]);
    expect(run.posts).toEqual(['checking', 'ready']);
  });

  it('never navigates to a malformed name, and says the workspaces are unavailable', async () => {
    for (const subdomainName of ['code-server--lab-tfv--x.evil.example', 'code-server--lab-lzb--someone', '']) {
      const run = await launch({ reads: [workspace({ subdomainName })] });
      expect(run.end).toBe('unavailable');
      expect(run.navigations).toEqual([]);
      expect(run.says.at(-1)).toBe(MESSAGES.unavailable);
      expect(run.posts.at(-1)).toBe('unavailable');
    }
  });

  it('takes the frame away when it gives up', async () => {
    const run = await launch({ reads: [404, 500], poll: { ...POLL, maxErrors: 2 } });
    expect(run.end).toBe('unavailable');
    expect(run.frames).toEqual([createPagePath(TFV, 'lab-tfv'), null]);
  });

  it('backs off from one second to five, and stops at the cap', async () => {
    const run = await launch({ reads: [workspace({ status: 'starting' })] });
    expect(run.end).toBe('unavailable');
    expect(run.sleeps.slice(0, 6)).toEqual([1000, 1500, 2250, 3375, 5000, 5000]);
    expect(Math.max(...run.sleeps)).toBe(POLL.maxDelayMs);
    expect(run.clock).toBeGreaterThanOrEqual(POLL.capMs);
    expect(run.clock).toBeLessThan(POLL.capMs + POLL.maxDelayMs * 2);
    expect(run.says.at(-1)).toBe(MESSAGES.unavailable);
    expect(run.posts).toEqual(['checking', 'starting', 'unavailable']);
    expect(run.navigations).toEqual([]);
  });

  it('gives up after six failed reads in a row, however they fail', async () => {
    for (const failure of [500, 502, new TypeError('Failed to fetch'), 'bad-json']) {
      const run = await launch({ reads: [failure] });
      expect(run.end).toBe('unavailable');
      expect(run.calls.filter((c) => c.url !== ME_PATH)).toHaveLength(POLL.maxErrors);
    }
    const noSession = await launch({ me: new TypeError('Failed to fetch') });
    expect(noSession.end).toBe('unavailable');
    expect(noSession.calls).toHaveLength(POLL.maxErrors);
  });

  it('forgives a failed read that is followed by a good one', async () => {
    const reads = [500, 500, 500, 500, 500, workspace({ status: 'starting' }), 500, 500, 500, 500, 500, workspace()];
    const run = await launch({ reads });
    expect(run.end).toBe('ready');
  });

  it('opens only the signed-in learner’s own editor, never another learner’s', async () => {
    const run = await launch({ reads: [workspace({ subdomainName: 'code-server--lab-tfv--someone' })] });
    expect(run.end).toBe('unavailable');
    expect(run.navigations).toEqual([]);
  });

  it('counts a session whose username it cannot use as a failed read, and reads no workspace', async () => {
    for (const me of [{}, { username: 'a--b' }, 'bad-json']) {
      const run = await launch({ me, reads: [workspace()] });
      expect(run.end).toBe('unavailable');
      expect(run.calls.map((c) => c.url)).toEqual(Array(POLL.maxErrors).fill(ME_PATH));
      expect(run.navigations).toEqual([]);
    }
  });

  it('stops at once when the session ends while it waits', async () => {
    const run = await launch({ reads: [workspace({ status: 'starting' }), 401] });
    expect(run.end).toBe('signed-out');
    expect(run.posts).toEqual(['checking', 'starting', 'signed-out']);
  });

  it('posts each state once, and only the states the site knows', async () => {
    const run = await launch({ reads: [404, 404, 404, workspace({ status: 'starting' }), workspace({ status: 'starting' }), workspace()] });
    expect(run.posts).toEqual(['checking', 'create', 'starting', 'ready']);
    for (const state of run.posts) expect(STATES).toContain(state);
  });
});

describe('the files Caddy serves', () => {
  const files = readdirSync(path.join(repoRoot, LAUNCHER_DIR)).sort();
  const html = read(`${LAUNCHER_DIR}/index.html`);
  const main = read(`${LAUNCHER_DIR}/main.js`);
  const launcher = read(`${LAUNCHER_DIR}/launcher.js`);

  it('are these four, and nothing else', () => {
    expect(files).toEqual(['index.html', 'launcher.css', 'launcher.js', 'main.js']);
  });

  it('are the files the role installs by name, and the role removes anything else', () => {
    const vars = read('lab-host/ansible/roles/coder/vars/main.yml');
    const listed = vars.match(/^coder_launcher_files:\n((?: {2}- \S+\n)+)/m);
    expect(listed, 'coder_launcher_files is not a plain list in vars/main.yml').not.toBeNull();
    expect(listed[1].trim().split('\n').map((line) => line.trim().replace(/^- /, '')).sort()).toEqual(files);
    const tasks = read('lab-host/ansible/roles/coder/tasks/main.yml');
    expect(tasks).toContain('excludes: "{{ coder_launcher_files }}"');
    // The directory is removed whole while Coder is disabled, so it must be the launcher's own.
    expect(vars).toContain("coder_launcher_dir_pattern: '^/etc/caddy/hcw-[a-z0-9-]+$'");
    expect(tasks).toContain('coder_launcher_dir is match(coder_launcher_dir_pattern)');
  });

  it('load one module script from this origin, and nothing inline', () => {
    // Any case, and any end tag (`</script >`, `</SCRIPT foo>`), as a browser reads them.
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)];
    expect(html.match(/<script\b/gi)).toHaveLength(1);
    expect(scripts).toHaveLength(1);
    expect(scripts[0][1].trim()).toBe('type="module" src="main.js"');
    expect(scripts[0][2]).toBe('');
    expect(html).not.toMatch(/\sstyle=|<style\b|\son[a-z]+=|javascript:/i);
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//i);
    expect(html).toContain('<link rel="stylesheet" href="launcher.css" />');
  });

  it('start with the same words the logic starts with', () => {
    const status = html.match(/<p id="status"[^>]*>([^<]*)<\/p>/);
    expect(status?.[1]).toBe(MESSAGES.checking);
  });

  it('set text only as text, and nothing from the query', () => {
    for (const source of [main, launcher]) {
      expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
    }
    expect(main).toContain('status.textContent = text;');
    expect(main).toMatch(/^import \{[^}]+\} from '\.\/launcher\.js';$/m);
    expect(main.match(/^import /gm)).toHaveLength(1);
    // The logic is pure: no page, no globals, no imports.
    expect(launcher).not.toMatch(/^import /m);
    expect(launcher).not.toMatch(/\b(?:document|window|location|localStorage)\./);
  });

  it('post only to the site’s two names, with its own type', () => {
    expect(SITE_ORIGINS).toEqual(['https://hybridcloudworks.com', 'https://www.hybridcloudworks.com']);
    expect(main).toContain('window.parent.postMessage({ type: MESSAGE_TYPE, state }, origin);');
    expect(main).not.toMatch(/postMessage\([^)]*'\*'/);
  });

  it('navigate only with location.replace, to the address the logic checked', () => {
    expect(main).toContain('navigate: (url) => window.location.replace(url),');
    expect(main.match(/location\.(?:replace|assign)\(|location\.href\s*=|\.src\s*=/g).sort()).toEqual([
      '.src =',
      'location.replace(',
    ]);
    // The one frame address: a path the logic built, set on a frame of this page.
    expect(main).toContain('frame.src = path;');
  });
});

describe('the route', () => {
  const route = read(ROUTE);
  const launcherHandle = route.match(/^handle @coder_lab_launcher \{\n([\s\S]*?)\n\}$/m);

  it('matches the launcher’s path on the dashboard name only', () => {
    expect(route).toMatch(/^@coder_lab_launcher \{\n {2}host \{\{ coder_domain \}\}\n {2}path \/_hcw\/lab\/\*\n\}$/m);
  });

  it('comes before Coder’s own handle, so Coder never sees these paths', () => {
    expect(launcherHandle).not.toBeNull();
    expect(route.indexOf('handle @coder_lab_launcher {')).toBeLessThan(route.indexOf('handle @coder {'));
  });

  it('adds the strict policy beside the panes-only frame-ancestors, with no-store', () => {
    const body = launcherHandle[1];
    const csp = body.match(/^ {4}\+Content-Security-Policy "([^"]+)"$/m);
    expect(csp, 'the policy is added (+), not set over lab_panes_only').not.toBeNull();
    const directives = Object.fromEntries(
      csp[1].split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values])
    );
    expect(directives).toEqual({
      'default-src': ["'none'"],
      'script-src': ["'self'"],
      'connect-src': ["'self'"],
      'style-src': ["'self'"],
      'frame-src': ["'self'"],
      'img-src': ["'self'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    });
    expect(body).not.toMatch(/frame-ancestors/);
    expect(body).toMatch(/^ {4}Cache-Control "no-store"$/m);
    expect(body).toMatch(/^ {4}X-Content-Type-Options "nosniff"$/m);
  });

  it('serves the role’s directory, with the prefix stripped', () => {
    const body = launcherHandle[1];
    expect(body).toMatch(/^ {2}uri strip_prefix \/_hcw\/lab$/m);
    expect(body).toMatch(/^ {2}root \* \{\{ coder_launcher_dir \}\}$/m);
    expect(body).toMatch(/^ {2}file_server$/m);
    expect(body).not.toMatch(/browse/);
    expect(read('lab-host/ansible/roles/coder/defaults/main.yml')).toMatch(
      /^coder_launcher_dir: \/etc\/caddy\/hcw-lab-launcher$/m
    );
    expect(read('lab-host/ansible/roles/coder/vars/main.yml')).toContain(
      'coder_launcher_source: "{{ role_path }}/../../../coder/launcher"'
    );
  });

  it('gives it no top-level exemption: only GitHub sign-in has one', () => {
    const exemptions = [...route.matchAll(/^vars (@\S+) lab_top_level_allowed true$/gm)].map((m) => m[1]);
    expect(exemptions).toEqual(['@coder_github_sign_in']);
    expect(launcherHandle[1]).not.toMatch(/lab_top_level_allowed/);
  });
});

describe('the map', () => {
  it('names each workspace exactly as the site’s catalogue does', () => {
    const catalogue = read('frontend/src/data/labs/catalogue.js');
    const rows = [...catalogue.matchAll(/id: '([a-z0-9-]+)',\n\s+workspaceName: '([a-z0-9-]+)',/g)];
    expect(Object.fromEntries(rows.map(([, id, name]) => [id, name]))).toEqual({ ...LAB_WORKSPACES });
  });

  it('knows exactly the labs the workspace template offers', () => {
    const template = read('lab-host/coder/templates/hcw-lab/main.tf');
    const regex = template.match(/regex = "\^\(([^)]+)\)\$"/);
    expect(regex, 'the template no longer validates lab with a regex of alternatives').not.toBeNull();
    expect(regex[1].split('|').sort()).toEqual(Object.keys(LAB_WORKSPACES).sort());
  });
});
