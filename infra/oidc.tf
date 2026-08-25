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
# environment:production — the subject the Function App deploy actually presents
#
# `de99aa0` put deploy-functions.yml behind `environment: production` to gate
# production deploys. That is a good change with a consequence nothing here
# accounted for: **declaring an environment changes the OIDC subject.** GitHub
# composes it as repo:<org>/<repo>:environment:<name>, NOT
# repo:<org>/<repo>:ref:<ref>, so the branch credential above cannot match a
# job that names an environment — the ref form is simply not what is presented.
#
# The result was a production deploy path that could not authenticate at all,
# and it stayed invisible because no deploy ran between that merge and
# 2026-08-25. The first dispatch after it failed at azure/login:
#
#   AADSTS700213: No matching federated identity record found for presented
#   assertion subject 'repo:HybridCloudWorks@312844660/
#   HCW-HybridCloudWorks@1268997852:environment:production'
#
# Both forms again, for the reasons given above the immutable block: the name
# form survives an org rename breaking the IDs' association, the ID form
# survives a rename outright. Six credentials against a cap of 20.
#
# The branch pair is NOT redundant now and must not be deleted alongside a
# future data-migration cleanup. heal-computed-properties.yml and
# publish-content-manifest.yml declare no environment, so they still present
# the ref subject. The rule is per-workflow, not per-repository: a workflow
# that names an environment needs an environment credential, one that does not
# needs the branch credential, and this identity serves both kinds.
# ---------------------------------------------------------------------------
resource "azurerm_federated_identity_credential" "github_production" {
  name                      = "github-${var.github_repo}-env-production"
  user_assigned_identity_id = azurerm_user_assigned_identity.github_deploy.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "repo:${var.github_org}/${var.github_repo}:environment:production"
}

