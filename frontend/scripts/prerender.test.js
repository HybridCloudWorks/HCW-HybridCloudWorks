/**
 * The two transformations that decide whether a pre-rendered page is correct.
 *
 * Both are easy to get subtly wrong in ways nothing else would catch. A page
 * with two `<title>` elements still renders; a page whose head tags leaked into
 * the body still renders; a page whose body was dropped still renders. All three
 * look fine in a browser and are wrong for exactly the audience this feature
 * exists to serve — crawlers and unfurlers, which never load the JavaScript that
 * would paper over the mistake.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  splitHead,
  injectIntoTemplate,
  canonicalFor,
  socialTags,
  seedAttribute,
  SEED_ATTRIBUTE,
  MOUNT_POINT_PATTERN,
} from './prerender.mjs';
// Imported rather than read from a path, so the JSON is parsed once by the
// bundler and a malformed file fails at import instead of mid-assertion.
//
// An earlier version of this comment justified the import by claiming that
// under Vitest `import.meta.url` is a Vite module id rather than a file: URL,
// so `fileURLToPath` on it throws. That is not true here and the roots below
// depend on it not being true, so it is corrected rather than deleted —
// vitest 4.1.11 reports
//
//     file:///…/frontend/scripts/prerender.test.js
//
// which `fileURLToPath` resolves, from the repository root and from frontend/
// alike. Measured, not assumed: a false warning left in place would tell the
// next reader the root resolution below is unsafe.
import swaConfig from '../staticwebapp.config.json';

// Every path in this file is resolved from THIS MODULE, never from
// process.cwd(). The distance from this file to the frontend package and to the
// repository root is fixed; the distance from the working directory is whatever
// the runner happened to be in. Reading them as cwd-relative passed under
// `cd frontend && npm test` — the way CI invokes this — and failed from the
// repository root with ENOENT on paths pointing outside the repository, so the
// suite guarding the deploy could not be run from the one place someone would
// run every suite from.
const FRONTEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(FRONTEND_ROOT, '..');

/**
 * The browser's side of `escapeAttr`, so a round-trip assertion tests the
 * escaping rather than restating it. Deliberately not a DOM parse: these tests
 * run in node, and a hand-written inverse fails loudly if `escapeAttr` ever
 * grows an escape this does not know about.
 */
function unescapeAttr(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

const TEMPLATE = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="UTF-8" />',
  '    <title>Hybrid Cloud Works</title>',
  '  </head>',
  '  <body>',
  '    <div id="root"></div>',
  '    <script type="module" src="/assets/index.js"></script>',
  '  </body>',
  '</html>',
].join('\n');

describe('splitHead', () => {
  it('lifts the run of hoisted tags React emits before the body', () => {
    // React 19 hoists <title>/<meta>/<link> from anywhere in the tree to the
    // front of the stream. Left in place they would render as visible content
    // inside <div id="root">.
    const rendered =
      '<link rel="preload" as="image" href="/a.png"/>' +
      '<title>About | HCW</title>' +
      '<div class="page">hello</div>';

    const { head, body } = splitHead(rendered);
    expect(head).toContain('<title>About | HCW</title>');
    expect(head).toContain('<link rel="preload"');
    expect(body).toBe('<div class="page">hello</div>');
  });

  it('stops at the first body element and never eats page content', () => {
    const { head, body } = splitHead('<div><title>not hoisted</title></div>');
    expect(head).toBe('');
    expect(body).toBe('<div><title>not hoisted</title></div>');
  });

  it('handles a render with no head tags at all', () => {
    const { head, body } = splitHead('<main>only body</main>');
    expect(head).toBe('');
    expect(body).toBe('<main>only body</main>');
  });

  it('keeps paired tags whole rather than splitting mid-element', () => {
    const { head, body } = splitHead('<style>.a{color:red}</style><p>x</p>');
    expect(head).toBe('<style>.a{color:red}</style>');
    expect(body).toBe('<p>x</p>');
  });
});

