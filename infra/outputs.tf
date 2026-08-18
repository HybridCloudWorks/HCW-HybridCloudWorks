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
  description = "Azure Storage account name"
  value       = azurerm_storage_account.hcw.name
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
  description = "Full HTTPS URL for the Function App"
  value       = "https://${azurerm_function_app_flex_consumption.hcw.default_hostname}"
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
