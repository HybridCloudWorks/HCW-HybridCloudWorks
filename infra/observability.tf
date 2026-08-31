# =============================================================================
# observability.tf — the plan's operational alarm fabric (T-505, closed —
# CHANGELOG.md; it is no longer an open item in TODO.md)
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

  # Second channel (T-709). Until this is set, every alert in the estate has
  # exactly one delivery path, across a subscription boundary that is only
  # proven to be ACCEPTED by ARM — not proven to arrive. One receiver plus one
  # unverified hop is a single point of silence for the whole alerting fabric.
  #
  # dynamic, not conditional count: an empty ops_sms_receiver produces no block
  # at all, so the action group is byte-identical to what exists today and the
  # variable can be set later without a resource replacement.
  dynamic "sms_receiver" {
    for_each = var.ops_sms_receiver.phone_number == "" ? [] : [var.ops_sms_receiver]
    content {
      name         = "ops-sms"
      country_code = sms_receiver.value.country_code
      phone_number = sms_receiver.value.phone_number
    }
  }

  tags = local.tags
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
# GB/day cap. Three days of `Usage` show where the volume goes:
#
#   AppTraces                      0.284 GB
#   CDBDataPlaneRequests           0.268 GB
#   CDBPartitionKeyRUConsumption   0.076 GB
#   AppRequests                    0.002 GB
#   AppExceptions                  0.002 GB
#
# READ THOSE AS A FLOOR, NOT A MEASUREMENT. They were sampled while the cap was
# already tripping, so every one of them is what survived the cap rather than
# what the source produced, and the shortfall is not distributed evenly — the
# cap stops collection mid-day, so a high-rate table loses proportionally more
# than a low-rate one. The list is also partial: it excludes AzureMetrics and
# the StorageRead/StorageWrite/StorageDelete categories the content_blob
# setting below ships, both of which land in the same workspace. An independent
# reading of the same period put the real figures roughly 20% away from these.
#
# What the numbers are good enough to establish is the ORDERING, which is the
# whole basis of the change: two Cosmos data-plane categories dominate, and the
# two tables an incident is actually read from are a rounding error that was
# being dropped anyway. Removing DataPlaneRequests, PartitionKeyRUConsumption
# and QueryRuntimeStatistics is therefore a large reduction — it is NOT a
# reduction to a number anyone can state in advance.
#
# CONFIRM AFTER APPLY, do not assume. Once ingestion has run uncapped for a
# full day, re-run the daily-cap usage query (the one in the logs_daily_cap
# rule below reports the same figure) and check the result against the cap. If
# it is not comfortably under, the next lever is AppTraces via host.json
# logLevel — see the sampling note on azurerm_application_insights.hcw in
# main.tf — and not another diagnostic category.
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
# CROSS-SUBSCRIPTION ACTION GROUP, AND EXACTLY WHAT IS PROVEN ABOUT IT. The
# action group lives in the Management subscription; every rule below that
# watches a workload resource has to be created in the APPLICATION
# subscription, because an Azure Monitor alert rule sits in the same
# subscription as the resource it scopes. So every one of these references
# crosses a subscription boundary.
#
# PROVEN: azurerm_consumption_budget_subscription.hcw carries the same
# cross-subscription contact_groups reference and applied successfully, so ARM
# ACCEPTS the reference. That is the whole of it.
#
# NOT PROVEN: that a notification is ever DELIVERED through it. Nobody has
# observed one arrive. The budget is not evidence either way, because it also
# carries contact_emails as an independent path and would still mail on that
# alone with the action group completely inert.
#
# The rules here have no second path. azurerm_monitor_metric_alert and
# azurerm_monitor_scheduled_query_rules_alert_v2 can only route through an
# action group — there is no per-rule email field to fall back to. So if the
# reference is accepted and silently inert, this file produces alert rules that
# exist, make `az monitor metrics alert list` non-empty, and page nobody. That
# is strictly WORSE than the visible emptiness this file was written against,
# because it looks fixed.
#
# So: fire a test notification at the action group after the apply and confirm
# it reaches the ops mailbox — the action group blade has a "Test action group"
# function and the CLI has an equivalent under `az monitor action-group
# test-notifications`. Until someone has seen one arrive, treat every rule
# below as unproven plumbing rather than as coverage. If it does not arrive,
# the fallback is the one the budget comment in main.tf names: a second action
# group in the application subscription, referenced alongside this one.
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
# Identities for the two log alert rules
# ---------------------------------------------------------------------------
#
# A scheduled query rule with no identity runs as whoever last edited it.
# Microsoft: "If you don't use a managed identity, the alert rule will inherit
# the permissions of the last user or service principal who edited it, based on
# their permissions at the time of that edit." Here that would be the HCP
# Terraform run principal, frozen at apply time, recorded nowhere in this
# configuration and invisible in the portal.
#
# That is a bad property for any rule and an actively dangerous one for
# logs_daily_cap, whose entire job is that the workspace cap cannot trip
# quietly again. A rule running on borrowed, unrecorded permissions fails
# SILENTLY when those permissions lapse — and the thing it was watching for is
# itself silent. Two silences on top of each other is how the original
# OverQuota went unnoticed.
#
# TWO IDENTITIES, NOT ONE, and that is not symmetry for its own sake. The rules
# sit in different subscriptions, and Microsoft's managed identity FAQ is
# explicit: "If you need to use a managed identity in a different resource
# group or subscription, you would need to create a new user-assigned managed
# identity and assign the necessary permissions to it." Attaching one identity
# across the boundary is not a supported shape, and this apply cannot be
# rehearsed. Separating them also draws a real line: the platform capacity
# alert's identity cannot read application telemetry, and the application
# alert's identity cannot read anything in Management beyond the workspace.
#
# USER-ASSIGNED, NOT SYSTEM-ASSIGNED, because of ordering. Microsoft describes
# system-assigned as "This identity has no permissions... AFTER you create the
# rule, you must assign permissions", and user-assigned as "BEFORE you create
# the alert rule, you create an identity and assign it appropriate permissions".
# Only the second can be expressed as one deterministic apply. It also avoids a
# documented trap: managed identity tokens are cached per resource URI for
# around 24 hours and "it can take several hours for changes to a managed
# identity's permissions to take effect" — so granting a role after the
# identity has already been refused once is not reliably a quick fix.
#
# The depends_on on each rule is what actually enforces the ordering. Without
# it Terraform sees the rule depend on the IDENTITY (through identity_ids) and
# not on the role assignment, and is free to create the rule first — which
# throws away the only reason to prefer user-assigned. Role assignment
# propagation is still eventually consistent, so a first apply can occasionally
# fail query validation on a role that has not landed yet; re-applying is the
# fix, and it converges rather than needing repair.

