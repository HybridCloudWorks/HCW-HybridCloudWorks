/**
 * The addons role's Caddy route (ADR 0035), rendered from its template for a
 * fixture `addons` list by string replacement, as lab-host-visitor-copy does:
 * each enabled row gets one host matcher that is exactly its one-label lab
 * name, one reverse_proxy to its loopback port, one per-name direct-visit
 * redirect to the add-on's own page on the site (the vars override the
 * Caddyfile's lab_panes_only reads), and a 503 with the site's sentence
 * while its container is stopped. No add-on is ever let through at the top
 * level (lab_top_level_allowed), and a disabled row is not in the route at
 * all.
 *
 * The Caddyfile side of the override is held here too: lab_panes_only sets
 * the variable before its matcher and its redir reads the placeholder,
 * which is what lets a later `vars` for the same key win. Whether Caddy
 * orders them that way is checked by `caddy adapt` in CI
 * (roles/caddy/tests/caddy-adapt.test.sh); this test only holds the text to
 * the shape that check was written for.
 *
 * In the CI matrix this runs in the `scripts (operations)` row, whose filter
 * covers lab-host/.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

const ROLES = 'lab-host/ansible/roles';
const template = read(`${ROLES}/addons/templates/20-addons.caddy.j2`);
const caddyfile = read(`${ROLES}/caddy/templates/Caddyfile.j2`);

const DOMAIN = 'lab.hybridcloudworks.com';
const SENTENCE = "This tool isn't available right now.";

/** The rows the template loops over: what the role's vars/main.yml filters `addons` down to. */
const ADDONS = [
  { id: 'migration', port: 18081 },
  { id: 'cloud-assessment', port: 18083 },
];

/**
 * Render the template's one `{% for addon in addons_running %}` loop and
 * its `{{ … }}` references for a fixture list, the way Jinja would for these
 * expressions: `addon.id`, `addon.id | replace('-', '_')`, `addon.port`, and
 * the three plain variables.
 */
function render(rows) {
  const vars = {
    lab_host_domain: DOMAIN,
    addons_publish_address: '127.0.0.1',
    addons_unavailable_response: SENTENCE,
    ansible_managed: 'Ansible managed',
  };
  const loop = /\{% for addon in addons_running %\}\n([\s\S]*?)\{% endfor %\}\n/g;
  const expanded = template.replace(loop, (_, body) =>
    rows
      .map((addon) =>
        body
          .replace(/\{\{ addon\.id \| replace\('-', '_'\) \}\}/g, addon.id.replace(/-/g, '_'))
          .replace(/\{\{ addon\.id \}\}/g, addon.id)
          .replace(/\{\{ addon\.port \}\}/g, String(addon.port))
      )
      .join('')
  );
  return expanded.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name) => {
    if (!(name in vars)) throw new Error(`the template reads ${name}, which this render does not set`);
    return vars[name];
  });
}

/** The route's lines, comments and blanks dropped. */
const lines = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

describe('the addons route template', () => {
  const rendered = render(ADDONS);
  const body = lines(rendered);

  it('renders nothing Jinja for the fixture rows', () => {
    expect(rendered).not.toMatch(/\{\{|\{%/);
  });

  it.each(ADDONS)('gives $id one host matcher that is exactly its lab name, and a proxy to its port', (addon) => {
    const matcher = `@addon_${addon.id.replace(/-/g, '_')}`;
    expect(body).toContain(`${matcher} host ${addon.id}.${DOMAIN}`);
    expect(body.filter((line) => line.startsWith(`${matcher} host`))).toHaveLength(1);
    expect(body).toContain(`handle ${matcher} {`);
    expect(body).toContain(`reverse_proxy 127.0.0.1:${addon.port}`);
    // One label below the lab domain, and no wildcard: the site's CSP names
    // exactly this origin.
    expect(rendered).not.toMatch(new RegExp(`\\*\\.${addon.id.replace(/-/g, '\\-')}\\.`));
  });

  it.each(ADDONS)('sends a top-level visit to $id to the add-on’s own page on the site', (addon) => {
    const matcher = `@addon_${addon.id.replace(/-/g, '_')}`;
    expect(body).toContain(
      `vars ${matcher} lab_direct_visit_redirect https://hybridcloudworks.com/tools/${addon.id}`
    );
  });

  it.each(ADDONS)('answers a stopped $id with the site’s sentence and 503', (addon) => {
    const matcher = `@addon_${addon.id.replace(/-/g, '_')}_down`;
    expect(body).toContain(`${matcher} host ${addon.id}.${DOMAIN}`);
    expect(body).toContain(`handle ${matcher} {`);
    expect(body.filter((line) => line === `respond "${SENTENCE}" 503`)).toHaveLength(ADDONS.length);
  });

  it('lets nothing of an add-on through at the top level', () => {
    // Directives only: the template's comment may say the name.
    expect(lines(template).filter((line) => /lab_top_level_allowed/.test(line))).toEqual([]);
  });

  it('proxies to the loopback and nowhere else', () => {
    for (const line of body.filter((l) => l.startsWith('reverse_proxy'))) {
      expect(line).toMatch(/^reverse_proxy 127\.0\.0\.1:\d+$/);
    }
    expect(body.filter((l) => l.startsWith('reverse_proxy'))).toHaveLength(ADDONS.length);
  });

  it('renders no route for an empty list, apart from the error block', () => {
    const empty = lines(render([]));
    expect(empty.filter((line) => /^@addon_|reverse_proxy|vars /.test(line))).toEqual([]);
    expect(empty).toEqual(['handle_errors {', '}']);
  });
});

describe('the Caddyfile’s half of the per-name redirect', () => {
  const snippet = caddyfile.slice(caddyfile.indexOf('(lab_panes_only) {'), caddyfile.indexOf('{% if caddy_tls_enabled'));
  const body = lines(snippet);

  it('sets the variable for every name before its matcher, and reads it back in the redir', () => {
    const set = body.findIndex((line) => line === 'vars lab_direct_visit_redirect {{ caddy_direct_visit_redirect }}');
    const matcher = body.findIndex((line) => line === '@lab_direct_visit {');
    const redir = body.findIndex((line) => line === 'redir @lab_direct_visit {vars.lab_direct_visit_redirect} 302');
    expect(set).toBeGreaterThan(-1);
    expect(matcher).toBeGreaterThan(set);
    expect(redir).toBeGreaterThan(matcher);
    // The target is the variable, so no literal address is left in the redir.
    expect(body.filter((line) => line.startsWith('redir '))).toHaveLength(1);
  });

  it('imports the snippet before conf.d, so a route’s vars comes after the snippet’s', () => {
    const site = caddyfile.slice(caddyfile.indexOf('{% if caddy_tls_enabled'), caddyfile.indexOf('{% else %}'));
    const imports = lines(site).filter((line) => line.startsWith('import '));
    expect(imports).toEqual(['import lab_panes_only', 'import {{ caddy_sites_dir }}/*.caddy']);
  });
});
