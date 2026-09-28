/**
 * What the lab host says inside the site's panes speaks to visitors only.
 * The owner's rule of 2026-09-28 is the one frontend/src/public-copy.test.js
 * holds the site's pages to: "The user only knows the front end and doesn't
 * know about tools we use". Since #750 every lab name can be framed by the
 * site, so any body Caddy answers on the TLS site can render inside a pane:
 * the apex placeholder, the 404 for a name no route claims, and the 503 the
 * coder route answers while Coder is stopped. None may name a tool, the host
 * or a setting. The 503 is also exactly the site's own sentence for the same
 * state (UNAVAILABLE_SENTENCE in frontend/src/pages/shared/LabPanePage.jsx),
 * so a visitor reads one message whichever side notices first.
 *
 * One body is exempt, and this test says where it may be: the fail-closed
 * HTTP-only site (no Cloudflare token) names the missing vault key for the
 * operator. The site's https pages cannot frame an http:// address (browsers
 * block mixed content in a frame), and lab_panes_only redirects a top-level
 * visit before it, so only a command-line client reads that one.
 *
 * The bodies are read from the templates Ansible renders, with each
 * `{{ variable }}` taken from the role's defaults/main.yml, so a new
 * `respond` in any of them is scanned too.
 *
 * The lab launcher (lab-host/coder/launcher/) is the page every pane opens
 * on, so everything it can put in front of a visitor is scanned the same
 * way: each of its messages, and the words in its page. It says "your lab
 * workspace", never the tool behind it, and its `unavailable` is the site's
 * sentence too. That includes a template Coder does not have: the launcher
 * says the sentence and never frames Coder's create page, whose own error
 * box is what a visitor saw on 2026-09-28.
 *
 * In the CI matrix this runs in the `scripts (operations)` row, whose filter
 * covers lab-host/ and LabPanePage.jsx.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ME_PATH, MESSAGES as LAUNCHER_MESSAGES, runLauncher } from '../lab-host/coder/launcher/launcher.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

const ROLES = 'lab-host/ansible/roles';
const CADDYFILE = `${ROLES}/caddy/templates/Caddyfile.j2`;
const APEX_ROUTE = `${ROLES}/caddy/templates/00-apex.caddy.j2`;
const CODER_ROUTE = `${ROLES}/coder/templates/10-coder.caddy.j2`;
const PANE_PAGE = 'frontend/src/pages/shared/LabPanePage.jsx';

/**
 * What a visitor must not read from the lab host: the tools behind it, the
 * host itself, and settings. The site's own list (public-copy.test.js) is
 * about the site's stack; this is the lab host's.
 */
const LAB_HOST_TERMS = Object.freeze({
  tools: /coder|caddy|docker|compose|postgres|ansible|terraform|portainer|\bvault\b/i,
  edge: /cloudflare|hostinger|\bvps\b/i,
  host: /\bhosts?\b|\bapex\b|\bserver\b|\bHCW\b/i,
  settings: /\bTLS\b|\bvault_[a-z_]+|\bCODER_[A-Z_]+|_response\b|\bconf\.d\b/i,
});

/** The top-level `name: "value"` scalars of a role's defaults/main.yml. */
function roleDefaults(role) {
  const text = read(`${ROLES}/${role}/defaults/main.yml`);
  const values = {};
  for (const match of text.matchAll(/^([a-z_]+): "((?:[^"\\]|\\.)*)"$/gm)) {
    values[match[1]] = match[2];
  }
  return values;
}

const DEFAULTS = { ...roleDefaults('caddy'), ...roleDefaults('coder') };

/** `{{ name }}` replaced from the role defaults; an unknown name fails the test. */
function render(body) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name) => {
    if (!(name in DEFAULTS)) throw new Error(`no default for ${name} in the caddy or coder role`);
    return DEFAULTS[name];
  });
}

/** Every `respond "<body>" <status>` in a Caddy template, rendered. */
function responds(text) {
  return [...text.matchAll(/respond "([^"]*)" (\d{3})/g)].map((m) => ({
    body: render(m[1]),
    status: Number(m[2]),
  }));
}

function termsIn(text) {
  return Object.entries(LAB_HOST_TERMS).flatMap(([term, pattern]) => {
    const match = text.match(pattern);
    return match ? [`${term}: "${match[0]}"`] : [];
  });
}

const caddyfile = read(CADDYFILE);
const [tlsSite, httpOnlySite] = caddyfile.split('{% else %}');

/** Every body that can render inside one of the site's panes. */
const paneBodies = [
  ...responds(tlsSite).map((r) => ({ ...r, file: `${CADDYFILE} (TLS site)` })),
  ...responds(read(APEX_ROUTE)).map((r) => ({ ...r, file: APEX_ROUTE })),
  ...responds(read(CODER_ROUTE)).map((r) => ({ ...r, file: CODER_ROUTE })),
];

