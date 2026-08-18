# =============================================================================
# Azure Cognitive Services (OpenAI)
#
# Replaces GCP Vertex AI. Provides GPT-4o and DALL-E 3 capabilities.
# Note: Ensure the subscription is approved for Azure OpenAI access.
# =============================================================================
resource "azurerm_cognitive_account" "openai" {
  name                = "${var.project_name}-openai-${var.environment}"
  location            = azurerm_resource_group.hcw.location
  resource_group_name = azurerm_resource_group.hcw.name
  kind                = "OpenAI"
  sku_name            = "S0"

  # T-506: keyless. AAD data-plane auth requires a custom subdomain endpoint,
  # and custom_subdomain_name forces replacement of an account created
  # without one — the plan for this change WILL show a destroy/create pair on
  # this account and both model deployments. That is expected and safe: the
  # account is stateless, and functions/src/lib/openai-client.js has zero
  # importers, so no runtime path exists to break. The endpoint moves from
  # the regional URL to https://<subdomain>.openai.azure.com/.
  custom_subdomain_name = "${var.project_name}-openai-${var.environment}"

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

resource "azurerm_cognitive_deployment" "gpt4o" {
  name                 = "gpt-4o"
  cognitive_account_id = azurerm_cognitive_account.openai.id

  model {
    format  = "OpenAI"
    name    = "gpt-4o"
    version = "2024-05-13" # Or whatever latest version is available in eastus2
  }

  sku {
    name     = "Standard"
    capacity = 10
  }
}

resource "azurerm_cognitive_deployment" "dalle3" {
  name                 = "dall-e-3"
  cognitive_account_id = azurerm_cognitive_account.openai.id

  model {
    format  = "OpenAI"
    name    = "dall-e-3"
    version = "3.0"
  }

  sku {
    name     = "Standard"
    capacity = 1
  }
}
