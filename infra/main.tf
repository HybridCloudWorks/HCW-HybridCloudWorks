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

  # This account holds all migrated production data. A plan that wants to
  # replace it must fail until a human removes this guard in a reviewed PR.
  lifecycle {
    prevent_destroy = true
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

  # null = retain forever. Set on the rate-limit counters and caches, which are
  # worthless after their window and would otherwise be retained and indexed
  # indefinitely. Unlike partition_key_paths this is mutable after creation.
  default_ttl = each.value.default_ttl

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
  name                     = var.storage_account_name
  resource_group_name      = azurerm_resource_group.hcw.name
  location                 = azurerm_resource_group.hcw.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"
  access_tier              = "Hot"
  min_tls_version          = "TLS1_2"
  # Master override, not a default. With this false, a container declared
  # `container_access_type = "blob"` still answers 409 to an anonymous reader —
  # containers CANNOT opt in above it. Combined with the Deny network rule
  # below, nothing in this account is reachable from the internet, by design.
  # Public media is served through the Function App's identity at
  # `GET /api/public/media/{container}/{*path}` (functions/src/lib/public-media.js).
  allow_nested_items_to_be_public = false

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

  # Holds all migrated production media. Same guard rationale as the Cosmos
  # account: replacement must be an explicit, reviewed decision.
  lifecycle {
    prevent_destroy = true
  }

  tags = var.tags
}

# Blob containers — every one private, because the account override above means
# every one IS private regardless of what is written here. Declaring three of
# them "blob" described an access model that did not exist and could not be
# reached, and it is the kind of drift that gets read as an audit finding.
#
# The three media containers are served anonymously through the Function App at
# `GET /api/public/media/{container}/{*path}`; the allowlist that decides which
# ones lives in functions/src/lib/blob-paths.js (PUBLIC_MEDIA_CONTAINERS) and
# must be kept in step with the comments here.
resource "azurerm_storage_container" "blogs" {
  name                  = "blogs"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "private" # blog cover images, served via the media route
}

resource "azurerm_storage_container" "covers" {
  name                  = "covers"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "private" # content cover images, served via the media route
}

resource "azurerm_storage_container" "certifications" {
  name                  = "certifications"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "private" # certification badges, served via the media route
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

  # REQUIRED for the Key Vault network rule below to have any effect.
  #
  # azurerm_key_vault.hcw sets network_acls.default_action = "Deny" and allows
  # this subnet via virtual_network_subnet_ids. A Key Vault VNet rule only
  # grants access when the subnet carries the Microsoft.KeyVault service
  # endpoint — without it the rule is inert and the vault denies the Function
  # App as well as everyone else.
  #
  # The failure mode is quiet: the app deploys clean, then its
  # @Microsoft.KeyVault(...) app-setting references fail to resolve and
  # getSecret() returns nothing, so a missing credential looks like missing
  # data rather than a network denial.
  service_endpoints = ["Microsoft.KeyVault"]

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

  # Function host state and release packages live here; replacing it takes the
  # API down until a redeploy. Guarded like the other stateful accounts.
  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_service_plan" "hcw" {
  name                = "${var.project_name}-asp-${var.environment}"
  location            = azurerm_resource_group.hcw.location
  resource_group_name = azurerm_resource_group.hcw.name
  os_type             = "Linux"
  sku_name            = "FC1" # Flex Consumption — VNet integration, scales to zero
  tags                = var.tags
}

# Deployment container for Flex Consumption.
#
# Flex does not use WEBSITE_RUN_FROM_PACKAGE; the platform pulls the deployment
# package from a blob container named in functionAppConfig.deployment. Nothing
# else in this file provided one — the containers above are CONTENT containers
# on the other storage account.
resource "azurerm_storage_container" "function_releases" {
  name                  = "function-releases"
  storage_account_id    = azurerm_storage_account.functions.id
  container_access_type = "private"
}

