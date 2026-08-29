# =============================================================================
# main.tf — HCW Azure Infrastructure
#
# Manages:
#   - Resource Group
#   - Azure Static Web App (frontend hosting)
#   - Cosmos DB Serverless (website data)
#   - Azure Storage Account + containers (content and media)
#   - Azure Function App on Consumption plan (API and workers)
#   - Azure Key Vault (runtime secrets)
#   - Application Insights + Log Analytics (observability)
#   - Budget alerts (replaces GCP billing export + budget)
#   - Cloudflare DNS records for Azure services
#
# NOTE: User authentication is implemented by Microsoft Entra ID in the
# application. This module manages Azure resources and does not provision the
# Entra app registrations or app roles.
# =============================================================================

data "azurerm_client_config" "current" {}

# =============================================================================
# Resource Group
# =============================================================================
# Resource groups are the lifecycle and RBAC boundary, and each one names the
# Azure service category it groups (Naming-Convention wiki page). The split is
# drawn on destroy semantics, not on inventory: `web` is redeployable, and
# everything carrying prevent_destroy is kept out of it, because a group is
# what someone deletes when they mean "remove the app" and lifecycle
# protection on one resource must not block routine work on another.
locals {
  # segment => what lives there, for the reader. The key is the name segment.
  app_resource_groups = {
    web  = "Static Web App, Function App, plan, Application Insights, and the Functions host storage account, which is recreated with the app"
    db   = "Cosmos account, database and containers — prevent_destroy"
    stor = "Content storage account and its blob containers — prevent_destroy"
    sec  = "Key Vault — prevent_destroy"
    conn = "Spoke virtual network and the Functions integration subnet"
    # No `ai` group. It held the Azure OpenAI account, which was removed when
    # AI moved to external provider APIs — a group with nothing in it is a
    # group someone will put something unrelated into.
  }
}

resource "azurerm_resource_group" "app" {
  for_each = local.app_resource_groups

  name     = "rg-${each.key}-${var.workload_name}-${var.environment}-${var.region_abbreviation}"
  location = var.azure_location
  tags     = local.tags
}

# Platform Management. Holds the central Log Analytics workspace every other
# subscription ships diagnostics to, and the action group those alerts route
# through — both platform concerns rather than workload ones, which is why
# they sit outside the application subscription entirely.
resource "azurerm_resource_group" "platform_mgmt" {
  provider = azurerm.mgmt

  name     = "rg-mgmt-plat-${var.environment}-${var.region_abbreviation}"
  location = var.azure_location
  tags     = local.tags
}

# =============================================================================
# Log Analytics Workspace (required by Application Insights)
# =============================================================================
resource "azurerm_log_analytics_workspace" "hcw" {
  # Same subscription as the resource group it lives in. resource_group_name
  # is only a string — the provider's subscription decides where the ARM call
  # goes, and without this alias the workspace lands in the application
  # subscription, where rg-mgmt-plat does not exist.
  provider = azurerm.mgmt

  name                = "log-plat-${var.environment}-${var.region_abbreviation}-${var.instance}"
  location            = azurerm_resource_group.platform_mgmt.location
  resource_group_name = azurerm_resource_group.platform_mgmt.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  # T-505: the plan's telemetry cost ceiling. When the cap trips, ingestion
  # stops until the daily reset — Cosmos DataPlaneRequests (observability.tf)
  # is the likeliest culprit; prune that category before raising the cap.
  daily_quota_gb = 0.25
  tags           = local.tags
}

# =============================================================================
# Application Insights and Log Analytics observability
# =============================================================================
resource "azurerm_application_insights" "hcw" {
  name                = "appi-${var.workload_name}-${var.environment}-${var.region_abbreviation}-${var.instance}"
  location            = azurerm_resource_group.app["web"].location
  resource_group_name = azurerm_resource_group.app["web"].name
  workspace_id        = azurerm_log_analytics_workspace.hcw.id
  application_type    = "Node.JS"
  tags                = local.tags
}

# `sampling_percentage` is DELIBERATELY NOT SET, and the reason is not
# oversight — it was proposed as the fix for the OverQuota workspace on
# 2026-08-24 and it is the wrong instrument here. Recorded so it is not
# proposed again.
#
# That argument configures INGESTION sampling, which Microsoft documents as
# operating "only when no other sampling is in effect: if the SDK samples your
# telemetry, ingestion sampling is disabled". Azure Functions enables ADAPTIVE
# sampling by default and functions/host.json enables it explicitly, with
# `excludedTypes: "Request"`. The consequence is exact and backwards:
#
#   - AppTraces, the table that is ~38% of the daily cap, IS sampled by the
#     host, so ingestion sampling does not touch it. Setting this would not
#     reduce the volume that caused the problem.
#   - Requests are EXCLUDED from host sampling, so they are the telemetry
#     ingestion sampling would actually discard. AppRequests and AppExceptions
#     are 0.3% of the cap each and are the two tables an incident is read from
#     — and observability.tf now runs an alert rule that counts AppExceptions
#     rows, which Microsoft's own guidance says sampling degrades ("alerts can
#     only trigger upon sampled data").
#
# So the setting would cost the alerting that landed in the same change and
# save nothing. The ingestion problem is fixed where the volume actually is:
# the Cosmos categories in observability.tf. The size of that reduction is
# stated there as a floor rather than a measurement — the figures behind it were
# sampled while the workspace was already capped, so they understate the true
# volume — and it has to be confirmed after a full uncapped day. Repeating a
# precise before/after number here would put two different claims in two files.
#
# If more headroom is ever needed, the levers in order are: host.json
# `logLevel` (Information-level host traces are what AppTraces mostly is),
# host.json `maxTelemetryItemsPerSecond` on the adaptive sampler, and then a
# workspace ingestion-time transformation — which is what Microsoft's daily-cap
# guidance recommends over a cap in the first place. All three are deterministic
# about WHAT they drop. This one is not.

# =============================================================================
# Azure Static Web App (frontend hosting)
#
# Standard tier provides:
#   - Custom domain with free managed SSL
#   - Global CDN (Azure Front Door backbone)
#   - SPA routing (navigationFallback in staticwebapp.config.json)
#   - Staging environments (preview on PRs)
#   - 100 GB bandwidth/month included
# =============================================================================
resource "azurerm_static_web_app" "hcw" {
  name = "stapp-${var.workload_name}-${var.environment}-${var.region_abbreviation}-${var.instance}"
  # Still a separate variable from azure_location even though the two now hold
  # the same value: Static Web Apps is offered in five regions only, and the
  # validation on static_web_app_location catches a bad region at plan time
  # instead of at apply time. This resource used to be the estate's odd one
  # out — running in centralus while named for southcentralus — and the move
  # to a single region is what retired that exception.
  location            = var.static_web_app_location
  resource_group_name = azurerm_resource_group.app["web"].name
  sku_tier            = "Standard"
  sku_size            = "Standard"
  tags                = local.tags

  lifecycle {
    # These two are written by the deploy, not by Terraform.
    #
    # `Azure/static-web-apps-deploy` stamps the repository it published from
    # onto the resource. Terraform has never set them, so it reads them as
    # drift and plans to null them — which would win until the next frontend
    # deploy stamped them back, and then plan again. An apply that always
    # shows a change and a deploy that always undoes it is a loop, not a
    # convergence, and it makes "0 changed" stop meaning anything.
    #
    # They are metadata: the deployment uses a token, and nothing about
    # serving the site reads these. The right answer is that the pipeline owns
    # the field, so Terraform stops claiming it. First seen 2026-08-23, on the
    # first plan after the §6 step 1 frontend deploy.
    ignore_changes = [repository_url, repository_branch]
  }
}

# =============================================================================
# Cosmos DB Account — Serverless capacity mode, NoSQL (Core/SQL) API
#
# Serverless: pay-per-RU, no provisioned throughput.
# Ideal for variable/low traffic pre-launch workloads.
# Consistency: Session (default, matches Firestore's per-client consistency).
# Single-region: centralus, the same region as the rest of the estate.
# =============================================================================
resource "azurerm_cosmosdb_account" "hcw" {
  name = var.cosmos_db_account_name
  # Kept as its own variable rather than folded into azure_location: where a
  # Cosmos account MAY be created is governed by two APIs that disagree, and
  # both must be re-checked for any future region (see var.cosmos_location).
  # It resolves to the same region as everything else today — this account was
  # the reason the estate moved to centralus rather than the exception to it.
  location            = var.cosmos_location
  resource_group_name = azurerm_resource_group.app["db"].name
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
  # policies and the container/query contract used by the current website.
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

  # zone_redundant is EXPLICIT, not left to the provider default, because the
  # default put this account in the availability-zone pool and South Central US
  # had no AZ capacity to give: creation failed with ServiceUnavailable and a
  # message about "zonal redundant (Availability Zones) accounts" — a capacity
  # message, not a configuration error, and one that would recur unpredictably.
  #
  # False is also the correct setting on its own merits here. The account is
  # serverless and single-region by deliberate design (see the capacity note
  # above), and zone redundancy costs more while protecting against a failure
  # mode a single-region account has already accepted.
  geo_location {
    location          = var.cosmos_location
    failover_priority = 0
    # centralus does support availability zones, so this is a choice rather
    # than a constraint: a serverless, single-region account has already
    # accepted the failure mode zone redundancy protects against, and zones
    # cost more.
    zone_redundant = false
  }

  # T-504: the service firewall ADR-001/ADR-0008 traded Private Link away for.
  # Data-plane access is allowed from exactly:
  #   - the Functions integration subnet (the app's runtime path — requires
  #     the Microsoft.AzureCosmosDB service endpoint on that subnet);
  #   - Azure datacenter IPs when cosmos_allow_azure_datacenter_ips is true —
  #     the documented "0.0.0.0" sentinel. This is what keeps the
  #     heal-computed-properties workflow working from GitHub-hosted runners
  #     (which run in Azure). Drop it once that job runs from an in-VNet
  #     runner; it narrows exposure to Azure tenants, not the open internet;
  #   - any operator IPs in cosmos_admin_ip_rules (smoke tier 2), empty in
  #     steady state.
  # Management-plane (ARM) operations — Terraform itself — are not gated by
  # this firewall.
  is_virtual_network_filter_enabled = true

  virtual_network_rule {
    id = azurerm_subnet.functions_integration.id
  }

  ip_range_filter = toset(concat(
    var.cosmos_allow_azure_datacenter_ips ? ["0.0.0.0"] : [],
    var.cosmos_admin_ip_rules,
  ))

  # T-504: keys off. The app is managed-identity-only (AAD data plane), the
  # operational tooling uses DefaultAzureCredential, and TODO.md's concern is
  # a key that may once have existed — disabling local auth is the durable
  # answer to it. Set the variable false only if plan review surfaces a key
  # consumer nobody remembered.
  # local_authentication_enabled replaced the deprecated
  # local_authentication_disabled and inverts its polarity, hence the negation.
  # The variable keeps the "disabled" sense deliberately: it reads as the
  # security posture being asserted, and renaming it belongs to T-507.
  local_authentication_enabled = !var.cosmos_local_auth_disabled

  # Continuous backup — point-in-time restore instead of the periodic default.
  # One-way conversion (continuous cannot go back to periodic).
  #
  # Continuous30Days since 2026-08-28 (T-707). The 7-day tier is free, and that
  # was the whole reason it was chosen; the problem is that this platform runs
  # cleanup timers which delete and rewrite documents, so corruption is
  # discovered slowly and a 7-day window can close before anyone notices. The
  # 30-day tier is billed at $0.20/GB/month × regions — cents at this data size
  # (roughly 70k small documents), which buys four times the window.
  #
  # What this still does NOT buy, and what T-707 keeps open: an out-of-account
  # copy. Microsoft's own words — "the backups aren't automatically
  # geo-disaster resistant" — the backup lives with the account, so account
  # deletion or a Central US failure takes it too. Serverless is single-region
  # for life and the conversion is irreversible, so that gap is closed by
  # exporting out of the account, not by a setting here. Tracked with the
  # recovery objectives in issue #231.
  backup {
    type = "Continuous"
    tier = "Continuous30Days"
  }

  # This account holds production website data. A plan that wants to
  # replace it must fail until a human removes this guard in a reviewed PR.
  #
  # Lifted once, for the centralus rebuild on 2026-08-19, and restored the same
  # day once the rebuild applied. That window was safe only because
  # The original rebuild window occurred before production data was populated.
  # It will not be safe again: this guard is the
  # difference between a typo and a data-loss incident.
  lifecycle {
    prevent_destroy = true
  }

  tags = local.tags
}

