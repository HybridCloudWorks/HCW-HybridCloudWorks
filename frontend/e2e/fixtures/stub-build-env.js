/**
 * The build configuration the authenticated browser journey runs against.
 *
 * These are NOT credentials and NOT a test switch. They are the four ordinary
 * build variables every deployment sets (see vite.config.js), given values that
 * name no real directory, application or API:
 *
 *   - the client and tenant ids are GUIDs that no Entra directory issued;
 *   - the API scope names an `api://` resource that does not exist;
 *   - the API base is `/api`, the same-origin shape a deployment uses.
 *
 * The bundle built with them is the production code path, unchanged: MSAL talks
 * to login.microsoftonline.com and the portal calls `/api/...`. The browser
 * test intercepts both with `page.route()` (fixtures/entra.js), so no request
 * leaves the machine and nothing in the application knows it is under test.
 *
 * TWO PLACES SET THEM, AND ONLY TWO: the `e2e` job's Build step in
 * .github/workflows/ci.yml, and the local `webServer` in playwright.config.js
 * (which imports this file). Neither the deploy workflows nor the `frontend`
 * CI row read them, so no shipped bundle carries these values.
 */
export const STUB_BUILD_ENV = Object.freeze({
  VITE_ENTRA_CLIENT_ID: 'e2e00000-0000-4000-8000-00000000c11e',
  VITE_ENTRA_TENANT_ID: 'e2e00000-0000-4000-8000-0000000071d0',
  VITE_ENTRA_API_SCOPE: 'api://e2e-hcw-api/access_as_admin',
  VITE_AZURE_FUNCTIONS_URL: '/api',
});
