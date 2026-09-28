/**
 * The lab catalogue for `/education/labs` (#681, Coder Phase 3 of #659).
 *
 * PURE DATA. Nothing here fetches, formats or renders; the page derives every
 * card from these rows and `catalogue.test.js` asserts each row carries every
 * field below and that no two share an `id`. Adding a lab is adding a row.
 *
 * `id` doubles as the Coder template parameter: the lab's pane
 * (`/education/labs/<id>`, #751) loads the lab launcher with `?lab=<id>`
 * (`labLauncherUrl`), which creates the learner's workspace from the
 * `hcw-lab` template (#679) with `param.lab=<id>`, and the template opens
 * that lab's folder in code-server. So an `id` is a path segment and a
 * Terraform variable value at once — lowercase, hyphenated, no spaces —
 * which the test also enforces.
 *
 * `workspaceName` is the name the launcher gives the learner's workspace for
 * this lab, one per lab per learner. The launcher keeps the same map
 * (LAB_WORKSPACES in lab-host/coder/launcher/launcher.js) because it may only
 * act on names it holds itself; this test and
 * scripts/lab-host-launcher.test.mjs both fail when the two differ. At most
 * 16 characters: code-server's address is `code-server--<workspace>--<owner>`,
 * one DNS label of 63, and a Coder username can be 32.
 *
 * `tools` names what the lab actually exercises, from the toolchain the
 * `hcw-lab` image ships (ADR 0032 §5). `articleSlugs` is empty until #677
 * publishes the walkthroughs; the page renders no article link for an empty
 * list rather than a placeholder.
 */
import { staticRoutes } from '@/lib/routeFactory';

/** Every tool a lab may name; the test refuses anything outside this set. */
export const LAB_TOOLS = Object.freeze(['az', 'terraform', 'kubectl', 'helm', 'ansible']);

/** The one Coder template every lab runs on today (#679). */
export const LAB_TEMPLATE = 'hcw-lab';

/**
 * Coder's public origin. Learners sign in there with GitHub; the site never
 * does. Since #750 it answers a top-level visit with a redirect to
 * `/education/labs`, so the site only ever frames it (#751). It is also the
 * origin of the lab launcher, the one sender whose messages the pane page
 * accepts.
 */
export const CODER_ORIGIN = 'https://coder.lab.hybridcloudworks.com';

/**
 * Where the lab launcher is served on Coder's name
 * (lab-host/ansible/roles/coder/templates/10-coder.caddy.j2). It opens
 * code-server inside the pane, which Coder's dashboard cannot: it opens apps
 * in a new window, and #750 turns every new window into the labs page.
 */
export const LAB_LAUNCHER_PATH = '/_hcw/lab/';

/**
 * Where a workspace's apps are served: one label below Coder's own name
 * (`CODER_WILDCARD_ACCESS_URL` in lab-host/coder/docker-compose.yml), which
 * is where code-server runs (`subdomain = true` in the `hcw-lab` template).
 * The site's `frame-src` and the pane's `allow` name exactly this and
 * `CODER_ORIGIN`, and `csp.test.js` holds the CSP to the same two strings.
 */
export const CODER_APPS_ORIGIN = 'https://*.coder.lab.hybridcloudworks.com';

/**
 * The one Coder path #750 lets through at the top level
 * (lab-host/ansible/roles/coder/templates/10-coder.caddy.j2), and the path
 * Coder's own "GitHub" button links to. Coder v2.37.3 serves the start and
 * the end of GitHub sign-in from it: without a `code` it sets its state
 * cookie and redirects to GitHub (coderd/httpmw/oauth2.go, ExtractOAuth2),
 * and GitHub sends the visitor back to it with one.
 */
export const CODER_GITHUB_SIGN_IN_PATH = '/api/v2/users/oauth2/github/callback';

/**
 * The image the labs run in, as the learner pulls it. `latest` on purpose:
 * this is the interactive, network-attached form a person runs on their own
 * machine, not the digest-pinned form `vps-agent` executes under
 * `--network none` (ADR 0032 §5 and `vps-agent/lib/capabilities.js`).
 */
export const LAB_IMAGE = 'ghcr.io/hybridcloudworks/hcw-lab:latest';

/**
 * The two "Run it locally" lines, exactly as a learner pastes them. Two
 * because the quoting differs: PowerShell expands `${PWD}` and bash expands
 * `"$PWD"`, and either form pasted at the other prompt mounts the wrong
 * directory or nothing. The page labels each with its shell.
 *
 * `\${PWD}` is escaped because this is a JavaScript template literal and an
 * unescaped `${PWD}` would be interpolated here, at build time, into
 * "undefined" — the test pins the rendered text so that cannot slip through.
 */