describe('injectIntoTemplate', () => {
  it('renders the body into the mount point, keeping the id for hydration', () => {
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<p>hello</p>' }, '/about');
    expect(html).toContain('<p>hello</p></div>');
    expect(html).toContain('id="root"');
  });

  // THE STAMP IS WHAT MAKES HYDRATION SAFE (T-714). navigationFallback serves
  // /index.html — the home page's markup — for any path without a file of its
  // own, at HTTP 200. Without a stamp to compare against, main.jsx would
  // hydrate the admin tree against the home page DOM on every /admin route.
  it('stamps the mount point with the route it rendered', () => {
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<p>x</p>' }, '/aws/blog/thing');
    expect(html).toContain('data-prerendered-route="/aws/blog/thing"');
  });

  // This assertion failed when it was written, and NOT on the stamp: it matched
  // the canonical link, which interpolated the route raw while every other tag
  // beside it went through escapeAttr. A route of `/a"><script>x` closed the
  // href and put a live element in <head>. Kept as one test because it is one
  // property — no route reaches the document unescaped, by any path.
  it('lets no route break out of an attribute, in the stamp or the canonical', () => {
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<p>x</p>' }, '/a"><script>x');
    expect(html).not.toContain('"><script>x');
    expect(html).toContain('&quot;');

    const [, stamp] = /data-prerendered-route="([^"]*)"/.exec(html) || [];
    expect(stamp).toBeTruthy();
    expect(stamp).not.toContain('<');

    const [, canonical] = /rel="canonical" href="([^"]*)"/.exec(html) || [];
    expect(canonical).toBeTruthy();
    expect(canonical).not.toContain('<');
  });

  it('emits no seed attribute for a route that was given no data', () => {
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<p>x</p>' }, '/about', null);
    expect(html).not.toContain(SEED_ATTRIBUTE);
  });

  it('emits the seed attribute for a route that was given data', () => {
    const seed = { 'article:x': { title: 'T' } };
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<p>x</p>' }, '/a/blog/x', seed);
    expect(html).toContain(SEED_ATTRIBUTE);
    const [, encoded] = new RegExp(`${SEED_ATTRIBUTE}="([^"]*)"`).exec(html);
    expect(JSON.parse(unescapeAttr(encoded))).toEqual(seed);
  });

  // The seed has to be INSIDE the opening tag of the mount point, not trailing
  // after it. Getting this wrong emits `<div id="root">...</div> data-...="{}"`,
  // which is visible text on the page and an absent seed — and the page still
  // renders, so only an assertion catches it.
  it('puts the seed on the mount point rather than after it', () => {
    const seed = { 'article:x': { title: 'T' } };
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<p>x</p>' }, '/a/blog/x', seed);
    expect(html).toMatch(new RegExp(`<div id="root"[^>]*\\s${SEED_ATTRIBUTE}="[^"]*"[^>]*>`));
  });

  it('REPLACES the template title rather than adding a second one', () => {
    // Two titles is not a tie a crawler resolves the way you would hope, and
    // the template's is the generic "Hybrid Cloud Works" this feature exists
    // to get rid of.
    const html = injectIntoTemplate(TEMPLATE, {
      head: '<title>About | HCW</title>',
      body: '<p>x</p>',
    });
    expect(html.match(/<title\b/gi)).toHaveLength(1);
    expect(html).toContain('<title>About | HCW</title>');
    expect(html).not.toContain('<title>Hybrid Cloud Works</title>');
  });

  it('keeps the template title when the route supplies none', () => {
    // A route with no title of its own is better off with the site title than
    // with none at all.
    const html = injectIntoTemplate(TEMPLATE, {
      head: '<meta name="description" content="d"/>',
      body: '<p>x</p>',
    });
    expect(html).toContain('<title>Hybrid Cloud Works</title>');
    expect(html).toContain('<meta name="description"');
  });

  it('puts head tags inside <head>, not adrift in the body', () => {
    const html = injectIntoTemplate(TEMPLATE, {
      head: '<meta name="description" content="d"/>',
      body: '<p>x</p>',
    });
    const headEnd = html.indexOf('</head>');
    expect(html.indexOf('<meta name="description"')).toBeLessThan(headEnd);
  });

  it('leaves the client bundle script in place — this is additive, not a replacement', () => {
    // If the script were dropped the page would look right and be inert: no
    // navigation, no interactivity, and nothing about the HTML would say so.
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<p>x</p>' });
    expect(html).toContain('<script type="module" src="/assets/index.js"></script>');
  });

  it('refuses a template with no mount point instead of writing a page with no content', () => {
    expect(() =>
      injectIntoTemplate('<html><body></body></html>', { head: '', body: '<p>x</p>' })
    ).toThrow(/no <div id="root">/);
  });
});

