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
import { join } from 'node:path';
import {
  splitHead,
  injectIntoTemplate,
  canonicalFor,
  socialTags,
  seedScript,
  SEED_ELEMENT_ID,
} from './prerender.mjs';
// Imported rather than read from a path: under Vitest `import.meta.url` is a
// Vite module id, not a file: URL, so fileURLToPath on it throws.
import swaConfig from '../staticwebapp.config.json';

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

  it('emits no seed island for a route that was given no data', () => {
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<p>x</p>' }, '/about', null);
    expect(html).not.toContain(SEED_ELEMENT_ID);
  });

  it('emits the seed island for a route that was given data', () => {
    const seed = { 'article:x': { title: 'T' } };
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<p>x</p>' }, '/a/blog/x', seed);
    expect(html).toContain(SEED_ELEMENT_ID);
    const [, json] = new RegExp(`id="${SEED_ELEMENT_ID}">(.*?)</script>`, 's').exec(html);
    expect(JSON.parse(json)).toEqual(seed);
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
    // vitest runs with the frontend package as cwd.
    const source = readFileSync(join(process.cwd(), 'scripts', 'prerender.mjs'), 'utf8');
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

describe('seedScript', () => {
  it('is empty for no seed, so nothing is emitted', () => {
    expect(seedScript(null)).toBe('');
  });

  // The one way a JSON island can still break out of its own script element.
  // Content is author-written article HTML, so a literal </script> inside it is
  // not a hypothetical.
  it('escapes < so an embedded </script> cannot close the element early', () => {
    const evil = { 'article:x': { body: '</script><img src=x onerror=alert(1)>' } };
    const out = seedScript(evil);
    expect(out).not.toContain('</script><img');
    const json = out.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(JSON.parse(json)).toEqual(evil);
  });

  // THE CONTRACT WITH main.jsx. The id is agreed in two files; changing one
  // without the other does not break the page, it silently stops hydration and
  // goes back to discarding the pre-rendered DOM — the exact bug T-714 exists
  // for, reintroduced invisibly.
  it('uses the id main.jsx looks for', () => {
    const mainJsx = readFileSync(join(process.cwd(), 'src', 'main.jsx'), 'utf8');
    expect(mainJsx).toContain(`const SEED_ELEMENT_ID = '${SEED_ELEMENT_ID}'`);
  });

  it('agrees with main.jsx on the stamp attribute name', () => {
    const mainJsx = readFileSync(join(process.cwd(), 'src', 'main.jsx'), 'utf8');
    // dataset.prerenderedRoute is the DOM spelling of data-prerendered-route.
    expect(mainJsx).toContain('dataset.prerenderedRoute');
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<p>x</p>' }, '/');
    expect(html).toContain('data-prerendered-route=');
  });
});
