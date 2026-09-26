/**
 * Capability allowlist — the ONLY commands this agent will ever run.
 *
 * Each capability maps a job `type` to a fixed Docker image + command
 * template. The job payload is NEVER interpolated into a shell string;
 * it is written into an isolated workspace directory (one file for a `text`
 * payload, an unpacked tree for a `tar` payload — lib/docker-runner.js) which
 * is bind-mounted read-only into the container. The container command is
 * passed to Docker as an argv array (no shell parsing of user input).
 *
 * To add a capability: add an entry here AND to LAB_JOB_TYPES in
 * functions/src/lib/labs.js (LAB_JOB_TYPES, the server-side enqueue allowlist)
 * AND to FALLBACK_JOB_TYPES in frontend/src/components/admin/labs/labsView.js
 * (the admin console's list when the snapshot has not arrived) AND to the
 * agent's `capabilities` array in its lab_agents registry document, which is
 * what the API actually authorizes claims against.
 *
 * ===========================================================================
 * IMAGES ARE PINNED BY DIGEST, NOT BY TAG (T-759)
 * ===========================================================================
 * Every image below carries `tag@sha256:...`. Docker resolves the digest and
 * ignores the tag, so the tag is there only to say which release the digest
 * corresponds to — it has no effect on what runs.
 *
 * This matters more here than in most places. `docker run` pulls implicitly,
 * and `--network none` applies to the *container*, not to the pull: the image
 * is fetched over the network before any sandbox flag takes effect. A tag is
 * mutable, so with `alpine:3.20` alone, whoever can repush that tag changes
 * what executes on the VPS with no commit, no review and no signal anywhere in
 * this repository. A digest is content-addressed — a repushed tag simply stops
 * matching, and the pull fails loudly instead of succeeding quietly.
 *
 * `capabilities.test.js` asserts every entry carries one, so a capability
 * added without a digest fails the gate rather than shipping.
 *
 * **To update an image:** resolve the new digest from the registry's
 * `Docker-Content-Digest` header (NOT from a mirror or a search result), and
 * record both the tag and the digest here in one commit:
 *
 *   tok=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/alpine:pull" | jq -r .token)
 *   curl -sI -H "Authorization: Bearer $tok" \
 *     -H "Accept: application/vnd.oci.image.index.v1+json" \
 *     https://registry-1.docker.io/v2/library/alpine/manifests/3.21 | grep -i docker-content-digest
 *
 * The alpine, terraform and ansible digests below were resolved that way on
 * 2026-08-28 and cross-checked against the Docker Hub API, which is a second
 * endpoint reporting the same value.
 *
 * **hcwLabRunner** is this repository's own image, built from lab-image/ and
 * published by .github/workflows/publish-lab-image.yml, which prints the
 * pushed digest in its job summary (`docker buildx imagetools inspect` of the
 * pushed tag). The pin below is the publish from main for cd9e1af4 (#716,
 * run 36221001115): the image rebased on python:3.14.7-slim-trixie (Debian
 * 13, CPython 3.14.7) with ansible-core 2.21.4 (#714). It still carries
 * #675's changes to lab-image/: transitive AVM vendoring, the unpacked
 * provider mirror, the kubeconform schemas and the capability scripts the
 * three runner-image capabilities call at /usr/local/bin (lab-image/bin/).
 * The image and those commands move together, so a change to lab-image/bin/
 * is live only once the digest main publishes for it is pinned here; before
 * that the jobs fail with `executable file not found` rather than run
 * something older.
 */

/** Digest-pinned image references. Tag is documentation; the digest decides. */
export const IMAGES = {
  alpine: 'alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc',
  ansible:
    'alpine/ansible:2.17.0@sha256:3cf35fbaecd3dba7c246191be1d46c0b4c051839294eb813677a7482c1fa1ced',
  hcwLabRunner:
    'ghcr.io/hybridcloudworks/hcw-lab-runner:cd9e1af462ed966b5724d3c549633f6d08a15fa4@sha256:b9cd7d1bd1101040d8597d58dac4067629ae3bbc3ce6f94c533b75981fbd4bad',
};