# =============================================================================
# Function App — Flex Consumption
#
# This MUST be azurerm_function_app_flex_consumption, not
# azurerm_linux_function_app. Flex is configured through
# properties.functionAppConfig (runtime, deployment storage, scaleAndConcurrency)
# and azurerm_linux_function_app does not emit that block, so pairing it with an
# FC1 plan fails at apply with:
#
#   Site.FunctionAppConfig is invalid. The FunctionAppConfig section was not
#   specified in the request, which is required for Flex Consumption sites.
#
# `terraform validate` does NOT catch this — it checks schema, not provider/API
# compatibility — so the previous config validated cleanly while being
# undeployable.
#
# Deliberately absent, all unsupported on Flex:
#   - site_config.application_stack.node_version  (maps to LinuxFxVersion)
#   - WEBSITE_RUN_FROM_PACKAGE                    (Flex uses the deployment container)
#   - FUNCTIONS_WORKER_RUNTIME                    (replaced by runtime_name)
#   - the platform `cors` block                   (see DECISION 7 below)
# =============================================================================
resource "azurerm_function_app_flex_consumption" "hcw" {
  name                = var.function_app_name
  location            = azurerm_resource_group.hcw.location
  resource_group_name = azurerm_resource_group.hcw.name
  service_plan_id     = azurerm_service_plan.hcw.id

  storage_container_type      = "blobContainer"
  storage_container_endpoint  = "${azurerm_storage_account.functions.primary_blob_endpoint}${azurerm_storage_container.function_releases.name}"
  storage_authentication_type = "SystemAssignedIdentity" # no static storage key

  runtime_name    = "node"
  runtime_version = "22"

  virtual_network_subnet_id = azurerm_subnet.functions_integration.id

  # DECISION 6 — bearer tokens must not traverse plaintext, and the origin has
  # to be unreachable except through Cloudflare before CF-Connecting-IP means
  # anything. functions/src/lib/auth/client-identity.js fails closed in
  # production until CF_ORIGIN_SECRET is set, precisely so rate limiting cannot
  # silently degrade to trusting a spoofable header.
  https_only = true

  # ---------------------------------------------------------------------------
  # Scale — every one of these was a silent platform default before.
  # ---------------------------------------------------------------------------

  # 2048 MB, down from the 4 GiB the Firebase functions declared. That pin
  # existed solely to survive JSON.parse of a 458 MiB AWS offer document; the
  # Price List Query API returns ~1 KB, and the full eight-service sweep across
  # all three providers now runs in 18.8 MB. Instance memory on Flex is
  # per-APP, not per-function, so this applies to every function here.
  instance_memory_in_mb = 2048

  # Bounded deliberately. getToolComparisonData is public and unauthenticated,
  # so an unbounded default turns a traffic spike into unbounded GB-seconds.
  maximum_instance_count = 20

  # Always-ready is deliberately NOT configured, which means zero — the default.
  # It is the single largest cost line available on this plan: one always-ready
  # 2048 MB instance is roughly $20/month whether or not anything executes,
  # against a USD 150 ceiling for the whole platform. Enabling zone redundancy
  # later forces a minimum of two, so revisit both together and only after
  # cold-start latency on getToolComparisonData has actually been measured.

  site_config {
    application_insights_connection_string = azurerm_application_insights.hcw.connection_string
    application_insights_key               = azurerm_application_insights.hcw.instrumentation_key

    # DECISION 7 — CORS is handled in code
    # (functions/src/lib/auth/cors.js), not here.
    #
    # Two allowlists drift, and when a request is rejected you cannot tell which
    # one did it. The in-code version also returns 403 on a disallowed origin
    # (matching Site-Main's applyCors) rather than silently omitting the header,
    # and can express any localhost port rather than the two hardcoded here.
    #
    # support_credentials = true was additionally wrong on its own merits: it
    # makes the platform intercept OPTIONS preflights itself, so the in-code
    # preflight would never run — and this is a bearer-token API, not a cookie
    # API.
  }

  app_settings = {
    # Cosmos DB — endpoint only; runtime auth uses managed identity via DefaultAzureCredential
    "COSMOS_ENDPOINT" = azurerm_cosmosdb_account.hcw.endpoint
    "COSMOS_DATABASE" = azurerm_cosmosdb_sql_database.hcw.name
    # COSMOS_CONNECTION_STRING is deliberately absent (TODO.md T-315).
    #
    # It carried the account PRIMARY KEY — readable by anyone with Contributor on
    # the resource group, and present in Terraform state — and existed solely for
    # the Cosmos change-feed trigger binding, whose two handlers were empty TODOs
    # that nonetheless ran continuously and billed lease-container RU. The
    # handlers and their registrations are gone, so the setting has nothing left
    # to serve.
    #
    # When change-feed triggers return, use the identity-based binding form
    # rather than reinstating this:
    #   COSMOS_CONNECTION__accountEndpoint = azurerm_cosmosdb_account.hcw.endpoint
    #   COSMOS_CONNECTION__credential      = "managedidentity"
    # See https://learn.microsoft.com/azure/azure-functions/functions-bindings-cosmosdb-v2

    "STORAGE_ACCOUNT_NAME"   = azurerm_storage_account.hcw.name
    "STORAGE_BLOB_ENDPOINT"  = azurerm_storage_account.hcw.primary_blob_endpoint
    "STORAGE_QUEUE_ENDPOINT" = azurerm_storage_account.hcw.primary_queue_endpoint
    "KEY_VAULT_URI"          = azurerm_key_vault.hcw.vault_uri

    "ENTRA_TENANT_ID" = var.entra_tenant_id
    # The API's OWN audience, not the SPA's client id. verify-token.js refuses to
    # start without it — an unset audience makes jsonwebtoken SKIP the audience
    # check entirely rather than fail, which accepts any token in the tenant.
    "ENTRA_API_AUDIENCE" = var.entra_api_audience

    # AWS pricing — Key Vault references, so process.env reads stay identical to
    # the Firebase defineSecret originals. Key Vault secret names cannot contain
    # underscores. Scope the IAM policy to pricing:GetProducts only.
    "AWS_ACCESS_KEY_ID"     = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/AWS-ACCESS-KEY-ID)"
    "AWS_SECRET_ACCESS_KEY" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/AWS-SECRET-ACCESS-KEY)"

    # GCP's service-account JSON is deliberately NOT here — it is a ~2.3 KB
    # multi-line blob and app settings are visible in the portal and in
    # `az webapp config appsettings list`. gcp.js reads it from Key Vault at
    # runtime via src/lib/key-vault.js.

    # DECISION 6 — proves a request arrived through Cloudflare rather than
    # directly at the origin. Without it client-identity.js refuses to derive a
    # rate-limit key in production.
    "CF_ORIGIN_SECRET" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/CF-ORIGIN-SECRET)"
    "CLIENT_IP_SALT"   = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/CLIENT-IP-SALT)"

    # -------------------------------------------------------------------------
    # Ported Firebase defineSecret bindings.
    #
    # Site-Main's functions/ declares 18 defineSecret bindings; before this block
    # exactly two of them (the AWS pair above) existed here. The other sixteen
    # had nowhere to land, which is a failure that deploys green: a handler
    # reaching for an unbound secret dies on first invocation in production, and
    # no test reproduces it because no test binds secrets.
    #
    # Names follow the established pattern — the app setting keeps the
    # underscored name so `process.env.X` reads port unchanged, and the Key Vault
    # secret uses hyphens because Key Vault names cannot contain underscores.
    #
    # These resolve to empty until the vault is seeded (Review.md §4.2). That is
    # safe today because the handlers are still stubs; it must be done before
    # FEATURE_FLAG_SCHEDULERS goes true or any CMS handler is ported.
    # -------------------------------------------------------------------------

    # AI generation — content drafting, scoring and image pipelines.
    "ANTHROPIC_API_KEY"  = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/ANTHROPIC-API-KEY)"
    "OPENAI_API_KEY"     = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/OPENAI-API-KEY)"
    "PERPLEXITY_API_KEY" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/PERPLEXITY-API-KEY)"
    "REPLICATE_API_KEY"  = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/REPLICATE-API-KEY)"

    # Ingestion and enrichment.
    "FIRECRAWL_API_KEY" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/FIRECRAWL-API-KEY)"
    "LINKIE_API_KEY"    = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/LINKIE-API-KEY)"
    "YOUTUBE_API_KEY"   = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/YOUTUBE-API-KEY)"

    # Social scheduling (Publer) and newsletter (Klaviyo). The WORKSPACE_ID and
    # LIST_ID are identifiers rather than credentials, but they travel with their
    # key and are pointless to split across two storage mechanisms.
    "PUBLER_API_KEY"      = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/PUBLER-API-KEY)"
    "PUBLER_WORKSPACE_ID" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/PUBLER-WORKSPACE-ID)"
    "KLAVIYO_PRIVATE_KEY" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/KLAVIYO-PRIVATE-KEY)"
    "KLAVIYO_LIST_ID"     = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/KLAVIYO-LIST-ID)"

    # Telegram notifications.
    "TELEGRAM_BOT_TOKEN" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/TELEGRAM-BOT-TOKEN)"
    "TELEGRAM_CHAT_ID"   = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/TELEGRAM-CHAT-ID)"

    # Site rebuild trigger (GitHub App) and VPS control (Hostinger).
    "GITHUB_APP_INSTALLATION_ID" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/GITHUB-APP-INSTALLATION-ID)"
    "HOSTINGER_API_TOKEN"        = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/HOSTINGER-API-TOKEN)"

    # GITHUB_APP_PRIVATE_KEY is deliberately NOT here, for the same reason as the
    # GCP service-account JSON above: it is a multi-line RSA PEM, and app
    # settings are visible in the portal and in
    # `az webapp config appsettings list`. It is signed into a JWT
    # (Site-Main cms-functions.js:3880 → getGithubAppInstallationToken), so it
    # must be read from Key Vault at runtime via src/lib/key-vault.js under the
    # name GITHUB-APP-PRIVATE-KEY.

    "NODE_ENV" = "production"

    # Feature flags.
    #
    # One per timer. They previously shared FEATURE_FLAG_SCHEDULERS, so enabling
    # the scheduled publisher would also have armed cleanupTempStorage — an
    # unimplemented TODO that deletes blobs (TODO.md T-302).
    #
    # FEATURE_FLAG_SCHEDULERS is now a master kill switch only: "false" holds
    # every timer off regardless of the individual flags, and any other value
    # defers to them. Set an individual flag to "true" once that timer's logic
    # is ported and reviewed.
    "FEATURE_FLAG_SCHEDULERS" = "false"

    # The only one implemented. Publishes content whose scheduledPublishDate has
    # come due, through the same pipeline the operator's Publish button uses.
    "FEATURE_FLAG_PUBLISH_SCHEDULED_CONTENT" = "false"

    # Unimplemented TODOs. Do not set to "true".
    "FEATURE_FLAG_SYNC_RSS_FEEDS"       = "false"
    "FEATURE_FLAG_CLEANUP_TEMP_STORAGE" = "false"
    "FEATURE_FLAG_CHECK_AGENT_HEALTH"   = "false"
  }

  identity {
    type = "SystemAssigned"
  }

  tags = var.tags
}

