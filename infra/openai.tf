# =============================================================================
# Azure Cognitive Services (OpenAI)
#
# Replaces GCP Vertex AI. Provides GPT-4o and DALL-E 3 capabilities.
# Note: Ensure the subscription is approved for Azure OpenAI access.
# =============================================================================
resource "azurerm_cognitive_account" "openai" {
  # `oai` is CAF's abbreviation for Azure OpenAI. `ai` must not appear here:
  # it is this repository's resource-group segment for AI + Machine Learning,
  # and the naming convention forbids the workload/name slots drawing from the
  # category vocabulary (Naming-Convention wiki page).
  name                = "oai-${var.workload_name}-${var.environment}-${var.region_abbreviation}"
  location            = azurerm_resource_group.app["ai"].location
  resource_group_name = azurerm_resource_group.app["ai"].name
  kind                = "OpenAI"
  sku_name            = "S0"

  # T-506: keyless. AAD data-plane auth requires a custom subdomain endpoint,
  # and custom_subdomain_name forces replacement of an account created
  # without one — the plan for this change WILL show a destroy/create pair on
  # this account and both model deployments. That is expected and safe: the
  # account is stateless, and functions/src/lib/openai-client.js has zero
  # importers, so no runtime path exists to break. The endpoint moves from
  # the regional URL to https://<subdomain>.openai.azure.com/.
  custom_subdomain_name = "oai-${var.workload_name}-${var.environment}-${var.region_abbreviation}"

  # Keys off, permanently. The only consumers this account will ever have
  # authenticate as the Function App's managed identity (role below). Note:
  # the OPENAI_API_KEY app setting in main.tf is the OpenAI.com SaaS key, a
  # different service — unaffected.
  local_auth_enabled = false

  tags = var.tags
}

# The Function App's managed identity is the account's only data-plane
# caller. Cognitive Services OpenAI User = inference only, no key listing.
resource "azurerm_role_assignment" "func_openai" {
  scope                = azurerm_cognitive_account.openai.id
  role_definition_name = "Cognitive Services OpenAI User"
  principal_id         = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

# Model versions are region-specific AND time-limited: Azure retires a version
# on a published date, after which creating a deployment of it fails with
# ServiceModelDeprecated rather than falling back to a newer one. 2024-05-13
# was retired 2026-03-31 and failed the first apply here.
#
# Check what the region actually offers before changing this:
#   az cognitiveservices model list -l southcentralus \
#     --query "[?model.name=='gpt-4o'].model.version" -o tsv
resource "azurerm_cognitive_deployment" "gpt4o" {
  name                 = "gpt-4o"
  cognitive_account_id = azurerm_cognitive_account.openai.id

  model {
    format  = "OpenAI"
    name    = "gpt-4o"
    version = "2024-11-20" # newest offered in southcentralus, verified 2026-08-19
  }

  sku {
    name     = "Standard"
    capacity = 10
  }
}

# There is deliberately no DALL-E deployment. Image generation goes through the
# OpenAI.com API using the OPENAI_API_KEY app setting (main.tf, sourced from
# Key Vault) — not through this Azure OpenAI account. A dall-e-3 deployment
# here would be a second, unused path to the same capability, and it cannot be
# created in southcentralus anyway: the region offers no DALL-E model at all,
# so the attempt fails with SpecialFeatureOrQuotaIdRequired.
