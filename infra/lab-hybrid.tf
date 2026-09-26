# =============================================================================
# lab-hybrid.tf — the Azure half of the Hybrid Lab (ADR 0032 decision 3, #664)
# =============================================================================
#
# The lab host itself is a Hostinger VPS, provisioned from the separate
# `hcw-lab` workspace (`infra-lab/`) and onboarded to Azure Arc by Ansible.
# What lives in THIS workspace is only what the production estate needs in
# order to see it:
#
#   - the resource group the Arc machine is onboarded into,
#   - a Reader grant on that group for the Function App's managed identity, so
#     GET /api/public/labs/estate can read the machine's status through Azure
#     Resource Graph (functions/src/lib/labs/estate.js), and, from #663,
#   - the onboarding service principal's only grant, Azure Connected Machine
#     Onboarding on this group,
#   - a data collection rule sending heartbeat and auth/authpriv syslog to the
#     existing Management workspace, and
#   - an audit-only machine-configuration assignment of the Linux security
#     baseline on this group.
#
# Nothing else. The Arc machine resource is created by `azcmagent connect` on
# the host (lab-host/ansible/roles/arc), under that service principal (ADR
# 0032 decision 3; its credential is an Ansible Vault entry, never a Terraform
# value). Defender for Servers stays off (ADR 0032, alternatives considered):
# nothing here sets a Microsoft.Security pricing tier.
#
# The role assignment is the whole grant. Resource Graph returns only rows the
# caller can read, and Reader is `*/read` — so the identity can describe this
# group's contents and cannot change them, and cannot see any other group it
# was not already granted. No credential is minted or stored for this path:
# the Function App's system identity signs its own token.

# Not an entry in local.app_resource_groups (main.tf): that map names the
# `site` workload's groups, and this is the `hybrid` workload's, so the name
# takes a different middle segment and the ADR fixes it in full —
# rg-lab-hybrid-prod-cus. It is also a lifecycle boundary of its own: deleting
# the lab must never be "delete rg-web", and vice versa.
resource "azurerm_resource_group" "lab_hybrid" {
  name     = "rg-lab-hybrid-${var.environment}-${var.region_abbreviation}"
  location = var.azure_location
  tags     = local.tags
}