# NOTE: there is deliberately NO `moved` block from
# azurerm_linux_function_app.hcw. A moved block requires the two addresses to be
# the same resource TYPE, and these are different types. If the old resource is
# ever in state it must be removed with `terraform state rm` before applying —
# but it cannot be, because that configuration could never have applied against
# an FC1 plan in the first place.

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
#
# Nothing masks that any more. COSMOS_CONNECTION_STRING used to sit in app
# settings carrying the primary key, which kept the change-feed trigger binding
# working while every SDK call failed — so a broken role assignment would have
# looked like a partially working app. Both are gone (TODO.md T-315): this
# assignment is now the only thing standing between the app and a uniform 403,
# which is the failure mode you want, because it is unambiguous.
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
  principal_id        = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
  scope               = azurerm_cosmosdb_account.hcw.id
}

resource "azurerm_role_assignment" "func_blob" {
  scope                = azurerm_storage_account.hcw.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

resource "azurerm_role_assignment" "func_queue" {
  scope                = azurerm_storage_account.hcw.id
  role_definition_name = "Storage Queue Data Contributor"
  principal_id         = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

# Required to mint user-delegation SAS tokens (blob-storage.js generateSasUrl).
# Storage Blob Data Contributor cannot call getUserDelegationKey; without this
# the failure is a 403 at signing time, which reads as a bug rather than as a
# missing role. Narrower than it looks: it grants only the delegation key, and
# the resulting SAS can never exceed the identity's own data-plane permissions.
resource "azurerm_role_assignment" "func_blob_delegator" {
  scope                = azurerm_storage_account.hcw.id
  role_definition_name = "Storage Blob Delegator"
  principal_id         = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

# Host storage access for Flex Consumption managed-identity mode
resource "azurerm_role_assignment" "func_host_storage" {
  scope                = azurerm_storage_account.functions.id
  role_definition_name = "Storage Blob Data Owner"
  principal_id         = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
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

  # The Function App reaches the vault over the subnet rule above. Nothing else
  # can — Terraform Cloud's runners are neither in this VNet nor a trusted Azure
  # service, so the Secrets Officer assignment below cannot actually write from
  # a TFC run.
  #
  # admin_ip_rules is how a human seeds the five secrets. Leave it empty and the
  # vault is unreachable by anyone except the app, which is the correct steady
  # state — populate it only for the seeding window. Secret VALUES are
  # deliberately not managed by Terraform, so they never enter state or TFC.
  # See Review.md §4.2 for the runbook.
  network_acls {
    default_action             = "Deny"
    bypass                     = "AzureServices"
    virtual_network_subnet_ids = [azurerm_subnet.functions_integration.id]
    ip_rules                   = var.admin_ip_rules
  }

  # Secrets are seeded by hand and exist nowhere else in managed form.
  # Replacement must be an explicit, reviewed decision.
  lifecycle {
    prevent_destroy = true
  }

  tags = var.tags
}

# Key Vault Secrets User — Function App managed identity (read-only at runtime)
resource "azurerm_role_assignment" "func_kv_secrets" {
  scope                = azurerm_key_vault.hcw.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
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
# and is tracked in state (not auto-created by the SDK at runtime).
#
# Currently unused: the change-feed triggers were removed with their connection
# string (TODO.md T-315), so nothing leases anything. Kept rather than destroyed
# because removing a container is a destructive Terraform change that does not
# belong in a code cleanup, and because it costs only storage on a serverless
# account with no processor polling it.
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