describe('the SPA fallback must not be a pre-rendered page', () => {
  const config = swaConfig;

  it('rewrites unmatched requests to the shell, not to index.html', () => {
    // index.html is the pre-rendered HOME PAGE. Pointing the fallback at it
    // serves the site's front page, in full, at HTTP 200, for every URL that
    // does not match a file — every mistyped link and every unpublished slug.
    // That is unbounded duplicate content, and it is worse than the empty shell
    // it replaced. Measured on the preview host on 2026-08-23, before the fix:
    // /definitely-not-real returned 200 with the home page's title and body.
    expect(config.navigationFallback.rewrite).toBe('/app-shell.html');
    expect(config.navigationFallback.rewrite).not.toBe('/index.html');
  });

  it('sends the 404 override to the shell too', () => {
    expect(config.responseOverrides['404'].rewrite).toBe('/app-shell.html');
    expect(config.responseOverrides['404'].statusCode).toBe(404);
  });

  it('names a file the pre-render step actually writes', () => {
    // A rewrite target that does not exist is a 404 for every article page,
    // which is the one thing the fallback exists to serve.
    const target = config.navigationFallback.rewrite.replace(/^\//, '');
    const source = readFileSync(join(FRONTEND_ROOT, 'scripts', 'prerender.mjs'), 'utf8');
    expect(source).toContain(`'${target}'`);
  });
});

describe('metadata contract', () => {
  it('canonical is route-specific, apex, and NOT trailing-slashed', () => {
    // Non-trailing because `trailingSlash: "always"` in Static Web Apps
    // redirects every path including files: /assets/*.js, /icons/*.png and
    // /sitemap.xml all 301'd, costing a round trip per asset per page load.
    expect(canonicalFor('/')).toBe('https://hybridcloudworks.com/');
    expect(canonicalFor('/about')).toBe('https://hybridcloudworks.com/about');
    expect(canonicalFor('/azure/blog')).toBe('https://hybridcloudworks.com/azure/blog');
  });

  it('normalises whatever slash form the route list uses', () => {
    // The canonical must not depend on how a route happened to be written.
    expect(canonicalFor('/about/')).toBe(canonicalFor('/about'));
  });

  it('never emits a bare-origin canonical for a sub-route', () => {
    // The original bug in one line: every page claimed to be the home page.
    for (const route of ['/about', '/azure', '/azure/education']) {
      expect(canonicalFor(route)).not.toBe('https://hybridcloudworks.com/');
    }
  });

  it('fills the tags a page did not supply', () => {
    const tags = socialTags('', '/about', 'About | HCW');
    expect(tags).toContain('rel="canonical" href="https://hybridcloudworks.com/about"');
    expect(tags).toContain('property="og:url" content="https://hybridcloudworks.com/about"');
    expect(tags).toContain('property="og:title" content="About | HCW"');
    expect(tags).toContain('name="twitter:card"');
  });

  it('does NOT overwrite what a page said about itself', () => {
    // /azure/news sets its own og:title via NewsPage. Clobbering it with the
    // document title would make this feature a downgrade for the pages that
    // already had metadata.
    const head = '<meta property="og:title" content="Azure Platform News" />';
    const tags = socialTags(head, '/azure/news', 'Azure Platform News | Hybrid Cloud Works');
    expect(tags).not.toContain('property="og:title"');
    expect(tags).toContain('rel="canonical"');
  });

  it('og:url always agrees with the canonical', () => {
    // Two contradictory signals are worse than one, and they are written by
    // different lines, so nothing else would catch them diverging.
    const tags = socialTags('', '/azure/blog', 'T');
    const canonical = /rel="canonical" href="([^"]+)"/.exec(tags)[1];
    const ogUrl = /property="og:url" content="([^"]+)"/.exec(tags)[1];
    expect(ogUrl).toBe(canonical);
  });

  it('escapes quotes so a title cannot break out of the attribute', () => {
    const tags = socialTags('', '/x', 'A "quoted" title');
    expect(tags).toContain('&quot;quoted&quot;');
    expect(tags).not.toMatch(/content="A "quoted"/);
  });

  it('omits a description rather than inventing one', () => {
    const tags = socialTags('', '/about', 'About');
    expect(tags).not.toContain('og:description');
  });

  it('strips the template canonical even when the route supplies none', () => {
    // The template's is hardcoded to the home page. Leaving it means either a
    // wrong canonical or two competing ones.
    const template =
      '<html><head><link rel="canonical" href="https://hybridcloudworks.com" /><title>T</title></head><body><div id="root"></div></body></html>';
    const html = injectIntoTemplate(template, { head: '', body: '<p>x</p>' }, '/about');
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain('href="https://hybridcloudworks.com/about"');
  });
});