# Cosmos DB SQL Database
resource "azurerm_cosmosdb_sql_database" "hcw" {
  # Deliberately NOT renamed to the CAF convention. This is a data-plane
  # identifier, not an Azure resource name: functions/src/lib/cosmos-client.js,
  # scripts/lib/cli.mjs and scripts/apply-computed-sortdate.mjs all default to
  # the literal "hcw" when COSMOS_DATABASE is unset; all current clients share
  # that value. Renaming it would leave those paths connecting to a database
  # to a database that does not exist, and the failure would look like a
  # permissions problem.
  #
  # It is its own variable rather than borrowing project_name so that the
  # coupling is explicit and changing it is a deliberate act coordinated with
  # those files. The scratch account (scratch.tf) uses the same name so a
  # rehearsal exercises exactly the database id production will.
  name                = var.cosmos_database_name
  resource_group_name = azurerm_resource_group.app["db"].name
  account_name        = azurerm_cosmosdb_account.hcw.name

  # prevent_destroy on the ACCOUNT does not protect its children: a database or
  # container destroy plans and applies cleanly underneath it. This database
  # holds every production document, so dropping it is a two-step that starts
  # with removing this guard in a reviewed PR — the same shape the account
  # already imposes (T-708).
  lifecycle {
    prevent_destroy = true
  }
}

# -----------------------------------------------------------------------------
# Cosmos DB Containers
#
# The container list is GENERATED from scripts/lib/migration-manifest.mjs, the
# collection contract used by Terraform and operational tooling. Regenerate with:
#
#     node scripts/generate-cosmos-container-spec.mjs
#
# Do not add containers here by hand — add the collection to the manifest and
# regenerate, or Terraform and the application contract drift apart.
#
# Partition keys come from the manifest: 68 on /id and five exceptions — four
# flattened subcollections keyed by their parent (content_versions on
# /contentId, image_prompts_sets on /pageId, image_prompt_sets_prompts on
# /setName, listen_and_learn_episodes on /setId) and admin_config on a
# constant /configScope so the ContentForge save stays one TransactionalBatch.
#
# /id is right for the rest because the Site-Main query load does not group by
# anything — one of ~40 content query sites filters on a provider — and the
# previous "natural" keys were wrong on their own merits: /contentId was written
# as the empty string on every document, /status on lab_jobs is mutable and a
# partition key value cannot be changed in place, and /agentId on lab_agents is
# identical to /id by construction.
#
# The subcollection exceptions are a CORRECTNESS matter, not a tuning one. Each
# assigns document ids that are unique only within their parent (a set name, a
# prompt name, an exam-area slug), so flattening them into one container under
# /id would silently overwrite documents on upsert.
#
# Full evidence, with file:line citations, in the manifest header.
#
# A partition key path is IMMUTABLE. Changing one on a container that already
# holds data means destroying the container and re-importing.
#
# THAT WINDOW IS CLOSED. This block used to read "every container here is empty
# as of 2026-08-20 — the decision window is open now and closes on the first
# import"; the import happened, and production holds roughly 70k documents
# (measured 2026-08-24). A partition-key change in cosmos-containers.json is
# now a data-destroying plan, which is why the resource carries
# prevent_destroy (T-708): the guard has to come off deliberately, in its own
# reviewed PR, before any such change can apply.
# -----------------------------------------------------------------------------

locals {
  # The applied tag map (T-752). var.tags carries the org-stable keys; the
  # environment is derived from var.environment so a deployment of this root
  # into a non-prod environment cannot tag every resource `prod` unless the
  # operator remembers to override the whole map. Value-identical today
  # (var.environment is "prod"), so this lands as a no-op plan.
  tags = merge(var.tags, { environment = var.environment })
}

locals {
  cosmos_container_spec = jsondecode(file("${path.module}/cosmos-containers.json"))
  cosmos_containers     = { for c in local.cosmos_container_spec.containers : c.name => c }
}

resource "azurerm_cosmosdb_sql_container" "hcw" {
  for_each = local.cosmos_containers

  name                = each.value.name
  resource_group_name = azurerm_resource_group.app["db"].name
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

  # Applies to every instance of the for_each. These containers are generated
  # from cosmos-containers.json and partition keys are immutable, so a
  # regenerated spec that renames a container or changes a key produces a
  # destroy-and-create — on roughly 70k production documents. The guard turns
  # that from a plan someone has to read carefully into a plan that fails
  # (T-708). Dropping a container deliberately means removing this first.
  lifecycle {
    prevent_destroy = true
  }
}

# The eleven `moved` blocks that used to follow — carrying the hand-declared
# containers into the for_each map, seven of them with a partition-key change
# — were removed on 2026-08-20. The centralus rebuild of 2026-08-19 recreated
# every container from the spec while all of them were empty, so the moves and
# the key changes both happened through that rebuild; `terraform state list`
# shows only the for_each form. The rebuild and state transition are complete;
# future address or partition-key changes still require an explicit reviewed
# plan.

