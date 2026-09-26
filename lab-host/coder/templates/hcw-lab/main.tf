# hcw-lab: the Coder workspace template for the browser labs (#659, Phase 1
# in #679). Coder's Docker starter template
# (github.com/coder/coder, examples/templates/docker/main.tf) adapted to the
# boundary ADR 0032 draws around a workspace:
#
#   - the workspace container never gets the Docker socket, `privileged`, or
#     a host path; its one mount is a per-workspace named volume;
#   - it runs as uid 65534 (`nobody`), which is what the hcw-lab image's
#     `full` target already drops to (lab-image/Dockerfile, `USER 65534:65534`);
#     the image gives that uid `/bin/bash` and home `/tmp/home` in its own
#     /etc/passwd, which the Coder agent needs because it runs every script
#     through the passwd shell (#693), so the template writes no passwd;
#   - it joins its own bridge network, created and destroyed with the
#     container, with no route to the Compose network Coder and PostgreSQL
#     share;
#   - 2 GiB of memory and one CPU, hard limits.
#
# template.test.mjs beside this file reads it as text and fails when any of
# those stops being true. The Coder server that runs this template holds the
# socket (lab-host/coder/docker-compose.yml) and is the only process that
# does.
#
# Publish and set the one-hour autostop with the two commands in
# lab-host/coder/README.md (`coder templates push`, then `coder templates
# edit hcw-lab --default-ttl 1h`; the push subcommand has no TTL flag in the
# current CLI reference).

terraform {
  required_version = ">= 1.9.0"

  required_providers {
    coder = {
      source  = "coder/coder"
      version = "2.18.0"
    }
    docker = {
      source  = "kreuzwerker/docker"
      version = "4.6.0"
    }
  }
}

# The provisioner runs inside the Coder server container, which has
# /var/run/docker.sock mounted; the provider's default host is that socket.
provider "docker" {}

locals {
  # ghcr.io/hybridcloudworks/hcw-lab, the `full` target of lab-image/Dockerfile,
  # published by .github/workflows/publish-lab-image.yml. Pulled by digest;
  # the tag is the commit the workflow built it from and is documentation
  # only (ADR 0032, decision 5: every learner-facing image is digest-pinned
  # where consumed).
  image_tag    = "02dd959520108765a0b48432fcd5819e3a802545"
  image_digest = "sha256:6dacca008c263b40cb04120c74036348d6cd0df1c38acc430bd6efca9901f820"
  image        = "ghcr.io/hybridcloudworks/hcw-lab@${local.image_digest}"

  # The image sets HOME=/tmp/home and owns it as 65534, so a named volume
  # mounted there inherits that ownership on first use (Docker copies the
  # image directory's contents and mode into an empty volume). /workspace is
  # the read-only mount point the job runner uses and is root-owned in the
  # image, which is why the persistent directory is not there.
  home       = "/tmp/home"
  lab_root   = "/tmp/home/lab"
  repo_url   = "https://github.com/HybridCloudWorks/HCW-HybridCloudWorks.git"
  repo_ref   = "main"
  uid        = "65534"
  memory_mib = 2048
  # CFS quota/period: 100000/100000 microseconds is one full CPU.
  cpu_period = 100000
  cpu_quota  = 100000

  # The lab catalogue (frontend/src/data/labs/catalogue.js in #681) keys on
  # these ids, and the site's deep link is
  # /templates/hcw-lab/workspace?mode=auto&param.lab=<id>. `source` is the
  # path in this repository the startup script checks out sparsely into the
  # lab folder; empty means the folder starts empty with a README that says
  # what to put in it.
  labs = {
    "landing-zone-builder-output" = {
      title  = "Landing Zone Builder output"
      source = ""
      readme = <<-EOT
        # Landing Zone Builder output

        This folder is yours. Download the Terraform the Landing Zone Builder
        produced for you on hybridcloudworks.com, upload the zip here with
        File > Upload in the file explorer (or drag it in), unzip it in the
        terminal, and run:

            az login --use-device-code
            terraform init
            terraform validate

        `terraform init` needs the network, which this workspace has. The
        provider mirror at /opt/terraform/mirror is what the offline job
        runner uses; here TF_CLI_CONFIG_FILE is unset so `init` reaches the
        registry for anything the mirror does not hold.
      EOT
    }
    "terraform-validate-walkthrough" = {
      title  = "Terraform validate walkthrough"
      source = "lab-image/smoke/providers-only"
      readme = ""
    }
    "ansible-syntax-check-walkthrough" = {
      title  = "Ansible syntax-check walkthrough"
      source = "lab-host/ansible"
      readme = ""
    }
  }

  lab        = local.labs[data.coder_parameter.lab.value]
  lab_folder = local.lab.source == "" ? "${local.lab_root}/${data.coder_parameter.lab.value}" : "${local.lab_root}/${local.lab.source}"
}

