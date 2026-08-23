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
 * DELIBERATELY NO DETAIL PAGES. `/:provider/blog/:slug` and friends would need
 * the article list, which means calling the API during the build, and the build
 * runs on a GitHub runner that Cloudflare answers with a managed challenge
 * (issue #175). Wiring pre-rendering to that would make every deploy depend on
 * a bot-protection exception. Listing pages carry the links, so crawlers still
 * reach the articles; the articles themselves are client-rendered for now.
 *
 * Admin routes are excluded on purpose: they are behind Entra sign-in, have no
 * search value, and pre-rendering them would publish the shell of a private UI.
 */
export function routes() {
  return [
    '/',
    '/about',
    '/contact',
    ...VALID_PROVIDERS.flatMap((provider) => [
      `/${provider}`,
      ...PROVIDER_SECTIONS.map((section) => `/${provider}/${section}`),
    ]),
  ];
}

/**
 * @param {string} url Route path to render, e.g. '/about'.
 * @returns {Promise<{html: string, head: string}>}
 */
export async function render(url) {
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
      <AppProviders>
        <StaticRouter location={url}>
          <App />
        </StaticRouter>
      </AppProviders>
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