# =============================================================================
# Azure Storage Account (content and media)
#
# Hot tier for frequently accessed blog covers, cert badges, AI images.
#
# RA-GRS since 2026-08-28 (T-706). It was LRS, and ADR 0018 accepted that
# explicitly "while the Firebase source retains the authoritative copy", with
# a revisit trigger of "when Firebase decommission removes the second copy".
# ADR 0023 removed it: every blob written since the 2026-08-21 cutover — CMS
# uploads, generated Listen & Learn audio, AI covers — existed in exactly one
# copy in one region. Versioning and soft delete (below) protect against
# overwrite and deletion, not against loss of the account or the region.
#
# RA-GRS rather than ZRS, for two reasons. The risk being closed is account and
# regional loss, which zone redundancy does not cover — ZRS keeps three copies
# inside one region. And LRS→ZRS is not expressible here at all: Azure requires
# a customer-initiated *conversion* (`az storage account migration start`),
# while LRS→GRS/RA-GRS is an ordinary settings update Terraform performs in
# place. The RA prefix buys read access to the secondary without a failover,
# which is what makes it useful for recovering one lost blob rather than only
# for a disaster.
#
# Cost: geo-redundancy roughly doubles the per-GB rate and adds a one-time
# egress charge for the initial sync. Against Cost-Analysis.md's figures —
# where storage is a minor line next to telemetry — that is cheap insurance
# for the only copy of every image the site serves.
# =============================================================================
resource "azurerm_storage_account" "hcw" {
  name                     = var.storage_account_name
  resource_group_name      = azurerm_resource_group.app["stor"].name
  location                 = azurerm_resource_group.app["stor"].location
  account_tier             = "Standard"
  account_replication_type = "RAGRS"
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

  # Account keys off. Nothing here reads one: the Function App uses its managed
  # identity, and azurerm_storage_container below takes storage_account_id,
  # which is the Resource Manager API rather than the shared-key data plane.
  # Leaving it on kept two standing credentials alive that no code path used —
  # and a key that is never used is a key nobody notices leaking.
  # var.storage_shared_access_key_enabled is the one-edit rollback.
  shared_access_key_enabled = var.storage_shared_access_key_enabled

  blob_properties {
    # Versioning, because this account holds the ONLY copy of the site's media
    # and the CMS overwrites blobs in place. delete_retention_policy below
    # recovers a DELETED blob; it does nothing for an overwritten one, so
    # replacing a cover image with the wrong file was, until now, permanent and
    # silent. With versioning the previous content becomes a non-current
    # version and is recoverable for as long as the lifecycle rule keeps it.
    #
    # PITR (`restore_policy`) is deliberately NOT enabled with it. It requires
    # change_feed_enabled, which is a second continuous cost, and it buys
    # account-wide rollback to a point in time — a bigger tool than the failure
    # this account actually has, which is one blob overwritten by hand.
    # Versioning answers that one exactly.
    #
    # The cost of versioning is bounded by the expire-noncurrent-versions rule
    # in azurerm_storage_management_policy.cleanup below. Without that rule an
    # account whose write pattern is "overwrite in place" grows forever.
    versioning_enabled = true

    cors_rule {
      allowed_headers = ["*"]
      allowed_methods = ["GET", "HEAD", "OPTIONS"]
      # EXACT origins only. Azure Storage CORS accepts a literal "*" or fully
      # qualified origins — it does not accept partial wildcards, so the
      # previous `https://*.<domain>` and `http://localhost:*` were rejected
      # with "The value for one of the XML nodes is not in the correct
      # format", an error that names neither the field nor the value.
      # Port is part of an origin, hence localhost:5173 (Vite's default) and
      # not bare localhost.
      allowed_origins = [
        "https://${var.domain}",
        "https://www.${var.domain}",
        "http://localhost:5173",
      ]
      exposed_headers    = ["Content-Length", "Content-Type"]
      max_age_in_seconds = 3600
    }

    delete_retention_policy {
      days = 7
    }

    # A deleted CONTAINER used to take its blobs with it irrecoverably, even
    # with blob soft delete on above — the two policies are separate and the
    # container is the bigger blast radius of the two. Seven days to match.
    container_delete_retention_policy {
      days = 7
    }
  }

  network_rules {
    default_action             = "Deny"
    bypass                     = ["AzureServices"]
    virtual_network_subnet_ids = [azurerm_subnet.functions_integration.id]
  }

  # Holds production website media. Same guard rationale as the Cosmos
  # account: replacement must be an explicit, reviewed decision.
  #
  # Lifted for the centralus rebuild on 2026-08-19 and restored the same day.
  # The account was empty then; it will not be next time.
  lifecycle {
    prevent_destroy = true
  }

  tags = local.tags
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

# Listen & Learn episode audio, written by the generate-listen-and-learn job and
# streamed through the media route once an editor approves the episode. Private
# like every other container here: PUBLIC_MEDIA_CONTAINERS in blob-paths.js is
# what makes it reachable anonymously, and the account denies anonymous reads
# outright regardless.
resource "azurerm_storage_container" "listenandlearn" {
  name                  = "listenandlearn"
  storage_account_id    = azurerm_storage_account.hcw.id
  container_access_type = "private" # episode MP3s, served via the media route
}

# Storage lifecycle management for generated and uploaded website media.
#
# KNOWN INERT as written. Azure matches `prefix_match` against
# `<container>/<blob>`, so "articles/" would match a container named
# `articles` — which does not exist, and is not created on purpose.
# `articles/` prefix is reserved for generated images on a 90-day lifecycle
# that RSS and blog-listing jobs may regenerate. When a scraper writes images
# here, this rule must name the real path (for example, "content/articles/")
# before it does anything. The decision stays next to the rule.
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

  # The bound on versioning_enabled above, and it is not optional.
  #
  # This account's write pattern is overwrite-in-place from the CMS. Versioning
  # turns every one of those overwrites into a retained non-current version, so
  # without an expiry the account grows monotonically with editing activity and
  # never with content — a cost line that only ever goes up, on a platform with
  # a USD 150 ceiling.
  #
  # 30 days is chosen against the failure it exists for: someone replaces the
  # wrong image and finds out when they next look at the page. That is a
  # days-to-weeks discovery, not a months one. NO prefix_match, unlike the rule
  # above — this applies to every container, because the mistake can happen in
  # any of them.
  rule {
    name    = "expire-noncurrent-versions"
    enabled = true

    filters {
      blob_types = ["blockBlob"]
    }

    actions {
      version {
        delete_after_days_since_creation = 30
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
  name                = "vnet-${var.workload_name}-${var.environment}-${var.region_abbreviation}-${var.instance}"
  location            = azurerm_resource_group.app["conn"].location
  resource_group_name = azurerm_resource_group.app["conn"].name
  address_space       = [var.vnet_address_space]
  tags                = local.tags
}

resource "azurerm_subnet" "functions_integration" {
  # This used to omit the region on the reasoning that a subnet is a child of
  # its VNet, which already carries it. CAF disagrees, and CAF wins here: its
  # example format is snet-<purpose>-<region>-<###>, region included, for the
  # same reason vnet carries it — subnet names show up in firewall rules, VNet
  # rules and support tickets detached from their parent, and a reader should
  # not have to walk up the tree to learn where the thing is.
  name                 = "snet-${var.workload_name}-func-${var.environment}-${var.region_abbreviation}-${var.instance}"
  resource_group_name  = azurerm_resource_group.app["conn"].name
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
  # Microsoft.AzureCosmosDB is the same story for the Cosmos account's VNet
  # rule (T-504), and Microsoft.Storage for both storage accounts' rules
  # (content account, and the Functions host account since T-503): without
  # the endpoint the rule is inert and the firewall denies the Function App
  # along with everyone else.
  #
  # azurerm 5.0 removed the service_endpoints list in favour of repeated
  # service_endpoint blocks. Generated from a variable rather than written out
  # three times: the set is a deployment input — private endpoints would change
  # this posture, and a new VNet-ruled service appends to it — so it belongs
  # somewhere a tfvars file can reach.
  dynamic "service_endpoint" {
    for_each = toset(var.functions_subnet_service_endpoints)
    content {
      service = service_endpoint.value
    }
  }

  delegation {
    name = "flex-consumption"
    service_delegation {
      name = "Microsoft.App/environments"
      # `join/action`, which is what Azure actually assigns for this
      # delegation — the action set belongs to the service, not to us. Naming
      # anything else produces a plan that never converges: Terraform writes
      # the value, Azure replaces it with its own, and the next plan proposes
      # the same in-place update forever. Verify with:
      #   az network vnet subnet show ... --query "delegations[].actions"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# The spoke's half of the same argument hub.tf makes for nsg-plat-shared: this
# NSG exists so that adding a rule is an edit to an existing, reviewed object
# rather than a decision to create security controls under time pressure. The
# integration subnet was the one subnet in the estate with no NSG at all
# (`networkSecurityGroup: null` on the live subnet, 2026-08-24), which is the
# state that makes "add a deny rule" a four-step change during an incident.
#
# EMPTY OF CUSTOM RULES, AND THAT IS THE WHOLE DESIGN. Azure's default rules
# still apply and are what this subnet needs: VNet-to-VNet in and out allowed,
# Azure Load Balancer in allowed, Internet in denied, Internet out allowed.
# Nothing about the running app changes. Inbound HTTP does not arrive here —
# it arrives at the App Service front end and the subnet carries only the app's
# OUTBOUND traffic — so the Internet-inbound deny costs nothing, and the
# Internet-outbound allow is what the app needs to reach the external model and
# ingest APIs it exists to call.
#
# Do NOT add an outbound deny here without first enumerating those APIs. The
# failure mode is a handler that hangs until its timeout rather than one that
# errors, which reads as a slow provider rather than as a blocked egress.
#
# Rollback if the app misbehaves after this lands is deleting the association
# (not the NSG); an unassociated NSG affects nothing.
resource "azurerm_network_security_group" "functions_integration" {
  name                = "nsg-${var.workload_name}-func-${var.environment}-${var.region_abbreviation}-${var.instance}"
  location            = azurerm_resource_group.app["conn"].location
  resource_group_name = azurerm_resource_group.app["conn"].name
  tags                = local.tags
}

resource "azurerm_subnet_network_security_group_association" "functions_integration" {
  subnet_id                 = azurerm_subnet.functions_integration.id
  network_security_group_id = azurerm_network_security_group.functions_integration.id
}


resource "azurerm_storage_account" "functions" {
  name                     = var.functions_storage_account_name
  resource_group_name      = azurerm_resource_group.app["web"].name
  location                 = azurerm_resource_group.app["web"].location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
  tags                     = local.tags

  # Account keys off — the credential half of the same posture the network
  # rules below take. All three access paths listed there are Entra-based
  # already: the host authenticates with its managed identity
  # (storage_authentication_type = "SystemAssignedIdentity" on the function
  # app), and the workflow uploads with the deploy identity's token inside its
  # firewall window. Nothing presents a key, so nothing breaks by removing the
  # ability to. var.storage_shared_access_key_enabled is the one-edit rollback,
  # and its description says what a key-auth failure looks like — which is not
  # like a storage failure.
  shared_access_key_enabled = var.storage_shared_access_key_enabled

  # Soft delete on the deployment packages and the host's own state. The
  # content account has had this since it was created; this one did not, so a
  # mistaken delete here — the release container, or a host-state blob — was
  # unrecoverable and takes the API down until a redeploy. Same 7 days, because
  # there is no reason for the two accounts to differ and every reason for an
  # operator not to have to remember which is which.
  blob_properties {
    delete_retention_policy {
      days = 7
    }

    container_delete_retention_policy {
      days = 7
    }
  }

  # T-503: the last publicly-open storage surface, closed. Three access paths
  # survive default Deny, each deliberate:
  #   1. Runtime and platform package-pull — the Flex app is VNet-integrated
  #      (virtual_network_subnet_id) with identity-based storage auth, so
  #      host-state and deployment reads arrive from the integration subnet;
  #      the subnet rule + Microsoft.Storage service endpoint admit them.
  #      This is the documented supported shape for network-restricted
  #      deployment storage on Flex Consumption.
  #   2. Workflow package upload — GitHub-hosted runners have public dynamic
  #      IPs, so deploy-functions.yml opens a per-run firewall window (adds
  #      the runner IP, uploads, removes it; see that workflow), authorized
  #      by the deploy identity's Storage Account Contributor grant scoped to
  #      exactly this account (oidc.tf).
  #   3. Operator windows — functions_storage_admin_ip_rules, same
  #      populate/apply/work/empty pattern as the Key Vault and Cosmos vars.
  #
  # Rollback: if the app stops cold-starting after apply (the failure mode is
  # a deploy that "succeeds" against stale state — verify with a deploy AND a
  # cold-start invocation), set functions_storage_network_default_action =
  # "Allow" and re-apply; that restores the pre-T-503 posture in one step.
  network_rules {
    default_action             = var.functions_storage_network_default_action
    bypass                     = ["AzureServices"]
    virtual_network_subnet_ids = [azurerm_subnet.functions_integration.id]
    ip_rules                   = var.functions_storage_admin_ip_rules
  }

  # Function host state and release packages live here; replacing it takes the
  # API down until a redeploy. Guarded like the other stateful accounts.
  #
  # Lifted for the centralus rebuild on 2026-08-19 and restored the same day.
  # The cost of replacement was a redeploy rather than an outage only because
  # Migration-Plan §6 cutover had not run.
  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_service_plan" "hcw" {
  name                = "asp-${var.workload_name}-${var.environment}-${var.region_abbreviation}-${var.instance}"
  location            = azurerm_resource_group.app["web"].location
  resource_group_name = azurerm_resource_group.app["web"].name
  os_type             = "Linux"
  sku_name            = "FC1" # Flex Consumption — VNet integration, scales to zero
  tags                = local.tags
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
# ---------------------------------------------------------------------------
# Timer feature flags — generated, so cutover flips a variable, not this file.
# ---------------------------------------------------------------------------
#
# The catalogue is the authority on which timers exist. It must match the
# `timer(name, FLAG, ...)` registrations in
# functions/src/functions/schedulers.js plus platformJobSweeper in
# jobs-sweeper.js — route-inventory.test.js asserts the timer set, so a timer
# added there without a flag here ships disarmed and one removed there leaves a
# dead setting behind.
locals {
  # Flag suffix => the function it arms. The comment is the whole point of the
  # map: `SYNC_SOCIAL_CALENDAR` tells an operator nothing about what turning it
  # on will start writing.
  timer_catalogue = {
    PUBLISH_SCHEDULED_CONTENT    = "publishScheduledContent — publishes content whose scheduledPublishDate is due"
    SYNC_RSS_FEEDS               = "syncRssFeeds — RSS ingest, every 2 hours"
    FORGE_SCHEDULED              = "forgeScheduled — nightly content forge run"
    MONITOR_PUBLISHING_PIPELINE  = "monitorPublishingPipeline — publishing watchdog, every 6 hours"
    GENERATE_REVIEWER_DIGEST     = "generateReviewerDigest — daily 07:00 reviewer digest e-mail"
    CHECK_LIVE_LINKS             = "checkLiveLinks — weekly Monday link check"
    CLEANUP_REJECTED_CONTENT     = "cleanupRejectedContent — daily 04:00, deletes rejected documents"
    CLEANUP_SOFT_DELETED_CONTENT = "cleanupSoftDeletedContent — every 4 hours, purges soft-deleted documents"
    REVERIFY_CERTIFICATIONS      = "reVerifyCertifications — weekly Sunday certification re-verify"
    SCRAPE_SKILLS_HUB_RSS        = "scrapeSkillsHubRss — weekly Friday Skills Hub scrape"
    REFRESH_PLAUD_TOKEN          = "refreshPlaudToken — Plaud OAuth token refresh, every 12 hours"
    CHECK_AGENT_HEALTH           = "checkAgentHealth — VPS agent heartbeat check, every 5 minutes"
    FETCH_PODCAST_FEEDS          = "fetchPodcastFeeds — podcast ingest, every 2 hours"
    FETCH_BLOG_LISTINGS          = "fetchBlogListings — Firecrawl blog listings, every 6 hours"
    # D12: the live writer of social_posts. Turning this on before the cutover
    # delta import means importing over rows this timer is actively rewriting.
    SYNC_SOCIAL_CALENDAR = "syncSocialCalendarScheduled — Publer calendar sync, every 5 minutes. NOT before the delta import"
    # T-302: both stay dry-run until their matching *_DELETE setting is true.
    CLEANUP_TEMP_STORAGE       = "cleanupTempStorage — daily, deletes temp blobs (dry-run unless TEMP_STORAGE_CLEANUP_DELETE)"
    CLEANUP_UNUSED_CERT_IMAGES = "cleanupUnusedCertImages — daily 05:00, deletes unused cert images (dry-run unless CERT_IMAGE_CLEANUP_DELETE)"
    PLATFORM_JOB_SWEEPER       = "platformJobSweeper — re-enqueues jobs left queued by a failed output binding (T-322)"
  }

  timer_flags = {
    for suffix, _description in local.timer_catalogue :
    "FEATURE_FLAG_${suffix}" => contains(var.enabled_timers, suffix) ? "true" : "false"
  }
}

resource "azurerm_function_app_flex_consumption" "hcw" {
  name                = var.function_app_name
  location            = azurerm_resource_group.app["web"].location
  resource_group_name = azurerm_resource_group.app["web"].name
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

    # The platform default is HTTP/1.1 only, which the live app was still on.
    # There is no compatibility question to weigh: HTTP/2 is negotiated over
    # TLS by ALPN, so a client that does not speak it is served 1.1 exactly as
    # before, and this app is https_only. Cloudflare already terminates HTTP/2
    # for browsers; this is about the leg BEHIND it and about any client
    # reaching the origin hostname directly.
    http2_enabled = true

    # DECISION 7 — CORS is handled in code
    # (functions/src/lib/auth/cors.js) for real requests, and HERE for
    # preflights, because the platform gives no choice about the second.
    #
    # The original decision removed this block entirely on the reasoning that two
    # allowlists drift and the in-code one is better: it 403s a disallowed origin
    # instead of silently omitting the header, and it can express any localhost
    # port rather than the two that used to be hardcoded. All of that still holds
    # for actual requests.
    #
    # It was wrong about preflights, and the site proved it on 2026-08-23. The
    # admin portal could authenticate and then every API call failed with
    # "Failed to fetch" — a browser-side CORS rejection with no server-side trace.
    #
    # The Functions host answers a GENUINE preflight itself: OPTIONS carrying both
    # `Origin` and `Access-Control-Request-Method`. With no origins configured
    # here it answers 204 with no Access-Control-* headers at all, which every
    # browser rejects. Measured against production:
    #
    #   OPTIONS + Origin + Access-Control-Request-Method  -> 204, no headers
    #   OPTIONS + Origin, no Access-Control-Request-Method -> reaches the app,
    #                                                        204 WITH headers
    #   GET + disallowed Origin                            -> 403 from the app
    #
    # The middle line is the proof: the in-code preflight is correct and simply
    # never runs for the only kind of preflight a browser sends. Removing this
    # block did not return preflight handling to the application; it left the
    # platform answering preflights with nothing.
    #
    # So the platform gets exactly the origins it needs to answer a preflight,
    # and nothing else changes: the in-code allowlist still decides actual
    # requests, still 403s, still owns localhost. Drift between the two is
    # contained by `cors_platform_origins.test.js`, which reads this file and
    # fails if it stops matching PRODUCTION_ORIGINS + PREVIEW_ORIGINS.
    #
    # support_credentials stays FALSE. This is a bearer-token API, not a cookie
    # API, and true would additionally make the platform intercept far more than
    # preflights.
    # Two ways to break that guard, both tried for T-750 and reverted: replacing
    # a literal with "https://${var.domain}" or the SWA's default_host_name
    # (the test compares strings, and an interpolation is not one), and putting
    # a comment between `cors {` and `allowed_origins` (its block regex stops
    # matching, so the guard passes while checking nothing). The asymmetry with
    # the storage account's CORS block, which does derive from var.domain, is
    # justified rather than an oversight: only this list is guarded by text.
    cors {
      allowed_origins = concat(
        ["https://hybridcloudworks.com", "https://www.hybridcloudworks.com"],
        ["https://calm-ground-0d0e6a010.7.azurestaticapps.net"],
        var.cors_extra_origins,
      )
      support_credentials = false
    }

    # -------------------------------------------------------------------------
    # The Azure half of the origin lock (DECISION 6). Off by default — see
    # var.functions_origin_lock_enabled for what turning it on breaks, and why
    # the ranges are a literal list rather than an http data source.
    #
    # These blocks live INSIDE this site_config rather than in a conditional
    # one of their own: the resource takes a single site_config, so a second
    # block is a configuration error that only surfaces when the flag is
    # turned on — a plan-time failure hiding behind a false default.
    #
    # The Deny is last by construction. App Service evaluates ip_restriction
    # entries by priority and applies an implicit "allow all" only when the
    # list is EMPTY, so this is either absent entirely (open, today) or ends in
    # an explicit Deny. There is no half-written state that quietly allows
    # everything.
    # -------------------------------------------------------------------------
    dynamic "ip_restriction" {
      for_each = var.functions_origin_lock_enabled ? var.cloudflare_ip_ranges : []
      content {
        action     = "Allow"
        ip_address = ip_restriction.value
        name       = "cloudflare-${replace(replace(ip_restriction.value, ".", "-"), "/", "-")}"
        priority   = 100 + index(var.cloudflare_ip_ranges, ip_restriction.value)
      }
    }

    dynamic "ip_restriction" {
      for_each = var.functions_origin_lock_enabled ? [1] : []
      content {
        action      = "Deny"
        ip_address  = "0.0.0.0/0"
        name        = "deny-all-non-cloudflare"
        priority    = 65000
        description = "Everything that did not match a Cloudflare range above"
      }
    }

    # The rule above is NOT sufficient on its own, and assuming it was is the
    # kind of mistake that leaves a lock looking closed while it is open.
    #
    # `0.0.0.0/0` is an IPv4 CIDR and matches no IPv6 source, so an IPv6 request
    # matches no rule at all and falls through to the unmatched-request action.
    # That action defaults to ALLOW — verified on the live app, which reported
    # `ipSecurityRestrictionsDefaultAction: Allow` while every IPv4 request was
    # correctly refused with 403.
    #
    # No AAAA record is published for the origin today and a direct IPv6 attempt
    # failed to connect, so this was not demonstrably exploitable — but the
    # posture depends on that remaining true, which is not a property this
    # configuration controls. Deny is the supported way to say what the
    # `0.0.0.0/0` rule was trying to say.
    ip_restriction_default_action = var.functions_origin_lock_enabled ? "Deny" : "Allow"

    # SCM (Kudu) reachability, closed by a per-run window rather than a standing
    # rule — see TODO.md T-520, raised as S2 in the 2026-08-24 Go-Live review.
    #
    # The Flex Consumption deploy runs THROUGH Kudu ("Will use Kudu
    # https://<scmsite>/api/publish to deploy since Flex consumption plan is
    # detected") and GitHub-hosted runners have no stable egress IPs, so a
    # standing Deny breaks every deploy. That is why this was Allow, and why
    # simply changing the literal was never the fix.
    #
    # deploy-functions.yml now opens a window instead: it adds the runner's IP
    # as an SCM allow rule before the deploy and removes it in an always-run
    # step that asserts the posture it found is the posture it left. That makes
    # Deny survivable, so the posture becomes a variable.
    #
    # Still false by default. The window has to be merged and observed working
    # on a real deploy before this flips, because the first deploy after a
    # premature flip is the one that cannot get in to fix it.
    #
    # This closes the REACHABILITY half. The credential half is already closed
    # below: basic authentication is off on both SCM and FTP, so anything
    # reaching the endpoint must present an Entra token. This app deploys with
    # OIDC and a federated identity and has never used a publish profile.
    scm_ip_restriction_default_action = var.functions_scm_lock_enabled ? "Deny" : "Allow"
  }

  # Kudu and FTP username/password publishing, off. Anyone reaching the SCM
  # endpoint now has to present an Entra token rather than a static credential,
  # so the publicly-reachable SCM site stops being an authentication surface
  # even while it stays publicly reachable.
  webdeploy_publish_basic_authentication_enabled = false

  app_settings = merge({
    # ---------------------------------------------------------------------------
    # The Functions HOST's own storage — timers, singleton locks, SyncTriggers.
    #
    # This is NOT the same thing as storage_authentication_type above. That
    # argument governs how the platform fetches the deployment PACKAGE; this
    # governs how the running host reaches storage for its own state. Setting
    # the first and assuming it covered the second is what broke the first
    # deploy (2026-08-20): the app deployed successfully, reported 80 functions,
    # and then served the App Service 404 page for every route.
    #
    # The evidence, from Application Insights:
    #
    #   [exception] Server failed to authenticate the request. Make sure the
    #               value of Authorization header is formed correctly including
    #               the signature.
    #   [trace]     SyncTriggers operation failed.
    #   [trace]     Process reporting unhealthy: Unhealthy
    #
    # An AzureWebJobsStorage connection string was present with an EMPTY
    # AccountKey — shared-key auth with no key, so every storage call failed the
    # signature check, SyncTriggers never completed, and the host never became
    # healthy enough to route a request. Nothing in this configuration wrote
    # that setting; it arrived with the deploy.
    #
    # `__accountName` is the identity-based form: the host constructs the blob,
    # queue and table endpoints from the account name and authenticates with its
    # own managed identity, which already holds Storage Blob Data Owner here.
    #
    # Declaring it here does NOT stop the keyless `AzureWebJobsStorage` string
    # from coming back, and the culprit is THIS PROVIDER, not the deploy —
    # corrected 2026-08-21 from the activity log, which is the only place the
    # two are distinguishable. `azurerm_function_app_flex_consumption` re-injects
    # it on every apply whatever `storage_authentication_type` says, and it does
    # not surface in plan: hashicorp/terraform-provider-azurerm#29149, open,
    # reproducing on the 5.1.0 pinned in .terraform.lock.hcl. Evidence: the
    # 20:02Z deploy deleted the setting, Terraform's 20:31Z apply was the only
    # `sites/config` write after it, and the setting was present again.
    #
    # It is stripped inside this same apply by the azapi read-then-update pair
    # below the resource — so the setting never survives the run that creates
    # it, and nothing downstream has to remember to clean up. deploy-functions.yml
    # asserts it is absent and FAILS if it is not, rather than deleting it:
    # a repair there would hide a regression in the strip. TODO.md T-511.
    #
    # The failure mode is worth remembering: a keyless connection string does
    # not fail at deploy, and does not fail as "storage". It fails as a 404 on
    # every route, which reads as a routing or build problem.
    # ---------------------------------------------------------------------------
    "AzureWebJobsStorage__accountName" = azurerm_storage_account.functions.name

    # Cosmos DB — endpoint only; runtime auth uses managed identity via DefaultAzureCredential
    "COSMOS_ENDPOINT" = azurerm_cosmosdb_account.hcw.endpoint
    "COSMOS_DATABASE" = azurerm_cosmosdb_sql_database.hcw.name
    # COSMOS_CONNECTION_STRING is deliberately absent (TODO.md T-315): it carried
    # the account PRIMARY KEY for two empty change-feed handlers. The six
    # current change-feed functions use the IDENTITY-BASED binding —
    # the app's managed identity already holds Cosmos Data Contributor at account
    # scope (func_cosmos), which covers the `leases` container too.
    # See https://learn.microsoft.com/azure/azure-functions/functions-bindings-cosmosdb-v2
    "COSMOS_CONNECTION__accountEndpoint" = azurerm_cosmosdb_account.hcw.endpoint
    "COSMOS_CONNECTION__credential"      = "managedidentity"

    "STORAGE_ACCOUNT_NAME"   = azurerm_storage_account.hcw.name
    "STORAGE_BLOB_ENDPOINT"  = azurerm_storage_account.hcw.primary_blob_endpoint
    "STORAGE_QUEUE_ENDPOINT" = azurerm_storage_account.hcw.primary_queue_endpoint

    # KEY_VAULT_URI was removed earlier on 2026-08-29, when GCP pricing stopped
    # needing a runtime vault client, and is back for a different caller with a
    # different direction of travel: the API-keys page WRITES secrets, through a
    # set-only role that cannot read them. The rule that removed it stands —
    # nothing reads a secret through this address, and a value that could be a
    # Key Vault reference must be one.
    #
    # Not a secret. It is the address references RESOLVE against, and it is in
    # the repository, in this file, on the line below.
    "KEY_VAULT_URI" = azurerm_key_vault.hcw.vault_uri

    # The app's own ARM id, for the config-references refresh call. Composed
    # from parts rather than read off the resource, because a resource cannot
    # reference its own attributes from inside its own arguments.
    "FUNCTION_APP_RESOURCE_ID" = "/subscriptions/${var.subscription_app}/resourceGroups/${azurerm_resource_group.app["web"].name}/providers/Microsoft.Web/sites/${var.function_app_name}"

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

    # GCP pricing. The Cloud Billing Catalog API serves the public price list
    # and Google documents it as API-key authenticated, so this is a single
    # string like every other credential here. It replaced a service-account
    # JSON — a ~2.3 KB multi-line blob that could not be an app setting and so
    # needed a runtime vault client, an OAuth library and a signed-JWT exchange,
    # all to read prices that are public.
    "GCP_BILLING_API_KEY" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/GCP-BILLING-API-KEY)"

    # DECISION 6 — proves a request arrived through Cloudflare rather than
    # directly at the origin. Without it client-identity.js refuses to derive a
    # rate-limit key in production.
    "CF_ORIGIN_SECRET" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/CF-ORIGIN-SECRET)"
    "CLIENT_IP_SALT"   = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/CLIENT-IP-SALT)"

    # -------------------------------------------------------------------------
    # Runtime Key Vault bindings.
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
    # These resolve to empty until the vault is seeded (TODO.md). Optional
    # integrations remain disabled until their owner-approved credentials exist.
    # -------------------------------------------------------------------------

    # AI generation — content drafting, scoring and image pipelines.
    #
    # Every model call goes to an EXTERNAL provider API with a key from Key
    # Vault. There is deliberately no AZURE_OPENAI_ENDPOINT and no Azure
    # OpenAI account behind it: the platform-hosted path was removed once the
    # decision landed that both text and image generation use the providers'
    # own APIs. Re-adding an Azure OpenAI account would be a second, unused
    # route to the same capability — and in this region it could not be used
    # regardless, since the subscription holds zero model quota.
    #
    # GEMINI_API_KEY reaches Gemini through the PUBLIC Generative Language API,
    # not Vertex. Vertex authenticates with Application Default Credentials — a
    # GCP identity this Function App cannot hold — so it was dropped from the
    # router at the port. The model ids are the same either way.
    #
    # It is listed first because it is first in preference order as of
    # 2026-08-23 (owner decision; see DEFAULT_PROVIDER_ORDER in
    # functions/src/lib/ai/ai-config.js). An unseeded secret resolves to the
    # literal @Microsoft.KeyVault(...) string, which readKey() treats as no key
    # at all — so until GEMINI-API-KEY is seeded the router simply moves on to
    # OpenAI. Adding this reference does not switch anything on by itself.
    "GEMINI_API_KEY"     = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/GEMINI-API-KEY)"
    "ANTHROPIC_API_KEY"  = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/ANTHROPIC-API-KEY)"
    "OPENAI_API_KEY"     = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/OPENAI-API-KEY)"
    "PERPLEXITY_API_KEY" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/PERPLEXITY-API-KEY)"
    "REPLICATE_API_KEY"  = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/REPLICATE-API-KEY)"

    # Listen & Learn audio.
    #
    # There is deliberately NO new setting for the default path: Gemini TTS
    # reads GEMINI_API_KEY, declared above for the text models, so the feature
    # is switched on by a secret that is already seeded and costs no new
    # service, resource or credential. That is also why it is first in
    # preference order (listen-and-learn/speech/index.js).
    #
    # AZURE_SPEECH_* is the fallback and is expected to stay unresolved. Every
    # Gemini TTS model is a *preview* model, and preview endpoints get retired;
    # a GA second path is what makes that a config change rather than an
    # outage. An unseeded reference arrives as the literal
    # @Microsoft.KeyVault(...) string, which readSetting() treats as no key at
    # all — so the provider simply is not offered, and declaring it here
    # switches nothing on and provisions nothing. Using it means creating a
    # Cognitive Services resource, which is a spend decision (TODO.md).
    "AZURE_SPEECH_KEY"    = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/AZURE-SPEECH-KEY)"
    "AZURE_SPEECH_REGION" = var.speech_region

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

    # Staging-preview link signing (T-606). Until the secret is seeded via the
    # vault procedure, readKey() sees the unresolved reference as unconfigured
    # and the preview route answers 404 — the loop arms itself when seeded.
    "PREVIEW_SIGNING_SECRET" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/PREVIEW-SIGNING-SECRET)"

    "NODE_ENV" = "production"

    # Timer clock. NCRONTAB on Linux Flex Consumption evaluates in UTC unless
    # told otherwise; 7 of Site-Main's 16 schedules are declared in
    # America/Chicago (the Friday 09:00 digest, the overnight publishers).
    # Porting the expressions verbatim without this would shift every one of
    # them by five or six hours depending on DST. Migration-Plan §4 carries the
    # per-timer table; the ported NCRONTAB expressions assume this setting.
    "WEBSITE_TIME_ZONE" = "America/Chicago"

    # T-206, last step. With "1" the public content list asks Cosmos for the
    # NEWEST N documents (ORDER BY c.cp_sortDate DESC) instead of an arbitrary
    # N that is then sorted in memory. cp_sortDate is a computed property the
    # healer workflow maintains on `content` and `blogs` — present on both as
    # of 2026-08-21 (run 32448029469) — and it is defined on every document
    # ("" when no date alias exists), which is what makes ORDER BY safe.
    # Precondition before flipping: `apply-computed-sortdate.mjs --inspect`
    # clean (every date alias ISO-sortable). Flip back to "0" if the list
    # ever comes back empty or mis-ordered; the in-memory sort still runs.
    "PUBLIC_LIST_SQL_ORDER" = "1"

    # Feature flags.
    #
    # One per timer. They previously shared FEATURE_FLAG_SCHEDULERS, so enabling
    # the scheduled publisher would also have armed cleanupTempStorage — an
    # unimplemented TODO that deletes blobs (TODO.md T-302).
    #
    # FEATURE_FLAG_SCHEDULERS is a master kill switch only: "false" holds every
    # timer off regardless of the individual flags, and any other value defers
    # to them (schedulers.js: `masterDisabled = FEATURE_FLAG_SCHEDULERS ===
    # 'false'`, checked before the per-timer flag).
    #
    # IT WAS A HARDCODED "false" HERE UNTIL 2026-08-24, which quietly cancelled
    # the design the next twenty lines describe. `enabled_timers` is a workspace
    # variable so that arming a timer is a variable edit, but the master switch
    # sat above it as a literal — so adding a timer to `enabled_timers` produced
    # a green apply, a changed app setting, and a timer that still returned
    # "disabled — skipping" on every tick. All 18 were permanent no-ops and
    # nothing said so. A cutover step cannot be verified by the thing it
    # configures if that thing is a constant.
    #
    # var.schedulers_master_enabled defaults to false, so this line writes the
    # same "false" it wrote before until an owner decides otherwise. What
    # changed is that the decision is now reachable.
    "FEATURE_FLAG_SCHEDULERS" = var.schedulers_master_enabled ? "true" : "false"

    # One flag per timer (functions/src/functions/schedulers.js, Migration-Plan
    # §4.2). All implemented; each is turned on ONE AT A TIME at cutover after
    # being observed firing at the intended local time (§6 step 7).
    #
    # These are generated from `local.timer_flags` rather than written out here,
    # so turning a timer on is a WORKSPACE VARIABLE edit — add its name to
    # `enabled_timers` — and not a code change. Eighteen timers turned on one at
    # a time would otherwise be eighteen pull requests during a cutover window,
    # which is how a "one at a time, watch each one" procedure quietly becomes
    # "turn them all on and see what breaks".
    #
    # The name in `enabled_timers` is the flag suffix, e.g. SYNC_RSS_FEEDS. An
    # unrecognised name fails the plan (see the validation on the variable)
    # rather than silently arming nothing, because a typo here is indisting-
    # uishable from a timer that does not fire.
    }, local.timer_flags, {
    # The two that delete blobs stay DRY-RUN even when their flag is on, until
    # the matching *_DELETE setting is "true" (TODO.md T-302). Deliberately NOT
    # part of enabled_timers: arming the timer and arming the deletion are two
    # decisions, and conflating them is how a dry run becomes a data loss.
    "TEMP_STORAGE_CLEANUP_DELETE" = "false"
    "CERT_IMAGE_CLEANUP_DELETE"   = "false"

    # Extra browser origins allowed to call the API, comma-separated, on top of
    # the production allowlist compiled into lib/auth/cors.js
    # (hybridcloudworks.com and www). Needed for §6 step 2: the site runs on the
    # Static Web App's own *.azurestaticapps.net hostname before DNS moves, and
    # that origin is not in the compiled list — so without this every API call
    # from the parallel-running site fails CORS, which looks like a broken API.
    # NOT "CORS_ALLOWED_ORIGINS" — that name collides with the read-only CORS
    # environment variables App Service injects from siteConfig.cors, so the
    # worker receives an empty array's serialisation (`[]`) no matter what is
    # written here. Proven on 2026-08-22 by three independent writers, T-513.
    "EXTRA_ALLOWED_ORIGINS" = join(",", var.cors_extra_origins)

    # T-513 sentinel — which writer's configuration generation is this worker
    # actually running? ARM answers "the last one written". Only the worker can
    # answer "the one I consumed", and on 2026-08-22 those disagreed: a fresh
    # worker held the literal string `[]` for CORS_ALLOWED_ORIGINS while ARM
    # held the real value.
    #
    # Two dimensions, because one cannot separate the two writes that happen in
    # a single apply — azurerm writes this whole map, then the azapi pair below
    # reads the result back and writes it again minus AzureWebJobsStorage. Both
    # carry the same generation. The WRITER marker is the only thing that says
    # which of the two a process consumed, and the azapi write deliberately
    # overrides it to `azapi-strip`.
    #
    # NOT timestamp(): that would change on every plan, propose a diff forever
    # and restart the host each apply. The generation must be an immutable
    # identifier supplied by whatever performed the deployment.
    # Guard gate 2 — the admins/{oid} registry (TODO.md, lib/admin-identity.js).
    # Gate 1 is the Entra `Admin` App Role; a token carrying it and no registry
    # record is still a 403, which is the point: directory membership alone does
    # not grant access to this application.
    #
    # This allowlist is consulted ONLY when the registry holds zero active
    # admins — bootstrapCurrentUserAdmin checks that first and requires
    # super_admin for every later call. So it is a first-admin escape hatch, not
    # a standing grant, and FINDING-06 forbids an allow-any form of it.
    #
    # BOTH forms are set deliberately. The owner is a B2B guest whose UPN
    # (spatino_hybridcloudworks.com#EXT#@...onmicrosoft.com) is not their mail
    # address, and which of the two an Entra token carries in `email` /
    # `preferred_username` is not worth guessing — the object id is unambiguous
    # and the email costs nothing as a second chance.
    "CMS_BOOTSTRAP_ALLOWED_UIDS"   = join(",", var.bootstrap_admin_oids)
    "CMS_BOOTSTRAP_ALLOWED_EMAILS" = join(",", var.bootstrap_admin_emails)

    "RUNTIME_CONFIG_GENERATION" = var.config_generation

    # THIS KEY MAKES EVERY PLAN SHOW A DIFF, AND THAT IS EXPECTED.
    #
    # azapi_update_resource below rewrites it to "azapi-strip" in the same
    # apply, so the live value is never what this line declares. Every
    # subsequent plan therefore reports:
    #
    #   ~ "RUNTIME_CONFIG_WRITER" = "azapi-strip" -> "azurerm"
    #   Plan: 3 to add, 1 to change, 3 to destroy
    #
    # — the change being this key, and the 3/3 being the three azapi resources
    # replaced by their `replace_triggered_by`: the settings read, the settings
    # strip, and the FTP basic-auth policy below them. (It was 2/2 until
    # 2026-08-24, when the FTP policy was added.) A plan reporting exactly that
    # and nothing else means NO DRIFT.
    #
    # DO NOT APPROVE THAT BY EYE (T-724). "And nothing else" is the entire
    # content of the claim, and it is the part a human reading a summary line
    # cannot check: three destroys look like three destroys whichever three
    # they are, and since T-708 the Cosmos containers are exactly the kind of
    # resource that could be among them. Run the assertion instead —
    #
    #     terraform show -json tfplan > plan.json
    #     node scripts/assert-expected-plan.mjs plan.json
    #
    # — which compares the change set against the three azapi ADDRESSES and
    # this one attribute, and fails on anything else, including a second
    # setting changing on this same resource. It also fails when an expected
    # change STOPS appearing, because a strip that is not running is how
    # AzureWebJobsStorage comes back (T-511).
    #
    # It is not in CI: the plan runs in HCP Terraform and `iac-validate.yml`
    # has no workspace token, so wiring it up needs a TFC API token as a
    # repository secret — an owner action, tracked in TODO.md.
    #
    # ON EVERY azurerm MINOR UPGRADE, re-test issue #29149. If it has closed,
    # delete the azapi pair, the azapi provider, T-511 and
    # scripts/assert-expected-plan.mjs together, and confirm with the
    # post-apply check in deploy-functions.yml — which is what fails if the
    # strip stops working.
    #
    # It is noise, it is permanent, and the
    # only thing worse than the noise is silencing it wrongly.
    #
    # Do NOT "fix" it with ignore_changes on this key. That would make azurerm
    # carry the live "azapi-strip" into its own write, so a worker that
    # consumed the FIRST write and missed the strip would report "azapi-strip"
    # too — which is the one thing this marker exists to make impossible. The
    # strip is what keeps AzureWebJobsStorage from breaking SyncTriggers, and
    # three production incidents were diagnosed by exactly this distinction.
    #
    # The drift is structural: two writers manage one settings map, and telling
    # them apart requires them to disagree. It cannot be removed without
    # removing the signal. It goes away on its own when
    # hashicorp/terraform-provider-azurerm#29149 closes and both azapi
    # resources are deleted — see the T-511 block below.
    "RUNTIME_CONFIG_WRITER" = "azurerm"
  })

  identity {
    type = "SystemAssigned"
  }

  tags = local.tags
}

