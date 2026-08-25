# =============================================================================
# observability.tf — the plan's operational alarm fabric (TODO T-505)
#
# Action group, diagnostic settings, and the alert rules that route through it.
#
# The rules were held back until they could land with the evidence that
# motivated their thresholds. That evidence arrived on 2026-08-24, from a
# readiness review that found ZERO alert rules of any kind in either
# subscription — `az monitor metrics alert list`, `scheduledQueryRules`,
# `webtests` and `activity-log alert list` all returned empty — while the
# workspace those rules would have read from was simultaneously OverQuota. So
# the platform was both unmonitored and silently dropping the telemetry that
# would have shown it. Both halves are fixed here.
#
# Ingestion from every diagnostic setting here lands in the Log Analytics
# workspace, which carries a 0.25 GB/day cap (main.tf). The cap is the cost
# ceiling for this whole file. It is no longer a ceiling anyone has to
# remember: `logs_daily_cap` below fires at 80% of whatever the cap is set to,
# derived from the workspace resource so the two cannot drift.
#
# THRESHOLD HONESTY. Every threshold in this file is a first estimate, not an
# incident-derived number — there has never been an alert here to be wrong.
# Each one says what it assumes. Tune them against the first week of real
# firing rather than leaving an estimate in place because it is written down.
# =============================================================================

