/**
 * Pre-render the built SPA to real HTML, one file per route (TODO.md T-515).
 *
 * WHAT WAS WRONG. This repository built with `vite build` and shipped a single
 * `index.html` containing an empty `<div id="root">` and the title "Hybrid Cloud
 * Works". Site-Main, the site being migrated from, built with Vike and shipped
 * pre-rendered HTML. Measured on the same path during the §6 parallel run:
 * `/about` was 24,902 bytes on Firebase and 2,808 bytes on Azure, with 2,717
 * characters of visible text against 967, and the correct `<title>` against a
 * generic one. Migration_Plan §7 states a gate of "90 HTML documents
 * pre-rendered"; this build produced three.
 *
 * That matters here more than it usually would. This is a content platform
 * whose purpose is being found, and every article, framework and architecture
 * page served a generic title and an empty shell to anything that does not run
 * JavaScript — most link unfurlers, several crawlers, every social preview card.
 * The pages render correctly in a browser, so clicking through the site reveals
 * nothing at all.
 *
 * HOW. `vite build` still produces the SPA exactly as before; this runs after it
 * and adds static HTML beside it. Each route is rendered through the real
 * application — same components, same providers, same 42 pages that set their
 * own title — and written to `dist/<route>/index.html`. The client bundle is
 * untouched and still hydrates, so this is additive: if a file here were wrong,
 * the SPA underneath it still works.
 *
 * WHY NOT `renderToString`. Every route is a `React.lazy` import behind one
 * `<Suspense>`, and `renderToString` does not wait for those — it emits the
 * loading fallback and returns, producing ~380 characters of identical markup
 * for every URL. `prerenderToNodeStream` (React 19's static API) resolves every
 * boundary first.
 *
 * WHY NO ARTICLE PAGES. See `routes()` in prerender-entry.jsx: they would need
 * the API at build time, and CI cannot reach it (issue #175).
 *
 * THIS STEP FAILS THE BUILD. A route that throws, renders its error boundary, or
 * comes back suspiciously small is a broken page — and a broken page written to
 * disk looks exactly like a working one from the outside. Shipping a shell is
 * the failure this whole file exists to prevent, so it is not something to warn
 * about and continue past.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ENTRY = 'scripts/prerender-entry.jsx';

/**
 * Resolved on demand, not at module scope.
 *
 * `splitHead` and `injectIntoTemplate` are pure and are imported by
 * prerender.test.js, where `import.meta.url` is a Vite module id rather than a
 * `file:` URL — computing these eagerly made the whole test file fail to import
 * with "The URL must be of scheme file", before a single assertion ran.
 */
function paths() {
  const frontend = fileURLToPath(new URL('..', import.meta.url));
  return { frontend, dist: join(frontend, 'dist'), ssrDist: join(frontend, 'dist-ssr') };
}

/**
 * Below this many characters of visible text, a page is a shell rather than a
 * page. The smallest legitimate route is a Coming Soon page at ~470; the shell
 * this replaces measured 389 on every URL. 420 sits between them.
 */
const MIN_TEXT_CHARS = 420;

/** Tags React hoists to the document head, emitted ahead of the body markup. */
const HEAD_TAG = /^\s*<(link|meta|title|style|script|base)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/i;

/**
 * The canonical origin and URL shape. Decided 2026-08-23 from evidence, not
 * preference, because canonical and trailing slash cannot be chosen separately:
 * a canonical pointing at a URL that redirects is worse than no canonical.
 *
 *   - The live Firebase site 301s `/about` to `/about/`, so the form Google
 *     actually resolved and indexed is the TRAILING one.
 *   - Its sitemap advertises `/about`, the non-trailing form. The two have
 *     disagreed the whole time; the sitemap is the half that is wrong.
 *   - Azure was configured `trailingSlash: "never"`, the opposite of live.
 *
 * Trailing looked right — it preserves the indexed form — and was shipped that
 * way for one deploy. It is wrong on this platform.
 *
 * `trailingSlash: "always"` in Static Web Apps applies to EVERY path, files
 * included. Measured live: `/assets/index-*.js`, `/assets/vendor-*.css`,
 * `/icons/hcw-logo.png` and `/sitemap.xml` all returned 301 to a slashed URL.
 * They resolve at the redirect with the correct content type, so nothing broke
 * — it simply cost an extra round trip on every asset on every page load,
 * permanently, to preserve a URL form that a 301 already handles.
 *
 * So: NON-trailing, matching `trailingSlash: "never"`. Existing trailing-form
 * inbound links redirect once and pass their equity on, which is the same
 * mechanism that made the trailing form look preferable in the first place.
 *
 * Apex, not www: every indexed URL and the sitemap use the apex.
 */