# ---------------------------------------------------------------------------
# Strip the `AzureWebJobsStorage` azurerm re-injects — T-511.
# ---------------------------------------------------------------------------
#
# `azurerm_function_app_flex_consumption` writes an `AzureWebJobsStorage`
# connection string with an EMPTY AccountKey on every apply, whatever
# `storage_authentication_type` says, and never shows it in plan
# (hashicorp/terraform-provider-azurerm#29149, open since March 2025). The host
# prefers that string over the identity-based `AzureWebJobsStorage__accountName`
# below, attempts shared-key auth with no key, and fails every storage call on
# the signature — which does NOT present as storage. It presents as SyncTriggers
# not registering new functions, and as "The listener for function 'Functions.X'
# was unable to start" on every timer and queue trigger. Three incidents:
# 2026-08-20 (every route 404), 2026-08-21 (83 deployed / 80 registered), and
# 2026-08-21 again (timer listeners down through the 104-function deploy).
#
# The widely-cited `"AzureWebJobsStorage" = ""` workaround is NOT used here: it
# worked until early May 2026 and then stopped, confirmed by three separate
# reporters on the issue. An empty value is also indistinguishable from a
# misconfiguration to anyone reading this file later.
#
# So the setting is removed inside the same apply that creates it. `list` reads
# the settings azurerm has just written; `update` writes them back without that
# one key. `replace_triggered_by` on the whole function app is deliberate rather
# than on `.app_settings` alone — the provider decides when it re-injects, this
# configuration does not, and a narrower trigger is a guess about behaviour that
# is already known to change without notice. If the function app did not change,
# azurerm wrote no config and there is nothing to strip.
#
# This is why azapi is a dependency (providers.tf). It is a thin ARM passthrough:
# it writes the body it is given and nothing else, which is exactly the property
# azurerm lacks here.
#
# WHEN #29149 CLOSES, delete both resources, the azapi provider, and T-511 — and
# confirm with the post-apply check in deploy-functions.yml, which is what fails
# if this stops working.

