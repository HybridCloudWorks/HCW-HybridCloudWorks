# -----------------------------------------------------------------------------
# Azure OpenAI
#
# The primary-key output that used to live here is deliberately gone (T-506):
# local auth is disabled on the account, so there is no key to export, and
# exporting one ever again would put it in state and run output against the
# identity-first principle. Data-plane access is the Function App's managed
# identity via the Cognitive Services OpenAI User assignment in openai.tf.
# -----------------------------------------------------------------------------
output "openai_endpoint" {
  description = "Azure OpenAI endpoint URL (custom-subdomain form, required for AAD auth)"
  value       = azurerm_cognitive_account.openai.endpoint
}
