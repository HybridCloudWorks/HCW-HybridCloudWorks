# =============================================================================
# main.tf — HCW Azure Infrastructure
#
# Manages:
#   - Resource Group
#   - Azure Static Web App (frontend hosting, replaces Firebase Hosting)
#   - Cosmos DB Serverless (database, replaces Cloud Firestore)
#   - Azure Storage Account + containers (replaces Firebase Cloud Storage)
#   - Azure Function App on Consumption plan (replaces Cloud Functions)
#   - Azure Key Vault (replaces GCP Secret Manager)
#   - Application Insights + Log Analytics (observability)
#   - Budget alerts (replaces GCP billing export + budget)
#   - Cloudflare DNS records for Azure services
#
# NOTE: Authentication (Firebase Auth) is retained as-is per the migration
# plan Option A. If migrating to Azure AD B2C in the future, add the
# azuread provider and B2C tenant resource here.
# =============================================================================

data "azurerm_client_config" "current" {}

# =============================================================================
# Resource Group
# =============================================================================
resource "azurerm_resource_group" "hcw" {
  name     = var.resource_group_name
  location = var.azure_location
  tags     = var.tags
}

# =============================================================================
# Log Analytics Workspace (required by Application Insights)
# =============================================================================
resource "azurerm_log_analytics_workspace" "hcw" {
  name                = "${var.project_name}-logs-${var.environment}"
  location            = azurerm_resource_group.hcw.location
  resource_group_name = azurerm_resource_group.hcw.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = var.tags
}

# =============================================================================
# Application Insights (replaces Cloud Logging + Firebase Performance)
# =============================================================================
resource "azurerm_application_insights" "hcw" {
  name                = "${var.project_name}-appinsights-${var.environment}"
  location            = azurerm_resource_group.hcw.location
  resource_group_name = azurerm_resource_group.hcw.name
  workspace_id        = azurerm_log_analytics_workspace.hcw.id
  application_type    = "Node.JS"
  tags                = var.tags
}

# =============================================================================
# Azure Static Web App (replaces Firebase Hosting)
#
# Standard tier provides:
#   - Custom domain with free managed SSL
#   - Global CDN (Azure Front Door backbone)
#   - SPA routing (navigationFallback in staticwebapp.config.json)
#   - Staging environments (preview on PRs)
#   - 100 GB bandwidth/month included
# =============================================================================
resource "azurerm_static_web_app" "hcw" {
  name                = "${var.project_name}-swa-${var.environment}"
  location            = azurerm_resource_group.hcw.location
  resource_group_name = azurerm_resource_group.hcw.name
  sku_tier            = "Standard"
  sku_size            = "Standard"
  tags                = var.tags
}

# =============================================================================
# Cosmos DB Account — Serverless capacity mode, NoSQL (Core/SQL) API
#
# Serverless: pay-per-RU, no provisioned throughput.
# Ideal for variable/low traffic pre-launch workloads.
# Consistency: Session (default, matches Firestore's per-client consistency).
# Single-region: East US 2 (matches us-central1 audience location).
# =============================================================================
resource "azurerm_cosmosdb_account" "hcw" {
  name                = var.cosmos_db_account_name
  location            = azurerm_resource_group.hcw.location
  resource_group_name = azurerm_resource_group.hcw.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  capabilities {
    name = "EnableServerless"
  }

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = azurerm_resource_group.hcw.location
    failover_priority = 0
  }

  tags = var.tags
}

# Cosmos DB SQL Database
resource "azurerm_cosmosdb_sql_database" "hcw" {
  name                = var.project_name
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
}

# -----------------------------------------------------------------------------
# Cosmos DB Containers (1:1 mapping from Firestore collections)
# Partition keys chosen for query efficiency based on existing access patterns.
# -----------------------------------------------------------------------------

resource "azurerm_cosmosdb_sql_container" "content" {
  name                = "content"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/cloudProvider"]

  indexing_policy {
    indexing_mode = "consistent"

    included_path { path = "/contentStatus/?" }
    included_path { path = "/cloudProvider/?" }
    included_path { path = "/fetchedAt/?" }
    included_path { path = "/updatedAt/?" }
    included_path { path = "/publishedAt/?" }
    included_path { path = "/contentType/?" }

    excluded_path { path = "/contentMarkdown/*" }
    excluded_path { path = "/contentHtml/*" }
    excluded_path { path = "/contentPlainText/*" }
    excluded_path { path = "/scraped/*" }
  }
}

resource "azurerm_cosmosdb_sql_container" "blogs" {
  name                = "blogs"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/cloudProvider"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
  }
}

resource "azurerm_cosmosdb_sql_container" "certifications" {
  name                = "certifications"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/issuer"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
  }
}