# SECRETS-IN-STATE: THIS EXPORT IS THE WHOLE LIVE SETTINGS MAP (T-723).
#
# `response_export_values = ["properties"]` is not a projection of what the HCL
# above declares — it is everything ARM currently holds on the app, written into
# Terraform state unredacted and from there into HCP Terraform's plan JSON. The
# IaC standard says secret values never transit state.
#
# It is safe because of exactly one property, and the property is not local to
# this resource: **every secret-shaped app setting is a
# `@Microsoft.KeyVault(SecretUri=…)` reference**, so what lands in state is a
# pointer rather than a credential. The first setting written with a literal
# value — here, or out of band by a human on the live app — makes a credential
# round-trip through state on every apply, with no plan diff worth noticing and
# no error.
#
# `functions/src/functions/app-settings-secrets.test.js` asserts that invariant
# by reading this file as text, so it fails in CI rather than being rediscovered
# from a state file. It cannot see an out-of-band write; nothing here can, which
# is why §4.5 of TODO.md says settings are Terraform-managed and editing one
# by hand is how drift starts.
#
# The narrower export that would remove the problem does not exist: the strip
# below has to rewrite the complete map, because ARM's appsettings PUT replaces
# rather than merges — sending a subset would delete every setting not sent.
resource "azapi_resource_action" "function_app_settings" {
  type        = "Microsoft.Web/sites@2024-04-01"
  resource_id = azurerm_function_app_flex_consumption.hcw.id
  action      = "config/appsettings/list"
  method      = "POST"

  response_export_values = ["properties"]

  lifecycle {
    replace_triggered_by = [azurerm_function_app_flex_consumption.hcw]
  }
}

