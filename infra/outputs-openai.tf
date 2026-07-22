# -----------------------------------------------------------------------------
# Azure OpenAI
# -----------------------------------------------------------------------------
output "openai_endpoint" {
  description = "Azure OpenAI endpoint URL"
  value       = azurerm_cognitive_account.openai.endpoint
}

output "openai_primary_key" {
  description = "Azure OpenAI primary key"
  value       = azurerm_cognitive_account.openai.primary_access_key
  sensitive   = true
}
