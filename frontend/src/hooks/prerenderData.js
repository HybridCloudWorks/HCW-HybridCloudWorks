import { createContext, useContext } from 'react';

/**
 * Data handed to the tree at pre-render time, keyed exactly as `usePublicData`
 * keys its queries (`article:my-slug`, and so on).
 *
 * WHY THIS EXISTS. `usePublicData` fetches inside a `useEffect`, and effects do
 * not run during server rendering. So a detail page rendered by
 * `scripts/prerender.mjs` produces its skeleton and nothing else — the same
 * empty shell pre-rendering exists to eliminate, which is why
 * `/:provider/blog/:slug` was excluded from the route list rather than rendered
 * badly.
 *
 * The build cannot fetch the data either: CI reaches the public API through
 * Cloudflare, which answers a GitHub runner with a managed challenge (#175). So
 * the content arrives as a manifest produced by an Azure-authenticated workflow
 * and is seeded here, synchronously, before the first render.
 *
 * IN THE BROWSER THIS IS ALWAYS EMPTY. No provider is mounted by `main.jsx`, so
 * `usePublicData` sees no seed and fetches exactly as it always has. That is the
 * property worth protecting: this changes what the pre-renderer can do and
 * changes nothing about the running application.
 */
export const PrerenderDataContext = createContext(null);

/**
 * The pre-seeded value for a query key, or `undefined` when there is none.
 *
 * `undefined` rather than `null` deliberately: `null` is a legitimate seeded
 * value meaning "this was looked up and does not exist", and a detail page
 * should render its not-found state for that rather than spin.
 */
export function usePrerenderedData(key) {
  const seeded = useContext(PrerenderDataContext);
  if (!seeded || !key) return undefined;
  return Object.prototype.hasOwnProperty.call(seeded, key) ? seeded[key] : undefined;
}
