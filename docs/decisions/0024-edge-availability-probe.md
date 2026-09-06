# ADR 0024: Reachability probing from a Cloudflare Worker

**Status:** Proposed
**Decision date:** 2026-08-28
**Owners:** Workload owner

## Context

[ADR 0022](../decisions/0022-alerting-fabric.md) accepted, as a named cost, that reachability —
the one signal that survives the app being completely down — has no alert
behind it. The standard Application Insights web test and its alert exist in
`infra/observability.tf`, gated off, because Cloudflare's free-plan Bot Fight
Mode answers datacenter clients asking `/api/health` with a 403 interstitial,
and it does not run on the Ruleset Engine: a WAF skip rule against it was
built, applied and confirmed inert. Azure's availability agents, GitHub-hosted
runners, and every external monitoring vendor are datacenter clients of
exactly that shape.

The gap is not hypothetical. Three recorded incidents (the 2026-08-20 mass
404 and two on 2026-08-21) share one signature — host up, functions
unregistered, every route 404 — and none of the five armed rules detects it.
The `Monitor Functions Registered` workflow (T-519, #233) covers the
function-registration cause through ARM, but reads the control plane, not the
network path a visitor uses. This was tracked as TODO T-519, blocked on a
Cloudflare-side change.

## Purpose and decision drivers

- **The signal matters more than the mechanism.** Every other alert needs the
  app healthy enough to emit telemetry; reachability is the only outside-in
  check, and it has been the actual failure class three times.
- **The blocker is plan-shaped, not rule-shaped.** Free-plan Bot Fight Mode is
  a toggle, not a policy engine: nothing on the plan can exempt a chosen
  client. Every fix that keeps the standard web test either disables bot
  protection entirely or spends money (Pro, #127).
- **Cost discipline.** Standard web tests bill per execution (14,400 a month
  at the disarmed defaults) against a platform spending about USD 3.23 a month
  on Azure; the free URL ping test retires 2026-09-30.
- **One alerting fabric.** ADR 0022 routes every rule through one action
  group. A probe that alerts from somewhere else (an external monitor's
  email, a Worker's own notification) forks the fabric and re-opens the
  fragmentation 0022 closed.

## Considered options

1. **Upgrade Cloudflare to Pro (#127) and arm the standard web test.** Super
   Bot Fight Mode is configurable where Bot Fight Mode is not, so the
   documented arm path (the `X-Customer-InstanceId` header match or the
   `ApplicationInsightsAvailability` service tag) becomes available. Cleanest
   alignment with the shipped design; costs the Pro subscription plus
   per-execution test billing, and couples an alerting gap to a plan decision
   with its own scope.
2. **Disable Bot Fight Mode.** Free, immediate, keeps the standard web test as
   designed. Removes bot protection from the one proxied hostname
   (`api-azure`), which rate limiting and the origin lock mitigate but do not
   replace — and spends the per-execution test cost anyway.
3. **Probe from GitHub Actions on a schedule.** No new infrastructure, but a
   GitHub runner is itself a datacenter client: the Bot Fight Mode 403 is the
   measured result in `deploy-functions.yml`. Probing the origin directly
   would require holding the origin secret in GitHub and punching the IP
   allowlist — weakening the origin lock to work around the edge, and testing
   the wrong path.
4. **A Cloudflare Worker on a cron trigger, reporting to Application
   Insights.** A same-account Worker's subrequest to its own zone is not
   challenged by Bot Fight Mode; it traverses the zone pipeline (the
   origin-secret transform stamps it) and reaches the origin from Cloudflare
   egress IPs (the Function App's allowlist admits it). It reports each
   attempt as `AvailabilityData`, landing in the same `availabilityResults`
   table the standard test would write, so the alert stays in the Terraform
   fabric. Free at this volume; adds one component outside Terraform.

## Decision

**Option 4.** A Worker (`edge/availability-probe`) asks
`GET /api/health` every 5 minutes over the production Cloudflare path and
reports every attempt to Application Insights; a scheduled-query alert
(`edge_probe_availability` in `infra/observability.tf`, gated on
`availability_probe_alert_enabled`, default `false`) fires when a 15-minute
window holds fewer than 2 successes.

Two design points carry the weight:

1. **The alert counts successes and fires on too few, not failures on too
   many.** A dead Worker, a disabled cron, or an unreachable ingestion
   endpoint produce no failure rows; a failure-counting rule reads that
   silence as health. Counting successes makes "the probe stopped" and "the
   API stopped answering" the same incident — which, from outside, they are.
2. **The probe is not the standard web test's replacement; it is its
   substitute under this plan.** The standard test and its 5-location vote
   stay in Terraform, disarmed, exactly as ADR 0022 left them. If #127
   upgrades the plan, arming the standard test is additive and this probe can
   retire; until then it is the only reachability check that can run at all.

What the Worker does not cover, knowingly: the client-to-edge leg (Cloudflare
its own availability) and geographic diversity (one edge probe versus five
agent locations). Both are judged smaller than the difference between this
signal existing and not existing.

## Consequences and accepted risks

- **One component lives outside Terraform.** The Worker is deployed by the
  owner with wrangler, like every other Cloudflare-side change in this
  estate; [Availability-Probe](../runbooks/availability-probe.md) is the deploy-and-verify
  procedure, and CI runs its unit tests. Drift risk is bounded by the alert
  itself: a probe that stops matching its documentation stops writing
  successes, and the rule fires.
- **The ingestion credential leaves Azure.** The Application Insights
  connection string becomes a Worker secret. It is write-only — it can submit
  telemetry, nothing else — and rotating it in Azure invalidates the copy.
- **Arming order is load-bearing.** Created before the probe writes success
  rows, the rule fires immediately and permanently. The variable description
  and the README both make an observed `success == 1` row the precondition,
  per the same observed-behaviour rule as Cutover-Runbook step 5.
- **T-519's gate changes shape.** It remains **Gate: owner** — wrangler deploy
  and the secret are owner actions — but it no longer waits on a Cloudflare
  plan change or a Bot Fight Mode decision.