# One ops action group; the budget and future alert rules all route here so
# changing who gets paged is one edit, not five.
resource "azurerm_monitor_action_group" "ops" {
  # Follows its resource group into the Management subscription — without the
  # alias the ARM call goes to the application subscription and fails with
  # ResourceGroupNotFound.
  provider = azurerm.mgmt

  name                = "ag-plat-${var.environment}-${var.region_abbreviation}-${var.instance}"
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

# Cosmos — ControlPlaneRequests ONLY, down from the four categories the
# approved plan named. The other three were pruned on 2026-08-24 because they
# were the reason the workspace stopped ingesting anything at all.
#
# The workspace was found in dataIngestionStatus OverQuota against a 0.25
# GB/day cap. Three days of `Usage` explain why:
#
#   AppTraces                      0.284 GB   ~38% of the cap
#   CDBDataPlaneRequests           0.268 GB   ~36%
#   CDBPartitionKeyRUConsumption   0.076 GB   ~10%
#   AppRequests                    0.002 GB    ~0.3%
#   AppExceptions                  0.002 GB    ~0.3%
#
# Two Cosmos categories were burning ~46% of the cap, and the two tables an
# incident is actually read from were burning 0.5% — and then losing even that
# because the cap had tripped. Dropping DataPlaneRequests,
# PartitionKeyRUConsumption and QueryRuntimeStatistics takes total ingestion
# from ~0.21 GB/day to ~0.10 GB/day, roughly 38% of the cap. That is the whole
# fix; nothing else had to be sacrificed for it.
#
# WHAT THIS COSTS, stated plainly rather than buried: DataPlaneRequests was the
# per-request audit record of who read what. Losing it means a data-access
# question can no longer be answered from logs. The trade was made because a
# capped workspace answers no questions at all, and because the firewall
# (main.tf) already restricts callers to the Functions subnet and named
# operator windows. If the audit trail becomes a requirement, the answer is a
# dedicated table with a longer cap or an ingestion-time transformation that
# keeps only writes — not switching this category back on under a 0.25 GB cap.
#
# ControlPlaneRequests stays: it records firewall, key and configuration
# changes to the account, it is near-zero volume, and it is the category that
# would show an unexpected change to the account's security posture.
resource "azurerm_monitor_diagnostic_setting" "cosmos" {
  name                           = "diag-cosmos-to-logs"
  target_resource_id             = azurerm_cosmosdb_account.hcw.id
  log_analytics_workspace_id     = azurerm_log_analytics_workspace.hcw.id
  log_analytics_destination_type = "Dedicated"

  enabled_log {
    category = "ControlPlaneRequests"
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

# There is no Azure OpenAI diagnostic setting, because there is no Azure
# OpenAI account: model calls go to external provider APIs (see the app
# settings in main.tf). Their request logs live with the provider, not here.

# =============================================================================
# Alert rules
#
# All of them route to azurerm_monitor_action_group.ops above, for the reason
# that action group exists: changing who gets paged is one edit, not eight.
#
# CROSS-SUBSCRIPTION ACTION GROUP. The action group lives in the Management
# subscription; the rules below that watch workload resources must be created
# in the APPLICATION subscription, because an Azure Monitor alert rule has to
# sit in the same subscription as the resource it scopes. Referencing an action
# group across that boundary is the same thing
# azurerm_consumption_budget_subscription.hcw already does successfully in this
# tenant, which is the only evidence available without an apply. If ARM rejects
# one of these references, the fallback is the same one the budget documents: a
# second action group in the application subscription.
#
# WHERE THEY LIVE. Every application-subscription rule is in the `web` resource
# group, next to Application Insights, rather than beside the resource it
# watches. "What pages us" is then one list in one place instead of a rule
# hiding in each service's group.
#
# METRIC ALERTS OVER LOG ALERTS, where there is a choice. A log alert reads the
# Log Analytics workspace, so it goes silent exactly when the workspace stops
# ingesting — which is the failure this file was rewritten to fix. Platform
# metrics are not ingested into the workspace, are not billed by the GB, and
# keep evaluating through an OverQuota window. Only the two conditions with no
# metric equivalent (application exceptions, workspace capacity) are log alerts.
# =============================================================================

# ---------------------------------------------------------------------------
# Function App — the API is returning errors
# ---------------------------------------------------------------------------
#
# Http5xx counts responses the PLATFORM saw as 5xx, which includes the ones the
# app never got to answer: a host that failed to start, a cold start that timed
# out, a worker that died mid-request. That is deliberately wider than
# AppExceptions below, and the two are not redundant — a 500 with no exception
# is the host, an exception with no 500 is a handler that caught and degraded.
#
# THRESHOLD ASSUMPTION: more than 5 server errors in 15 minutes. This app
# scales to zero and a cold start can fail a request, so one or two in a window
# is noise. Nothing has fired yet to calibrate this; if the first week is
# quiet, lower it.
resource "azurerm_monitor_metric_alert" "function_http_5xx" {
  name                = "alert-func-http5xx-${var.environment}-${var.region_abbreviation}"
  resource_group_name = azurerm_resource_group.app["web"].name
  scopes              = [azurerm_function_app_flex_consumption.hcw.id]
  description         = "Function App returned more than 5 HTTP 5xx responses in 15 minutes."
  severity            = 1
  frequency           = "PT5M"
  window_size         = "PT15M"

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "Http5xx"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = 5
  }

  action {
    action_group_id = azurerm_monitor_action_group.ops.id
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# Function App — the API is slow
# ---------------------------------------------------------------------------
#
# HttpResponseTime, not AverageResponseTime: the latter is marked deprecated in
# the Microsoft.Web/sites metric reference and measures the same thing.
#
# THRESHOLD ASSUMPTION: mean response above 5 seconds sustained over 30
# minutes. The window is wider than the 5xx rule on purpose. Traffic here is
# low enough that a single cold start — seconds, on a plan with no always-ready
# instances by design (see the scale block in main.tf) — can dominate a short
# window's mean. Thirty minutes is long enough that one cold start cannot fire
# it and short enough to catch a genuinely degraded dependency.
resource "azurerm_monitor_metric_alert" "function_response_time" {
  name                = "alert-func-latency-${var.environment}-${var.region_abbreviation}"
  resource_group_name = azurerm_resource_group.app["web"].name
  scopes              = [azurerm_function_app_flex_consumption.hcw.id]
  description         = "Function App mean response time above 5 seconds over 30 minutes."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT30M"

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "HttpResponseTime"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 5
  }

  action {
    action_group_id = azurerm_monitor_action_group.ops.id
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# Cosmos — the account is throttling
# ---------------------------------------------------------------------------
#
# THIS IS A METRIC ALERT AND NOT THE SCHEDULED QUERY RULE THE REVIEW ASKED FOR,
# and the reason is in the diagnostic setting above. A KQL rule for 429s would
# have to read CDBDataPlaneRequests, which is the category that was just
# removed for consuming a third of the daily cap. Restoring it to feed a
# throttling alert would re-create the OverQuota condition the alert exists to
# help with. The platform metric carries the same signal, costs no ingestion,
# and — unlike any log alert — keeps evaluating while the workspace is capped.
#
# TotalRequests split on StatusCode is the documented way to see 429s; there is
# no dedicated throttled-request metric on this account type. `Count` is the
# metric's own aggregation type, not a choice.
#
# THRESHOLD ASSUMPTION: more than 10 throttled requests in 15 minutes. The
# Cosmos SDK retries a 429 transparently, so a handful is invisible to callers
# and normal. Ten in a window means retries are no longer absorbing it. This
# account is serverless — there is no provisioned RU dial to turn up, so a
# firing alert points at the query or the partition key, not at throughput.
resource "azurerm_monitor_metric_alert" "cosmos_throttled" {
  name                = "alert-cosmos-throttle-${var.environment}-${var.region_abbreviation}"
  resource_group_name = azurerm_resource_group.app["web"].name
  scopes              = [azurerm_cosmosdb_account.hcw.id]
  description         = "Cosmos returned more than 10 HTTP 429 (throttled) responses in 15 minutes."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"

  criteria {
    metric_namespace = "Microsoft.DocumentDB/databaseAccounts"
    metric_name      = "TotalRequests"
    aggregation      = "Count"
    operator         = "GreaterThan"
    threshold        = 10

    dimension {
      name     = "StatusCode"
      operator = "Include"
      values   = ["429"]
    }
  }

  action {
    action_group_id = azurerm_monitor_action_group.ops.id
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# Application — handlers are throwing
# ---------------------------------------------------------------------------
#
# Scoped to the Application Insights component rather than the workspace, so
# the rule reads only this application's telemetry even after a second workload
# starts shipping to the same workspace.
#
# AppExceptions is 0.3% of the daily cap. It is also, with AppRequests, the
# table an incident is read from — which is exactly why the Cosmos categories
# were pruned above instead of this one, and why ingestion sampling was NOT
# turned on. See the sampling note on azurerm_application_insights.hcw in
# main.tf: it would apply to precisely these two tables and to nothing else.
#
# THRESHOLD ASSUMPTION: more than 5 exceptions in 15 minutes. Unhandled
# exceptions here are supposed to be rare, but one failing timer can emit
# several per run, so a bare "greater than zero" would page on a known-broken
# integration forever.
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "app_exceptions" {
  name                = "alert-app-exceptions-${var.environment}-${var.region_abbreviation}"
  resource_group_name = azurerm_resource_group.app["web"].name
  location            = azurerm_resource_group.app["web"].location
  scopes              = [azurerm_application_insights.hcw.id]
  description         = "More than 5 application exceptions in 15 minutes."
  severity            = 1

  evaluation_frequency = "PT5M"
  window_duration      = "PT15M"

  criteria {
    # No summarize and no metric_measure_column: the measure is table rows, so
    # the aggregation is Count and the query has to return the rows themselves.
    query                   = "AppExceptions"
    time_aggregation_method = "Count"
    operator                = "GreaterThan"
    threshold               = 5

    failing_periods {
      number_of_evaluation_periods             = 1
      minimum_failing_periods_to_trigger_alert = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.ops.id]
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# Log Analytics — ingestion is approaching the daily cap
# ---------------------------------------------------------------------------
#
# THE POINT OF THIS RULE IS THAT THE CAP CANNOT TRIP QUIETLY AGAIN. The
# workspace was found OverQuota — dropping every table, including the ones
# every other rule in this file reads — with nothing anywhere saying so.
# Microsoft's guidance for the daily cap is an alert on
# `_LogOperation ... OverQuota`, but that fires once collection has ALREADY
# stopped. This one fires at 80% of the cap, while there is still headroom to
# prune a category or raise the ceiling deliberately.
#
# It can fire from inside a capped workspace, which no other log alert here
# can: the daily cap stops collection of BILLABLE tables, and `Usage` is not
# billable. That is also why the query filters IsBillable — unbillable rows do
# not count against the cap and must not count here either.
#
# THE RESET HOUR IS NOT THE DAY BOUNDARY. Azure assigns each workspace its own
# cap reset hour and it cannot be configured; this one resets at 08:00 UTC
# (quotaNextResetTime on the live workspace, read 2026-08-24). Summing from
# midnight would under-count for eight hours after every reset and over-count
# before it, so the window starts at the most recent reset instead:
# startofday(now() - 8h) + 8h is the last 08:00 UTC that has passed.
#
# No attribute on azurerm_log_analytics_workspace exposes the reset hour, so
# the 8 is a literal. If the workspace is ever recreated Azure may assign a
# different hour — check `az monitor log-analytics workspace show --query
# quotaNextResetTime` and correct it here.
#
# The threshold is DERIVED from the workspace's own cap so the two cannot
# drift: change daily_quota_gb in main.tf and this moves with it.
#
# mute_actions_after_alert_duration rather than auto-mitigation, and the two
# are mutually exclusive on this resource. Ingestion only goes up between
# resets, so once it is past 80% it stays past — an hourly evaluation would
# otherwise send the same mail every hour until the reset, which is how a
# useful alert becomes a mail rule.
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "logs_daily_cap" {
  provider = azurerm.mgmt

  name                = "alert-logs-capacity-${var.environment}-${var.region_abbreviation}"
  resource_group_name = azurerm_resource_group.platform_mgmt.name
  location            = azurerm_resource_group.platform_mgmt.location
  scopes              = [azurerm_log_analytics_workspace.hcw.id]
  description         = "Log Analytics billable ingestion has passed 80% of the daily cap since the last reset."
  severity            = 2

  evaluation_frequency = "PT1H"
  window_duration      = "P1D"

  mute_actions_after_alert_duration = "PT6H"

  criteria {
    query                   = <<-KQL
      let DailyCapResetHour = 8h;
      let WindowStart = startofday(now() - DailyCapResetHour) + DailyCapResetHour;
      Usage
      | where IsBillable
      | where StartTime >= WindowStart
      | summarize IngestedGb = sum(Quantity) / 1000.0
    KQL
    time_aggregation_method = "Maximum"
    metric_measure_column   = "IngestedGb"
    operator                = "GreaterThan"
    threshold               = azurerm_log_analytics_workspace.hcw.daily_quota_gb * 0.8

    failing_periods {
      number_of_evaluation_periods             = 1
      minimum_failing_periods_to_trigger_alert = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.ops.id]
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# Availability — is the API answering at all, from outside Azure
# ---------------------------------------------------------------------------
#
# Every other rule in this file watches a resource that is up enough to emit
# telemetry. This is the only one that can tell the difference between "the API
# is healthy" and "nothing is reaching the API", because it asks from the
# outside, over the same Cloudflare path a browser uses.
#
# CREATED DISABLED, AND THAT IS NOT AN OVERSIGHT. Two independent reasons:
#
#   1. Bot Fight Mode. deploy-functions.yml carries the measurement: a
#      GitHub-hosted runner asking this host for /api/health is served
#      Cloudflare's "Just a moment..." interstitial and a 403, and that
#      challenge does not run on the Ruleset Engine — a WAF skip rule was
#      built, applied and confirmed INERT against it. Availability-test agents
#      are datacenter clients of exactly the same shape. Arming this before
#      that is settled most likely produces a rule that fires continuously and
#      is muted by whoever receives it, which is worse than no alert at all.
#   2. Standard tests bill PER EXECUTION, and the free URL ping test retires
#      2026-09-30. At the defaults below — 5 locations every 15 minutes — that
#      is 5 x 96 x 30 = 14,400 executions a month. Against a platform whose
#      entire current Azure spend is about USD 3.23 a month, that is not a
#      rounding error and it should be spent knowingly.
#
# TO ARM IT: give the availability agents a path through Cloudflare — the
# supported pattern is Microsoft's custom-header identifier below plus a
# Cloudflare rule that admits it, or the ApplicationInsightsAvailability
# service tag — confirm one execution succeeds, then set
# availability_test_enabled = true in the workspace. The alert rule underneath
# already exists and starts working the moment results appear.
#
# The X-Customer-InstanceId header is Microsoft's documented way to prove a
# request came from THIS test rather than from anyone else sharing the
# availability service's IP addresses. It is set now so the Cloudflare rule has
# something to match on when someone writes it; it authenticates nothing on its
# own.
resource "azurerm_application_insights_standard_web_test" "api_health" {
  name                    = "webtest-api-health-${var.environment}-${var.region_abbreviation}"
  resource_group_name     = azurerm_resource_group.app["web"].name
  location                = azurerm_resource_group.app["web"].location
  application_insights_id = azurerm_application_insights.hcw.id
  description             = "GET /api/health through Cloudflare, from outside Azure."

  enabled       = var.availability_test_enabled
  frequency     = var.availability_test_frequency_seconds
  geo_locations = var.availability_test_geo_locations

  # About 80% of availability-test failures disappear on retry, so a failure is
  # only reported after three consecutive attempts fail at the same location.
  # This is what stops one dropped packet from paging.
  retry_enabled = true
  timeout       = 30

  request {
    url       = "https://api-azure.${var.domain}/api/health"
    http_verb = "GET"

    # The health endpoint returns JSON, not a page. Parsing dependent requests
    # would make the test stricter than the thing it is testing.
    parse_dependent_requests_enabled = false
    follow_redirects_enabled         = true

    header {
      name  = "X-Customer-InstanceId"
      value = "ApplicationInsightsAvailability:hcw-api-health"
    }
  }

  validation_rules {
    expected_status_code = 200

    # The certificate is Cloudflare's, and its expiry is not something this
    # configuration manages or can fix. A test that fails on a certificate
    # nobody here can renew reports someone else's problem as this API's
    # outage.
    ssl_check_enabled = false
  }

  tags = var.tags
}

# The alert on the test above.
#
# How many locations have to fail is DERIVED from how many there are, using
# Microsoft's stated relationship (locations - 2) — 3 of the 5 default
# locations. That is what distinguishes "the site is down" from "one agent's
# region has a network problem"; a lower number turns regional internet weather
# into a page. A floor of 2 keeps that true if someone trims the location list
# to save per-execution cost, where the formula alone would arrive at 1.
#
# Deriving it also means the location list and the vote cannot drift apart. A
# hardcoded 3 next to a shortened list is an alert that silently needs every
# location to fail.
#
# `scopes` names BOTH the web test and the component. That is not redundancy
# with the criteria block: Azure rejects an availability alert scoped to only
# one of the two.
#
# The window has to span at least two test cycles or the vote cannot be
# reached — at the default 900-second frequency a location reports roughly
# every 15 minutes, so a 15-minute window would count some locations zero times
# and the alert would simply never fire. Derived from the frequency variable
# for the same reason as the count above.
# Gated on the same variable as the web test it watches. Created unconditionally
# it would sit enabled against a disabled test, so `az monitor metrics alert list`
# would report six rules when only five can fire -- and the inert one is
# reachability, the only signal that survives the app being completely down. An
# inventory that overstates coverage is worse than one rule fewer.
resource "azurerm_monitor_metric_alert" "api_availability" {
  count               = var.availability_test_enabled ? 1 : 0
  name                = "alert-api-availability-${var.environment}-${var.region_abbreviation}"
  resource_group_name = azurerm_resource_group.app["web"].name
  scopes              = [azurerm_application_insights_standard_web_test.api_health.id, azurerm_application_insights.hcw.id]
  description         = "GET /api/health failed from ${max(2, length(var.availability_test_geo_locations) - 2)} or more of ${length(var.availability_test_geo_locations)} availability test locations."
  severity            = 1
  frequency           = "PT5M"
  window_size         = var.availability_test_frequency_seconds <= 300 ? "PT15M" : "PT30M"

  application_insights_web_test_location_availability_criteria {
    web_test_id           = azurerm_application_insights_standard_web_test.api_health.id
    component_id          = azurerm_application_insights.hcw.id
    failed_location_count = max(2, length(var.availability_test_geo_locations) - 2)
  }

  action {
    action_group_id = azurerm_monitor_action_group.ops.id
  }

  tags = var.tags
}