data "coder_provisioner" "me" {}
data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

# One parameter: which lab folder to open. A dropdown of the catalogue ids;
# Coder rejects any value that is not one of the options, and the regex says
# the same thing a second way so a value that bypasses the form (the deep
# link's param.lab) is checked too.
data "coder_parameter" "lab" {
  name         = "lab"
  display_name = "Lab"
  description  = "Which lab folder to open in VS Code. Set by the Open in Coder link on hybridcloudworks.com/education/labs."
  type         = "string"
  form_type    = "dropdown"
  mutable      = false
  default      = "terraform-validate-walkthrough"
  order        = 1

  option {
    name  = "Landing Zone Builder output"
    value = "landing-zone-builder-output"
  }
  option {
    name  = "Terraform validate walkthrough"
    value = "terraform-validate-walkthrough"
  }
  option {
    name  = "Ansible syntax-check walkthrough"
    value = "ansible-syntax-check-walkthrough"
  }

  validation {
    regex = "^(landing-zone-builder-output|terraform-validate-walkthrough|ansible-syntax-check-walkthrough)$"
    error = "lab must be one of the catalogue ids: landing-zone-builder-output, terraform-validate-walkthrough, ansible-syntax-check-walkthrough."
  }
}

resource "coder_agent" "main" {
  arch                    = data.coder_provisioner.me.arch
  os                      = "linux"
  startup_script_behavior = "blocking"

  # Sparse, shallow checkout of one directory of this repository into the
  # persistent home, once; a second start finds it and leaves it alone.
  # `$${...}` is Terraform's escape for a literal shell `${...}`.
  startup_script = <<-EOT
    set -euo pipefail
    export HOME=${local.home}
    LAB_ID='${data.coder_parameter.lab.value}'
    LAB_SOURCE='${local.lab.source}'
    LAB_ROOT='${local.lab_root}'
    mkdir -p "$LAB_ROOT"

    if [ -n "$LAB_SOURCE" ]; then
      if [ ! -d "$LAB_ROOT/.git" ]; then
        git clone --quiet --depth 1 --filter=blob:none --sparse --branch '${local.repo_ref}' '${local.repo_url}' "$LAB_ROOT"
        git -C "$LAB_ROOT" sparse-checkout set "$LAB_SOURCE"
      fi
    else
      mkdir -p "$LAB_ROOT/$LAB_ID"
      if [ ! -f "$LAB_ROOT/$LAB_ID/README.md" ]; then
        cat > "$LAB_ROOT/$LAB_ID/README.md" <<'README'
    ${local.lab.readme}
    README
      fi
      # The builder's zip is initialised online: undo the image's
      # mirror-only provider installation for this lab's shell.
      printf 'unset TF_CLI_CONFIG_FILE\n' > "$HOME/.bashrc.d-hcw-lab"
      grep -qs 'bashrc.d-hcw-lab' "$HOME/.bashrc" || printf '. "$HOME/.bashrc.d-hcw-lab"\n' >> "$HOME/.bashrc"
    fi
  EOT

  env = {
    HOME                = local.home
    GIT_AUTHOR_NAME     = coalesce(data.coder_workspace_owner.me.full_name, data.coder_workspace_owner.me.name)
    GIT_AUTHOR_EMAIL    = data.coder_workspace_owner.me.email
    GIT_COMMITTER_NAME  = coalesce(data.coder_workspace_owner.me.full_name, data.coder_workspace_owner.me.name)
    GIT_COMMITTER_EMAIL = data.coder_workspace_owner.me.email
  }

  # Browser only: the site links learners to code-server, and the desktop
  # VS Code, SSH and port-forward helpers would advertise paths this lab does
  # not support.
  display_apps {
    vscode                 = false
    vscode_insiders        = false
    web_terminal           = true
    ssh_helper             = false
    port_forwarding_helper = false
  }

  metadata {
    display_name = "CPU"
    key          = "0_cpu_usage"
    script       = "coder stat cpu"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "Memory"
    key          = "1_ram_usage"
    script       = "coder stat mem"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "Home disk"
    key          = "2_home_disk"
    script       = "coder stat disk --path ${local.home}"
    interval     = 60
    timeout      = 1
  }
}