describe('the scan itself', () => {
  it('catches the wording the lab host used before 2026-09-28', () => {
    expect(termsIn('Coder is stopped on this host.')).toEqual(['tools: "Coder"', 'host: "host"']);
    expect(termsIn('HCW lab host. Nothing is served at the apex yet.')).toEqual(['host: "HCW"']);
    expect(termsIn('TLS is off: vault_cloudflare_api_token is not set.')).toEqual([
      'edge: "cloudflare"',
      'settings: "TLS"',
    ]);
  });

  it('passes the site’s own sentence', () => {
    expect(termsIn("Lab workspaces aren't available right now.")).toEqual([]);
  });

  it('finds the three bodies a pane can show: the apex, the unknown name and Coder stopped', () => {
    expect(paneBodies.map(({ status, file }) => `${status} ${file}`).sort()).toEqual([
      `200 ${APEX_ROUTE}`,
      `404 ${CADDYFILE} (TLS site)`,
      `503 ${CODER_ROUTE}`,
    ]);
  });
});

describe('what a pane can show from the lab host', () => {
  it.each(paneBodies.map((r) => [r.status, r.file, r.body]))(
    '%i from %s names no tool, host or setting',
    (_status, _file, body) => {
      expect(body.trim()).not.toBe('');
      expect(termsIn(body)).toEqual([]);
    }
  );

  it('answers "Coder stopped" with the site’s own sentence for the same state', () => {
    const sentence = read(PANE_PAGE).match(/export const UNAVAILABLE_SENTENCE = "([^"]+)";/);
    expect(sentence, `${PANE_PAGE} no longer exports UNAVAILABLE_SENTENCE`).not.toBeNull();
    expect(DEFAULTS.coder_unavailable_response).toBe(sentence[1]);
    expect(responds(read(CODER_ROUTE))).toEqual([{ body: sentence[1], status: 503 }]);
  });
});

describe('what the lab launcher can show', () => {
  const LAUNCHER_PAGE = 'lab-host/coder/launcher/index.html';

  /** The words in the launcher's page: its title, its first status line and its no-script note. */
  const pageWords = read(LAUNCHER_PAGE)
    .replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  it('scans the words in its page', () => {
    expect(pageWords).toContain('Your lab workspace');
    expect(pageWords).toContain(LAUNCHER_MESSAGES.checking);
    expect(termsIn(pageWords)).toEqual([]);
  });

  it.each(Object.entries(LAUNCHER_MESSAGES))('its "%s" message names no tool, host or setting', (_key, text) => {
    expect(text.trim()).not.toBe('');
    expect(termsIn(text)).toEqual([]);
    expect(text).not.toMatch(/code-server|\bvps\b|coder/i);
  });

  it('says "unavailable" with the site’s own sentence for the same state', () => {
    const sentence = read(PANE_PAGE).match(/export const UNAVAILABLE_SENTENCE = "([^"]+)";/);
    expect(sentence, `${PANE_PAGE} no longer exports UNAVAILABLE_SENTENCE`).not.toBeNull();
    expect(LAUNCHER_MESSAGES.unavailable).toBe(sentence[1]);
  });

  // 2026-09-28, before the template was published: the pane loaded Coder's
  // create page, and Coder answered with its own red box, these words and a
  // stack trace. The launcher now reads the template first.
  const CODER_ERROR_BOX = ['Resource not found or you do not have access to this resource', 'Response data', 'Stack Trace'];

  it('shows only the site’s sentence when the template is missing, and never Coder’s error page', async () => {
    const reply = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    const says = [];
    const frames = [];
    const end = await runLauncher({
      search: '?lab=landing-zone-builder-output',
      // Signed in, no workspace yet, and Coder has no template: 404 for all but /users/me.
      fetch: async (url) => (url === ME_PATH ? reply(200, { username: 'learner' }) : reply(404)),
      ui: { say: (text) => says.push(text), frame: (framePath) => frames.push(framePath) },
      post: () => {},
      navigate: () => {},
      sleep: async () => {},
      now: () => 0,
    });
    const sentence = read(PANE_PAGE).match(/export const UNAVAILABLE_SENTENCE = "([^"]+)";/)[1];
    expect(end).toBe('unavailable');
    expect(frames, 'a Coder page was framed, and a missing template shows Coder’s own error there').toEqual([]);
    expect(says.at(-1)).toBe(sentence);
    for (const text of says) {
      expect(termsIn(text)).toEqual([]);
      for (const words of CODER_ERROR_BOX) expect(text).not.toContain(words);
    }
  });

  it('points a visitor with no session at the site’s own sign-in button', () => {
    expect(LAUNCHER_MESSAGES['signed-out']).toContain('Sign in with GitHub');
    expect(read(PANE_PAGE)).toContain('Sign in with GitHub <span className="sr-only">(opens in a new tab)</span>');
  });
});

describe('the one body for the operator', () => {
  it('is only on the fail-closed HTTP-only site, which a pane cannot show', () => {
    expect(httpOnlySite, `${CADDYFILE} has no HTTP-only branch`).toBeDefined();
    expect(httpOnlySite).toMatch(/^http:\/\/\{\{ caddy_site_domain \}\} \{$/m);
    expect(responds(httpOnlySite)).toEqual([
      { body: 'TLS is off: vault_cloudflare_api_token is not set.', status: 503 },
    ]);
  });
});