export const SITE_ORIGIN = 'https://hybridcloudworks.com';
const DEFAULT_SOCIAL_IMAGE = `${SITE_ORIGIN}/icons/hcw-logo.png`;

/** `/azure/blog` -> `https://hybridcloudworks.com/azure/blog` (root keeps its slash) */
export function canonicalFor(route) {
  const clean = String(route).replace(/^\/+|\/+$/g, '');
  return clean ? `${SITE_ORIGIN}/${clean}` : `${SITE_ORIGIN}/`;
}

/** The value of a `<meta>` already present in the rendered head, if any. */
function metaContent(head, attr, name) {
  const match = new RegExp(`<meta[^>]*${attr}="${name}"[^>]*content="([^"]*)"`, 'i').exec(head);
  return match?.[1] || null;
}

/**
 * The head tags a route did not supply itself.
 *
 * WHY THIS IS NOT OPTIONAL. Pre-rendering made these pages legible to crawlers
 * for the first time, and what they read was `index.html`'s hardcoded
 * `<link rel="canonical" href="https://hybridcloudworks.com">` — every page
 * declaring itself a duplicate of the home page. Titles were correct and the
 * canonical said to consolidate all of them onto one URL anyway.
 *
 * Coverage was also uneven rather than absent: `/azure/news` already emitted
 * og:title and og:description from NewsPage, `/about` emitted neither, and the
 * routes with the best metadata of all — the article and architecture detail
 * templates, which set canonical, og:image and more — are the ones not
 * pre-rendered at all. So this fills gaps and never overwrites: a page that
 * says something about itself keeps saying it.
 */
