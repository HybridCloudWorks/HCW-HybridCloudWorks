/**
 * Refuse a Functions deploy while the `hcw-azure` workspace is mid-run.
 *
 * ## The incident this exists for (#454, 2026-09-09 04:37–04:40 UTC)
 *
 * A Functions deploy and a Terraform apply touched the Function App's
 * app-settings map inside three minutes. ARM's appsettings PUT **replaces**
 * rather than merges — the T-511 strip's own header says so — which makes any
 * two writers that read-modify-write that map destroy each other's changes:
 *
 *   04:37:56  deploy identity   writes settings (map as it stood pre-apply)
 *   04:39:14  Terraform         writes the six new settings
 *   04:39:50  deploy identity   writes AGAIN, from the map it read at 04:37
 *
 * Result: `ELEVENLABS_API_KEY`, `RSSCOM_API_KEY`, `RSSCOM_PODCAST_ID`,
 * `PLAUD_EMBEDDED_CLIENT_ID`, `PLAUD_EMBEDDED_API_KEY` and
 * `PUBLIC_API_ORIGIN` all gone, while the Cosmos and blob containers from the
 * same apply survived — so the apply itself was fine. Only the map lost.
 *
 * Nothing in either pipeline prevented that. `concurrency: function-app-host`
 * in `deploy-functions.yml` serialises deploys against each other and knows
 * nothing about Terraform, which runs in HCP Terraform rather than in Actions.
 *
 * ## What counts as busy, and why the reading errs toward refusing
 *
 * `FINISHED` is imported from `check-tfc-plan.mjs` rather than restated, so
 * there is ONE definition of "this run is over" in the repository. That file
 * already argues the case: `planning`, `applying`, `cost_estimating` and
 * `apply_queued` are neither awaiting a decision nor finished — they are
 * running — and a state in neither set claims less by being treated as in
 * progress.
 *
 * Here the same rule points the same way for a different reason. An
 * unrecognised state blocks the deploy, and a blocked deploy costs one
 * re-dispatch; a raced deploy costs six credentials and is discovered days
 * later by a feature that quietly read nothing. So this refuses on anything it
 * cannot positively identify as over.
 *
 * ## Self-arming
 *
 * No `TFC_TOKEN` means this cannot check, and it says so and exits 0 rather
 * than blocking every deploy until the secret is seeded — the same pattern the
 * reader workflows use. A guard that cannot run must not become the reason
 * releases stop.
 */
import { pathToFileURL } from 'node:url';
import { FINISHED } from './check-tfc-plan.mjs';

const API = 'https://app.terraform.io/api/v2';
export const ORGANIZATION = 'hcw';
export const WORKSPACE = 'hcw-azure';

/**
 * Is this run still going, as far as the app-settings map is concerned?
 *
 * @param {string} status - HCP Terraform run status
 * @returns {boolean} true when the run is not positively finished
 */
export function isBusy(status) {
  return !FINISHED.has(String(status || ''));
}

/**
 * The busy run in the newest-first list, or null when none is.
 *
 * Only the newest run matters in practice, but scanning the page is cheap and
 * a queued run sitting behind an applying one is exactly the case where the
 * newest entry alone could read as settled.
 *
 * @param {Array<{id: string, attributes: {status: string}}>} runs
 * @returns {{id: string, status: string} | null}
 */
export function firstBusyRun(runs) {
  for (const run of runs || []) {
    const status = run?.attributes?.status;
    if (status && isBusy(status)) return { id: run.id, status };
  }
  return null;
}

/** The operator-facing sentence. Names the run so it can be opened directly. */
export function describeBusy({ id, status }) {
  return (
    `The ${WORKSPACE} workspace has run ${id} in state "${status}". ` +
    'A Terraform apply and a Functions deploy must not overlap: both rewrite the ' +
    'whole app-settings map, so the later write silently discards the earlier ' +
    "one's settings (#454). Wait for the run to finish, then dispatch this " +
    `deploy again. https://app.terraform.io/app/${ORGANIZATION}/workspaces/${WORKSPACE}/runs`
  );
}

async function tfc(token, path) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.api+json' },
  });
  if (!response.ok) {
    throw new Error(
      `HCP Terraform answered ${response.status} for ${path}. ` +
        'TFC_TOKEN must be a USER or TEAM token with read access to the workspace.'
    );
  }
  return (await response.json()).data;
}

async function main() {
  const token = process.env.TFC_TOKEN;
  if (!token) {
    console.log(
      'TFC_TOKEN is not set — cannot check whether a Terraform apply is running. ' +
        'Seed it at Settings -> Secrets and variables -> Actions to arm this guard.'
    );
    return 0;
  }

  const workspace = await tfc(token, `/organizations/${ORGANIZATION}/workspaces/${WORKSPACE}`);
  const runs = await tfc(token, `/workspaces/${workspace.id}/runs?page%5Bsize%5D=20`);
  const busy = firstBusyRun(runs);

  if (busy) {
    console.error(`::error::${describeBusy(busy)}`);
    return 1;
  }
  console.log(`No run in progress on ${WORKSPACE} — safe to deploy.`);
  return 0;
}

// Guarded so the module can be imported without firing main(), and via
// pathToFileURL rather than a hand-built file:// string — a Windows path does
// not survive template interpolation into a URL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`::error::${error.message}`);
      process.exit(2);
    });
}