# VS Code in the browser. https://registry.coder.com/modules/coder/code-server,
# pinned to a module version and a code-server release. install_prefix is on
# the persistent volume with use_cached, so a restart does not re-download
# code-server. subdomain = true serves it at
# <app>--<agent>--<workspace>--<owner>.coder.lab.hybridcloudworks.com, the
# name the wildcard certificate exists for.
module "code-server" {
  count           = data.coder_workspace.me.start_count
  source          = "registry.coder.com/coder/code-server/coder"
  version         = "1.6.0"
  agent_id        = coder_agent.main.id
  folder          = local.lab_folder
  install_prefix  = "${local.home}/.code-server"
  install_version = "4.106.3"
  use_cached      = true
  subdomain       = true
  order           = 1
}

# The image, by digest. keep_locally so a workspace delete does not remove the
# 484 MB pull every other workspace shares.
resource "docker_image" "hcw_lab" {
  name         = local.image
  keep_locally = true
}

# One volume per workspace, kept across stops (no count) so a learner's files
# survive the one-hour autostop. Deleting the workspace deletes it.
resource "docker_volume" "home" {
  name = "coder-${data.coder_workspace.me.id}-home"

  lifecycle {
    ignore_changes = all
  }

  labels {
    label = "com.coder.resource"
    value = "true"
  }
  labels {
    label = "coder.owner"
    value = data.coder_workspace_owner.me.name
  }
  labels {
    label = "coder.owner_id"
    value = data.coder_workspace_owner.me.id
  }
  labels {
    label = "coder.workspace_id"
    value = data.coder_workspace.me.id
  }
  labels {
    label = "coder.workspace_name_at_creation"
    value = data.coder_workspace.me.name
  }
}

# The workspace's own bridge network, created with the container and removed
# with it (count follows start_count so stopped workspaces do not hold one of
# Docker's finite address pools). Not `internal`, so `az login` and
# `terraform init` reach the internet; not the Compose network, so the
# container has no route to Coder's PostgreSQL or to the server's socket.
resource "docker_network" "workspace" {
  count      = data.coder_workspace.me.start_count
  name       = "coder-ws-${data.coder_workspace.me.id}"
  driver     = "bridge"
  internal   = false
  attachable = false

  labels {
    label = "com.coder.resource"
    value = "true"
  }
  labels {
    label = "coder.workspace_id"
    value = data.coder_workspace.me.id
  }
}

resource "docker_container" "workspace" {
  count = data.coder_workspace.me.start_count
  image = docker_image.hcw_lab.image_id
  # lower() because Docker restricts container names and workspace names may
  # carry capitals.
  name     = "coder-${data.coder_workspace_owner.me.name}-${lower(data.coder_workspace.me.name)}"
  hostname = data.coder_workspace.me.name

  # The image already drops to 65534; stated here so the template, not the
  # image, is what template.test.mjs holds to it.
  user = "65534:65534"

  entrypoint = ["sh", "-c", coder_agent.main.init_script]
  env = [
    "CODER_AGENT_TOKEN=${coder_agent.main.token}",
    "HOME=${local.home}",
  ]

  # Hard limits: 2 GiB with no swap on top, one CPU. cpu_shares is the
  # relative weight when the host is contended; the quota is the ceiling.
  memory      = local.memory_mib
  memory_swap = local.memory_mib
  cpu_shares  = 1024
  cpu_period  = local.cpu_period
  cpu_quota   = local.cpu_quota

  # Nothing a lab needs requires a capability, and the process is not root
  # anyway; dropping them all and forbidding privilege gain is what makes
  # that true for anything a learner runs too.
  privileged    = false
  security_opts = ["no-new-privileges:true"]
  capabilities {
    drop = ["ALL"]
  }

  networks_advanced {
    name = docker_network.workspace[count.index].name
  }

  # The only mount: the per-workspace named volume. No host_path anywhere in
  # this file, by design and by test.
  volumes {
    container_path = local.home
    volume_name    = docker_volume.home.name
    read_only      = false
  }

  labels {
    label = "com.coder.resource"
    value = "true"
  }
  labels {
    label = "coder.owner"
    value = data.coder_workspace_owner.me.name
  }
  labels {
    label = "coder.owner_id"
    value = data.coder_workspace_owner.me.id
  }
  labels {
    label = "coder.workspace_id"
    value = data.coder_workspace.me.id
  }
  labels {
    label = "coder.workspace_name"
    value = data.coder_workspace.me.name
  }
  labels {
    label = "hcw.lab"
    value = data.coder_parameter.lab.value
  }
}

# What the dashboard shows on the workspace page.
resource "coder_metadata" "workspace" {
  count       = data.coder_workspace.me.start_count
  resource_id = docker_container.workspace[0].id

  item {
    key   = "lab"
    value = local.lab.title
  }
  item {
    key   = "image"
    value = "hcw-lab ${substr(local.image_tag, 0, 12)} (${substr(local.image_digest, 0, 19)})"
  }
  item {
    key   = "limits"
    value = "1 CPU, 2 GiB, no socket, no host path"
  }
}