resource "azurerm_cosmosdb_sql_container" "speakerevents" {
  name                = "speakerevents"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/id"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
  }
}

resource "azurerm_cosmosdb_sql_container" "lab_jobs" {
  name                = "lab_jobs"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/status"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/status/?" }
    included_path { path = "/type/?" }
    included_path { path = "/createdAt/?" }
    included_path { path = "/agentId/?" }
  }
}

resource "azurerm_cosmosdb_sql_container" "lab_agents" {
  name                = "lab_agents"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/agentId"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
  }
}

resource "azurerm_cosmosdb_sql_container" "config" {
  name                = "config"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/id"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
  }
}

resource "azurerm_cosmosdb_sql_container" "dashboard_stats" {
  name                = "dashboard_stats"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/id"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
  }
}

resource "azurerm_cosmosdb_sql_container" "image_prompts" {
  name                = "image_prompts"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/id"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
  }
}

resource "azurerm_cosmosdb_sql_container" "generated_content_images" {
  name                = "generated_content_images"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/contentId"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
  }
}

resource "azurerm_cosmosdb_sql_container" "workflow_digests" {
  name                = "workflow_digests"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/id"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
  }
}

resource "azurerm_cosmosdb_sql_container" "users" {
  name                = "users"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/id"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
  }
}

resource "azurerm_cosmosdb_sql_container" "audits" {
  name                = "audits"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/userId"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/action/?" }
    included_path { path = "/timestamp/?" }
    included_path { path = "/userId/?" }
  }
}

# =============================================================================
# Azure Storage Account (replaces Firebase Cloud Storage / GCS)
#
# Hot tier for frequently accessed blog covers, cert badges, AI images.
# LRS (locally redundant) — sufficient for a single-region deployment.
# =============================================================================
resource "azurerm_storage_account" "hcw" {
  name                     = var.storage_account_name
  resource_group_name      = azurerm_resource_group.hcw.name
  location                 = azurerm_resource_group.hcw.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"
  access_tier              = "Hot"

  blob_properties {
    cors_rule {
      allowed_headers    = ["*"]
      allowed_methods    = ["GET", "HEAD", "OPTIONS"]
      allowed_origins    = ["https://${var.domain}", "https://*.${var.domain}", "http://localhost:*"]
      exposed_headers    = ["Content-Length", "Content-Type"]
      max_age_in_seconds = 3600
    }

    delete_retention_policy {
      days = 7
    }
  }

  tags = var.tags
}

# Blob containers matching Firebase Storage paths
resource "azurerm_storage_container" "blogs" {
  name                  = "blogs"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "blob" # public read for blog covers
}

resource "azurerm_storage_container" "covers" {
  name                  = "covers"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "blob"
}

resource "azurerm_storage_container" "certifications" {
  name                  = "certifications"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "blob"
}

resource "azurerm_storage_container" "speakerevents" {
  name                  = "speakerevents"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "blob"
}

resource "azurerm_storage_container" "content" {
  name                  = "content"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "blob"
}

# Storage lifecycle management (replaces platform/firebase/storage-lifecycle.json)
resource "azurerm_storage_management_policy" "cleanup" {
  storage_account_id = azurerm_storage_account.hcw.id

  rule {
    name    = "cleanup-old-scraped-images"
    enabled = true

    filters {
      prefix_match = ["articles/"]
      blob_types   = ["blockBlob"]
    }

    actions {
      base_blob {
        delete_after_days_since_modification_greater_than = 90
      }
    }
  }
}

# =============================================================================
# Azure Function App — Consumption plan (replaces Cloud Functions v2)
#
# Linux, Node.js 22 runtime.
# Consumption plan: pay per execution, 1M free invocations/month.
# Uses the same Storage Account for function app state.
# =============================================================================

# Dedicated storage account for function app (required by Azure)
resource "azurerm_storage_account" "functions" {
  name                     = "${replace(var.project_name, "-", "")}funcsa"
  resource_group_name      = azurerm_resource_group.hcw.name
  location                 = azurerm_resource_group.hcw.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  tags                     = var.tags
}

resource "azurerm_service_plan" "hcw" {
  name                = "${var.project_name}-asp-${var.environment}"
  location            = azurerm_resource_group.hcw.location
  resource_group_name = azurerm_resource_group.hcw.name
  os_type             = "Linux"
  sku_name            = "Y1" # Consumption plan
  tags                = var.tags
}

