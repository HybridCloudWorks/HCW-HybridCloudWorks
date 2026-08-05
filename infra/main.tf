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

  # Serverless is NOT only a cost choice here — it is what makes the
  # container-per-collection shape below viable. Read this before changing it.
  #
  # Converting serverless -> provisioned throughput is IRREVERSIBLE, and the
  # documented conversion formula is `RU/s = number of partitions * 5000`. At
  # 66 containers that lands ~330,000 RU/s of manual throughput at once, and
  # even after scaling every container down by hand the floor is 400 RU/s each.
  # A consolidated design (a handful of containers with a type discriminator)
  # would floor roughly an order of magnitude lower.
  #
  # Serverless is also single-region for life: regions cannot be added after
  # account creation, and there is no autoscale.
  #
  # So three irreversible decisions are load-bearing on each other: serverless
  # capacity mode, one container per Firestore collection, and the per-container
  # partition keys. On serverless, empty and idle containers cost nothing, so
  # 66 containers is genuinely free today and keeps the per-container indexing
  # policies and the 1:1 verification story that scripts/verify-migration.mjs
  # is built on.
  #
  # Trigger condition: if multi-region, autoscale, or provisioned throughput is
  # ever required, container consolidation happens in the SAME project, before
  # the capacity-mode change — not after it.
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
# Cosmos DB Containers
#
# The container list is GENERATED from scripts/lib/migration-manifest.mjs, the
# same manifest the migration and verification scripts read. Regenerate with:
#
#     node scripts/generate-cosmos-container-spec.mjs
#
# Do not add containers here by hand — add the collection to the manifest and
# regenerate, or Terraform, the migrator and the verifier drift apart again.
#
# Partition keys come from the manifest: 62 on /id, and four flattened
# subcollections keyed by their parent (content_versions on /contentId,
# image_prompts_sets on /pageId, image_prompt_sets_prompts on /setName,
# listen_and_learn_episodes on /setId).
#
# /id is right for the rest because the Site-Main query load does not group by
# anything — one of ~40 content query sites filters on a provider — and the
# previous "natural" keys were wrong on their own merits: /contentId was written
# as the empty string on every document, /status on lab_jobs is mutable and a
# partition key value cannot be changed in place, and /agentId on lab_agents is
# identical to /id by construction.
#
# The four exceptions are a CORRECTNESS matter, not a tuning one. Each assigns
# document ids that are unique only within their parent (a set name, a prompt
# name, an exam-area slug), so flattening them into one container under /id
# would silently overwrite documents on upsert.
#
# Full evidence, with file:line citations, in the manifest header.
#
# A partition key path is IMMUTABLE. Changing one on a container that already
# holds data means destroying the container and re-importing.
# -----------------------------------------------------------------------------

locals {
  cosmos_container_spec = jsondecode(file("${path.module}/cosmos-containers.json"))
  cosmos_containers     = { for c in local.cosmos_container_spec.containers : c.name => c }
}

resource "azurerm_cosmosdb_sql_container" "hcw" {
  for_each = local.cosmos_containers

  name                = each.value.name
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = [each.value.partition_key_path]

  indexing_policy {
    indexing_mode = "consistent"

    dynamic "included_path" {
      for_each = each.value.included_paths
      content {
        path = included_path.value
      }
    }

    dynamic "excluded_path" {
      for_each = each.value.excluded_paths
      content {
        path = excluded_path.value
      }
    }

    # Transcribed from Site-Main's firestore.indexes.json. Cosmos REQUIRES a
    # composite index for an ORDER BY over two or more properties — without one
    # the query fails rather than running slowly.
    dynamic "composite_index" {
      for_each = each.value.composite_indexes
      content {
        dynamic "index" {
          for_each = composite_index.value
          content {
            path  = index.value.path
            order = index.value.order
          }
        }
      }
    }
  }
}