# Reader on the lab group only. Scoped to the group rather than the machine
# because the machine does not exist until the host is onboarded, and a grant
# on a resource that Terraform does not manage would have nothing to reference.
resource "azurerm_role_assignment" "func_lab_hybrid_reader" {
  scope                = azurerm_resource_group.lab_hybrid.id
  role_definition_name = "Reader"
  principal_id         = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

# -----------------------------------------------------------------------------
# Onboarding identity (#663)
# -----------------------------------------------------------------------------
# The service principal is OWNER-CREATED, not declared here, and the grant
# takes its object id as a variable. Two reasons, both structural:
#
#   - infra/ has no azuread provider, and the HCP Terraform run identity is an
#     Azure RBAC principal (Contributor + Role Based Access Control
#     Administrator) with no Entra directory role, the same boundary oidc.tf
#     records for app registrations.
#   - A secret minted by Terraform would sit in state. The credential is used
#     once by `azcmagent connect` from Ansible Vault and then deleted
#     (docs/runbooks/labs-host.md), so it never passes through here.
#
# Null until the owner has created the principal, so the rest of the estate
# keeps planning in the meantime. principal_type is explicit because the
# principal is new when this first applies: without it ARM looks the id up in
# Entra first and can miss a principal that has not replicated yet.
resource "azurerm_role_assignment" "arc_onboarding" {
  count = var.arc_onboarding_principal_id == null ? 0 : 1

  scope                = azurerm_resource_group.lab_hybrid.id
  role_definition_name = "Azure Connected Machine Onboarding"
  principal_id         = var.arc_onboarding_principal_id
  principal_type       = "ServicePrincipal"
}

# -----------------------------------------------------------------------------
# Data collection rule (#663)
# -----------------------------------------------------------------------------
# Heartbeat and auth/authpriv syslog, and nothing else, so ingestion stays at
# kilobytes a day against the workspace's daily cap (ADR 0032 consequences).
#
# Heartbeat has no data source: the Azure Monitor Agent writes a Heartbeat row
# every minute to each Log Analytics destination of every rule associated with
# it. Declaring the workspace as a destination IS the heartbeat.
#
# Levels are Info and above. sshd logs failed and accepted logins at Info, so
# dropping Info would drop the one signal this rule exists for; Debug is the
# only level left out, because it is where a chatty PAM module multiplies
# volume without adding a login event.
#
# The workspace is in the Management subscription and this rule is in the
# application one. A cross-subscription destination is allowed; a
# cross-region one is not, so the rule takes the workspace's own location
# rather than repeating var.azure_location and hoping the two agree.
#
# The association to the machine is NOT here. Its target is the Arc machine's
# resource id, which does not exist until `azcmagent connect` has run, so a
# Terraform association would fail every apply until then. The owner installs
# the Azure Monitor Agent extension and creates the association with the two
# `az` commands in docs/runbooks/labs-host.md once the machine is Connected.
# Both are needed: an association made outside the portal's DCR wizard does
# not install the agent.
resource "azurerm_monitor_data_collection_rule" "lab_hybrid" {
  name                = "dcr-lab-hybrid-${var.environment}-${var.region_abbreviation}"
  resource_group_name = azurerm_resource_group.lab_hybrid.name
  location            = azurerm_log_analytics_workspace.hcw.location
  kind                = "Linux"
  description         = "Lab host (Arc): heartbeat and auth/authpriv syslog only (ADR 0032 decision 3, #663)"

  destinations {
    log_analytics {
      name                  = "log-plat"
      workspace_resource_id = azurerm_log_analytics_workspace.hcw.id
    }
  }

  data_flow {
    streams      = ["Microsoft-Syslog"]
    destinations = ["log-plat"]
  }

  data_sources {
    syslog {
      name           = "syslog-auth"
      facility_names = ["auth", "authpriv"]
      log_levels     = ["Info", "Notice", "Warning", "Error", "Critical", "Alert", "Emergency"]
      streams        = ["Microsoft-Syslog"]
    }
  }

  tags = local.tags
}

# -----------------------------------------------------------------------------
# Machine configuration, audit only (#663)
# -----------------------------------------------------------------------------
# The built-in "Linux machines should meet requirements for the Azure compute
# security baseline" (fc9b3da7-8347-4380-8e70-0a0361d8dedd, v2.3.1 when this
# was written). Resource-group scope, never subscription: the IaC repository
# standard forbids a workload repository assigning subscription-level policy.
#
# Two parameters are load-bearing:
#   - IncludeArcMachines defaults to "false", and this group holds nothing BUT
#     an Arc machine. Left at its default the assignment would evaluate zero
#     resources and read as compliant forever.
#   - effect is AuditIfNotExists, the definition's only value besides
#     Disabled. It never changes the host. The machine-configuration service
#     creates the guest assignment from the definition's guestConfiguration
#     metadata by itself, so there is no DeployIfNotExists prerequisite and no
#     managed identity; the Connected Machine agent has the
#     machine-configuration agent built in.
#
# Gated by lab_hybrid_policy_enabled because this is the first policy
# assignment infra/ owns, and the run identity cannot write one: Contributor's
# NotActions exclude Microsoft.Authorization/*/Write, and Role Based Access
# Control Administrator writes role assignments only. The owner grants
# Resource Policy Contributor on this group (docs/runbooks/labs-host.md) and
# then sets the switch. Terraform does not grant that role to itself: an
# identity widening its own rights inside the plan it runs under is the
# escalation scripts/bootstrap-terraform-oidc.ps1's role split exists to
# prevent.
resource "azurerm_resource_group_policy_assignment" "lab_hybrid_linux_baseline" {
  count = var.lab_hybrid_policy_enabled ? 1 : 0

  name                 = "audit-linux-baseline-lab-hybrid"
  display_name         = "Lab host: Linux security baseline (audit only)"
  description          = "Audits the Arc-enabled lab host against the Azure compute security baseline for Linux. Audit only; changes nothing on the host (ADR 0032 decision 3, #663)."
  resource_group_id    = azurerm_resource_group.lab_hybrid.id
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/fc9b3da7-8347-4380-8e70-0a0361d8dedd"

  parameters = jsonencode({
    IncludeArcMachines = { value = "true" }
    effect             = { value = "AuditIfNotExists" }
  })
}
