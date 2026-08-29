# =============================================================================
# storage.tf — both storage accounts (content and the Functions host), their
# containers, the lifecycle policy, and the identity-based role assignments
# that replace account keys.
#
# Split out of main.tf on 2026-08-29 (T-754). Terraform reads every .tf file in
# this directory as ONE module: same namespace, same state, same plan. Nothing
# moved between states and no resource address changed — an empty plan is the
# proof, and `functions/test/terraform-source.js` is why the text-reading guards
# did not need to care.
# =============================================================================

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