/**
 * The writable scratch space a runner-image job gets. The root filesystem is
 * read-only (SANDBOX_FLAGS), so terraform's data dir, helm's homes and the
 * payload copy all live on this tmpfs. Explicit uid/gid/mode because Docker
 * mounts a tmpfs root-owned by default and the container runs as 65534:
 * measured on Docker 29.8 (#675), the bare `--tmpfs /tmp/run:rw,size=64m`
 * the first version of this file used gave `Permission denied` on the first
 * write, before any tool ran. 64 MB is enough because the image's provider
 * mirror is unpacked and vendored modules are called by relative path, so
 * `terraform init` symlinks providers and references modules in place rather
 * than copying either here (lab-image/Dockerfile, the `mirror` stage).
 */
export const RUN_TMPFS = ['--tmpfs', '/tmp/run:rw,size=64m,uid=65534,gid=65534,mode=0700'];

export const CAPABILITIES = {
  // Smoke test — proves the whole pipeline (claim -> docker -> result).
  'shell-echo': {
    image: IMAGES.alpine,
    // payloadFile is the path of the payload inside the container.
    buildCommand: (payloadFile) => ['cat', payloadFile],
    payloadFileName: 'payload.txt',
    payloadEncodings: ['text'],
    timeoutSeconds: 30,
  },

  // Validates Terraform HCL without touching any backend or provider creds.
  // hcw-terraform-validate (lab-image/bin/) copies /workspace to the tmpfs,
  // rewrites each `source = "Azure/<module>/azurerm"` whose version
  // constraint a vendored copy under /opt/avm satisfies to that copy's
  // relative path, leaves every other registry source untouched so `init`
  // fails loudly on it, then runs `init -backend=false` and `validate`.
  // The learner's files are never changed (ADR 0032, decision 5). A `text`
  // payload is one main.tf; a `tar` payload is a whole root.
  'terraform-validate': {
    image: IMAGES.hcwLabRunner,
    buildCommand: () => ['hcw-terraform-validate'],
    payloadFileName: 'main.tf',
    payloadEncodings: ['text', 'tar'],
    timeoutSeconds: 180,
    extraDockerArgs: RUN_TMPFS,
  },

  // Syntax-checks an Ansible playbook. No inventory, no remote hosts.
  'ansible-check': {
    image: IMAGES.ansible,
    buildCommand: (payloadFile) => [
      'ansible-playbook',
      '--syntax-check',
      '-i',
      'localhost,',
      payloadFile,
    ],
    payloadFileName: 'playbook.yml',
    payloadEncodings: ['text'],
    timeoutSeconds: 60,
  },

  // Renders a Helm chart with `helm template`: no repository, no cluster.
  // The payload is a tar of one chart directory (Chart.yaml at the top or
  // one level down); dependencies must already be under charts/, since
  // there is no network to fetch them.
  'helm-template': {
    image: IMAGES.hcwLabRunner,
    buildCommand: () => ['hcw-helm-template'],
    payloadEncodings: ['tar'],
    timeoutSeconds: 60,
    extraDockerArgs: RUN_TMPFS,
  },

  // Validates Kubernetes manifests against the JSON schemas bundled in the
  // image (one pinned release of yannh/kubernetes-json-schema), strict, with
  // no API server: `kubectl --dry-run` in either mode reaches a cluster and
  // is deliberately not a capability. A `text` payload is one manifest
  // file; a `tar` payload is a directory tree kubeconform walks.
  kubeconform: {
    image: IMAGES.hcwLabRunner,
    buildCommand: () => ['hcw-kubeconform'],
    payloadFileName: 'manifests.yaml',
    payloadEncodings: ['text', 'tar'],
    timeoutSeconds: 60,
  },
};