# -----------------------------------------------------------------------------
# State moves for the containers that were previously declared individually.
#
# These keep Terraform from reading the for_each block as thirteen deletions
# plus seventy-one creations. Note that `content`, `blogs`, `certifications`,
# `lab_jobs`, `lab_agents`, `generated_content_images` and `audits` also change
# partition key, which forces replacement after the move — safe only while the
# containers are empty. Run this BEFORE importing any data.
#
# `dashboard_stats` and `users` are intentionally absent: neither collection
# exists in Site-Main, so both are destroyed rather than moved.
# -----------------------------------------------------------------------------

moved {
  from = azurerm_cosmosdb_sql_container.content
  to   = azurerm_cosmosdb_sql_container.hcw["content"]
}

moved {
  from = azurerm_cosmosdb_sql_container.blogs
  to   = azurerm_cosmosdb_sql_container.hcw["blogs"]
}

moved {
  from = azurerm_cosmosdb_sql_container.certifications
  to   = azurerm_cosmosdb_sql_container.hcw["certifications"]
}

moved {
  from = azurerm_cosmosdb_sql_container.speakerevents
  to   = azurerm_cosmosdb_sql_container.hcw["speakerevents"]
}

moved {
  from = azurerm_cosmosdb_sql_container.lab_jobs
  to   = azurerm_cosmosdb_sql_container.hcw["lab_jobs"]
}

moved {
  from = azurerm_cosmosdb_sql_container.lab_agents
  to   = azurerm_cosmosdb_sql_container.hcw["lab_agents"]
}

moved {
  from = azurerm_cosmosdb_sql_container.config
  to   = azurerm_cosmosdb_sql_container.hcw["config"]
}

moved {
  from = azurerm_cosmosdb_sql_container.image_prompts
  to   = azurerm_cosmosdb_sql_container.hcw["image_prompts"]
}

moved {
  from = azurerm_cosmosdb_sql_container.generated_content_images
  to   = azurerm_cosmosdb_sql_container.hcw["generated_content_images"]
}

moved {
  from = azurerm_cosmosdb_sql_container.workflow_digests
  to   = azurerm_cosmosdb_sql_container.hcw["workflow_digests"]
}

moved {
  from = azurerm_cosmosdb_sql_container.audits
  to   = azurerm_cosmosdb_sql_container.hcw["audits"]
}

# =============================================================================
# Azure Storage Account (replaces Firebase Cloud Storage / GCS)
#
# Hot tier for frequently accessed blog covers, cert badges, AI images.
# LRS (locally redundant) — sufficient for a single-region deployment.
# =============================================================================
resource "azurerm_storage_account" "hcw" {
  name                            = var.storage_account_name
  resource_group_name             = azurerm_resource_group.hcw.name
  location                        = azurerm_resource_group.hcw.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  account_kind                    = "StorageV2"
  access_tier                     = "Hot"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false # account-level public access off; containers opt-in below

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

  network_rules {
    default_action             = "Deny"
    bypass                     = ["AzureServices"]
    virtual_network_subnet_ids = [azurerm_subnet.functions_integration.id]
  }

  tags = var.tags
}

# Blob containers — account-level public access is OFF (set above)
# Only media containers explicitly serving public assets have container_access_type = "blob"
resource "azurerm_storage_container" "blogs" {
  name                  = "blogs"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "blob" # public read: blog cover images served directly
}

resource "azurerm_storage_container" "covers" {
  name                  = "covers"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "blob" # public read: content cover images
}

resource "azurerm_storage_container" "certifications" {
  name                  = "certifications"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "blob" # public read: certification badge images
}

resource "azurerm_storage_container" "speakerevents" {
  name                  = "speakerevents"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "private" # private: event assets served via API
}

resource "azurerm_storage_container" "content" {
  name                  = "content"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "private" # private: raw content assets, not public
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
# Workload VNet + Flex Consumption integration subnet
#
# Flex Consumption requires a /27 minimum subnet delegated to
# Microsoft.App/environments. /24 leaves room for growth.
# Service firewalls on Cosmos, Storage, and Key Vault are scoped
# to this subnet's CIDR (ADR-001, 2026-07-30).
# =============================================================================
resource "azurerm_virtual_network" "hcw" {
  name                = "${var.project_name}-vnet-${var.environment}"
  location            = azurerm_resource_group.hcw.location
  resource_group_name = azurerm_resource_group.hcw.name
  address_space       = [var.vnet_address_space]
  tags                = var.tags
}

resource "azurerm_subnet" "functions_integration" {
  name                 = "snet-functions-integration"
  resource_group_name  = azurerm_resource_group.hcw.name
  virtual_network_name = azurerm_virtual_network.hcw.name
  address_prefixes     = [var.functions_subnet_prefix]

  delegation {
    name = "flex-consumption"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/action"]
    }
  }
}


