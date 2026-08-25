# =============================================================================
# scratch.tf — legacy rehearsal estate
#
# A second Cosmos account and a second storage account, in their own resource
# group, that exist only while the legacy switches are true. No current
# workflow enables them. Keep these declarations until REVIEW.md records the
# owner-approved state cleanup.
#
# Everything here mirrors production's posture on purpose:
#   - serverless, centralus, Session consistency, the same database name, the
#     same 72 containers from the same generated spec with the same partition
#     keys, TTLs and indexes — so a rehearsal exercises exactly the shape that
#     production has;
#   - keys OFF. A key-authenticated rehearsal passes while proving nothing
#     about DefaultAzureCredential + native RBAC, which is the path production
#     takes. The healer's 2026-08-20 failure ("cannot be authorized by AAD token
#     in data plane") is the class of defect a key would have hidden;
#   - the same firewall shape (Azure datacenter sentinel + operator windows),
#     minus the VNet rule, because nothing in the Functions subnet should ever
#     talk to this account.
#
# And differs in exactly the ways a sandbox should:
#   - its own resource group, so nothing carrying prevent_destroy shares it
#     and teardown is one delete;
#   - NO prevent_destroy — it is meant to be destroyed;
#   - `sbx` in the environment slot (the CAF sandbox token), so a name is never
#     mistaken for production in a log line.
#
# It holds a full copy of production data while on. Flip the variable off to
# destroy the copy; record the intended lifetime on the Phase-4 wiki page.
#
# Cost when on and empty: ~0 (serverless, no RU; 7-day continuous backup is
# free tier). Cost holding the rehearsal data: storage pennies.
# =============================================================================

locals {
  scratch_environment = "sbx"
  scratch_tags = merge(var.tags, {
    environment = local.scratch_environment
    purpose     = "data-migration-rehearsal"
  })
}

resource "azurerm_resource_group" "scratch" {
  count = var.cosmos_scratch_enabled ? 1 : 0

  name     = "rg-db-${var.workload_name}-${local.scratch_environment}-${var.region_abbreviation}"
  location = var.azure_location
  tags     = local.scratch_tags
}

# -----------------------------------------------------------------------------
# Cosmos
# -----------------------------------------------------------------------------

resource "azurerm_cosmosdb_account" "scratch" {
  count = var.cosmos_scratch_enabled ? 1 : 0

  name                = "cosmos-${var.workload_name}-${local.scratch_environment}-${var.region_abbreviation}"
  location            = var.cosmos_location
  resource_group_name = azurerm_resource_group.scratch[0].name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  capabilities {
    name = "EnableServerless"
  }

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = var.cosmos_location
    failover_priority = 0
    zone_redundant    = false
  }

  # Same shape as production minus the VNet rule: the Azure datacenter
  # sentinel admits GitHub-hosted runners, and the SAME operator-window
  # variable admits a laptop — one window opens both accounts.
  is_virtual_network_filter_enabled = true
  ip_range_filter = toset(concat(
    var.cosmos_allow_azure_datacenter_ips ? ["0.0.0.0"] : [],
    var.cosmos_admin_ip_rules,
  ))

  # Keys off — see the header. Not a variable: there is no scenario in which
  # turning keys on here produces a more useful rehearsal.
  local_authentication_enabled = false

  backup {
    type = "Continuous"
    tier = "Continuous7Days"
  }

  tags = local.scratch_tags
}

resource "azurerm_cosmosdb_sql_database" "scratch" {
  count = var.cosmos_scratch_enabled ? 1 : 0

  name                = var.cosmos_database_name
  resource_group_name = azurerm_resource_group.scratch[0].name
  account_name        = azurerm_cosmosdb_account.scratch[0].name
}