describe('the canonical form must match how the platform serves', () => {
  it('agrees with staticwebapp.config.json trailingSlash', () => {
    // These two were set independently and disagreed for one deploy: canonical
    // said /about/ while the config said "never". A canonical pointing at a URL
    // that redirects is worse than no canonical, and nothing else compares them.
    const trailing = swaConfig.trailingSlash;
    const canonical = canonicalFor('/about');
    if (trailing === 'always') expect(canonical.endsWith('/')).toBe(true);
    if (trailing === 'never') expect(canonical.endsWith('/')).toBe(false);
  });

  it('never lets a file path inherit a trailing-slash rule', () => {
    // Why "never" and not "always": Static Web Apps applies trailingSlash to
    // every path, files included.
    expect(swaConfig.trailingSlash).toBe('never');
  });
});

describe('article detail routes', () => {
  it('replaces a canonical the page rendered rather than adding a second', () => {
    // BlogDetailTemplate sets its own canonical via Helmet. Emitting one
    // regardless put TWO on all 24 article pages the first time detail routes
    // were pre-rendered. The route-derived one wins because it is what knows
    // the origin and the trailing-slash policy.
    const template = '<html><head><title>T</title></head><body><div id="root"></div></body></html>';
    const head = '<link rel="canonical" href="https://example.com/wrong/" /><title>A | HCW</title>';
    const html = injectIntoTemplate(template, { head, body: '<p>x</p>' }, '/aws/blog/my-post');

    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain('href="https://hybridcloudworks.com/aws/blog/my-post"');
    expect(html).not.toContain('example.com/wrong');
  });

  it('keeps a page-supplied og:image, which only detail pages have', () => {
    const head = '<meta property="og:image" content="https://cdn.example/hero.png" />';
    const tags = socialTags(head, '/aws/blog/my-post', 'A | HCW');
    expect(tags).not.toContain('og:image');
  });
});

describe('seedAttribute', () => {
  it('is empty for no seed, so nothing is emitted', () => {
    expect(seedAttribute(null)).toBe('');
  });

  // Article bodies are author-written HTML, so a literal `"` or `</script>`
  // inside one is not a hypothetical. In an attribute the quote is the escape
  // that matters: an unescaped one ends the value and everything after it is
  // parsed as further attributes on the mount point.
  it('escapes the characters that would end the attribute or open a tag', () => {
    const evil = { 'article:x': { body: '"></div><img src=x onerror=alert(1)>' } };
    const out = seedAttribute(evil);

    expect(out).not.toContain('"></div>');
    expect(out).not.toContain('<img');

    const [, encoded] = new RegExp(`${SEED_ATTRIBUTE}="([^"]*)"`).exec(out);
    expect(JSON.parse(unescapeAttr(encoded))).toEqual(evil);
  });

  // THE CLOBBERING CASE THIS SHAPE EXISTS FOR. DOMPurify strips an injected
  // <script> but keeps <div id="...">, and getElementById returns the first
  // element with an id regardless of tag — so an id-addressed island inside
  // #root could be supplied by the article it belongs to. An attribute on the
  // mount point cannot: the template writes <div id="root"> ahead of anything
  // the pre-render puts inside it.
  it('carries no id for article markup to shadow', () => {
    const out = seedAttribute({ 'article:x': { title: 'T' } });
    expect(out).not.toContain('id=');
    expect(out).not.toContain('<');
  });

  // THE CONTRACT WITH main.jsx. The attribute is agreed in two files; changing
  // one without the other does not break the page, it silently stops hydration
  // and goes back to discarding the pre-rendered DOM — the exact bug T-714
  // exists for, reintroduced invisibly.
  it('uses the attribute main.jsx reads', () => {
    const mainJsx = readFileSync(join(FRONTEND_ROOT, 'src', 'main.jsx'), 'utf8');
    // dataset.prerenderedSeed is the DOM spelling of data-prerendered-seed.
    expect(SEED_ATTRIBUTE).toBe('data-prerendered-seed');
    expect(mainJsx).toContain('dataset.prerenderedSeed');
  });

  it('agrees with main.jsx on the stamp attribute name', () => {
    const mainJsx = readFileSync(join(FRONTEND_ROOT, 'src', 'main.jsx'), 'utf8');
    // dataset.prerenderedRoute is the DOM spelling of data-prerendered-route.
    expect(mainJsx).toContain('dataset.prerenderedRoute');
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<p>x</p>' }, '/');
    expect(html).toContain('data-prerendered-route=');
  });
});

