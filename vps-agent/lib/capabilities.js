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
 */

export const CAPABILITIES = {
  // Smoke test — proves the whole pipeline (claim -> docker -> result).
  'shell-echo': {
    image: 'alpine:3.20',
    // payloadFile is the path of the payload inside the container.
    buildCommand: (payloadFile) => ['cat', payloadFile],
    payloadFileName: 'payload.txt',
    timeoutSeconds: 30,
  },

  // Validates Terraform HCL without touching any backend or provider creds.
  'terraform-validate': {
    image: 'hashicorp/terraform:1.9',
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
    image: 'alpine/ansible:2.17.0',
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