resource "azurerm_user_assigned_identity" "alerts_mgmt" {
  provider = azurerm.mgmt

  name                = "id-plat-alerts-${var.environment}-${var.region_abbreviation}-${var.instance}"
  location            = azurerm_resource_group.platform_mgmt.location
  resource_group_name = azurerm_resource_group.platform_mgmt.name
  tags                = local.tags
}

resource "azurerm_user_assigned_identity" "alerts_app" {
  name                = "id-${var.workload_name}-alerts-${var.environment}-${var.region_abbreviation}-${var.instance}"
  location            = azurerm_resource_group.app["web"].location
  resource_group_name = azurerm_resource_group.app["web"].name
  tags                = local.tags
}

# LOG ANALYTICS READER RATHER THAN READER OR MONITORING READER, and the
# difference is a credential rather than a preference. All three carry `*/read`
# and so all three satisfy the documented requirement, which is a "reader role
# for all workspaces that the query accesses". Only Log Analytics Reader
# carries `notActions: Microsoft.OperationalInsights/workspaces/sharedKeys/read`.
# On a Log Analytics workspace those shared keys are the INGESTION keys: a
# principal holding them can write arbitrary data into this workspace, which
# means forging or drowning the very telemetry these rules read. Reader and
# Monitoring Reader both hand that to an alert rule that needs to run a query.
#
# The alias on the two workspace grants is belt and braces. A role assignment
# addresses its scope by absolute resource ID, so in principle the subscription
# is already in the scope and the provider's own never enters the call — but
# every other Management-subscription write in this file carries the alias, and
# a reader should not have to know how the provider parses a scope in order to
# know which subscription a GRANT lands in. It costs nothing if it is redundant
# and it is the difference between an apply and a support ticket if it is not.
resource "azurerm_role_assignment" "alerts_mgmt_workspace" {
  provider = azurerm.mgmt

  scope                = azurerm_log_analytics_workspace.hcw.id
  role_definition_name = "Log Analytics Reader"
  principal_id         = azurerm_user_assigned_identity.alerts_mgmt.principal_id
}

