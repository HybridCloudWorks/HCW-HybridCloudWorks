/**
 * The nine providers on the home page strip, in the order they appear, and
 * the text the strip's frame shows for each (owner request 2026-09-28).
 *
 * Data, not JSX, so the copy can be read, reviewed and tested in one place:
 * `providerGuide.test.js` pins the providers, their rows, their types, their
 * websites and a length ceiling, and `public-copy.test.js` scans every string
 * here because this file is under `components/`.
 *
 * TYPES. Three kinds, woven into each description rather than shown as a
 * separate label: Azure, AWS, Google Cloud and VMware are cloud providers;
 * GitHub and FinOps are framework providers; Terraform, Docker and Ansible
 * are service providers.
 *
 * "HOW WE USE IT" IS A CLAIM ABOUT THIS REPOSITORY, so each one was checked
 * against it when written:
 *   - Azure: the site is hosted on it (infra/); its Learn pages carry study
 *     guides built from Microsoft's exam outlines (src/data/azure/study-guides);
 *     the Landing Zone Builder assembles an Azure landing zone (/tools/landing-zone).
 *   - AWS and Google Cloud: blueprints (pages/<provider>/architecture-blueprints.js),
 *     certification catalogues with learning paths, and news feeds
 *     (functions/src/lib/rss/feeds.js). Neither hosts anything here.
 *   - VMware: reference designs, the VCF/VVD/NSX frameworks and seven
 *     certification tracks (pages/vmware, data/vmware/education.js). It has no
 *     blueprints (its architecture-blueprints.js is empty), so none is claimed.
 *   - GitHub: the repository, the workflows that test and deploy
 *     (.github/workflows), GitHub sign-in for lab workspaces, and the container
 *     registry the lab image is published to (publish-lab-image.yml).
 *   - FinOps: the FinOps pages — FOCUS, frameworks, the maturity model, the
 *     allocation and anomaly blueprints and the tools page (pages/finops).
 *   - Terraform: infra/ is Terraform; so is the lab workspace template
 *     (lab-host/coder/templates/hcw-lab); the Landing Zone Builder's download
 *     is Terraform on Azure Verified Modules; two labs validate Terraform.
 *   - Docker: lab-image/Dockerfile builds hcw-lab in stages; each lab workspace
 *     is a container from it; Docker Sandboxes on /education/labs.
 *   - Ansible: lab-host/ansible configures the lab host (hardening, the
 *     container runtime, the workspace service); the Ansible lab lints that
 *     same playbook.
 * Change the repository and one of these can stop being true; change the
 * sentence with it.
 *
 * LENGTH. The frame is four lines tall at desktop width and never changes
 * height, so every description must fit in four lines there.
 * DESCRIPTION_MAX_CHARS is the test's proxy for that, measured in a browser
 * at the frame's desktop width (see the test for the numbers).
 */

/** The three kinds of provider, as the descriptions name them. */
export const PROVIDER_TYPES = Object.freeze({
  cloud: 'Cloud Provider',
  framework: 'Framework Provider',
  service: 'Service Provider',
});

/** What the frame says before anyone has pointed at a provider. */
export const PROVIDER_GUIDE_DEFAULT =
  'Point at or tap a provider to see what it is and how we use it.';

/** The longest a description may be and still fit four lines at desktop width. */
export const DESCRIPTION_MAX_CHARS = 320;