resource "azurerm_storage_account" "functions" {
  name                     = "${replace(var.project_name, "-", "")}funcsa"
  resource_group_name      = azurerm_resource_group.hcw.name
  location                 = azurerm_resource_group.hcw.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
  tags                     = var.tags
}

resource "azurerm_service_plan" "hcw" {
  name                = "${var.project_name}-asp-${var.environment}"
  location            = azurerm_resource_group.hcw.location
  resource_group_name = azurerm_resource_group.hcw.name
  os_type             = "Linux"
  sku_name            = "FC1" # Flex Consumption — VNet integration, scales to zero
  tags                = var.tags
}

resource "azurerm_linux_function_app" "hcw" {
  name                          = var.function_app_name
  location                      = azurerm_resource_group.hcw.location
  resource_group_name           = azurerm_resource_group.hcw.name
  service_plan_id               = azurerm_service_plan.hcw.id
  storage_account_name          = azurerm_storage_account.functions.name
  storage_uses_managed_identity = true # no static storage key

  virtual_network_subnet_id = azurerm_subnet.functions_integration.id

  site_config {
    application_stack {
      node_version = "22"
    }

    cors {
      allowed_origins = [
        "https://${var.domain}",
        "https://www.${var.domain}",
        "http://localhost:5173",
        "http://localhost:4173",
      ]
      support_credentials = true
    }

    application_insights_connection_string = azurerm_application_insights.hcw.connection_string
    application_insights_key               = azurerm_application_insights.hcw.instrumentation_key
  }

  app_settings = {
    # Cosmos DB — endpoint only; runtime auth uses managed identity via DefaultAzureCredential
    "COSMOS_ENDPOINT" = azurerm_cosmosdb_account.hcw.endpoint
    "COSMOS_DATABASE" = azurerm_cosmosdb_sql_database.hcw.name
    # COSMOS_CONNECTION_STRING is required by the Cosmos DB change-feed trigger binding
    # See: https://learn.microsoft.com/azure/azure-functions/functions-bindings-cosmosdb-v2
    "COSMOS_CONNECTION_STRING" = azurerm_cosmosdb_account.hcw.primary_sql_connection_string

    "STORAGE_ACCOUNT_NAME"   = azurerm_storage_account.hcw.name
    "STORAGE_BLOB_ENDPOINT"  = azurerm_storage_account.hcw.primary_blob_endpoint
    "STORAGE_QUEUE_ENDPOINT" = azurerm_storage_account.hcw.primary_queue_endpoint
    "KEY_VAULT_URI"          = azurerm_key_vault.hcw.vault_uri

    "ENTRA_TENANT_ID" = var.entra_tenant_id
    "ENTRA_CLIENT_ID" = var.entra_client_id

    "WEBSITE_RUN_FROM_PACKAGE" = "1"
    "FUNCTIONS_WORKER_RUNTIME" = "node"
    "NODE_ENV"                 = "production"

    # Feature flags — set to "true" in TF Cloud vars once business logic is ported
    "FEATURE_FLAG_SCHEDULERS" = "false"
  }

  identity {
    type = "SystemAssigned"
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# RBAC — Function App managed identity data-plane roles (no static keys)
# ---------------------------------------------------------------------------

# Cosmos DB data-plane access is NOT Azure RBAC. "Cosmos DB Built-in Data
# Contributor" lives in the account's own sqlRoleDefinitions namespace, not in
# Microsoft.Authorization/roleDefinitions, so `azurerm_role_assignment` cannot
# resolve it by name — the apply fails with "role definition not found", and
# even if it resolved it would not grant data-plane access.
#
# functions/src/lib/cosmos-client.js authenticates with DefaultAzureCredential
# and no key, so without this assignment every Cosmos operation returns 403.
# That is currently masked by COSMOS_CONNECTION_STRING in app settings, which
# carries the primary key and keeps the trigger binding working while the
# client would not.
#
# 00000000-0000-0000-0000-000000000002 is the built-in Data Contributor role.
#
# `name` is deliberately omitted — the provider generates a GUID and keeps it
# stable in state. Hardcoding one is ForceNew, occupies an address we do not
# own, and invites the copy-paste failure when a second identity (the VPS
# agent) needs an assignment: ARM treats a PUT on an existing assignment name
# as a replace, so a duplicated name silently REMOVES the Function App's
# access rather than erroring.
resource "azurerm_cosmosdb_sql_role_assignment" "func_cosmos" {
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  role_definition_id  = "${azurerm_cosmosdb_account.hcw.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_linux_function_app.hcw.identity[0].principal_id
  scope               = azurerm_cosmosdb_account.hcw.id
}

resource "azurerm_role_assignment" "func_blob" {
  scope                = azurerm_storage_account.hcw.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_function_app.hcw.identity[0].principal_id
}

resource "azurerm_role_assignment" "func_queue" {
  scope                = azurerm_storage_account.hcw.id
  role_definition_name = "Storage Queue Data Contributor"
  principal_id         = azurerm_linux_function_app.hcw.identity[0].principal_id
}

# Host storage access for Flex Consumption managed-identity mode
resource "azurerm_role_assignment" "func_host_storage" {
  scope                = azurerm_storage_account.functions.id
  role_definition_name = "Storage Blob Data Owner"
  principal_id         = azurerm_linux_function_app.hcw.identity[0].principal_id
}

# =============================================================================
# Azure Key Vault — RBAC mode (access policies removed)
#
# enable_rbac_authorization = true replaces access policies.
# Roles: Key Vault Secrets User (read) for Function App MI,
#        Key Vault Secrets Officer (write) for Terraform executor.
# =============================================================================
resource "azurerm_key_vault" "hcw" {
  name                       = var.key_vault_name
  location                   = azurerm_resource_group.hcw.location
  resource_group_name        = azurerm_resource_group.hcw.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  soft_delete_retention_days = 90
  purge_protection_enabled   = var.purge_protection_enabled
  rbac_authorization_enabled = true

  network_acls {
    default_action             = "Deny"
    bypass                     = "AzureServices"
    virtual_network_subnet_ids = [azurerm_subnet.functions_integration.id]
  }

  tags = var.tags
}

# Key Vault Secrets User — Function App managed identity (read-only at runtime)
resource "azurerm_role_assignment" "func_kv_secrets" {
  scope                = azurerm_key_vault.hcw.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_function_app.hcw.identity[0].principal_id
}

# Key Vault Secrets Officer — Terraform executor (write during CI/CD secret seeding)
resource "azurerm_role_assignment" "terraform_kv_secrets" {
  scope                = azurerm_key_vault.hcw.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

# =============================================================================
# Budget Alert (replaces GCP billing export + budget alert)
# =============================================================================
resource "azurerm_consumption_budget_resource_group" "hcw" {
  name              = "${var.project_name}-monthly-budget"
  resource_group_id = azurerm_resource_group.hcw.id
  amount            = var.budget_amount_usd
  time_grain        = "Monthly"

  time_period {
    start_date = "2026-07-01T00:00:00Z"
  }

  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThanOrEqualTo"
    contact_emails = [var.budget_alert_email]
  }

  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThanOrEqualTo"
    contact_emails = [var.budget_alert_email]
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    contact_emails = [var.budget_alert_email]
  }
}

# Change feed lease container — explicit so it has a controlled partition key
# and is tracked in state (not auto-created by the SDK at runtime)
resource "azurerm_cosmosdb_sql_container" "leases" {
  name                = "leases"
  resource_group_name = azurerm_resource_group.hcw.name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/id"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
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
