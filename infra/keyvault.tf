# =============================================================================
# keyvault.tf — the vault and every role assignment against it, including the
# two custom roles the API Keys page depends on.
#
# Split out of main.tf on 2026-08-29 (T-754). Terraform reads every .tf file in
# this directory as ONE module: same namespace, same state, same plan. Nothing
# moved between states and no resource address changed — an empty plan is the
# proof, and `functions/test/terraform-source.js` is why the text-reading guards
# did not need to care.
# =============================================================================

# =============================================================================
# Azure Key Vault — RBAC mode (access policies removed)
#
# enable_rbac_authorization = true replaces access policies.
# Roles: Key Vault Secrets User (read) for Function App MI,
#        Key Vault Secrets Officer (write) for Terraform executor.
# =============================================================================
resource "azurerm_key_vault" "hcw" {
  name                       = var.key_vault_name
  location                   = azurerm_resource_group.app["sec"].location
  resource_group_name        = azurerm_resource_group.app["sec"].name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  soft_delete_retention_days = 90
  purge_protection_enabled   = var.purge_protection_enabled
  rbac_authorization_enabled = true

  # The Function App reaches the vault over the subnet rule above. Nothing else
  # can — Terraform Cloud's runners are neither in this VNet nor a trusted Azure
  # service, so the Secrets Officer assignment below cannot actually write from
  # a TFC run.
  #
  # admin_ip_rules is how a human seeds the five secrets. Leave it empty and the
  # vault is unreachable by anyone except the app, which is the correct steady
  # state — populate it only for the seeding window. Secret VALUES are
  # deliberately not managed by Terraform, so they never enter state or TFC.
  # See TODO.md for the runbook.
  network_acls {
    default_action             = "Deny"
    bypass                     = "AzureServices"
    virtual_network_subnet_ids = [azurerm_subnet.functions_integration.id]
    ip_rules                   = var.admin_ip_rules
  }

  # Secrets are seeded by hand and exist nowhere else in managed form.
  # Replacement must be an explicit, reviewed decision.
  #
  # Of the four guards lifted for the centralus rebuild on 2026-08-19, this was
  # the only one whose contents Terraform cannot rebuild. Destroying this vault
  # destroys every secret in it, and the failure mode afterwards is quiet: the
  # app deploys clean and its @Microsoft.KeyVault(...) references resolve to
  # nothing, so a missing credential presents as missing data (see the note on
  # the integration subnet above).
  #
  # That rebuild was safe only because the secret values were held outside
  # Azure and re-seeded by hand afterwards. Guard restored the same day. Any
  # future plan that replaces this vault must export first — the Deployment
  # Runbook's export procedure is a prerequisite, not a suggestion.
  lifecycle {
    prevent_destroy = true
  }

  tags = local.tags
}