export const PROVIDER_GUIDE = Object.freeze([
  Object.freeze({
    provider: 'azure',
    label: 'Azure',
    name: 'Microsoft Azure',
    type: 'cloud',
    row: 1,
    website: 'https://azure.microsoft.com',
    description:
      'Microsoft Azure is the cloud provider this site calls home: every page you read is served from it. We teach it the way we run it, with reference blueprints, study guides built from Microsoft’s exam outlines, and a Landing Zone Builder that assembles an Azure landing zone for you to download.',
  }),
  Object.freeze({
    provider: 'aws',
    label: 'AWS',
    name: 'Amazon Web Services',
    type: 'cloud',
    row: 1,
    website: 'https://aws.amazon.com',
    description:
      'We teach Amazon Web Services rather than run on it. This cloud provider earns its place through reference blueprints such as a serverless API and multi-region disaster recovery, a catalogue of AWS certifications with learning paths, and a news feed that follows what AWS releases.',
  }),
  Object.freeze({
    provider: 'gcp',
    label: 'GCP',
    name: 'Google Cloud',
    type: 'cloud',
    row: 1,
    website: 'https://cloud.google.com',
    description:
      'Where does Google Cloud fit? As the third hyperscale cloud provider on this site, it is taught through blueprints for workloads like a BigQuery data lake, Cloud Run microservices and zero trust security, a catalogue of Google’s certifications with learning paths, and a news feed.',
  }),
  Object.freeze({
    provider: 'vmware',
    label: 'VMware',
    name: 'VMware by Broadcom',
    type: 'cloud',
    row: 1,
    website: 'https://www.vmware.com',
    description:
      'Private cloud has a cloud provider of its own in VMware by Broadcom. Our VMware pages cover private and hybrid designs on VMware Cloud Foundation with vSphere, vSAN and NSX, the validated designs and frameworks behind them, and certification tracks from associate to advanced professional.',
  }),
  Object.freeze({
    provider: 'github',
    label: 'GitHub',
    name: 'GitHub',
    type: 'framework',
    row: 2,
    website: 'https://github.com',
    description:
      'Every line of this site lives on GitHub, the framework provider behind how we build. Its workflows test every change and deploy the site, you sign in with GitHub to open a lab workspace, and the lab image is published to its container registry. Our GitHub pages teach those same workflows.',
  }),
  Object.freeze({
    provider: 'finops',
    label: 'FinOps',
    name: 'FinOps Foundation',
    type: 'framework',
    row: 2,
    website: 'https://www.finops.org',
    description:
      'Money is where FinOps comes in. The FinOps Foundation is the framework provider behind everything we say about cloud cost: its framework and the FOCUS billing specification shape our cost pages, from allocation and anomaly blueprints to the maturity model and the FinOps tools.',
  }),
  Object.freeze({
    provider: 'terraform',
    label: 'Terraform',
    name: 'Terraform',
    type: 'service',
    row: 2,
    // www.terraform.io redirects here, and this is the canonical URL it names.
    website: 'https://developer.hashicorp.com/terraform',
    description:
      'Terraform, HashiCorp’s infrastructure-as-code tool, is the service provider we lean on most. It declares this site’s cloud infrastructure, defines the lab workspaces, and powers the Landing Zone Builder, whose download is Terraform built on Azure Verified Modules. Two browser labs teach you to validate it.',
  }),
  Object.freeze({
    provider: 'docker',
    label: 'Docker',
    name: 'Docker',
    type: 'service',
    row: 2,
    website: 'https://www.docker.com',
    description:
      'Think of Docker as the service provider that packages our labs. A multi-stage Dockerfile builds the hcw-lab image with every tool a lab needs, each lab workspace runs as a container from that image, and Docker Sandboxes let you run a coding agent against your landing zone on your own machine.',
  }),
  Object.freeze({
    provider: 'ansible',
    label: 'Ansible',
    name: 'Red Hat Ansible',
    type: 'service',
    row: 2,
    website: 'https://www.ansible.com',
    description:
      'A bare server becomes the Hybrid Lab host because of Red Hat Ansible, the service provider behind its setup. Ansible roles harden the machine, install the container runtime and bring up the workspace service, and one browser lab has you syntax-check and lint that same playbook until it passes.',
  }),
]);

/** The strip's two rows, each in display order. */
export const PROVIDER_GUIDE_ROWS = Object.freeze(
  [1, 2].map((row) => Object.freeze(PROVIDER_GUIDE.filter((entry) => entry.row === row)))
);

/** "Microsoft Azure's website (opens in a new tab)"; "Amazon Web Services' website …". */
export function websiteLinkLabel(entry) {
  const owner = entry.name.endsWith('s') ? `${entry.name}'` : `${entry.name}'s`;
  return `${owner} website (opens in a new tab)`;
}
