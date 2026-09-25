/**
 * The lab catalogue for `/education/labs` (#681, Coder Phase 3 of #659).
 *
 * PURE DATA. Nothing here fetches, formats or renders; the page derives every
 * card from these rows and `catalogue.test.js` asserts each row carries every
 * field below and that no two share an `id`. Adding a lab is adding a row.
 *
 * `id` doubles as the Coder template parameter: "Open in Coder" deep-links to
 * `/templates/<template>/workspace?mode=auto&param.lab=<id>`, and the `hcw-lab`
 * template (#679) opens `/workspace/<id>` in code-server. So an `id` is a path
 * segment and a Terraform variable value at once — lowercase, hyphenated,
 * no spaces — which the test also enforces.
 *
 * `tools` names what the lab actually exercises, from the toolchain the
 * `hcw-lab` image ships (ADR 0032 §5). `articleSlugs` is empty until #677
 * publishes the walkthroughs; the page renders no article link for an empty
 * list rather than a placeholder.
 */

/** Every tool a lab may name; the test refuses anything outside this set. */
export const LAB_TOOLS = Object.freeze(['az', 'terraform', 'kubectl', 'helm', 'ansible']);

/** The one Coder template every lab runs on today (#679). */
export const LAB_TEMPLATE = 'hcw-lab';

/** Coder's public origin. Learners sign in there with GitHub; the site never does. */
export const CODER_ORIGIN = 'https://coder.lab.hybridcloudworks.com';

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
 * The "Open in Coder" deep link for a lab: Coder shows its consent screen
 * after GitHub sign-in, then creates the workspace with `param.lab` set, so
 * the learner lands in code-server with the lab folder open (#659).
 *
 * `mode=auto` is Coder's own parameter and is not encoded; the template and
 * lab id are, because they are path and query values built from data.
 */
export function coderWorkspaceUrl(lab, origin = CODER_ORIGIN) {
  const template = encodeURIComponent(lab.template);
  const labId = encodeURIComponent(lab.params.lab);
  return `${origin}/templates/${template}/workspace?mode=auto&param.lab=${labId}`;
}

export default labs;
