/**
 * Server entry for the pre-render step.
 *
 * Deliberately NOT `main.jsx`: that entry reaches for
 * `document.getElementById('root')` at module scope and mounts a client root,
 * neither of which exists here. This renders the same tree with a static router
 * instead, and collects the head tags Helmet produces on the way.
 *
 * Everything else — providers, layout, the 42 pages that set their own title —
 * is imported from the real application, because a second copy of the tree
 * would pre-render a site that is not the site.
 */
import React from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { StaticRouter } from 'react-router';
import { HelmetProvider } from 'react-helmet-async';
import { App, AppProviders } from '@/App';
import { VALID_PROVIDERS } from '@/context/ProviderContext';
import { PrerenderDataContext } from '@/hooks/prerenderData';

/**
 * Sections that exist under every provider, as declared by App.jsx's
 * `/:provider` route block. A provider that has no content for one renders the
 * Coming Soon page, which is a real page and is pre-rendered as such.
 */
const PROVIDER_SECTIONS = [
  'blog',
  'architecture-designs',
  'frameworks',
  'code',
  'coder-corner',
  'education',
  'audio-architecture',
  'audio',
  'news',
  'rss',
];

/**
 * Every route pre-rendered at build time.
 *
 * Derived from `VALID_PROVIDERS` rather than written out, so adding a provider
 * adds its pages automatically — a hand-maintained list is how a route quietly
 * stops being pre-rendered.
 *
 * DETAIL PAGES COME FROM THE MANIFEST, not from the API. `/:provider/blog/:slug`
 * needs its article at render time and the build cannot fetch one — Cloudflare
 * answers a GitHub runner with a managed challenge (#175), and making every
 * deploy depend on a bot-protection exception is the trade that issue rejected.
 * So `frontend/data/content-manifest.json`, written by an Azure-authenticated
 * workflow reading Cosmos directly, supplies both the routes and their content.
 * When the file is absent — a fresh clone, a branch that predates it — detail
 * routes are simply skipped and everything else pre-renders as before.
 *
 * Admin routes are excluded on purpose: they are behind Entra sign-in, have no
 * search value, and pre-rendering them would publish the shell of a private UI.
 * /preview/:id (the signed staging view, T-606) is excluded by the same
 * construction — nothing below enumerates it, and it must stay that way: a
 * prerendered preview would publish an unpublished draft.
 */
/**
 * Public routes that are NOT `/:provider/<section>` and so are not produced by
 * the derivation below (T-737).
 *
 * Eleven indexable routes were declared in App.jsx and reached neither disk nor
 * the sitemap: they fell through to `app-shell.html`, which carries a generic
 * title and no canonical — so a crawler that found one saw the same untitled
 * shell as for every other. `routes-are-complete.test.js` reads App.jsx and
 * fails when a public absolute route is missing from here, which is the part
 * that stops the list going stale again: a hand-maintained list is exactly how
 * a route quietly stops being pre-rendered, and this file already says so.
 *
 * `/templates/*` are submission forms — real public pages with real content,
 * and indexable whether or not anyone wants them to be.
 */
const STANDALONE_ROUTES = [
  '/finops/tools',
  '/finops/focus',
  '/finops/architectures',
  '/terraform/modules',
  '/terraform/tools',
  '/github/workflows',
  '/github/tools',
  '/tools/migration',
  '/tools/comparison',
  '/tools/resources',
  '/tools/decisions',
  '/templates/framework',
  '/templates/architecture',
  '/templates/blog',
  '/templates/coder-corner',
  '/templates/rosetta-stone',
];

export function routes(manifest = null) {
  return [
    '/',
    '/about',
    '/contact',
    ...VALID_PROVIDERS.flatMap((provider) => [
      `/${provider}`,
      ...PROVIDER_SECTIONS.map((section) => `/${provider}/${section}`),
    ]),
    ...STANDALONE_ROUTES,
    ...(manifest?.routes || []),
  ];
}

/**
 * @param {string} url Route path to render, e.g. '/about'.
 * @returns {Promise<{html: string, head: string}>}
 */
export async function render(url, seededData = null) {
  const helmetContext = {};

  // `prerenderToNodeStream`, not `renderToString`. Every route in this app is a
  // React.lazy import behind one <Suspense>, and renderToString does not wait:
  // it emits the PageLoader fallback and returns. That produced ~380 characters
  // of identical markup for every URL and no title at all — a shell, which is
  // the exact problem this step exists to fix. The static API resolves every
  // Suspense boundary before it completes.
  //
  // Same nesting as main.jsx: Helmet outermost, then the shared providers, then
  // the router. Only the router differs.
  // Collected rather than logged. A route that renders an error boundary still
  // produces perfectly valid-looking HTML — a shell — so the caller has to be
  // able to tell "rendered" from "rendered the error state", and refuse to
  // publish the second.
  const errors = [];

  const { prelude } = await prerenderToNodeStream(
    <HelmetProvider context={helmetContext}>
      {/*
        The seed is how a detail page renders its article at all: usePublicData
        fetches in an effect, and effects do not run here. Null on every route
        that needs no data, which is the browser's behaviour too.
      */}
      <PrerenderDataContext.Provider value={seededData}>
        <AppProviders>
          <StaticRouter location={url}>
            <App />
          </StaticRouter>
        </AppProviders>
      </PrerenderDataContext.Provider>
    </HelmetProvider>,
    {
      onError(error, info) {
        errors.push({
          message: error?.message || String(error),
          stack: info?.componentStack || '',
        });
      },
    }
  );

  const html = await new Promise((resolve, reject) => {
    let out = '';
    prelude.setEncoding('utf8');
    prelude.on('data', (chunk) => {
      out += chunk;
    });
    prelude.on('end', () => resolve(out));
    prelude.on('error', reject);
  });

  // Read AFTER the render completes: Helmet fills the context as components
  // mount, and a lazy page has not mounted until its boundary resolves.
  const { helmet } = helmetContext;
  const head = helmet
    ? [
        helmet.title?.toString(),
        helmet.meta?.toString(),
        helmet.link?.toString(),
        helmet.script?.toString(),
      ]
        .filter(Boolean)
        .join('\n    ')
    : '';

  return { html, head, errors };
}
