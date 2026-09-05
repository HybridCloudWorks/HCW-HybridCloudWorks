# =============================================================================
# functionapp.tf — the service plan, the Function App itself (including its
# app settings and the timer flag locals), and the azapi resources that patch
# what the azurerm provider cannot express.
#
# Split out of main.tf on 2026-08-29 (T-754). Terraform reads every .tf file in
# this directory as ONE module: same namespace, same state, same plan. Nothing
# moved between states and no resource address changed — an empty plan is the
# proof, and `functions/test/terraform-source.js` is why the text-reading guards
# did not need to care.
# =============================================================================

resource "azurerm_service_plan" "hcw" {
  name                = "asp-${var.workload_name}-${var.environment}-${var.region_abbreviation}-${var.instance}"
  location            = azurerm_resource_group.app["web"].location
  resource_group_name = azurerm_resource_group.app["web"].name
  os_type             = "Linux"
  sku_name            = "FC1" # Flex Consumption — VNet integration, scales to zero
  tags                = local.tags
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
    CLEANUP_SOFT_DELETED_CONTENT = "cleanupSoftDeletedContent — every 4 hours, purges soft-deleted documents (dry-run unless CONTENT_HARD_DELETE; a mark with no recorded origin is never deleted)"
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
    # The three that delete stay DRY-RUN even when their flag is on, until
    # the matching *_DELETE setting is "true" (TODO.md T-302). Deliberately NOT
    # part of enabled_timers: arming the timer and arming the deletion are two
    # decisions, and conflating them is how a dry run becomes a data loss.
    # CONTENT_HARD_DELETE is the content reaper's pin (T-518 Wave 3a): the
    # only one of the three that deletes documents rather than blobs. Flipped
    # 2026-09-05 (#343) after two dry-run firings were read at zero across
    # the board — nothing soft-deleted for longer than the 7-day grace window
    # existed, so the first armed run deletes nothing. A mark with no recorded
    # origin is refused in both modes (#334); the owner's planted test page is
    # the live witness for the classification, due a week after its mark.
    "TEMP_STORAGE_CLEANUP_DELETE" = "false"
    "CERT_IMAGE_CLEANUP_DELETE"   = "false"
    "CONTENT_HARD_DELETE"         = "true"

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
