# =============================================================================
# budget.tf — the subscription budgets. Staying inside budget is a standing
# requirement on every deployment, not a gate that completes.
#
# Split out of main.tf on 2026-08-29 (T-754). Terraform reads every .tf file in
# this directory as ONE module: same namespace, same state, same plan. Nothing
# moved between states and no resource address changed — an empty plan is the
# proof, and `functions/test/terraform-source.js` is why the text-reading guards
# did not need to care.
# =============================================================================

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