resource "azurerm_federated_identity_credential" "github_production_immutable" {
  name                      = "github-${var.github_repo}-env-production-immutable"
  user_assigned_identity_id = azurerm_user_assigned_identity.github_deploy.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "${local.github_immutable_prefix}:environment:production"
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

# Read the workload alert rules, so their LIVE state can be verified after an
# apply (.github/workflows/verify-alert-state.yml).
#
# THE GAP THIS CLOSES. Applies run in TFC on a human's confirmation, and a
# green run proves ARM accepted the change — not that the deployed rule now
# behaves differently. For the alert fabric those come apart precisely where it
# matters: `autoMitigate` decides whether a firing rule mails once or every
# five minutes (ADR 0022 decision 6), and nothing in the repository, in CI, or
# in the TFC run list can show its value. This grant is what lets a workflow
# read it back.
#
# MONITORING READER, not Reader. Both satisfy the requirement — the operation
# is a control-plane GET on Microsoft.Insights/scheduledQueryRules, which
# `*/read` covers — and the two differ in what ELSE they carry at this scope.
# Reader grants read over every resource in the group: the Function App's
# configuration, the storage account, the Application Insights component. This
# identity already deploys to that Function App, so the marginal risk is small,
# but "small" is not "none" and the narrower role names the actual job. Note
# what Monitoring Reader deliberately does NOT carry, which is the point:
# `listKeys` on the workspace, so this identity cannot read the ingestion keys
# and so cannot forge or drown the telemetry the rules evaluate — the same
# reasoning that chose Log Analytics Reader for the alert identities themselves
# (ADR 0022 decision 4).
#
# SCOPE IS THE RESOURCE GROUP, not the individual rules. Three rules live here
# and a fourth would be a fourth role assignment; more importantly a per-rule
# grant would have to be re-declared every time a rule is renamed, which is
# exactly the coupling that leaves a verification path quietly broken. The
# group is the smallest scope that survives the rules changing.
resource "azurerm_role_assignment" "github_deploy_alert_reader" {
  scope                = azurerm_resource_group.app["web"].id
  role_definition_name = "Monitoring Reader"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
}

# Deliberately NOT granted to the active deployment path:
#   - Key Vault access. Deploys do not read secrets; the Function App's own
#     managed identity does that at runtime.
#   - Import-only Cosmos or storage roles on PRODUCTION. These were declared
#     behind migration_writer_enabled and were LIVE on this identity until
#     2026-08-24; the gate and all three declarations were removed with the
#     rehearsal itself. See the removal record at the end of this file.
#   - Data-plane access to the CONTENT storage account. This identity writes a
#     deployment package to the FUNCTIONS host account and nothing else; the
#     media the site serves is the Function App's to write, not CI's.
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
# REMOVED 2026-08-24 — the production-import grants, and the gate that held them
# ---------------------------------------------------------------------------
#
# Three role assignments and var.migration_writer_enabled went together:
#
#   github_deploy_cosmos_migration          Cosmos DB Built-in Data Contributor
#                                           at DATABASE scope, dbs/hcw
#   github_deploy_content_blob_migration    Storage Blob Data Contributor on the
#                                           production content account
#   github_deploy_content_network_migration Storage Account Contributor on the
#                                           production content account
#
# The owner confirmed the migration rehearsal is finished. This is a REVOCATION,
# not a tidy-up: all three were live on the identity, so a CI principal held
# write access to every container in the production database and to the account
# holding the site's media, for a job that no longer exists.
#
# WHY THE DECLARATIONS ARE DELETED RATHER THAN LEFT AT count = 0. A variable gate
# is only "off" while the workspace agrees with the checked-in default, and here
# it demonstrably did not: variables.tf said false while all three assignments
# were live in Azure. Deleting the resources removes the configuration's ability
# to grant them at all — a workspace value for a variable that no longer exists
# is a warning, not a re-grant. It also means an apply that finds them in state
# destroys them, which a default nobody can see from here would not guarantee.
#
# WHAT SURVIVES, and the job each one is still doing:
#
#   github_deploy_functions                Website Contributor on the Function
#                                          App — deploy-functions.yml publishes.
#   github_deploy_releases                 Blob Data Contributor on the FUNCTIONS
#                                          host account only, for the deployment
#                                          package. Never the content account.
#   github_deploy_funcsa_network           Storage Account Contributor on the
#                                          FUNCTIONS host account only, for the
#                                          per-run firewall window.
#   github_deploy_cosmos_container_writer  the custom container-definition role
#                                          at account scope, for the healer's
#                                          ARM PUT of computedProperties.
#   github_deploy_cosmos_content           data-plane Data Contributor scoped to
#   github_deploy_cosmos_blogs             colls/content and colls/blogs, for
#                                          apply-computed-sortdate --inspect.
#
# The two container-scoped Cosmos grants are UNAFFECTED by dropping the
# database-scoped one. They are separate assignments; the database scope was a
# superset sitting alongside them, not their parent. The healer keeps data-plane
# access to exactly the two containers it reads, and loses everything else.
#
# The two storage grants had no consumer to lose. Nothing in .github/workflows
# addresses the content storage account, and scripts/apply-computed-sortdate.mjs
# imports @azure/cosmos and @azure/identity and no blob client at all.
#
# NOT REMOVED, and worth a decision of its own: the two `data-migration`
# federated credentials near the top of this file. A federated credential grants
# no permissions — it decides which OIDC subject may act AS this identity — so
# with the grants above gone, a data-migration token now inherits the same
# reduced role set as a branch token. No workflow references
# `environment: data-migration`. Retiring that trust is an identity change and
# belongs with whoever owns the identity, not with this cleanup.
# ---------------------------------------------------------------------------

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
    azurerm_federated_identity_credential.github_production.subject,
    azurerm_federated_identity_credential.github_data_migration.subject,
    azurerm_federated_identity_credential.github_branch_immutable.subject,
    azurerm_federated_identity_credential.github_production_immutable.subject,
    azurerm_federated_identity_credential.github_data_migration_immutable.subject,
  ]
}