export const RUN_LOCALLY_COMMANDS = Object.freeze([
  Object.freeze({
    shell: 'PowerShell',
    command: `docker run --rm -it -v \${PWD}:/workspace ${LAB_IMAGE}`,
  }),
  Object.freeze({
    shell: 'bash',
    command: `docker run --rm -it -v "$PWD":/workspace ${LAB_IMAGE}`,
  }),
]);

/** The fields every lab carries, in the order the test reports a missing one. */
export const LAB_FIELDS = Object.freeze([
  'id',
  'workspaceName',
  'title',
  'summary',
  'tools',
  'template',
  'params',
  'articleSlugs',
  'estimatedMinutes',
]);

export const labs = Object.freeze([
  Object.freeze({
    id: 'landing-zone-builder-output',
    workspaceName: 'lab-lzb',
    title: 'Validate a Landing Zone Builder download',
    summary:
      'Take the zip the Landing Zone Builder at /tools/landing-zone hands you, unpack it in the workspace, and run terraform fmt and terraform validate against the Azure Verified Modules it declares — the same checks the lab runner applies before anything is planned.',
    tools: Object.freeze(['terraform', 'az']),
    template: LAB_TEMPLATE,
    params: Object.freeze({ lab: 'landing-zone-builder-output' }),
    articleSlugs: Object.freeze([]),
    estimatedMinutes: 25,
  }),
  Object.freeze({
    id: 'terraform-validate-walkthrough',
    workspaceName: 'lab-tfv',
    title: 'Terraform validate, step by step',
    summary:
      'Start from a deliberately broken module and work through what terraform init -backend=false, terraform fmt -check and terraform validate each catch, why the provider mirror lets init succeed offline, and what none of the three can tell you before a plan.',
    tools: Object.freeze(['terraform']),
    template: LAB_TEMPLATE,
    params: Object.freeze({ lab: 'terraform-validate-walkthrough' }),
    articleSlugs: Object.freeze([]),
    estimatedMinutes: 20,
  }),
  Object.freeze({
    id: 'ansible-syntax-check-walkthrough',
    workspaceName: 'lab-asc',
    title: 'Ansible syntax check, step by step',
    summary:
      'Run ansible-playbook --syntax-check and ansible-lint over the playbook that configures the Hybrid Lab host itself, read what each one reports, and fix a role until both pass — with no host in reach and nothing executed.',
    tools: Object.freeze(['ansible']),
    template: LAB_TEMPLATE,
    params: Object.freeze({ lab: 'ansible-syntax-check-walkthrough' }),
    articleSlugs: Object.freeze([]),
    estimatedMinutes: 20,
  }),
]);

/**
 * What a lab's pane loads: the lab launcher, told which lab. The launcher
 * finds the learner's workspace for it (`workspaceName`), has Coder create
 * or start it in Coder's own page when it must, and replaces itself with
 * code-server once code-server is healthy, so the learner lands in the lab
 * folder inside the pane (#659, #751). The template it creates from is
 * `hcw-lab` and its one parameter is `lab`, whose options are exactly these
 * ids (lab-host/coder/templates/hcw-lab/main.tf).
 */
export function labLauncherUrl(lab, origin = CODER_ORIGIN) {
  return `${origin}${LAB_LAUNCHER_PATH}?lab=${encodeURIComponent(lab.id)}`;
}

/**
 * Where the pane page's "Sign in with GitHub" opens, in a tab of its own
 * (#751; the whole flow is in LabPanePage.jsx). `redirect` is where Coder
 * sends the tab once signed in. Any path on Coder lands the tab on
 * `/education/labs`, because #750 redirects every top-level visit there
 * except this path, so `/`, Coder's own default, is as good as any.
 */
export function coderSignInUrl(origin = CODER_ORIGIN) {
  return `${origin}${CODER_GITHUB_SIGN_IN_PATH}?redirect=${encodeURIComponent('/')}`;
}

/** The site page that holds one lab's pane: `/education/labs/<id>` (#751). */
export function labPanePath(labId) {
  return `${staticRoutes.labs}/${encodeURIComponent(labId)}`;
}

/** The catalogue row with this id, or null for an id the catalogue does not have. */
export function labById(labId) {
  return labs.find((lab) => lab.id === labId) ?? null;
}

export default labs;