# The application rule needs the workspace too, not just the component. The
# component is workspace-based: AppExceptions rows physically live in the
# Management-subscription workspace, and the documented requirement covers
# every workspace a query reaches "even if those workspaces are in different
# subscriptions".
resource "azurerm_role_assignment" "alerts_app_workspace" {
  provider = azurerm.mgmt

  scope                = azurerm_log_analytics_workspace.hcw.id
  role_definition_name = "Log Analytics Reader"
  principal_id         = azurerm_user_assigned_identity.alerts_app.principal_id
}

# And on the component itself, which is the rule's scope. Monitoring Reader
# here rather than Log Analytics Reader: on a microsoft.insights/components
# scope the two are functionally identical — the workspace-specific actions in
# Log Analytics Reader have nothing to act on and its sharedKeys notAction
# excludes nothing — so the tie is broken by which one names the job.
resource "azurerm_role_assignment" "alerts_app_component" {
  scope                = azurerm_application_insights.hcw.id
  role_definition_name = "Monitoring Reader"
  principal_id         = azurerm_user_assigned_identity.alerts_app.principal_id
}

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
# A LOG rule, not a metric alert. Flex Consumption does not publish HTTP
# metrics at all: `az monitor metrics list-definitions` on this app returns
# exactly nine names, all execution and memory counters, and Http5xx is not
# among them. Http5xx and HttpResponseTime belong to App Service and Elastic
# Premium plans. ARM rejects the metric alert outright -- "Couldn't find a
# metric named Http5xx" -- which is how this was found, on the first apply
# (2026-08-25), after four reviews had all assumed the metric existed.
#
# The cost of the switch is real and worth stating: a log rule stops evaluating
# when the workspace hits its daily cap, so this alert is silent in exactly the
# condition alert-logs-capacity exists to catch. There is no metric alternative
# on this plan, so that capacity alert is now load-bearing rather than a
# nice-to-have.
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "function_http_5xx" {
  name                = "alert-func-http5xx-${var.environment}-${var.region_abbreviation}"
  resource_group_name = azurerm_resource_group.app["web"].name
  location            = azurerm_resource_group.app["web"].location
  scopes              = [azurerm_application_insights.hcw.id]
  description         = "Function App returned more than 5 HTTP 5xx responses in 15 minutes."
  severity            = 1

  evaluation_frequency = "PT5M"
  # PT30M, not PT15M (T-745). The window had no headroom for ingestion lag:
  # App Insights availability rows typically land 1-3 minutes after the probe
  # runs and occasionally later, so at any evaluation the newest one or two
  # results may not be queryable yet. Against a 15-minute window expecting 3
  # results and firing below 2, that lag alone spent the "one dropped run is
  # tolerated" budget the ADR claims — a single late ingestion plus one missed
  # cron paged Sev 1 against a healthy site.
  #
  # 30 minutes expects 6 results and fires below 3, so it absorbs lag plus two
  # dropped runs while still detecting a real outage inside ~15 minutes (three
  # consecutive failures). Change this and you must change the threshold below
  # and the cron cadence in edge/availability-probe/wrangler.toml together.
  window_duration = "PT30M"

  # Stateful for the reason set out on alert-app-exceptions below: stateless is
  # the azurerm default and re-notifies every evaluation. Same frequency, same
  # threshold, same detection — one mail per incident instead of one every five
  # minutes until it clears.
  auto_mitigation_enabled = true

  criteria {
    # Classic schema, because the scope is the component. toint() because
    # resultCode is a string here and a lexical compare would match "50" too.
    query                   = "requests | where toint(resultCode) >= 500"
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

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.alerts_app.id]
  }

  tags = local.tags

  depends_on = [
    azurerm_role_assignment.alerts_app_workspace,
    azurerm_role_assignment.alerts_app_component,
  ]
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
# A log rule for the same reason as the 5xx rule above: HttpResponseTime is an
# App Service metric and Flex Consumption does not publish it.
#
# P95 rather than the mean the metric alert used. The original comment worried
# that one cold start could dominate a short window's mean on a plan with no
# always-ready instances -- with a percentile that concern mostly goes away,
# and a P95 over 30 minutes describes what users actually experienced rather
# than an average one outlier can drag.
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "function_response_time" {
  name                = "alert-func-latency-${var.environment}-${var.region_abbreviation}"
  resource_group_name = azurerm_resource_group.app["web"].name
  location            = azurerm_resource_group.app["web"].location
  scopes              = [azurerm_application_insights.hcw.id]
  description         = "Function App P95 response time above 5 seconds over 30 minutes."
  severity            = 2

  evaluation_frequency = "PT5M"
  window_duration      = "PT30M"

  # Stateful, as on the two rules above. It matters most here: the window is six
  # times the frequency, so a stateless version re-notifies for a full half hour
  # after latency has already recovered.
  auto_mitigation_enabled = true

  criteria {
    # duration is milliseconds in the classic schema; 5000 is the 5 seconds the
    # metric alert expressed in its own units.
    query                   = "requests | summarize P95DurationMs = percentile(duration, 95)"
    time_aggregation_method = "Average"
    metric_measure_column   = "P95DurationMs"
    operator                = "GreaterThan"
    threshold               = 5000

    failing_periods {
      number_of_evaluation_periods             = 1
      minimum_failing_periods_to_trigger_alert = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.ops.id]
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.alerts_app.id]
  }

  tags = local.tags

  depends_on = [
    azurerm_role_assignment.alerts_app_workspace,
    azurerm_role_assignment.alerts_app_component,
  ]
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

  tags = local.tags
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

  # STATEFUL, and this attribute is the whole reason the mail volume dropped.
  # At the azurerm default (false) a log rule is STATELESS: it fires on every
  # evaluation whose condition is met, so at PT5M Azure sends a fresh Sev1 mail
  # every five to ten minutes for as long as exceptions keep arriving — and
  # because the window is three times the frequency, the same burst is counted
  # by three consecutive evaluations, so the mail continues for fifteen minutes
  # after the last exception. `alert-app-exceptions-prod-cus` did exactly that
  # on 2026-08-25, the first night these rules were live, which is how the
  # default was found to be the wrong one.
  #
  # Stateful means one alert per condition: it fires once, stays fired, and
  # resolves when the condition has not been met for three evaluation periods
  # (fifteen minutes here), sending one Resolved mail. The rule still evaluates
  # every five minutes against the same threshold — DETECTION IS UNCHANGED and
  # nothing is suppressed; only the repeats go. That is why this was the change
  # made without evidence: it costs no coverage. The levers that do cost
  # coverage — a filter on the query below, a higher threshold, a severity that
  # is not 1 — need a week of real firing to set, not a guess.
  #
  # Mutually exclusive with mute_actions_after_alert_duration, which is why
  # alert-logs-capacity uses that one instead: its condition cannot clear
  # before the 08:00 UTC reset, so there is nothing for auto-resolution to
  # resolve.
  auto_mitigation_enabled = true

  criteria {
    # No summarize and no metric_measure_column: the measure is table rows, so
    # the aggregation is Count and the query has to return the rows themselves.
    # `exceptions`, not `AppExceptions`. The scope below is the Application
    # Insights COMPONENT, and a component resolves the classic schema
    # (requests/exceptions/traces). `App*` names are the workspace schema and
    # are only resolvable when the rule scopes the workspace itself, which is
    # what alert-logs-capacity does. Getting this wrong is not a warning: ARM
    # rejects the create with "Failed to resolve table expression named
    # 'AppExceptions'", which is exactly how it was found (2026-08-25).
    query                   = "exceptions"
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

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.alerts_app.id]
  }

  tags = local.tags

  # Permissions before the rule, which is the entire reason this identity is
  # user-assigned. identity_ids alone orders the rule after the IDENTITY, not
  # after its grants.
  depends_on = [
    azurerm_role_assignment.alerts_app_workspace,
    azurerm_role_assignment.alerts_app_component,
  ]
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
# drift. It reads the RESOURCE attribute, not the variable behind it, so
# raising logs_daily_quota_gb in the workspace moves this with it and no edit
# here is needed — which is what makes the T-719 measurement a variable change
# rather than a code change. It is also why that variable refuses -1: an
# unlimited workspace would put a negative number on the line below.
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

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.alerts_mgmt.id]
  }

  tags = local.tags

  depends_on = [azurerm_role_assignment.alerts_mgmt_workspace]
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
# availability_test_enabled = true in the workspace. That one variable arms the
# test and creates the alert together: the alert is gated on the same variable,
# so that an inventory of alert rules cannot show a reachability alert that
# nothing can fire.
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

  tags = local.tags
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
#
# Gated on the same variable as the web test it watches. Created unconditionally
# it would sit enabled against a disabled test, so `az monitor metrics alert list`
# would report six rules when only five can fire — and the inert one is
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

  tags = local.tags
}

