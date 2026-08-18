# =============================================================================
# oidc.tf — GitHub Actions deployment identity (federated, no stored secrets)
#
# Replaces the AZURE_CREDENTIALS GitHub secret, which held a static
# service-principal JSON. The README guardrail asks for OIDC and managed
# identities and forbids committed static cloud credentials; the workflows were
# not meeting it.
#
# WHY A USER-ASSIGNED MANAGED IDENTITY RATHER THAN AN APP REGISTRATION
#
# The usual recipe federates an Entra app registration. That requires directory
# permissions in Entra ID — Application Administrator or the tenant's
# "users may register applications" setting. Azure **Owner** does not grant it:
# Owner is Azure RBAC over subscriptions and resources, a different plane.
#
# A user-assigned managed identity is an ordinary Azure resource, and
# azurerm_federated_identity_credential attaches the trust to it directly. So
# everything here is creatable by an Azure Owner with no Entra role at all,
# which matches the permissions this deployment is expected to run under.
#
# The one thing that still needs Entra rights is the API app registration
# behind var.entra_api_audience — see Review.md §4.1. That is a one-time manual
# step and is deliberately not automated here.
# =============================================================================

resource "azurerm_user_assigned_identity" "github_deploy" {
  name                = "id-${var.project_name}-github-deploy"
  location            = azurerm_resource_group.hcw.location
  resource_group_name = azurerm_resource_group.hcw.name
  tags                = var.tags
}

# Trust GitHub's OIDC issuer for this repository on the deploy branch only.
#
# `subject` must match the token's claim EXACTLY. GitHub composes it as
# repo:<org>/<repo>:ref:<git-ref>, so github_org, github_repo and
# github_deploy_ref are load-bearing — a mismatch fails at azure/login with
# AADSTS70021 and no indication of which component was wrong.
resource "azurerm_federated_identity_credential" "github_branch" {
  name                      = "github-${var.github_repo}-branch"
  user_assigned_identity_id = azurerm_user_assigned_identity.github_deploy.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "repo:${var.github_org}/${var.github_repo}:ref:${var.github_deploy_ref}"
}

# The data-migration workflow runs under a GitHub Environment, which changes the
# subject claim shape — an environment token is not a branch token, so the
# branch credential above does not cover it.
resource "azurerm_federated_identity_credential" "github_data_migration" {
  name                      = "github-${var.github_repo}-env-data-migration"
  user_assigned_identity_id = azurerm_user_assigned_identity.github_deploy.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "repo:${var.github_org}/${var.github_repo}:environment:data-migration"
}

# ---------------------------------------------------------------------------
# Roles for the deployment identity — scoped, not subscription Contributor
# ---------------------------------------------------------------------------

# Publish code to the Function App. Website Contributor covers deployment and
# app-settings management without granting rights over the rest of the group.
resource "azurerm_role_assignment" "github_deploy_functions" {
  scope                = azurerm_function_app_flex_consumption.hcw.id
  role_definition_name = "Website Contributor"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
}

# Flex Consumption pulls the deployment package from the releases container, so
# the publishing identity must be able to write blobs to it.
resource "azurerm_role_assignment" "github_deploy_releases" {
  scope                = azurerm_storage_account.functions.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
}

# T-503 makes the host storage account default-Deny, and GitHub-hosted runners
# have public dynamic IPs — so deploy-functions.yml opens a per-run firewall
# window (add runner IP → upload → remove, always-run cleanup). Managing the
# account's network rules is a control-plane write, which the data-plane role
# above does not carry; Storage Account Contributor is the narrowest built-in
# that does. Two things to know about it, on the record:
#   - it also permits listKeys on this one account. The identity could already
#     write the deployment package (the blob role above) — i.e. arbitrary code
#     into the API — so this adds no capability an attacker holding the
#     identity would care about.
#   - scope is exactly this account, not the group or subscription.
resource "azurerm_role_assignment" "github_deploy_funcsa_network" {
  scope                = azurerm_storage_account.functions.id
  role_definition_name = "Storage Account Contributor"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
}

# Deliberately NOT granted:
#   - Key Vault access. Deploys do not read secrets; the Function App's own
#     managed identity does that at runtime.
#   - Cosmos data-plane roles beyond the two-container exception below. The
#     data migration authenticates with its own credentials rather than
#     borrowing the deploy identity.
#   - anything at subscription scope.

# ---------------------------------------------------------------------------
# The one Cosmos exception: heal-computed-properties.yml
# ---------------------------------------------------------------------------
# azurerm_cosmosdb_sql_container cannot express computedProperties, so any
# apply that updates the `content` or `blogs` container wipes cp_sortDate —
# and with PUBLIC_LIST_SQL_ORDER=1 live, that breaks the public content list
# (TODO.md T-206). The healer workflow re-applies it via
# scripts/apply-computed-sortdate.mjs, and needs Data Contributor on EXACTLY
# those two containers — scoped per container, not at the account, keeping
# the "no Cosmos for the deploy identity" posture as narrow an exception as
# the job allows. If the healer ever 403s despite these assignments, widening
# the scope to the database is the first debugging step: container-scoped
# metadata writes are the newest corner of Cosmos data-plane RBAC.
#
# `name` omitted for the same reason as func_cosmos in main.tf: the provider
# generates a stable GUID, and a duplicated hardcoded name silently REPLACES
# another identity's assignment instead of erroring.

resource "azurerm_cosmosdb_sql_role_assignment" "github_deploy_cosmos_content" {
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  role_definition_id  = "${azurerm_cosmosdb_account.hcw.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_user_assigned_identity.github_deploy.principal_id
  scope               = "${azurerm_cosmosdb_account.hcw.id}/dbs/${azurerm_cosmosdb_sql_database.hcw.name}/colls/content"
}

resource "azurerm_cosmosdb_sql_role_assignment" "github_deploy_cosmos_blogs" {
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  role_definition_id  = "${azurerm_cosmosdb_account.hcw.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_user_assigned_identity.github_deploy.principal_id
  scope               = "${azurerm_cosmosdb_account.hcw.id}/dbs/${azurerm_cosmosdb_sql_database.hcw.name}/colls/blogs"
}

# ---------------------------------------------------------------------------
# Values the GitHub workflows need. None are secret: federation means
# possession of these IDs grants nothing without a matching OIDC token from
# this repository and ref.
# ---------------------------------------------------------------------------
output "client_id" {
  description = "CLIENT_ID for azure/login — set as a repository variable, not a secret"
  value       = azurerm_user_assigned_identity.github_deploy.client_id
}

output "deploy_principal_id" {
  description = "Principal ID of the GitHub deployment identity — for granting further roles"
  value       = azurerm_user_assigned_identity.github_deploy.principal_id
}

output "federated_subjects" {
  description = "Exact OIDC subject claims trusted by this identity — compare against a failing token"
  value = [
    azurerm_federated_identity_credential.github_branch.subject,
    azurerm_federated_identity_credential.github_data_migration.subject,
  ]
}
