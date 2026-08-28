/**
 * Capability allowlist — the ONLY commands this agent will ever run.
 *
 * Each capability maps a job `type` to a fixed Docker image + command
 * template. The job payload is NEVER interpolated into a shell string;
 * it is written to a file inside an isolated workspace directory which
 * is bind-mounted read-only into the container. The container command
 * is passed to Docker as an argv array (no shell parsing of user input).
 *
 * To add a capability: add an entry here AND to LAB_JOB_TYPES in
 * functions/src/lib/labs.js (LAB_JOB_TYPES, the server-side enqueue allowlist)
 * AND to the agent's `capabilities` array in its lab_agents registry document,
 * which is what the API actually authorizes claims against.
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
 * The digests below were resolved that way on 2026-08-28 and cross-checked
 * against the Docker Hub API, which is a second endpoint reporting the same
 * value.
 */

/** Digest-pinned image references. Tag is documentation; the digest decides. */
export const IMAGES = {
  alpine: 'alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc',
  terraform:
    'hashicorp/terraform:1.9@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd',
  ansible:
    'alpine/ansible:2.17.0@sha256:3cf35fbaecd3dba7c246191be1d46c0b4c051839294eb813677a7482c1fa1ced',
};

export const CAPABILITIES = {
  // Smoke test — proves the whole pipeline (claim -> docker -> result).
  'shell-echo': {
    image: IMAGES.alpine,
    // payloadFile is the path of the payload inside the container.
    buildCommand: (payloadFile) => ['cat', payloadFile],
    payloadFileName: 'payload.txt',
    timeoutSeconds: 30,
  },

  // Validates Terraform HCL without touching any backend or provider creds.
  'terraform-validate': {
    image: IMAGES.terraform,
    buildCommand: () => [
      'sh',
      '-c',
      // Fixed string — no user input. Workspace is mounted at /workspace (ro);
      // copy to a writable tmpfs because init writes .terraform/.
      'cp /workspace/main.tf /tmp/run/ && cd /tmp/run && terraform init -backend=false -input=false >/dev/null && terraform validate -no-color',
    ],
    payloadFileName: 'main.tf',
    timeoutSeconds: 120,
    extraDockerArgs: ['--tmpfs', '/tmp/run:rw,size=64m'],
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
    timeoutSeconds: 60,
  },
};
