/**
 * Copy staticwebapp.config.json into the build output.
 *
 * The deployed content root is `dist`, not `frontend`. Azure Static Web Apps
 * reads `staticwebapp.config.json` from the root of whatever is uploaded, so a
 * dist without it is a dist that silently loses every route rule.
 *
 * WHY THE FILE IS NOT SIMPLY IN `public/`, which Vite would copy for free: it
 * is read from the repository root of `frontend/` by `src/lib/csp.test.js`,
 * which asserts the CSP `connect-src` names the same host as
 * `VITE_AZURE_FUNCTIONS_URL`, and it is referenced by that path in
 * Migration-Plan §3.4, REVIEW §0.1 and Architecture-Plan. Moving it would make
 * five references wrong to save one copy.
 *
 * WHAT BREAKS WITHOUT IT, and why it would not be obvious: §3.4 exists because
 * the soft 404 was already broken once. The config carries the SPA fallback
 * rewrite, the 404 override and the CSP. Deploy without it and the site loads,
 * the home page works, and every deep link 404s — which reads as a routing bug
 * in the app rather than a missing file.
 *
 * This runs as `postbuild`, so it is part of `npm run build` rather than a step
 * a workflow has to remember. Any deploy path that builds gets a complete dist.
 */
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../staticwebapp.config.json', import.meta.url));
const destination = fileURLToPath(new URL('../dist/staticwebapp.config.json', import.meta.url));

if (!existsSync(source)) {
  console.error(`[stage-swa-config] ${source} is missing — the deployed site would lose every route rule.`);
  process.exit(1);
}
if (!existsSync(fileURLToPath(new URL('../dist', import.meta.url)))) {
  console.error('[stage-swa-config] dist/ does not exist. Run this after vite build, not before.');
  process.exit(1);
}

copyFileSync(source, destination);
console.log(`[stage-swa-config] staticwebapp.config.json -> dist/ (${statSync(destination).size} bytes)`);