resource "azapi_update_resource" "function_app_settings_without_webjobs_storage" {
  type        = "Microsoft.Web/sites/config@2024-04-01"
  resource_id = "${azurerm_function_app_flex_consumption.hcw.id}/config/appsettings"

  body = {
    # The WRITER marker is overridden here and the generation deliberately is
    # not. Both writes belong to the same apply and therefore the same
    # generation; what differs is which of them a worker actually consumed
    # (T-513). A worker reporting `azurerm` has the first write and missed this
    # one; `azapi-strip` has this one. Without the marker the two are
    # indistinguishable, because ARM shows only the final state either way.
    #
    # Values pass through exactly as azapi returned them, unchanged. Wrapping
    # them in tostring() would be reasonable hardening — app-settings values are
    # strings — but doing it now could silently remove the very fault under
    # investigation and destroy the evidence. Harden after T-513 closes.
    properties = merge(
      {
        for key, value in azapi_resource_action.function_app_settings.output.properties :
        key => value if key != "AzureWebJobsStorage"
      },
      { "RUNTIME_CONFIG_WRITER" = "azapi-strip" }
    )
  }

  lifecycle {
    replace_triggered_by = [azapi_resource_action.function_app_settings]
  }
}

# ---------------------------------------------------------------------------
# FTP basic publishing credentials, off.
# ---------------------------------------------------------------------------
#
# `webdeploy_publish_basic_authentication_enabled = false` above closes the SCM
# half of publishing credentials. It reads like it closed both, and it did not:
# Azure keeps two independent `basicPublishingCredentialsPolicies` child
# resources, `scm` and `ftp`, and the azurerm argument writes only the first.
# On the live app that left `scm.allow = false` next to `ftp.allow = true` —
# a username/password publishing surface still open on a production app that
# has never used a publish profile and deploys with OIDC.
#
# There is no azurerm argument for the FTP half on this resource type.
# `azurerm_linux_function_app` has `ftp_publish_basic_authentication_enabled`;
# `azurerm_function_app_flex_consumption` does not expose it in 5.1.0 —
# confirmed against the installed provider's own schema, whose only publishing
# argument is the webdeploy one. So this is the same shape as the strip above:
# azapi writes the one property azurerm cannot reach, and nothing else.
#
# `replace_triggered_by` on the whole function app for the same reason the pair
# above carries it. The FTP policy is a CHILD of the site: replace the site and
# the child comes back at its default, which is `allow: true`. Without this the
# lock would come off silently on the one event that recreates the app, and the
# only way to notice would be to go and look. This costs one more add/destroy
# pair in every plan (see the RUNTIME_CONFIG_WRITER note above, which counts
# them) and buys a setting that cannot quietly revert.
#
# THE WAY BACK IS NOT DELETING THIS RESOURCE. Every other control in this
# configuration reverts by changing a value and applying; this one does not,
# because destroying an azapi_update_resource performs no API call — it drops
# the resource from state and leaves the property exactly as it last wrote it.
# So removing this block leaves FTP basic auth OFF permanently and silently.
# That is the desirable direction and it is still a surprise if nobody says so.
# To actually restore FTP publishing, set `allow = true` here and apply, or
# write the property directly with `az resource update` against the same
# basicPublishingCredentialsPolicies/ftp child — then remove the block.
resource "azapi_update_resource" "function_app_ftp_basic_auth" {
  type        = "Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01"
  resource_id = "${azurerm_function_app_flex_consumption.hcw.id}/basicPublishingCredentialsPolicies/ftp"

  # Ordered after the app-settings strip rather than left to the graph. Both
  # write children of the same site and both are replaced on every apply via
  # replace_triggered_by, so without an edge their relative order is incidental.
  # The strip is the one that matters: until it completes the site is carrying a
  # keyless AzureWebJobsStorage, which is the state three recorded incidents came
  # from. Finish that first, then harden FTP.
  depends_on = [azapi_update_resource.function_app_settings_without_webjobs_storage]

  body = {
    properties = {
      allow = false
    }
  }

  lifecycle {
    replace_triggered_by = [azurerm_function_app_flex_consumption.hcw]
  }
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
  resource_group_name = azurerm_resource_group.app["db"].name
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

# Queue and Table on the same account, because identity-based
# AzureWebJobsStorage is not a blob-only contract.
#
# Blob alone is the intuitive grant and it is not enough. The host's own health
# probe reports:
#
#   "azure.functions.webjobs.storage": { "status": "Unhealthy",
#     "description": "Unable to access AzureWebJobsStorage",
#     "errorCode": "AuthenticationFailed" }
#
# while web_host.lifecycle and script_host.lifecycle both report Healthy — so
# the app serves HTTP perfectly and only the storage-backed machinery is down.
# That is the trap: HTTP routes answer 200, every smoke test passes, and timer
# triggers, singleton locks and SyncTriggers silently do not run. A scheduled
# function that never fires produces no error anywhere.
#
# Found 2026-08-20, after removing a keyless AzureWebJobsStorage connection
# string in favour of AzureWebJobsStorage__accountName. The connection string
# had been failing first, which masked the missing roles behind a different
# error with the same symptom.
resource "azurerm_role_assignment" "func_host_storage_queue" {
  scope                = azurerm_storage_account.functions.id
  role_definition_name = "Storage Queue Data Contributor"
  principal_id         = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

resource "azurerm_role_assignment" "func_host_storage_table" {
  scope                = azurerm_storage_account.functions.id
  role_definition_name = "Storage Table Data Contributor"
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
  location                   = azurerm_resource_group.app["sec"].location
  resource_group_name        = azurerm_resource_group.app["sec"].name
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
  # See TODO.md for the runbook.
  network_acls {
    default_action             = "Deny"
    bypass                     = "AzureServices"
    virtual_network_subnet_ids = [azurerm_subnet.functions_integration.id]
    ip_rules                   = var.admin_ip_rules
  }

  # Secrets are seeded by hand and exist nowhere else in managed form.
  # Replacement must be an explicit, reviewed decision.
  #
  # Of the four guards lifted for the centralus rebuild on 2026-08-19, this was
  # the only one whose contents Terraform cannot rebuild. Destroying this vault
  # destroys every secret in it, and the failure mode afterwards is quiet: the
  # app deploys clean and its @Microsoft.KeyVault(...) references resolve to
  # nothing, so a missing credential presents as missing data (see the note on
  # the integration subnet above).
  #
  # That rebuild was safe only because the secret values were held outside
  # Azure and re-seeded by hand afterwards. Guard restored the same day. Any
  # future plan that replaces this vault must export first — the Deployment
  # Runbook's export procedure is a prerequisite, not a suggestion.
  lifecycle {
    prevent_destroy = true
  }

  tags = local.tags
}

# Key Vault Secrets User — Function App managed identity.
#
# The PLATFORM uses this to resolve every "@Microsoft.KeyVault(SecretUri=...)"
# app setting before the process starts. No application code holds a vault
# client any more (src/lib/key-vault.js was deleted 2026-08-29 with its last
# caller), so this grant is not "the app reading secrets" — it is the host
# reading them on the app's behalf. Removing it does not break a code path; it
# leaves every referenced setting unresolved, which /api/health reports as
# unresolvedSecrets > 0.
resource "azurerm_role_assignment" "func_kv_secrets" {
  scope                = azurerm_key_vault.hcw.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

# =============================================================================
# The API-keys page: write-only vault access, and a config refresh
# =============================================================================
# Seeding a credential used to mean opening this vault's firewall to a human's
# IP, running scripts/cutover/06-seed-secret.ps1 from a desktop, and closing it
# again — three steps, one of which leaves production open to the internet if
# the operator is interrupted. This repository has already made that mistake
# once. The app never had that problem: it is in the integration subnet, which
# network_acls already admits. It was missing permission, not a network path.
#
# WHY A CUSTOM ROLE AND NOT "Key Vault Secrets Officer". Officer grants every
# secret operation — get, list, set, delete, recover, purge. The page promises
# that a pasted credential cannot be read back out, and a promise the platform
# does not enforce is a promise one refactor away from being false. This role
# can create a new secret VERSION and do nothing else: it cannot read, it
# cannot delete, and it cannot purge, so a compromised app can neither harvest
# the vault nor destroy it.
#
# The honest limit: a secret that resolves into an app setting is in the app's
# environment by definition, so this does not hide the values the app actively
# uses. It stops it reading OTHER secrets, OLD versions, and anything it has no
# reference for.
resource "azurerm_role_definition" "kv_secret_writer" {
  name        = "${var.workload_name}-keyvault-secret-writer"
  scope       = azurerm_key_vault.hcw.id
  description = "Create new secret versions. No read, no delete, no purge."

  permissions {
    actions          = []
    not_actions      = []
    data_actions     = ["Microsoft.KeyVault/vaults/secrets/setSecret/action"]
    not_data_actions = []
  }

  assignable_scopes = [azurerm_key_vault.hcw.id]
}

resource "azurerm_role_assignment" "func_kv_secret_writer" {
  scope              = azurerm_key_vault.hcw.id
  role_definition_id = azurerm_role_definition.kv_secret_writer.role_definition_resource_id
  principal_id       = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

# App Service caches Key Vault references and refetches them every 24 hours, so
# without this a pasted key sits in the vault, correct and unused, for up to a
# day — and the page looks broken. The documented remedy is a POST to the site's
# config/configreferences/appsettings/refresh endpoint, which needs a
# management-plane right on the app itself.
#
# WHAT IS DELIBERATELY NOT HERE: Microsoft.Web/sites/config/list/action. That is
# the action that READS app settings back, secret values included, and granting
# it would hand the app a way around the set-only vault role above. Write
# without list is the whole point.
#
# Scoped to this one site, not the resource group. And the refresh call is
# best-effort in code (lib/secret-vault.js): if this assignment is missing or
# ARM refuses, the secret is already safely written and the only cost is that it
# goes live on the 24-hour cycle instead of now.
resource "azurerm_role_definition" "func_config_refresh" {
  name        = "${var.workload_name}-function-config-refresh"
  scope       = azurerm_function_app_flex_consumption.hcw.id
  description = "Refresh this site's Key Vault references. Cannot list settings back."

  permissions {
    actions          = ["Microsoft.Web/sites/config/Write"]
    not_actions      = ["Microsoft.Web/sites/config/list/action"]
    data_actions     = []
    not_data_actions = []
  }

  assignable_scopes = [azurerm_function_app_flex_consumption.hcw.id]
}

resource "azurerm_role_assignment" "func_config_refresh" {
  scope              = azurerm_function_app_flex_consumption.hcw.id
  role_definition_id = azurerm_role_definition.func_config_refresh.role_definition_resource_id
  principal_id       = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}

# REMOVED (T-748): azurerm_role_assignment.terraform_kv_secrets, which granted
# Key Vault Secrets Officer to the HCP Terraform workspace principal for
# "CI/CD secret seeding".
#
# It had no consumer. Terraform manages no secret VALUES in this configuration —
# there is not one azurerm_key_vault_secret resource in infra/ — and TFC's
# runners are neither in this VNet nor a trusted Azure service, so the grant
# could not write from a run even if something wanted to. Its only live effect
# was latent: whenever admin_ip_rules opens a seeding window, a shared remote
# execution environment would gain write access to every production secret
# alongside the named human operator.
#
# Seeding is covered by the admin_object_ids window below, which grants named
# humans. The repository's own doctrine (oidc.tf: "deploys do not read secrets")
# argues against handing that reach to an automation principal that never
# needed it.

# Key Vault Secrets Officer — named human operators, for the seeding windows the
# cutover scripts need.
#
# Every script in scripts/cutover that touches a secret assumed this existed.
# It did not: the vault is RBAC-authorised with no access policies, so the only
# principals with data-plane access were the Function App and the Terraform
# service principal above. `04-telegram-webhook.ps1` opened the firewall exactly
# as designed on 2026-08-23 and was refused by RBAC, which looks like a broken
# script and is actually a missing role assignment.
#
# Empty by default and emptied again after the window, for the same reason
# admin_ip_rules is: standing human access to production secrets is not a steady
# state worth having.
resource "azurerm_role_assignment" "admin_kv_secrets" {
  for_each = toset(var.admin_object_ids)

  scope                = azurerm_key_vault.hcw.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.value
}

# =============================================================================
# Budget Alert (replaces GCP billing export + budget alert)
# =============================================================================
# Scoped to the SUBSCRIPTION, not a resource group. It was resource-group
# scoped while the workload was one group; splitting into six by service
# category would have left the budget watching whichever one it was pinned to
# and silently ignoring the other five — a budget that under-reports is worse
# than none, because it reads as reassurance. The application subscription is
# now the boundary that means "this workload", so that is what it watches.
#
# contact_groups crosses a subscription boundary: the budget lives in App, the
# action group in Management. This said the ARM API "doubtfully" supported that
# until 2026-08-24; the doubt is half resolved and the half that remains is the
# half that matters. This budget applied, so ARM ACCEPTS the reference. Whether
# a notification is ever DELIVERED through it is still unobserved, and this
# resource cannot tell anyone: contact_emails below is an independent path, so
# the mail arrives either way and an inert action group looks identical to a
# working one from here.
#
# That indifference is exactly what the alert rules in observability.tf do not
# have — they can only route through an action group — so the delivery test
# belongs there, and the note in that file's Alert rules header says how.
resource "azurerm_consumption_budget_subscription" "hcw" {
  name            = "${var.workload_name}-monthly-budget"
  subscription_id = "/subscriptions/${var.subscription_app}"
  amount          = var.budget_amount_usd
  time_grain      = "Monthly"

  # Azure rejects a monthly budget whose start date is before the current
  # month (400: "Start date for monthly time grain should not be prior to
  # current month"), so this is not a free-form "when we started" field — it
  # goes stale and breaks the NEXT first-apply into a fresh subscription.
  # Existing budgets are unaffected: the constraint is checked on create.
  #
  # A variable rather than a literal so a later deployment can set it without
  # editing this file. Terraform has no "current month" function that would be
  # stable across plans, and a timestamp() here would propose a diff on every
  # run.
  time_period {
    start_date = var.budget_start_date
  }

  # T-505: the approved threshold ladder (50/75/90/100 actual + forecast),
  # routed through the ops action group as well as direct email. Five
  # notifications is the budget API's maximum.
  dynamic "notification" {
    for_each = [50, 75, 90, 100]
    content {
      enabled        = true
      threshold      = notification.value
      operator       = "GreaterThanOrEqualTo"
      threshold_type = "Actual"
      contact_emails = [var.budget_alert_email]
      contact_groups = [azurerm_monitor_action_group.ops.id]
    }
  }

  # Forecasted overrun fires before the money is spent — the alert that
  # actually leaves time to act.
  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Forecasted"
    contact_emails = [var.budget_alert_email]
    contact_groups = [azurerm_monitor_action_group.ops.id]
  }
}

# The second budget, because the first one is scoped to a subscription that
# does not contain the platform's most variable cost.
#
# The workload subscription is where almost everything lives, and almost
# everything there is serverless and near-free at this traffic. The one line
# that scales with load rather than with inventory is Log Analytics ingestion —
# and the workspace bills in Platform Management, which had no budget at all.
# So the thing worth watching was the thing nothing watched, and the estate
# would have looked in-budget right up to a surprise.
#
# `provider = azurerm.mgmt` for the same reason the workspace and the action
# group carry it: subscription_id below names the scope, but the provider
# decides which subscription the ARM call goes to, and without the alias this
# is written into the application subscription — where the name would collide
# with nothing and simply watch the wrong thing.
#
# Deliberately NOT scoped to the resource group. A subscription budget catches
# a cost that appears somewhere nobody expected, which is the case a budget is
# for; a resource-group budget silently ignores everything outside it.
#
# Same threshold ladder as the workload budget, and the same action group, so
# the two read identically in the inbox and neither needs its own runbook.
resource "azurerm_consumption_budget_subscription" "platform_mgmt" {
  provider = azurerm.mgmt

  name            = "plat-mgmt-monthly-budget"
  subscription_id = "/subscriptions/${var.subscription_mgmt}"
  amount          = var.budget_amount_mgmt_usd
  time_grain      = "Monthly"

  time_period {
    start_date = var.budget_start_date
  }

  dynamic "notification" {
    for_each = [50, 75, 90, 100]
    content {
      enabled        = true
      threshold      = notification.value
      operator       = "GreaterThanOrEqualTo"
      threshold_type = "Actual"
      contact_emails = [var.budget_alert_email]
      contact_groups = [azurerm_monitor_action_group.ops.id]
    }
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Forecasted"
    contact_emails = [var.budget_alert_email]
    contact_groups = [azurerm_monitor_action_group.ops.id]
  }
}

# Change feed lease container — explicit so it has a controlled partition key
# and is tracked in state (not auto-created by the SDK at runtime).
#
# The lease store for the six change-feed functions (T-324), each under its own
# prefix (`<functionName>-`). `createLeaseContainerIfNotExists = false` in the
# bindings: the container is Terraform's, never the SDK's.
resource "azurerm_cosmosdb_sql_container" "leases" {
  name                = "leases"
  resource_group_name = azurerm_resource_group.app["db"].name
  account_name        = azurerm_cosmosdb_account.hcw.name
  database_name       = azurerm_cosmosdb_sql_database.hcw.name
  partition_key_paths = ["/id"]

  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
  }

  # Lower stakes than the data containers — these are continuation tokens, not
  # documents, and resetting the feed by dropping them is a legitimate (if
  # disruptive) operation: every change-feed function would reprocess from the
  # start, which the rising-edge claims make mostly idempotent. The guard is
  # here for the accidental case, not to declare the container permanent; it
  # comes off in a reviewed PR when a reset is what you actually want (T-708).
  lifecycle {
    prevent_destroy = true
  }
}

# =============================================================================
# Cloudflare DNS — Azure Static Web App custom domain
#
# The existing root Terraform manages VPS subdomains (api, auth, argocd, etc.).
# This module adds the Azure-specific records used by the website and API.
# =============================================================================

# Azure SWA custom domain validation TXT record
# REMOVED 2026-08-23: cloudflare_record.azure_swa_txt_validation
#
# It published the Static Web App's default hostname as a TXT value at the apex
# and was described, here and in the runbook, as the domain-ownership proof. It
# was neither. Azure validates a root domain against a TOKEN it generates when
# the validation starts — a value like `_6sod2vwest3f9qq3jascfmqk4g5c9jt` — and
# it never looks at a hostname in a TXT record. The record was inert from the
# day it was written.
#
# It cost real time on 2026-08-23: the runbook said binding "does not wait on
# DNS moving" because this record existed, so `az staticwebapp hostname set` was
# run for both hostnames and both failed. www needed an actual CNAME; the apex
# needed `--validation-method dns-txt-token` and the generated token.
#
# It is not replaced by a managed record. The token is minted per validation and
# is not knowable at plan time, so pinning one in Terraform would be state that
# drifts the moment Azure reissues it. The procedure is in the runbook, step 3b:
# start the validation, read the token with `az staticwebapp hostname show`, add
# it as a TXT record, and Azure completes on its own.
#
# The `asuid.` convention some Azure docs describe belongs to App Service and
# Front Door, NOT to Static Web Apps. This estate does use it — correctly — for
# the Function App: `cloudflare_record.azure_functions_domain_verification`
# publishes `asuid.api-azure` holding `custom_domain_verification_id`, which is
# exactly how App Service proves domain ownership. Carrying that pattern across
# to the Static Web App is the mistake this comment exists to prevent; SWA
# validates a root domain with a generated token instead.

# Azure Functions subdomain for the API origin.
resource "cloudflare_record" "azure_functions" {
  zone_id = var.cloudflare_zone_id
  name    = "api-azure"
  content = "${var.function_app_name}.azurewebsites.net"
  type    = "CNAME"
  proxied = true
  ttl     = 1
  comment = "Azure Functions API endpoint"
}

# =============================================================================
# Origin lock, Cloudflare half (DECISION 6)
#
# Stamps x-hcw-origin-secret onto every request Cloudflare proxies to the
# origin. functions/src/lib/auth/client-identity.js compares it against the
# CF-ORIGIN-SECRET it reads from Key Vault and, in production, throws when it
# does not match rather than trusting a spoofable CF-Connecting-IP.
#
# Phase is http_request_late_transform, not http_request_transform: the late
# phase runs AFTER any customer transform rules and after Cloudflare's own
# managed headers, so nothing downstream can strip or overwrite the header
# before it reaches the origin.
#
# Created only when a secret is supplied. An empty string means "the lock is
# not configured yet", and creating a rule that stamps an empty header would
# make viaCloudflare() compare "" to "" and pass for everyone — the exact
# silent degradation this design exists to prevent.
# =============================================================================
# =============================================================================
# Custom hostname binding — what makes the proxied hostname reach the app
#
# App Service routes by HTTP Host header. Cloudflare proxies api-azure.<domain>
# to the origin but forwards the ORIGINAL Host, so App Service receives
# `Host: api-azure.<domain>`, finds no site bound to that name, and returns its
# own "404 Web Site not found" page — before the Functions host is consulted at
# all. Every route 404s, and the page talks about custom domains rather than
# routing, which sends you to host.json and the route prefix instead.
#
# Two ways to fix it, and the first is not available here:
#
#   1. Rewrite the Host at the edge, with a Cloudflare Origin Rule. Rejected:
#      the API answers `not entitled to use the HostHeader override` — it is a
#      plan entitlement, not a permission, so no token change reaches it.
#
#   2. Bind the hostname on the Azure side, which is this.
#
# NO CERTIFICATE IS BOUND, deliberately. An App Service Managed Certificate is
# issued only when the hostname resolves to the app, and behind a proxied
# Cloudflare record it resolves to Cloudflare — so managed issuance cannot
# succeed without un-proxying, which would disable the origin lock. It is also
# not needed: Cloudflare connects to the origin at its azurewebsites.net name
# and receives the platform's own wildcard certificate, so the TLS leg is
# already valid. Only the HTTP Host needed fixing.
#
# Verification is the asuid TXT record below rather than a CNAME check, because
# a CNAME check follows DNS to Cloudflare and fails for the same reason.
# =============================================================================
resource "cloudflare_record" "azure_functions_domain_verification" {
  zone_id = var.cloudflare_zone_id
  name    = "asuid.api-azure"
  content = azurerm_function_app_flex_consumption.hcw.custom_domain_verification_id
  type    = "TXT"
  ttl     = 300
  comment = "Azure custom-domain ownership proof for the Functions origin"
}

resource "azurerm_app_service_custom_hostname_binding" "api" {
  hostname            = "api-azure.${var.domain}"
  app_service_name    = azurerm_function_app_flex_consumption.hcw.name
  resource_group_name = azurerm_resource_group.app["web"].name

  # Azure reads the TXT record at bind time, so it has to exist first. The
  # dependency is not inferable from the arguments above.
  depends_on = [cloudflare_record.azure_functions_domain_verification]
}

resource "cloudflare_ruleset" "origin_secret" {
  count = var.cloudflare_origin_secret == "" ? 0 : 1

  zone_id = var.cloudflare_zone_id
  name    = "Origin secret for the Azure Functions origin"
  kind    = "zone"
  phase   = "http_request_late_transform"

  rules {
    action      = "rewrite"
    description = "Stamp x-hcw-origin-secret on requests proxied to the Functions origin"
    enabled     = true
    # Scoped to the Functions hostname rather than the whole zone: the Static
    # Web App shares this zone and has no use for the header, and a secret is
    # safest where it is not sent to things that do not need it.
    expression = "(http.host eq \"api-azure.${var.domain}\")"

    action_parameters {
      headers {
        name      = "x-hcw-origin-secret"
        operation = "set"
        value     = var.cloudflare_origin_secret
      }
    }
  }
}
