# Frontend review — `frontend/`

React 19 + Vite + TypeScript/JavaScript + Tailwind CSS 4 + React Router 8.
Public pages are pre-rendered at build time (`scripts/prerender.mjs`) and
hydrated client-side; the admin portal is Entra ID/MSAL-protected
(`@azure/msal-browser`). Hosted on Azure Static Web Apps behind Cloudflare.

## What to check in the diff

### Routing and pre-rendering
- New or changed routes must survive `npm run validate:routes` and
  `npm run validate:providers`. Route additions usually touch `App.jsx` and
  the route inventory the validators read — a route added in only one place
  is the classic drift bug here.
- Public pages must render without a signed-in session and without runtime
  API data at pre-render time. Anything that reads `window`, MSAL state, or
  fetches during module evaluation breaks `npm run build` (which runs the
  prerender) or produces empty pre-rendered HTML — check
  `frontend/scripts/prerender.mjs` expectations.
- `staticwebapp.config.json` changes: verify rewrites/headers don't open
  admin routes to anonymous traffic and that `scripts/stage-swa-config.mjs`
  still stages it (it runs as `postbuild`).

### Auth and API boundary
- Admin features must acquire tokens via the existing MSAL context/hooks —
  not roll their own token handling. API calls carry the Entra bearer token;
  the Functions side validates it, the frontend must never trust its own
  role checks for anything but UI gating.
- API paths called from the frontend must exist in the Functions route
  inventory (`functions/src/functions/route-inventory.test.js` /
  `api-contract.test.js`). A frontend-only change that calls a new endpoint
  is a contract break until the Functions side lands.
- `VITE_*` env vars are compiled into the public bundle. Client ID, tenant
  ID, scope, Functions URL only. Anything secret-shaped here is a blocking
  finding.

### Rendering user or CMS content
- Any HTML rendered from CMS/user content goes through DOMPurify (already a
  dependency). `dangerouslySetInnerHTML` without sanitization is a blocking
  finding. Markdown goes through `react-markdown` + `remark-gfm`, not raw
  HTML injection.

### Accessibility
- `eslint-plugin-jsx-a11y` runs in lint; interactive elements need keyboard
  support (`npm run a11y:check-keyboard`) and theme-aware contrast
  (`npm run a11y:contrast`). New interactive components built from divs
  instead of the existing Radix primitives are a maintainability and a11y
  flag — this codebase already has Radix dialog/select/tabs/toast/etc.

## Verification commands

Run from `frontend/` (Node 22+, `npm ci` first if needed):

```bash
npm run lint
npm run format:check
npm run validate:routes && npm run validate:providers && npm run validate:content-matrix
npm run test          # vitest
npm run build         # includes prerender + SWA config staging
```

`npm run code:quality` bundles lint + format + the three validators.
Playwright e2e (`npm run test:e2e` — smoke, hydration, console-errors,
contrast specs) is the release-level check; run it when the diff touches
routing, hydration, or theming and the environment allows a browser.
