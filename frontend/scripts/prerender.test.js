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
import { splitHead, injectIntoTemplate } from './prerender.mjs';
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
    const html = injectIntoTemplate(TEMPLATE, { head: '', body: '<p>hello</p>' });
    expect(html).toContain('<div id="root"><p>hello</p></div>');
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