# Key Vault Secrets User — Function App managed identity.
#
# The PLATFORM uses this to resolve every "@Microsoft.KeyVault(SecretUri=...)"
# app setting before the process starts. No application code holds a vault
# client any more (src/lib/key-vault.js was deleted 2026-08-29 with its last
# caller), so this grant is not "the app reading secrets" — it is the host
# reading them on the app's behalf. Removing it does not break a code path; it
# leaves every referenced setting unresolved, which /api/health reports as
# unresolvedSecrets > 0.
resource "azurerm_role_assignment" "func_kv_secrets" {
  scope                = azurerm_key_vault.hcw.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

# =============================================================================
# The API-keys page: write-only vault access, and a config refresh
# =============================================================================
# Seeding a credential used to mean opening this vault's firewall to a human's
# IP, running scripts/cutover/06-seed-secret.ps1 from a desktop, and closing it
# again — three steps, one of which leaves production open to the internet if
# the operator is interrupted. This repository has already made that mistake
# once. The app never had that problem: it is in the integration subnet, which
# network_acls already admits. It was missing permission, not a network path.
#
# WHY A CUSTOM ROLE AND NOT "Key Vault Secrets Officer". Officer grants every
# secret operation — get, list, set, delete, recover, purge. The page promises
# that a pasted credential cannot be read back out, and a promise the platform
# does not enforce is a promise one refactor away from being false. This role
# can create a new secret VERSION and do nothing else: it cannot read, it
# cannot delete, and it cannot purge, so a compromised app can neither harvest
# the vault nor destroy it.
#
# The honest limit: a secret that resolves into an app setting is in the app's
# environment by definition, so this does not hide the values the app actively
# uses. It stops it reading OTHER secrets, OLD versions, and anything it has no
# reference for.
# THE DEFINITION IS NOT MANAGED HERE, and this is the second time the estate
# has learned it. `azurerm_role_definition` needs
# Microsoft.Authorization/roleDefinitions/write, and the Terraform run identity
# is Contributor + Role Based Access Control Administrator. Neither carries it:
# Contributor excludes Microsoft.Authorization/*/Write outright, and RBAC
# Administrator holds roleAssignments/write plus */read and nothing more. So the
# identity may ASSIGN roles and not INVENT them — the split infra/oidc.tf records
# after a 403 on 2026-08-21 proved it there.
#
# This block and func_config_refresh below were declared as `resource` when the
# API Keys page landed, which would have failed the very apply that turns the
# page on, with an authorization error naming Microsoft.Authorization rather
# than anything about Key Vault. Corrected before that apply ran, so no state
# holds either definition.
#
# The owner creates it once from the reviewed JSON; Terraform reads it by name
# and does the assignment:
#
#   az role definition create --role-definition @infra/roles/keyvault-secret-writer.json
#
# ASSIGNABLE AT THE RESOURCE GROUP, assigned at the vault. Microsoft documents
# custom roles as assignable at management group, subscription and resource
# group scopes; a resource-scoped assignableScopes entry is outside that set.
# rg-sec holds the vault and nothing else, so the group is not a widening here —
# it is the narrowest documented scope. The assignment below is still made at
# the vault itself, which is at or below the assignable scope.
data "azurerm_role_definition" "kv_secret_writer" {
  name  = "HCW Key Vault Secret Writer"
  scope = azurerm_resource_group.app["sec"].id
}

resource "azurerm_role_assignment" "func_kv_secret_writer" {
  scope              = azurerm_key_vault.hcw.id
  role_definition_id = data.azurerm_role_definition.kv_secret_writer.id
  principal_id       = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

# App Service caches Key Vault references and refetches them every 24 hours, so
# without this a pasted key sits in the vault, correct and unused, for up to a
# day — and the page looks broken. The documented remedy is a POST to the site's
# config/configreferences/appsettings/refresh endpoint, which needs a
# management-plane right on the app itself.
#
# WHAT IS DELIBERATELY NOT HERE: Microsoft.Web/sites/config/list/action. That is
# the action that READS app settings back, secret values included, and granting
# it would hand the app a way around the set-only vault role above. Write
# without list is the whole point.
#
# Scoped to this one site, not the resource group. And the refresh call is
# best-effort in code (lib/secret-vault.js): if this assignment is missing or
# ARM refuses, the secret is already safely written and the only cost is that it
# goes live on the 24-hour cycle instead of now.
# Owner-created for the same reason as kv_secret_writer above:
#
#   az role definition create --role-definition @infra/roles/function-config-refresh.json
#
# rg-web holds the Static Web App, the Function App, its plan, Application
# Insights and the host storage account. Microsoft.Web/sites/config/Write
# reaches only `sites`, and the Static Web App is Microsoft.Web/staticSites — a
# different resource type — so the group scope grants nothing the resource scope
# would not have.
data "azurerm_role_definition" "func_config_refresh" {
  name  = "HCW Function Config Refresh"
  scope = azurerm_resource_group.app["web"].id
}

resource "azurerm_role_assignment" "func_config_refresh" {
  scope              = azurerm_function_app_flex_consumption.hcw.id
  role_definition_id = data.azurerm_role_definition.func_config_refresh.id
  principal_id       = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

# REMOVED (T-748): azurerm_role_assignment.terraform_kv_secrets, which granted
# Key Vault Secrets Officer to the HCP Terraform workspace principal for
# "CI/CD secret seeding".
#
# It had no consumer. Terraform manages no secret VALUES in this configuration —
# there is not one azurerm_key_vault_secret resource in infra/ — and TFC's
# runners are neither in this VNet nor a trusted Azure service, so the grant
# could not write from a run even if something wanted to. Its only live effect
# was latent: whenever admin_ip_rules opens a seeding window, a shared remote
# execution environment would gain write access to every production secret
# alongside the named human operator.
#
# Seeding is covered by the admin_object_ids window below, which grants named
# humans. The repository's own doctrine (oidc.tf: "deploys do not read secrets")
# argues against handing that reach to an automation principal that never
# needed it.

# Key Vault Secrets Officer — named human operators, for the seeding windows the
# cutover scripts need.
#
# Every script in scripts/cutover that touches a secret assumed this existed.
# It did not: the vault is RBAC-authorised with no access policies, so the only
# principals with data-plane access were the Function App and the Terraform
# service principal above. `04-telegram-webhook.ps1` opened the firewall exactly
# as designed on 2026-08-23 and was refused by RBAC, which looks like a broken
# script and is actually a missing role assignment.
#
# Empty by default and emptied again after the window, for the same reason
# admin_ip_rules is: standing human access to production secrets is not a steady
# state worth having.
resource "azurerm_role_assignment" "admin_kv_secrets" {
  for_each = toset(var.admin_object_ids)

  scope                = azurerm_key_vault.hcw.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.value
}
