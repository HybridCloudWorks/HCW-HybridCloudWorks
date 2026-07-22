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
  
  tags = var.tags
}

resource "azurerm_cognitive_deployment" "gpt4o" {
  name                 = "gpt-4o"
  cognitive_account_id = azurerm_cognitive_account.openai.id

  model {
    format  = "OpenAI"
    name    = "gpt-4o"
    version = "2024-05-13" # Or whatever latest version is available in eastus2
  }

  scale {
    type     = "Standard"
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

  scale {
    type     = "Standard"
    capacity = 1
  }
}