# ---------------------------------------------------------------------------
# Availability, the path that works on this Cloudflare plan (ADR 0024)
# ---------------------------------------------------------------------------
#
# The standard web test above is the design; this is the one that can run.
# Bot Fight Mode 403s every datacenter client asking /api/health — Azure's
# availability agents included — and does not run on the Ruleset Engine, so no
# WAF rule exempts them (the block comment above carries the measurement). The
# alternative is edge/availability-probe: a Cloudflare Worker on a 5-minute
# cron, deployed by the owner with wrangler, whose subrequest to its own zone
# is the one external-shaped client Bot Fight Mode does not challenge. It
# reports every attempt to Application Insights as an availability result
# named edge-api-health — wrangler.toml's PROBE_NAME, which the query below
# must match verbatim.
#
# THE RULE COUNTS SUCCESSES AND FIRES ON TOO FEW, rather than counting
# failures. Counting failures has a blind spot exactly where it matters: a
# dead Worker, a disabled cron, or an unreachable ingestion endpoint produce
# no failure rows at all, and a failure-counting rule reads that silence as
# health. Counting successes makes "the probe stopped running" and "the API
# stopped answering" the same incident, which they are from a visitor's seat.
# The probe writes 3 results per 15-minute window; below 2 is an incident, so
# one dropped cron run is tolerated and two are not.
#
# A log rule, not a metric alert on availabilityResults/availabilityPercentage,
# for the same blind-spot reason: that metric goes silent when the probe dies,
# and a metric alert on a silent metric does not fire.
#
# Gated on its own variable rather than availability_test_enabled: the two
# paths arm independently, and arming THIS one first (or instead) is the
# expected order — it costs nothing per execution. The gate also has the same
# duty as every other in this file: created before the probe writes rows, the
# rule fires immediately and permanently, so the variable's description makes
# the observed success row the precondition for flipping it.
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "edge_probe_availability" {
  count               = var.availability_probe_alert_enabled ? 1 : 0
  name                = "alert-api-reachability-${var.environment}-${var.region_abbreviation}"
  resource_group_name = azurerm_resource_group.app["web"].name
  location            = azurerm_resource_group.app["web"].location
  scopes              = [azurerm_application_insights.hcw.id]
  description         = "Fewer than 3 of the expected 6 edge-probe successes for GET /api/health in 30 minutes — the API is unreachable over the Cloudflare path, or the probe itself is down. Either way nobody outside can confirm the site is up."
  severity            = 1

  evaluation_frequency = "PT5M"
  window_duration      = "PT15M"

  # Stateful like every other rule here (#226): reachability incidents are
  # exactly the kind that run long, and one mail per incident is the design.
  auto_mitigation_enabled = true

  criteria {
    # Classic schema, component scope, like the rules above. success == 1 in
    # availabilityResults; the name filter keeps a future second probe from
    # voting in this rule's window.
    query                   = "availabilityResults | where name == \"edge-api-health\" | where success == 1"
    time_aggregation_method = "Count"
    operator                = "LessThan"
    # 6 expected in a 30-minute window at a 5-minute cadence; below 3 is an
    # incident (T-745).
    threshold = 3

    failing_periods {
      number_of_evaluation_periods             = 1
      minimum_failing_periods_to_trigger_alert = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.ops.id]
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.alerts_app.id]
  }

  tags = local.tags

  depends_on = [
    azurerm_role_assignment.alerts_app_workspace,
    azurerm_role_assignment.alerts_app_component,
  ]
}
