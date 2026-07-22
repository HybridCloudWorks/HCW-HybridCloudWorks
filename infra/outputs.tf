# =============================================================================
# outputs.tf — Azure infrastructure outputs
# Used by CI/CD workflows and application configuration.
# =============================================================================

# -----------------------------------------------------------------------------
# Static Web App
# -----------------------------------------------------------------------------
output "static_web_app_default_hostname" {
  description = "Default hostname of the Azure Static Web App"
  value       = azurerm_static_web_app.hcw.default_host_name
}

output "static_web_app_api_key" {
  description = "API key for Static Web App deployment (used in GitHub Actions)"
  value       = azurerm_static_web_app.hcw.api_key
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Cosmos DB
# -----------------------------------------------------------------------------
output "cosmos_db_endpoint" {
  description = "Cosmos DB account endpoint URL"
  value       = azurerm_cosmosdb_account.hcw.endpoint
}

output "cosmos_db_primary_key" {
  description = "Cosmos DB primary key"
  value       = azurerm_cosmosdb_account.hcw.primary_key
  sensitive   = true
}

output "cosmos_db_connection_string" {
  description = "Cosmos DB primary connection string"
  value       = azurerm_cosmosdb_account.hcw.primary_sql_connection_string
  sensitive   = true
}

output "cosmos_db_database_name" {
  description = "Cosmos DB database name"
  value       = azurerm_cosmosdb_sql_database.hcw.name
}

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------
output "storage_account_name" {
  description = "Azure Storage account name"
  value       = azurerm_storage_account.hcw.name
}

output "storage_primary_blob_endpoint" {
  description = "Primary blob endpoint for constructing asset URLs"
  value       = azurerm_storage_account.hcw.primary_blob_endpoint
}

output "storage_connection_string" {
  description = "Storage account primary connection string"
  value       = azurerm_storage_account.hcw.primary_connection_string
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Function App
# -----------------------------------------------------------------------------
output "function_app_default_hostname" {
  description = "Default hostname of the Azure Function App"
  value       = azurerm_linux_function_app.hcw.default_hostname
}

output "function_app_url" {
  description = "Full HTTPS URL for the Function App"
  value       = "https://${azurerm_linux_function_app.hcw.default_hostname}"
}

output "function_app_principal_id" {
  description = "Managed identity principal ID for the Function App"
  value       = azurerm_linux_function_app.hcw.identity[0].principal_id
}

# -----------------------------------------------------------------------------
# Key Vault
# -----------------------------------------------------------------------------
output "key_vault_uri" {
  description = "Azure Key Vault URI"
  value       = azurerm_key_vault.hcw.vault_uri
}

output "key_vault_name" {
  description = "Azure Key Vault name"
  value       = azurerm_key_vault.hcw.name
}

# -----------------------------------------------------------------------------
# Observability
# -----------------------------------------------------------------------------
output "app_insights_instrumentation_key" {
  description = "Application Insights instrumentation key"
  value       = azurerm_application_insights.hcw.instrumentation_key
  sensitive   = true
}

output "app_insights_connection_string" {
  description = "Application Insights connection string"
  value       = azurerm_application_insights.hcw.connection_string
  sensitive   = true
}

output "log_analytics_workspace_id" {
  description = "Log Analytics workspace ID"
  value       = azurerm_log_analytics_workspace.hcw.id
}

# -----------------------------------------------------------------------------
# DNS / Domains
# -----------------------------------------------------------------------------
output "azure_functions_cname" {
  description = "Azure Functions CNAME record value for Cloudflare"
  value       = "${azurerm_linux_function_app.hcw.default_hostname}"
}

output "azure_swa_cname" {
  description = "Azure Static Web App CNAME record value for Cloudflare"
  value       = azurerm_static_web_app.hcw.default_host_name
}