export function socialTags(head, route, title) {
  const canonical = canonicalFor(route);
  const description = metaContent(head, 'name', 'description');
  const ogTitle = metaContent(head, 'property', 'og:title') || title;
  const ogDescription = metaContent(head, 'property', 'og:description') || description;
  const ogImage = metaContent(head, 'property', 'og:image') || DEFAULT_SOCIAL_IMAGE;

  const tags = [`<link rel="canonical" href="${canonical}" />`];
  const add = (attr, name, content) => {
    if (!content) return;
    if (metaContent(head, attr, name)) return; // the page said it; leave it alone
    tags.push(`<meta ${attr}="${name}" content="${escapeAttr(content)}" />`);
  };

  // og:url must agree with the canonical or the two signals contradict.
  add('property', 'og:url', canonical);
  add('property', 'og:type', 'website');
  add('property', 'og:site_name', 'Hybrid Cloud Works');
  add('property', 'og:title', ogTitle);
  add('property', 'og:description', ogDescription);
  add('property', 'og:image', ogImage);
  add('name', 'twitter:card', 'summary_large_image');
  add('name', 'twitter:title', ogTitle);
  add('name', 'twitter:description', ogDescription);
  add('name', 'twitter:image', ogImage);

  return tags.join('\n    ');
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Split React's output into head tags and body markup.
 *
 * React 19 hoists `<title>`, `<meta>` and `<link>` rendered anywhere in the tree
 * to the front of the stream, ahead of the first real element. This consumes
 * that run; whatever is left is the body.
 */
export function splitHead(rendered) {
  let rest = rendered;
  const head = [];
  for (;;) {
    const match = HEAD_TAG.exec(rest);
    if (!match) break;
    head.push(match[0].trim());
    rest = rest.slice(match[0].length);
  }
  return { head: head.join('\n    '), body: rest };
}

/**
 * Put the rendered markup and head tags into the built index.html.
 *
 * The template's own `<title>` is REPLACED, not appended to. Two title elements
 * in one document is not a tie a crawler resolves the way you would hope, and
 * the template's is the generic one.
 */
export function injectIntoTemplate(template, { head, body }, route = '/') {
  let html = template;

  if (/<title\b/i.test(head)) {
    html = html.replace(/\s*<title\b[^>]*>[\s\S]*?<\/title>/i, '');
  }

  // The template's canonical is ALWAYS removed, whether or not the route
  // supplies its own. It is hardcoded to the home page, so leaving it means
  // either a wrong canonical or two competing ones — and Google's guidance for
  // JavaScript sites is explicit that the canonical in the served HTML must not
  // contradict the rendered one.
  html = html.replace(/\s*<link[^>]*rel="canonical"[^>]*>/gi, '');

  const title = /<title\b[^>]*>([^<]*)<\/title>/i.exec(head)?.[1] || '';
  const generated = socialTags(head, route, title);

  // Detail templates set their own canonical via Helmet, so it arrives in
  // `head` — correct in spirit, but the route decides the origin and the
  // trailing-slash form and this step already knows both. Dropping it here and
  // letting socialTags emit one keeps exactly one per document. Leaving it
  // produced TWO on all 24 article pages, which is not a tie a crawler
  // resolves the way anyone hopes.
  const headWithoutCanonical = head.replace(/\s*<link[^>]*rel="canonical"[^>]*>/gi, '');
  const combined = [headWithoutCanonical, generated].filter(Boolean).join('\n    ');

  if (combined) {
    html = html.replace(/<\/head>/i, `    ${combined}\n  </head>`);
  }

  // The mount point keeps its id: the client bundle still hydrates into it.
  const rootDiv = /<div id="root"><\/div>/;
  if (!rootDiv.test(html)) {
    // `/` is written back to dist/index.html, which is also the template. Run
    // this twice without an intervening `vite build` and the second run reads
    // its own output — an empty mount point is the thing that distinguishes
    // them, so say which case this is rather than "no root div".
    if (/<div id="root">\s*\S/.test(html)) {
      throw new Error(
        'dist/index.html has already been pre-rendered. This step needs the ' +
          'template `vite build` produces — run `npm run build`, which does both in order.'
      );
    }
    throw new Error('dist/index.html has no <div id="root"></div> to render into');
  }
  return html.replace(rootDiv, `<div id="root">${body}</div>`);
}

/** `/azure/blog` -> `dist/azure/blog/index.html`; `/` -> `dist/index.html`. */
/**
 * The data a route needs, keyed as `usePublicData` keys it.
 *
 * Only the entry for THIS route is handed over, not the whole manifest: a page
 * that reads a key it was not given should fall through to its normal fetch,
 * and passing everything would hide that.
 */
function seedFor(manifest, route) {
  if (!manifest?.data) return null;
  const slug = /\/blog\/([^/]+)$/.exec(route)?.[1];
  if (!slug) return null;
  const key = `article:${slug}`;
  return Object.prototype.hasOwnProperty.call(manifest.data, key)
    ? { [key]: manifest.data[key] }
    : null;
}

function outputPathFor(dist, route) {
  const clean = route.replace(/^\/+|\/+$/g, '');
  return clean ? join(dist, clean, 'index.html') : join(dist, 'index.html');
}

/**
 * Minimal browser globals for libraries that need a document at import time.
 *
 * Installing a window is not free. Before this, `typeof window === 'undefined'`
 * was true and every SSR guard in the tree took its server path. Afterwards the
 * guards pass and the code runs — so a HALF-built DOM is worse than none, and
 * the first narrow version proved it: /azure/education had pre-rendered fine for
 * days and immediately failed with "window.matchMedia is not a function".
 *
 * So the shim fills jsdom's own documented gaps rather than only DOMPurify's
 * needs. `matchMedia` is absent from jsdom entirely, which is why a guard of the
 * form `window.matchMedia && window.matchMedia(...)` behaves differently here
 * than in any real browser.
 */
async function installDom() {
  if (globalThis.window?.document) return;
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.Element = dom.window.Element;
  globalThis.DocumentFragment = dom.window.DocumentFragment;
  globalThis.HTMLTemplateElement = dom.window.HTMLTemplateElement;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.trustedTypes = dom.window.trustedTypes;

  // jsdom does not implement matchMedia. Reduced motion and dark mode both
  // report false, which is the right default for a static file: it is served to
  // everyone, so it must not bake in one visitor's preference.
  if (!dom.window.matchMedia) {
    dom.window.matchMedia = (query) => ({
      matches: false,
      media: String(query),
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  }
}

function buildSsrBundle(frontend) {
  // Built here rather than as a separate npm script so `npm run build` cannot
  // pre-render a stale tree against fresh client assets.
  //
  // Vite's JS entry is run through this same Node binary rather than the `vite`
  // shim or npx: the shims are `.cmd` files on Windows, which spawnSync cannot
  // execute without `shell: true` — and that both failed to resolve in the shell
  // this first ran in and drags in shell quoting for no benefit.
  const vite = join(frontend, 'node_modules', 'vite', 'bin', 'vite.js');
  const result = spawnSync(
    process.execPath,
    [vite, 'build', '--ssr', ENTRY, '--outDir', 'dist-ssr', '--logLevel', 'warn'],
    { cwd: frontend, stdio: 'inherit' }
  );
  if (result.error) {
    throw new Error(`could not run ${vite}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`SSR bundle build failed with exit code ${result.status}`);
  }
}

async function main() {
  const { frontend, dist, ssrDist } = paths();
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error('dist/index.html is missing — run `vite build` before this step');
  }

  buildSsrBundle(frontend);

  // A DOM has to exist BEFORE the bundle is imported.
  //
  // Article pages sanitise their body with DOMPurify and feed the result to
  // `dangerouslySetInnerHTML`. DOMPurify binds to a window at import time and
  // exposes no `sanitize` without one, so under plain Node every detail route
  // died with "I.sanitize is not a function" — which the pre-render step
  // correctly refused to write, rather than shipping the error page.
  //
  // Skipping sanitisation here was never an option: the output is a static file
  // served to every visitor, so unsanitised markup would be baked in permanently
  // rather than merely rendered once.
  //
  // jsdom is already a devDependency — vitest uses it as the test environment —
  // so this adds no package, and nothing here reaches the browser bundle.
  await installDom();

  const entryUrl = pathToFileURL(join(ssrDist, 'prerender-entry.js')).href;
  const { render, routes } = await import(entryUrl);

  // Build input, not site content — see build-content-manifest.mjs. Absent is
  // fine and simply means no detail routes this build.
  const manifestPath = join(frontend, 'data', 'content-manifest.json');
  let manifest = null;
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    console.log(
      `[prerender] manifest: ${manifest.routes?.length || 0} article routes, generated ${manifest.generatedAt || 'unknown'}`
    );
  } else {
    console.log('[prerender] no content manifest — article detail pages will not be pre-rendered');
  }

  const template = readFileSync(join(dist, 'index.html'), 'utf8');

  // The SPA fallback needs a shell of its own, and this is not optional.
  //
  // `staticwebapp.config.json` rewrites any request with no matching file to a
  // single HTML document, which is how article pages work: /azure/blog/{slug}
  // is not pre-rendered — the slugs are not known at build time — so it falls
  // back and the SPA renders it.
  //
  // That fallback used to be dist/index.html, an empty shell. Pre-rendering
  // turns dist/index.html into the fully rendered HOME PAGE, so every unknown
  // URL would serve complete home-page content at HTTP 200 — the whole site's
  // front page duplicated across unlimited addresses, which is worse for search
  // than the shell it replaced. Measured on the preview host before this fix:
  // /definitely-not-real returned 200 with the home page's title and body.
  //
  // So the pristine template is kept as its own file and the fallback points at
  // it. Known routes get their pre-rendered document; anything else gets a shell
  // that boots the SPA, exactly as before.
  writeFileSync(join(dist, 'app-shell.html'), template);

  const targets = routes(manifest);
  const failures = [];
  const skipped = [];
  const publishedRoutes = [];
  let written = 0;
  let bytes = 0;

  for (const route of targets) {
    let rendered;
    try {
      // Only detail routes carry a seed; everything else renders from nothing,
      // exactly as it did before the manifest existed.
      rendered = await render(route, seedFor(manifest, route));
    } catch (error) {
      failures.push(`${route}: threw — ${error?.message || error}`);
      continue;
    }

    if (rendered.errors.length > 0) {
      // An error boundary produces perfectly valid-looking HTML. Without this
      // check the error state would be written out and published as the page.
      failures.push(`${route}: rendered an error — ${rendered.errors[0].message}`);
      continue;
    }

    if (rendered.html.includes('data-page="not-found"')) {
      // Not an error. `/:provider/<section>` is declared for every provider,
      // and the dispatcher behind it renders the 404 page for the combinations
      // that have no content — /azure/code and /github/frameworks among them.
      // The route list is a candidate grid, so this is the expected answer for
      // a real part of it.
      //
      // It must still be SKIPPED rather than written: the page says "this page
      // does not exist" and would be served at HTTP 200 for a crawler to index
      // as content. Reported so the count is visible and a sudden jump is not.
      skipped.push(route);
      continue;
    }

    const text = rendered.html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < MIN_TEXT_CHARS) {
      failures.push(`${route}: only ${text.length} characters of text — a shell, not a page`);
      continue;
    }

    const html = injectIntoTemplate(template, splitHead(rendered.html), route);
    const outPath = outputPathFor(dist, route);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html);
    written += 1;
    bytes += Buffer.byteLength(html);
    publishedRoutes.push(route);
  }

  // The sitemap is GENERATED from the routes that were actually written, not
  // hand-maintained. public/sitemap.xml held 51 URLs in the non-trailing form
  // while the live site redirected every one of them to the trailing form — the
  // two had disagreed the whole time, and a static list drifts from the
  // pre-render set the moment either changes. Generating it from
  // `publishedRoutes` means sitemap, canonical and the files on disk cannot
  // disagree: they have one source.
  //
  // Skipped routes are excluded by construction. Advertising a URL that renders
  // the 404 page is worse than omitting it.
  const urls = publishedRoutes
    .map((route) => ['  <url>', `    <loc>${canonicalFor(route)}</loc>`, '  </url>'].join('\n'))
    .join('\n');
  writeFileSync(
    join(dist, 'sitemap.xml'),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      urls,
      '</urlset>',
      '',
    ].join('\n')
  );

  // The SSR bundle is a build artefact, not site content. Left in place it would
  // be uploaded with the site — and `dist-ssr` contains a copy of every page's
  // source-mapped server build.
  rmSync(ssrDist, { recursive: true, force: true });

  // The three routes that must always exist. Everything else is content that
  // can legitimately come and go; these are the site itself, and if one of them
  // starts rendering the 404 page something is broken badly enough that a
  // deploy should stop.
  const CORE = ['/', '/about', '/contact'];
  for (const route of CORE) {
    if (skipped.includes(route)) {
      failures.push(`${route}: rendered the 404 page — this route must always exist`);
    }
  }

  // A floor, not an exact count: sections appear and disappear with content, but
  // a collapse from ~80 to a handful means the render broke rather than that
  // someone unpublished a page.
  const MINIMUM_DOCUMENTS = 60;
  if (written < MINIMUM_DOCUMENTS && failures.length === 0) {
    failures.push(
      `only ${written} documents written, expected at least ${MINIMUM_DOCUMENTS} — ` +
        `${skipped.length} routes rendered the 404 page`
    );
  }

  if (skipped.length > 0) {
    const list = skipped.map((route) => `  ${route}`).join('\n');
    console.log(
      `[prerender] ${skipped.length} route(s) have no content for that provider ` +
        `and were skipped:\n${list}`
    );
  }

  if (failures.length > 0) {
    console.error(`\n[prerender] ${failures.length} route(s) failed:`);
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(
      '\nA pre-rendered shell is indistinguishable from a working page once it is\n' +
        'deployed, which is the failure this step exists to prevent. Fix the route\n' +
        'or remove it from routes() in scripts/prerender-entry.jsx.'
    );
    process.exit(1);
  }

  const average = Math.round(bytes / Math.max(written, 1) / 1024);
  console.log(`[prerender] ${written} HTML documents written, ${average} kB average`);
}

// Only when run as a script. `splitHead` and `injectIntoTemplate` are imported
// by prerender.test.js, and an unguarded main() would kick off a full SSR build
// the moment the test file loaded.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[prerender] FAILED: ${error?.message || error}`);
    process.exit(1);
  });
}
