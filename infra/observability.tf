# =============================================================================
# observability.tf — the plan's operational alarm fabric (TODO T-505)
#
# Action group + diagnostic settings. Alert *rules* (error rate, queue age)
# deliberately follow later — per T-505's contract they need the action group
# to exist first, and each rule should land with the evidence that motivated
# its threshold.
#
# Ingestion from every diagnostic setting here lands in the Log Analytics
# workspace, which carries a 0.25 GB/day cap (main.tf). The cap is the cost
# ceiling for this whole file: if it trips, prune categories (Cosmos
# DataPlaneRequests first) rather than raising it reflexively.
# =============================================================================

# One ops action group; the budget and future alert rules all route here so
# changing who gets paged is one edit, not five.
resource "azurerm_monitor_action_group" "ops" {
  # Follows its resource group into the Management subscription — without the
  # alias the ARM call goes to the application subscription and fails with
  # ResourceGroupNotFound.
  provider = azurerm.mgmt

  name                = "ag-plat-${var.environment}-${var.region_abbreviation}"
  resource_group_name = azurerm_resource_group.platform_mgmt.name
  short_name          = "hcw-ops"

  email_receiver {
    name                    = "ops-email"
    email_address           = var.budget_alert_email
    use_common_alert_schema = true
  }

  tags = var.tags
}

# Key Vault — who touched the vault. AuditEvent is the category the plan
# names; it is low-volume and high-value.
resource "azurerm_monitor_diagnostic_setting" "key_vault" {
  name                       = "diag-kv-to-logs"
  target_resource_id         = azurerm_key_vault.hcw.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.hcw.id

  enabled_log {
    category = "AuditEvent"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}

# Cosmos — the four categories from the approved plan. DataPlaneRequests is
# the volume risk under the daily cap; it is also the only record of who read
# what once the firewall (main.tf) narrows the callers.
resource "azurerm_monitor_diagnostic_setting" "cosmos" {
  name                           = "diag-cosmos-to-logs"
  target_resource_id             = azurerm_cosmosdb_account.hcw.id
  log_analytics_workspace_id     = azurerm_log_analytics_workspace.hcw.id
  log_analytics_destination_type = "Dedicated"

  enabled_log {
    category = "DataPlaneRequests"
  }

  enabled_log {
    category = "ControlPlaneRequests"
  }

  enabled_log {
    category = "QueryRuntimeStatistics"
  }

  enabled_log {
    category = "PartitionKeyRUConsumption"
  }
}

# Content storage, blob service — read/write/delete against the media the
# Function App serves publicly. Logged at the blob sub-resource because the
# account level only exposes metrics.
resource "azurerm_monitor_diagnostic_setting" "content_blob" {
  name                       = "diag-content-blob-to-logs"
  target_resource_id         = "${azurerm_storage_account.hcw.id}/blobServices/default"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.hcw.id

  enabled_log {
    category = "StorageRead"
  }

  enabled_log {
    category = "StorageWrite"
  }

  enabled_log {
    category = "StorageDelete"
  }

  enabled_metric {
    category = "Transaction"
  }
}

# Azure OpenAI — audit and request/response, per the plan's diagnostics list.
# Volume is bounded by the account's own tiny deployment capacity.
resource "azurerm_monitor_diagnostic_setting" "openai" {
  name                       = "diag-openai-to-logs"
  target_resource_id         = azurerm_cognitive_account.openai.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.hcw.id

  enabled_log {
    category = "Audit"
  }

  enabled_log {
    category = "RequestResponse"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}