/**
 * The deploy's mount-point check, tied to the thing it checks.
 *
 * WHY THIS EXISTS. `deploy-azure-frontend.yml` greps the built `/about` page to
 * prove pre-rendering produced a page rather than a shell. Its pattern was the
 * literal `<div id="root"><[^/]`, written when the mount point carried no
 * attributes. #296 (T-714) then stamped `data-prerendered-route` onto that same
 * div, so the literal stopped existing anywhere in the output.
 *
 * The check could no longer pass. Not "was more likely to fail" — could not
 * pass, on any input, however correct. It went unnoticed because this guard
 * FAILS CLOSED: a broken check blocks the deploy instead of admitting bad
 * output, so nothing was shipped wrong and nothing looked wrong until someone
 * tried to deploy on 2026-09-01 and the run died on a perfectly good build.
 *
 * A bash literal in a workflow describing a shape this module emits is a truth
 * in two places with nothing holding them together. So the pattern now lives in
 * prerender.mjs, the workflow uses that exact text, and this test reads it back
 * OUT OF THE WORKFLOW FILE to prove the two still agree. Editing either one
 * alone fails here — in the frontend test job, minutes after the push, instead
 * of at the next deploy whenever that happens to be.
 */
describe('the deploy workflow mount-point check', () => {
  const workflow = readFileSync(
    join(REPO_ROOT, '.github', 'workflows', 'deploy-azure-frontend.yml'),
    'utf8'
  );

  it('greps for exactly the pattern prerender.mjs exports', () => {
    // Single-quoted in bash, so the pattern is literal between the quotes.
    const found = /grep -q '(<div id="root"[^']*)' dist\/about\/index\.html/.exec(workflow);
    expect(found, 'the workflow no longer greps dist/about/index.html for a mount point').not.toBe(
      null
    );
    expect(found[1]).toBe(MOUNT_POINT_PATTERN);
  });

  it('matches a real pre-rendered document', () => {
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<main>real</main>' }, '/about');
    expect(new RegExp(MOUNT_POINT_PATTERN).test(html)).toBe(true);
  });

  it('matches when a seed rides along, including one containing a bracket', () => {
    // The case that made escapeAttr escape `>`: a raw `>` inside the attribute
    // value would end the tag as far as `[^>]*` is concerned, and the pattern
    // would look for a child element in the middle of an attribute.
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<main>real</main>' }, '/about', {
      'public:x': { note: 'a > b' },
    });
    expect(html).toContain('&gt;');
    expect(new RegExp(MOUNT_POINT_PATTERN).test(html)).toBe(true);
  });

  it('REJECTS a shell, which is the whole point', () => {
    const shell = injectIntoTemplate(TEMPLATE, { head: '', body: '' }, '/about');
    expect(new RegExp(MOUNT_POINT_PATTERN).test(shell)).toBe(false);
  });

  it('rejects the untouched vite template', () => {
    expect(new RegExp(MOUNT_POINT_PATTERN).test(TEMPLATE)).toBe(false);
  });
});