# The same for_each, the same spec, the same body as azurerm_cosmosdb_sql_container.hcw
# in main.tf. `leases` is not replicated: the migration never touches it.
resource "azurerm_cosmosdb_sql_container" "scratch" {
  # A filtered comprehension rather than `enabled ? map : {}` — Terraform
  # rejects the conditional because the two arms have different object types.
  for_each = { for k, v in local.cosmos_containers : k => v if var.cosmos_scratch_enabled }

  name                = each.value.name
  resource_group_name = azurerm_resource_group.scratch[0].name
  account_name        = azurerm_cosmosdb_account.scratch[0].name
  database_name       = azurerm_cosmosdb_sql_database.scratch[0].name
  partition_key_paths = [each.value.partition_key_path]
  default_ttl         = each.value.default_ttl

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

# Cosmos DB Built-in Data Contributor at DATABASE scope — the one grant the
# migration needs and the deploy identity does not hold on production (where
# it has two container-scoped grants for the healer, and nothing else).
#
# The scope references the database RESOURCE, not a string, for the dependency
# edge: oidc.tf records the apply that ordered role assignments before the
# thing they scoped to existed.
resource "azurerm_cosmosdb_sql_role_assignment" "scratch_github_deploy" {
  count = var.cosmos_scratch_enabled ? 1 : 0

  resource_group_name = azurerm_resource_group.scratch[0].name
  account_name        = azurerm_cosmosdb_account.scratch[0].name
  role_definition_id  = "${azurerm_cosmosdb_account.scratch[0].id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_user_assigned_identity.github_deploy.principal_id
  scope               = "${azurerm_cosmosdb_account.scratch[0].id}/dbs/${azurerm_cosmosdb_sql_database.scratch[0].name}"
}

# Built-in Reader on the group, so the probe step can `az cosmosdb show` the
# firewall configuration and say precisely why a request was refused. NOT
# "Cosmos DB Account Reader Role", which also carries listKeys-adjacent actions
# on an account that deliberately has no keys.
resource "azurerm_role_assignment" "scratch_reader" {
  count = var.cosmos_scratch_enabled ? 1 : 0

  scope                = azurerm_resource_group.scratch[0].id
  role_definition_name = "Reader"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
}

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------

resource "azurerm_storage_account" "scratch" {
  count = var.storage_scratch_enabled ? 1 : 0

  # st<workload><env><region>01 — 16 characters, inside the 24 cap, no hyphens.
  name                     = "st${var.workload_name}${local.scratch_environment}${var.region_abbreviation}01"
  resource_group_name      = azurerm_resource_group.scratch[0].name
  location                 = var.azure_location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"

  # Same posture as the production content account: nothing public, deny by
  # default, Azure services bypass. No VNet rule (nothing in the subnet should
  # reach it). The workflow opens a per-run window for the runner exactly as
  # deploy-functions.yml does for the Functions host account.
  allow_nested_items_to_be_public = false

  # Keys off, and hardcoded rather than following
  # var.storage_shared_access_key_enabled — the same argument the Cosmos
  # account above makes for local_authentication_enabled. A rehearsal that
  # uploads with an account key passes while proving nothing about the
  # identity-based path production takes, so a rollback switch here would only
  # ever be used to make the rehearsal less like production. The copy runs on
  # the deploy identity's Storage Blob Data Contributor grant below.
  shared_access_key_enabled = false

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
  }

  blob_properties {
    delete_retention_policy {
      days = 7
    }
  }

  tags = local.scratch_tags
}

# The five content containers production has, plus one for the migration's
# full reports — which carry document ids and object paths and therefore must
# not become workflow artifacts on a public repository.
locals {
  scratch_storage_containers = var.storage_scratch_enabled ? toset([
    "blogs", "covers", "certifications", "speakerevents", "content", "migration-reports",
  ]) : toset([])
}

resource "azurerm_storage_container" "scratch" {
  for_each = local.scratch_storage_containers

  name                  = each.value
  storage_account_id    = azurerm_storage_account.scratch[0].id
  container_access_type = "private"
}

# Blob write for the copy, plus Storage Account Contributor for the per-run
# firewall window — the same pair and the same reasoning as
# github_deploy_releases / github_deploy_funcsa_network in oidc.tf.
resource "azurerm_role_assignment" "scratch_blob" {
  count = var.storage_scratch_enabled ? 1 : 0

  scope                = azurerm_storage_account.scratch[0].id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
}

resource "azurerm_role_assignment" "scratch_storage_network" {
  count = var.storage_scratch_enabled ? 1 : 0

  scope                = azurerm_storage_account.scratch[0].id
  role_definition_name = "Storage Account Contributor"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
}
