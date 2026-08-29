# =============================================================================
# outputs.tf — Azure infrastructure outputs
# Used by CI/CD workflows and application configuration.
#
# SECURITY NOTE: Sensitive key/connection-string outputs are intentionally
# omitted, with ONE recorded exception — `swa_token` below. All *runtime* access
# uses managed identity + RBAC; no static key is passed to application code.
# See Required-Inputs for the full secrets catalog.
#
# The exception is stated here rather than left to be discovered, because this
# sentence used to read as an unqualified "no key outputs exist" eleven lines
# above one that does (T-722). A security note that a reader can falsify by
# scrolling is worse than no note: it teaches them not to trust the next one.
# =============================================================================

# -----------------------------------------------------------------------------
# Static Web App
# -----------------------------------------------------------------------------
output "swa_hostname" {
  description = "Default hostname of the Azure Static Web App (also the Cloudflare CNAME target)"
  value       = azurerm_static_web_app.hcw.default_host_name
}

# THE RECORDED EXCEPTION to the header's rule (T-722).
#
# This is the estate's last long-lived credential; everything else a workflow
# uses is federated OIDC. `sensitive` keeps it out of logs and plan output, but
# it is still surfaced on the HCP Terraform Outputs tab to anyone with state
# read, and it is consumed by GitHub Actions as exactly the kind of static
# credential the IaC standard's Principle 2 prohibits.
#
# Kept because removing it does not remove the credential: the token exists in
# state via `azurerm_static_web_app.hcw.api_key` whatever this block says, and
# `deploy-azure-frontend.yml` has no other way to authenticate today. Deleting
# the output alone would hide it rather than retire it.
#
# Retiring it means moving the SWA deploy to OIDC, which is owner-gated and
# tracked as T-727. Until then it is an accepted exception recorded in
# TODO.md's accepted-risks table, in the same terms as Key Vault purge
# protection — and the deploy workflow now at least isolates it in a job that
# installs nothing.
output "swa_token" {
  description = "Deployment token (API key) for Static Web App deployment (used in GitHub Actions). Accepted exception to the no-key-outputs rule — see TODO.md accepted risks and TODO.md T-727."
  value       = azurerm_static_web_app.hcw.api_key
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Cosmos DB
# -----------------------------------------------------------------------------
output "cosmos_endpoint" {
  description = "Cosmos DB account endpoint URL (no key — Function App uses managed identity)"
  value       = azurerm_cosmosdb_account.hcw.endpoint
}

output "cosmos_database" {
  description = "Cosmos DB database name"
  value       = azurerm_cosmosdb_sql_database.hcw.name
}

# The account's resource group — what heal-computed-properties.yml needs to
# address the container through ARM (the cp_sortDate write is control-plane;
# see oidc.tf). Same pairing guarantee as web_resource_group: read from the
# account resource itself.
output "cosmos_resource_group" {
  description = "Resource group holding the Cosmos account — the COSMOS_RESOURCE_GROUP repository variable the healer addresses ARM with"
  value       = azurerm_cosmosdb_account.hcw.resource_group_name
}

# cosmos_db_primary_key intentionally removed — use managed identity
# cosmos_db_connection_string intentionally removed — use managed identity

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------
output "storage_account" {
  description = "Content storage account name (NOT the Functions host account — see functions_storage_account)"
  value       = azurerm_storage_account.hcw.name
}

# The CONTENT account's group — used by repository-variable bootstrap and
# operator tooling when a controlled storage firewall window is required.
# Taken from the account's own attribute for the same pairing guarantee as
# web_resource_group below.
output "storage_resource_group" {
  description = "Resource group holding the content storage account — used with STORAGE_RESOURCE_GROUP when controlled access is required"
  value       = azurerm_storage_account.hcw.resource_group_name
}

output "functions_storage_account" {
  description = "Functions host storage account — the FUNCTIONS_STORAGE_ACCOUNT repository variable whose firewall deploy-functions.yml opens and closes per run (T-503)"
  value       = azurerm_storage_account.functions.name
}

# Taken from the storage account's own attribute rather than the resource
# group resource, so this output and functions_storage_account can never name
# a mismatched pair — RESOURCE_GROUP exists solely to scope the firewall
# window on that exact account.
output "web_resource_group" {
  description = "Resource group holding the Function App and its host storage account — the RESOURCE_GROUP repository variable deploy-functions.yml scopes its per-run firewall window to (T-503)"
  value       = azurerm_storage_account.functions.resource_group_name
}

output "blob_endpoint" {
  description = "Primary blob endpoint for constructing public asset URLs"
  value       = azurerm_storage_account.hcw.primary_blob_endpoint
}

# storage_connection_string intentionally removed — use managed identity

# -----------------------------------------------------------------------------
# Function App
# -----------------------------------------------------------------------------
output "function_hostname" {
  description = "Default hostname of the Azure Function App (also the Cloudflare CNAME target)"
  value       = azurerm_function_app_flex_consumption.hcw.default_hostname
}

# The bare resource name, which is what `func azure functionapp publish` and
# Azure/functions-action's `app-name` take — neither accepts a hostname or a URL.
#
# It exists as an output because it was hardcoded in two places and both went
# stale: deploy-functions.yml carried `func-site-prod-scus` and
# functions/package.json carried `hcw-functions-prod`, an estate older still.
# Neither app exists, so a deploy would have failed on "app not found" — which
# reads as a permissions or subscription problem before it reads as a typo.
output "function_app_name" {
  description = "Function App resource name — what a deploy targets. Not the hostname; see function_hostname for that"
  value       = azurerm_function_app_flex_consumption.hcw.name
}

output "function_url" {
  description = "Full HTTPS URL for the Function App ORIGIN. Not reachable by browsers or CI while the origin lock is on — see api_base_url"
  value       = "https://${azurerm_function_app_flex_consumption.hcw.default_hostname}"
}

# The address every CLIENT must use: browsers, CI smoke tests, anything that is
# not Cloudflare itself.
#
# This exists because function_url is a trap once functions_origin_lock_enabled
# is true. That output names the azurewebsites.net origin, which is exactly the
# thing the ip_restriction rules refuse — a browser or a GitHub-hosted runner
# gets 403, and the 403 says nothing about why. Anything that fed
# function_hostname into a client-facing setting was building a URL guaranteed
# to fail the moment the lock came on.
#
# Route: browser -> api-azure.<domain> (Cloudflare, proxied) -> origin. The
# late-transform rule stamps x-hcw-origin-secret on the way through, which is
# what lets client-identity.js trust CF-Connecting-IP.
#
# Consumers: VITE_AZURE_FUNCTIONS_URL (frontend build), the FUNCTIONS_URL
# GitHub variable, deploy-functions.yml's smoke test, and the connect-src
# entry in frontend/staticwebapp.config.json — which must name this host, since
# CSP is enforced against the URL the browser actually calls.
output "api_base_url" {
  description = "Public API base URL through Cloudflare — the only address clients can reach while the origin lock is on"
  value       = "https://${cloudflare_record.azure_functions.name}.${var.domain}/api"
}

output "app_principal_id" {
  description = "Function App managed identity principal ID — use this when granting additional RBAC roles"
  value       = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

# -----------------------------------------------------------------------------
# Key Vault
# -----------------------------------------------------------------------------
output "vault_uri" {
  description = "Azure Key Vault URI"
  value       = azurerm_key_vault.hcw.vault_uri
}

output "vault_name" {
  description = "Azure Key Vault name"
  value       = azurerm_key_vault.hcw.name
}

# -----------------------------------------------------------------------------
# Observability
# -----------------------------------------------------------------------------
output "insights_connection" {
  description = "Application Insights connection string (used for local development only — wired via Terraform in production)"
  value       = azurerm_application_insights.hcw.connection_string
  sensitive   = true
}

output "workspace_id" {
  description = "Log Analytics workspace ID"
  value       = azurerm_log_analytics_workspace.hcw.id
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------
output "subnet_id" {
  description = "Functions Flex integration subnet ID — use for additional service firewall rules"
  value       = azurerm_subnet.functions_integration.id
}

# -----------------------------------------------------------------------------
# DNS / Domains
# -----------------------------------------------------------------------------
# The former azure_functions_hostname / azure_swa_hostname outputs (Cloudflare
# CNAME targets) returned values identical to function_hostname / swa_hostname
# above and were consolidated into them — their Cloudflare-CNAME note now lives
# on those descriptions. Consume function_hostname / swa_hostname for CNAMEs.

# Which Cloudflare plan this zone is on. Added 2026-08-20 because an
# architecture argument was being made on an assumption about it, and the plan
# tier decides what the edge can and cannot do — Origin Rules' Host Header
# override, Super Bot Fight Mode, and mTLS all gate on it.
data "cloudflare_zone" "current" {
  zone_id = var.cloudflare_zone_id
}

output "cloudflare_plan" {
  description = "Cloudflare plan for the zone — determines which edge features are reachable at all"
  value       = data.cloudflare_zone.current.plan
}

# -----------------------------------------------------------------------------
# REMOVED 2026-08-24 — cosmos_scratch_endpoint, cosmos_scratch_account_name,
# storage_scratch_account and scratch_resource_group.
#
# They described the rehearsal estate, which is destroyed by this change
# (scratch.tf). The header above them also claimed they were consumed by
# scripts/set-github-variables.ps1 wave 2; that script's $waveTwo list holds no
# scratch entry, so the claim was already untrue before the estate went.
#
# The GitHub repository variables COSMOS_SCRATCH_ENDPOINT, STORAGE_SCRATCH_ACCOUNT
# and SCRATCH_RESOURCE_GROUP are therefore orphaned rather than merely stale:
# nothing writes them and nothing reads them. Clearing them is a repository
# settings change, not a Terraform one.
# -----------------------------------------------------------------------------
