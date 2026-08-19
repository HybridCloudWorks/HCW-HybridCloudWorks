# =============================================================================
# ci-runner.tf — Self-hosted GitHub Actions runners on Azure Container Apps
#
# Event-driven Container Apps Job with the KEDA github-runner scaler: each
# queued workflow job triggers one execution running one ephemeral runner
# (JIT config, single job, exit). Scale-to-zero — idle days cost nothing.
# Stood up as a FALLBACK for GitHub-hosted runner outages: CI selects its
# runner via the repository variable CI_RUNNER (see ci.yml), which stays
# 'ubuntu-latest' until flipped during an incident.
#
# Deliberate choices (from the runner architecture review):
#   - No managed identity on the job. CI legs (npm/lint/vitest) need zero
#     Azure access, and granting the deploy identity here would give every CI
#     step ambient rights to the whole estate. If a workflow ever needs Azure,
#     it uses the OIDC federated credential path, not the runner's identity.
#   - No VNet. Outbound-only workload; Container Apps consumption egress IPs
#     are shared/dynamic and could not be allow-listed in Key Vault's IP
#     rules anyway. Revisit (VNet + NAT gateway) only if a job must reach a
#     network-restricted resource.
#   - Secret VALUES are never in Terraform state. The job declares its
#     secrets with placeholder values and ignore_changes; the operator seeds
#     real values out-of-band with `az containerapp job secret set` — the
#     same runbook pattern as Key Vault seeding (Review.md §4.2 / §4.4).
#   - Image pulls come from Docker Hub AUTHENTICATED (Captain/Pro account:
#     unlimited pulls, sidestepping the per-IP anonymous limit that shared
#     Azure NAT egress otherwise trips).
# =============================================================================

# Deferred, not deleted — ADR 0021 ratified this runner as CI failover, and
# this flag is the thing that supersedes it rather than a code deletion.
#
# It stays off because the case for it did not survive being checked: the
# repository is public, so GitHub-hosted runners are unlimited and free, and
# ADR 0021's "scale-to-zero costs nothing idle" driver was answering a cost
# problem that does not exist. Meanwhile all three prerequisites are absent
# (DOCKERHUB_USERNAME, DOCKERHUB_TOKEN, and the GitHub App for JIT runner
# registration — CHECKLIST §7), so the failover path cannot register a runner
# today regardless. What it buys is a few hours of merge friction avoided
# during a GitHub incident; what it costs is a Container Apps environment, a
# Docker Hub account, a GitHub App holding Administration: Read & write, and
# ADR 0021's own flagged risk — repository workflow code executing inside the
# production subscription.
#
# Flip to true only alongside provisioning those three secrets. ADR 0021's
# revisit trigger (the runner being needed routinely) is the reason to.
variable "ci_runner_enabled" {
  description = "Deploy the Container Apps CI runner. Off: GitHub-hosted runners are free for this public repository and the runner's prerequisites are unprovisioned"
  type        = bool
  default     = false
}

variable "ci_runner_image" {
  description = "Fully-qualified runner image reference (Docker Hub)"
  type        = string
  default     = "docker.io/hybridcloudworks/hcw-runner:2.328.0"
}

variable "ci_runner_max_executions" {
  description = "Max parallel runner executions (the CI matrix is 6 legs + 1 policy job)"
  type        = number
  default     = 10
}

resource "azurerm_container_app_environment" "ci_runner" {
  count                      = var.ci_runner_enabled ? 1 : 0
  name                       = "hcw-ci-runner-env"
  location                   = azurerm_resource_group.platform_mgmt.location
  resource_group_name        = azurerm_resource_group.platform_mgmt.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.hcw.id
  tags                       = var.tags
}

resource "azurerm_container_app_job" "ci_runner" {
  count                        = var.ci_runner_enabled ? 1 : 0
  name                         = "hcw-ci-runner"
  location                     = azurerm_resource_group.platform_mgmt.location
  resource_group_name          = azurerm_resource_group.platform_mgmt.name
  container_app_environment_id = azurerm_container_app_environment.ci_runner[0].id
  tags                         = var.tags

  replica_timeout_in_seconds = 1800 # generous ceiling; CI legs finish in minutes
  replica_retry_limit        = 0    # a failed runner should surface, not silently retry

  event_trigger_config {
    parallelism              = 1
    replica_completion_count = 1

    scale {
      min_executions              = 0
      max_executions              = var.ci_runner_max_executions
      polling_interval_in_seconds = 30

      rules {
        name             = "github-runner"
        custom_rule_type = "github-runner"
        metadata = {
          owner                     = var.github_org
          repos                     = var.github_repo
          runnerScope               = "repo"
          labels                    = "aca"
          targetWorkflowQueueLength = "1"
          applicationID             = "seeded-out-of-band" # real value via az CLI
          installationID            = "seeded-out-of-band" # real value via az CLI
        }
        authentication {
          secret_name       = "gh-app-private-key"
          trigger_parameter = "appKey"
        }
      }
    }
  }

  registry {
    server               = "docker.io"
    username             = "seeded-out-of-band"
    password_secret_name = "dockerhub-token"
  }

  # Placeholders only — real values are seeded by the operator (Review.md
  # §4.4) and ignore_changes keeps Terraform from reverting or reading them.
  secret {
    name  = "gh-app-private-key"
    value = "placeholder-seed-out-of-band"
  }
  secret {
    name  = "dockerhub-token"
    value = "placeholder-seed-out-of-band"
  }

  template {
    container {
      name   = "runner"
      image  = var.ci_runner_image
      cpu    = 1.0
      memory = "2Gi"

      env {
        name  = "GH_REPO_OWNER"
        value = var.github_org
      }
      env {
        name  = "GH_REPO_NAME"
        value = var.github_repo
      }
      env {
        name  = "RUNNER_LABELS"
        value = "aca"
      }
      # App id / installation id are not secret, but they are seeded alongside
      # the key so all GitHub App config lives in one operator step.
      env {
        name        = "GH_APP_PRIVATE_KEY"
        secret_name = "gh-app-private-key"
      }
      env {
        name  = "GH_APP_ID"
        value = "seeded-out-of-band"
      }
      env {
        name  = "GH_APP_INSTALLATION_ID"
        value = "seeded-out-of-band"
      }
    }
  }

  lifecycle {
    # Operator-seeded values (secrets, registry username, app ids, scaler
    # metadata ids) must never be reverted by a plan/apply.
    ignore_changes = [
      secret,
      registry,
      template[0].container[0].env,
      event_trigger_config[0].scale[0].rules,
    ]
  }
}

output "runner_job" {
  description = "Container Apps job name for the CI runner, or null while ci_runner_enabled is false (used by the seeding runbook)"
  value       = one(azurerm_container_app_job.ci_runner[*].name)
}