resource "azurerm_linux_function_app" "hcw" {
  name                       = var.function_app_name
  location                   = azurerm_resource_group.hcw.location
  resource_group_name        = azurerm_resource_group.hcw.name
  service_plan_id            = azurerm_service_plan.hcw.id
  storage_account_name       = azurerm_storage_account.functions.name
  storage_account_access_key = azurerm_storage_account.functions.primary_access_key

  site_config {
    application_stack {
      node_version = "22"
    }

    cors {
      allowed_origins = [
        "https://${var.domain}",
        "https://www.${var.domain}",
        "http://localhost:5173",  # Vite dev server
        "http://localhost:4173",  # Vite preview
      ]
      support_credentials = true
    }

    application_insights_connection_string = azurerm_application_insights.hcw.connection_string
    application_insights_key               = azurerm_application_insights.hcw.instrumentation_key
  }

  app_settings = {
    "COSMOS_ENDPOINT"                = azurerm_cosmosdb_account.hcw.endpoint
    "COSMOS_DATABASE"                = azurerm_cosmosdb_sql_database.hcw.name
    "COSMOS_KEY"                     = azurerm_cosmosdb_account.hcw.primary_key
    "STORAGE_CONNECTION_STRING"      = azurerm_storage_account.hcw.primary_connection_string
    "STORAGE_ACCOUNT_NAME"           = azurerm_storage_account.hcw.name
    "KEY_VAULT_URI"                  = azurerm_key_vault.hcw.vault_uri
    "WEBSITE_RUN_FROM_PACKAGE"       = "1"
    "FUNCTIONS_WORKER_RUNTIME"       = "node"
    "NODE_ENV"                       = "production"
    # Firebase Auth (Option A — kept for token validation)
    "FIREBASE_PROJECT_ID"            = "hybridcloudworks-61e8d"
  }

  identity {
    type = "SystemAssigned"
  }

  tags = var.tags
}

# Grant Function App access to Key Vault secrets
resource "azurerm_key_vault_access_policy" "function_app" {
  key_vault_id = azurerm_key_vault.hcw.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = azurerm_linux_function_app.hcw.identity[0].principal_id

  secret_permissions = ["Get", "List"]
}

# =============================================================================
# Azure Key Vault (replaces GCP Secret Manager)
#
# Stores: AI API keys, social integration secrets, service credentials.
# Soft-delete enabled (7-day retention for accidental deletion).
# RBAC: Function App gets read-only; CI/CD service principal gets read-write.
# =============================================================================
resource "azurerm_key_vault" "hcw" {
  name                       = var.key_vault_name
  location                   = azurerm_resource_group.hcw.location
  resource_group_name        = azurerm_resource_group.hcw.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  soft_delete_retention_days = 7
  purge_protection_enabled   = false # allow destroy during development

  tags = var.tags
}

# Grant the Terraform executor (CI/CD service principal) full secret access
resource "azurerm_key_vault_access_policy" "terraform" {
  key_vault_id = azurerm_key_vault.hcw.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = data.azurerm_client_config.current.object_id

  secret_permissions = ["Get", "List", "Set", "Delete", "Purge", "Recover"]
}

# =============================================================================
# Budget Alert (replaces GCP billing export + budget alert)
# =============================================================================
resource "azurerm_consumption_budget_resource_group" "hcw" {
  name              = "${var.project_name}-monthly-budget"
  resource_group_id = azurerm_resource_group.hcw.id
  amount            = 250
  time_grain        = "Monthly"

  time_period {
    start_date = "2026-07-01T00:00:00Z"
  }

  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThanOrEqualTo"
    contact_emails = ["saulpatinojr@gmail.com"]
  }

  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThanOrEqualTo"
    contact_emails = ["saulpatinojr@gmail.com"]
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    contact_emails = ["saulpatinojr@gmail.com"]
  }
}

# =============================================================================
# Cloudflare DNS — Azure Static Web App custom domain
#
# The existing root Terraform manages VPS subdomains (api, auth, argocd, etc.).
# This module adds the Azure-specific records. During migration, both Firebase
# and Azure records coexist; the cutover flips the root A/CNAME record.
# =============================================================================

# Azure SWA custom domain validation TXT record
resource "cloudflare_record" "azure_swa_txt_validation" {
  zone_id = var.cloudflare_zone_id
  name    = "@"
  content = azurerm_static_web_app.hcw.default_host_name
  type    = "TXT"
  ttl     = 300
  comment = "Azure Static Web App domain validation"
}

# Azure Functions subdomain (for API calls during migration)
resource "cloudflare_record" "azure_functions" {
  zone_id = var.cloudflare_zone_id
  name    = "api-azure"
  content = "${var.function_app_name}.azurewebsites.net"
  type    = "CNAME"
  proxied = true
  ttl     = 1
  comment = "Azure Functions API endpoint (migration)"
}
