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
# behind var.entra_api_audience — see REVIEW.md. That is a one-time manual
# step and is deliberately not automated here.
# =============================================================================

resource "azurerm_user_assigned_identity" "github_deploy" {
  # CAF's managed-identity format carries both region and instance:
  # id-<app or service name>-<environment>-<region>-<###>.
  name                = "id-${var.workload_name}-github-deploy-${var.environment}-${var.region_abbreviation}-${var.instance}"
  location            = azurerm_resource_group.app["web"].location
  resource_group_name = azurerm_resource_group.app["web"].name
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

# Legacy import trust retained pending the owner-only cleanup decision in
# REVIEW.md. The former workflow used an Environment subject, which differs
# from the branch credential above.
resource "azurerm_federated_identity_credential" "github_data_migration" {
  name                      = "github-${var.github_repo}-env-data-migration"
  user_assigned_identity_id = azurerm_user_assigned_identity.github_deploy.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "repo:${var.github_org}/${var.github_repo}:environment:data-migration"
}

# ---------------------------------------------------------------------------
# The SAME two subjects again, in GitHub's immutable-identifier form.
#
# GitHub now composes the subject with numeric org and repository IDs embedded:
#
#   repo:HybridCloudWorks@312844660/HCW-HybridCloudWorks@1268997852:ref:refs/heads/main
#
# rather than the documented repo:<org>/<repo>:ref:<ref>. Confirmed on
# 2026-08-20 from a real token — the first dispatch of deploy-functions.yml
# failed with AADSTS700213 and the presented subject in the error, and
# `GET /repos/{owner}/{repo}/actions/oidc/customization/sub` reports
# `sub_claim_prefix` in the ID form while `use_default` is true. So this is
# GitHub's default now, not a customization anyone here made.
#
# Both forms are trusted rather than swapping to the new one, for two reasons.
# The rollout is GitHub's to reverse, and a credential that stops matching
# fails every deploy at login with an error naming nothing that changed. And
# the two are not redundant in the way they look: the name form survives an org
# rename breaking the IDs' association, the ID form survives a rename outright.
# Federated credentials are free and capped at 20; four is not a cost.
#
# Delete the name-form pair once the ID form has been stable for a release or
# two — not before, and not because it looks duplicated.
#
# The IDs are hardcoded deliberately. They are immutable by definition: that is
# the entire point of GitHub embedding them, and a variable would invite
# someone to "fix" them to something readable.
# ---------------------------------------------------------------------------
locals {
  # repo:<org>@<org-id>/<repo>@<repo-id> — verified against the GitHub API,
  # not copied out of the error message.
  github_immutable_prefix = "repo:${var.github_org}@312844660/${var.github_repo}@1268997852"
}

resource "azurerm_federated_identity_credential" "github_branch_immutable" {
  name                      = "github-${var.github_repo}-branch-immutable"
  user_assigned_identity_id = azurerm_user_assigned_identity.github_deploy.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "${local.github_immutable_prefix}:ref:${var.github_deploy_ref}"
}

resource "azurerm_federated_identity_credential" "github_data_migration_immutable" {
  name                      = "github-${var.github_repo}-env-data-migration-immutable"
  user_assigned_identity_id = azurerm_user_assigned_identity.github_deploy.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "${local.github_immutable_prefix}:environment:data-migration"
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

# Deliberately NOT granted to the active deployment path:
#   - Key Vault access. Deploys do not read secrets; the Function App's own
#     managed identity does that at runtime.
#   - Import-only Cosmos or storage roles on PRODUCTION. The legacy role
#     declarations remain gated off by migration_writer_enabled pending review.
#   - anything at subscription scope.

# ---------------------------------------------------------------------------
# heal-computed-properties.yml — a control-plane write, so an ARM role
# ---------------------------------------------------------------------------
# azurerm_cosmosdb_sql_container cannot express computedProperties, so any
# apply that updates the `content` or `blogs` container wipes cp_sortDate —
# and with PUBLIC_LIST_SQL_ORDER=1 live, that breaks the public content list
# (TODO.md T-206). scripts/apply-computed-sortdate.mjs re-applies it.
#
# Setting computedProperties is a CONTROL-PLANE operation. The healer
# originally did it through the SDK's container.replace(), which goes to the
# data-plane endpoint, and Cosmos refuses that with an AAD token no matter
# which roles the identity holds: run 32420399977 (2026-08-20) failed with
# "cannot be authorized by AAD token in data plane" while holding Data
# Contributor on exactly those containers. The write now goes through ARM
# (a PUT on .../sqlDatabases/hcw/containers/{name}), and the authorization
# for that is a custom role: containers read + write on the account and
# nothing else. Not "Cosmos DB Operator" — that is databaseAccounts/* minus
# keys, which also covers the firewall, the database and every container's
# existence, none of which the healer has any business touching.
#
# The two container-scoped DATA-PLANE grants below stay: --inspect reads
# documents in content and blogs to check the date aliases are ISO-sortable,
# and that is a data-plane read.
# The role DEFINITION is not managed here. Creating one needs
# Microsoft.Authorization/roleDefinitions/write, which the Terraform run
# identity deliberately does not hold (it is Contributor + Role Based Access
# Control Administrator: it may assign roles, not invent them — the first
# apply of this block proved it with a 403 on 2026-08-21). Same split as the
# bootstrap identity itself: the owner creates the definition once from the
# reviewed JSON in infra/roles/, and Terraform consumes it by name and does
# the assignment.
#
#   az role definition create --role-definition @infra/roles/cosmos-container-writer.json
#
# To change the permission set: edit the JSON, `az role definition update`,
# and nothing here moves. A rename is the one change that needs both.
data "azurerm_role_definition" "cosmos_container_writer" {
  name  = "HCW Cosmos Container Definition Writer"
  scope = azurerm_cosmosdb_account.hcw.id
}

resource "azurerm_role_assignment" "github_deploy_cosmos_container_writer" {
  scope              = azurerm_cosmosdb_account.hcw.id
  role_definition_id = data.azurerm_role_definition.cosmos_container_writer.id
  principal_id       = azurerm_user_assigned_identity.github_deploy.principal_id
}

# `name` omitted on the data-plane assignments for the same reason as
# func_cosmos in main.tf: the provider generates a stable GUID, and a
# duplicated hardcoded name silently REPLACES another identity's assignment
# instead of erroring.

# The container segment of each scope comes from the CONTAINER RESOURCE, not a
# string literal. A literal "colls/content" is correct text but carries no
# dependency edge, so on a fresh apply Terraform ordered these before the
# containers existed and Cosmos rejected them with "The collection with name
# [content] ... could not be found". Referencing the resource makes the
# ordering explicit and breaks if the container is ever renamed or removed —
# both improvements over failing at apply time.

resource "azurerm_cosmosdb_sql_role_assignment" "github_deploy_cosmos_content" {
  resource_group_name = azurerm_resource_group.app["db"].name
  account_name        = azurerm_cosmosdb_account.hcw.name
  role_definition_id  = "${azurerm_cosmosdb_account.hcw.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_user_assigned_identity.github_deploy.principal_id
  scope               = "${azurerm_cosmosdb_account.hcw.id}/dbs/${azurerm_cosmosdb_sql_database.hcw.name}/colls/${azurerm_cosmosdb_sql_container.hcw["content"].name}"
}

resource "azurerm_cosmosdb_sql_role_assignment" "github_deploy_cosmos_blogs" {
  resource_group_name = azurerm_resource_group.app["db"].name
  account_name        = azurerm_cosmosdb_account.hcw.name
  role_definition_id  = "${azurerm_cosmosdb_account.hcw.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_user_assigned_identity.github_deploy.principal_id
  scope               = "${azurerm_cosmosdb_account.hcw.id}/dbs/${azurerm_cosmosdb_sql_database.hcw.name}/colls/${azurerm_cosmosdb_sql_container.hcw["blogs"].name}"
}

# ---------------------------------------------------------------------------
# Legacy production-import role gate: migration_writer_enabled
# ---------------------------------------------------------------------------
# These are count = 0 by default and remain only for state-safe cleanup
# sequencing. Do not enable them; remove the declarations through the
# owner-approved Terraform cleanup in REVIEW.md.
#
# Database scope rather than account scope: the migration touches every
# container under `hcw` and nothing else on the account.
resource "azurerm_cosmosdb_sql_role_assignment" "github_deploy_cosmos_migration" {
  count = var.migration_writer_enabled ? 1 : 0

  resource_group_name = azurerm_resource_group.app["db"].name
  account_name        = azurerm_cosmosdb_account.hcw.name
  role_definition_id  = "${azurerm_cosmosdb_account.hcw.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_user_assigned_identity.github_deploy.principal_id
  scope               = "${azurerm_cosmosdb_account.hcw.id}/dbs/${azurerm_cosmosdb_sql_database.hcw.name}"
}

resource "azurerm_role_assignment" "github_deploy_content_blob_migration" {
  count = var.migration_writer_enabled ? 1 : 0

  scope                = azurerm_storage_account.hcw.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
}

# Storage Account Contributor on the content account, for the per-run firewall
# window the storage copy needs — same role, same reasoning, same narrow scope
# as github_deploy_funcsa_network above.
resource "azurerm_role_assignment" "github_deploy_content_network_migration" {
  count = var.migration_writer_enabled ? 1 : 0

  scope                = azurerm_storage_account.hcw.id
  role_definition_name = "Storage Account Contributor"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
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
    azurerm_federated_identity_credential.github_branch_immutable.subject,
    azurerm_federated_identity_credential.github_data_migration_immutable.subject,
  ]
}
