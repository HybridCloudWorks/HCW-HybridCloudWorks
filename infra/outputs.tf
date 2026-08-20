# =============================================================================
# outputs.tf — Azure infrastructure outputs
# Used by CI/CD workflows and application configuration.
#
# SECURITY NOTE: Sensitive key/connection-string outputs are intentionally
# omitted. All runtime access uses managed identity + RBAC; no static key
# is passed to application code. See Variables.md for the full secrets catalog.
# =============================================================================

# -----------------------------------------------------------------------------
# Static Web App
# -----------------------------------------------------------------------------
output "swa_hostname" {
  description = "Default hostname of the Azure Static Web App (also the Cloudflare CNAME target)"
  value       = azurerm_static_web_app.hcw.default_host_name
}

output "swa_token" {
  description = "Deployment token (API key) for Static Web App deployment (used in GitHub Actions)"
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

# cosmos_db_primary_key intentionally removed — use managed identity
# cosmos_db_connection_string intentionally removed — use managed identity

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------
output "storage_account" {
  description = "Content storage account name (NOT the Functions host account — see functions_storage_account)"
  value       = azurerm_storage_account.hcw.name
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
