# ADR 0022: The alerting fabric, and the signal it does not cover

**Status:** Accepted
**Decision date:** 2026-08-24
**Owners:** Workload owner and architecture owner

## Context

[ADR 0010](0010-observability) centralised bounded observability. Collection was
built; alerting never was. The Go-Live readiness review of 2026-08-24 found
**zero alert rules of any kind** in either subscription — `az monitor metrics
alert list`, `scheduledQueryRules`, `webtests` and `activity-log alert list` all
returned empty — while the Log Analytics workspace those rules would have read
from was simultaneously `OverQuota` and dropping every billable table. The
platform was both unmonitored and silently discarding the evidence that would
have shown it. [ADR 0018](0018-as-built-plan-v02) tracked this as remediation
debt under TODO **T-505**.

The rules described here are declared on `fix/go-live-remediation` and **have
not been applied**. This ADR records the design decisions, several of which
deliberately diverge from what the review asked for.

## Purpose and decision drivers

- **An alert must keep working when the thing it watches is broken.** The
  failure that motivated this work was a capped workspace, and a log-based alert
  is silent exactly then.
- **Ingestion is capped at 0.25 GB/day**, so every alert design that adds
  ingestion competes for budget with the two tables an incident is actually read
  from.
- **Nothing has ever fired here.** Every threshold is a first estimate, so the
  design has to make tuning easy and has to say which numbers are guesses.
- **A coverage claim must not exceed what can fire.** A rule that exists,
  appears in an inventory, and cannot page anyone is worse than a visibly empty
  inventory, because it looks fixed.

## Decision

Five armed rules — Function App 5xx, Function App latency, Cosmos throttling,
application exceptions, Log Analytics daily-cap approach — plus a standard
availability web test and its alert, both created disabled. All route to the
existing `ag-plat-prod-cus-01` action group. The operator-facing description
lives in [Alerting and support](Alerting-And-Support); what follows is why.

**1. Metric alerts over log alerts wherever there is a choice.** Platform
metrics are not ingested into the workspace, are not billed by the GB, and keep
evaluating through an `OverQuota` window. Only the two conditions with no metric
equivalent are scheduled query rules.

**2. Cosmos 429 is a metric alert, not the KQL rule the review specified.** A
KQL rule for throttling has to read `CDBDataPlaneRequests` — the diagnostic
category being removed in the same change for consuming about a third of the
daily cap. Keeping it to feed a throttling alert would re-create the `OverQuota`
condition the alert exists to help with, and a log alert would go silent in
precisely that scenario. `TotalRequests` split on `StatusCode` is the documented
route to 429s and there is no dedicated throttled-request metric on this account
type.

**3. Application Insights ingestion sampling is deliberately NOT enabled.**
`sampling_percentage` configures *ingestion* sampling, which Microsoft states
"only applies when no other sampling is in effect", and Azure Functions runs
adaptive SDK sampling on by default. `functions/host.json` has it enabled with
`Request` excluded. The net effect is inverted: `AppTraces` — the largest table
by far — is host-sampled and therefore untouchable by ingestion sampling, while
`AppRequests` and `AppExceptions` are excluded from host sampling and are
exactly what ingestion sampling would discard. Those two tables are 0.3% of the
cap each, are what an incident is read from, and one of them is what the new
exceptions rule counts. Microsoft's own guidance is that sampling affects
alerting accuracy. The daily-cap problem is solved by pruning Cosmos categories
instead; the remaining levers, if headroom is ever needed, are `host.json`
`logLevel`, `maxTelemetryItemsPerSecond`, or a workspace ingestion-time
transformation.

**4. The log alert identities use Log Analytics Reader, not Monitoring Reader.**
Both rules carry a user-assigned identity — user-assigned rather than
system-assigned because only that ordering is expressible as one deterministic
apply, and because managed-identity tokens are cached per resource URI for about
24 hours, so granting a role after a refusal is not reliably a quick fix. Two
identities rather than one, because the rules sit in different subscriptions and
Microsoft's guidance is to create a new identity rather than attach one across
that boundary.

The role choice is the load-bearing part. Reader, Monitoring Reader and Log
Analytics Reader all carry `*/read` and all three satisfy the documented
requirement. Only **Log Analytics Reader** carries a `notActions` entry for
`Microsoft.OperationalInsights/workspaces/sharedKeys/read`. On a workspace those
shared keys are the *ingestion* keys: a principal holding them can write
arbitrary data into the workspace. The other two roles would have let an alert
rule forge or drown the telemetry it reads. On the Application Insights
component scope the two roles are functionally identical — Log Analytics
Reader's workspace-specific actions have nothing to act on there — so the
component grant uses Monitoring Reader, the role that names the job.

**5. The availability test and its alert are gated on the same variable.** The
alert carries `count = var.availability_test_enabled ? 1 : 0` rather than being
created unconditionally against a disabled test. Created unconditionally it
would sit enabled and inert, and `az monitor metrics alert list` would report
six rules when five can fire — with the inert one being reachability, the only
signal that survives the application being completely down.

## Consequences and accepted risks

- **Reachability has no alert, and that is the failure class this platform has
  actually had.** Cloudflare Bot Fight Mode answers Azure's availability agents
  the way it answers any datacenter client — a 403 interstitial — and a WAF skip
  rule against it was built, applied and confirmed inert, because Bot Fight Mode
  does not run on the Ruleset Engine. Three recorded incidents (2026-08-20 mass
  404, and two on 2026-08-21) share one shape: host up, functions unregistered,
  every route 404. `Http5xx` does not count 404s; `AppExceptions` cannot fire
  because no handler runs. **None of the five armed rules detects it.** This is
  the accepted cost of the Cloudflare edge ([ADR 0002](0002-cloudflare-edge))
  until the Cloudflare side changes; tracked as TODO **T-519**.
- **The per-request Cosmos audit trail is gone.** Pruning
  `CDBDataPlaneRequests` means a data-access question can no longer be answered
  from logs. Accepted because a capped workspace answers no questions at all,
  and because the account firewall already restricts callers to the Functions
  subnet and named operator windows. If the audit trail becomes a requirement,
  the answer is a dedicated table with its own cap or an ingestion-time
  transformation that keeps only writes — not switching the category back on
  under a 0.25 GB cap.
- **Delivery is unproven and cannot be proven before the apply.** Every rule
  routes solely through one action group and none has a second path; for the
  four rules in the application subscription that reference also crosses a
  subscription boundary. ARM accepting the reference is proven; a notification
  arriving is not. Two post-apply tests settle it and they answer different
  questions ([Deployment Runbook](Deployment-Runbook#4-post-apply-verification)
  §4).
- **Every threshold is an estimate**, stated as such beside each resource. They
  are to be tuned against the first week of real firing, not preserved because
  they are written down.
- Cost is small but not zero, and the one line that is not a rounding error is
  arming the web test at 14,400 executions a month
  ([Cost analysis](Cost-Analysis)).
- Azure RBAC propagation is eventually consistent and `azurerm` does not wait,
  so a first apply can fail query validation on a grant that has not landed.
  Re-applying converges. `skip_query_validation` was deliberately not set — it
  would hide a genuinely broken query.

## Alternatives considered

- **A KQL rule for Cosmos 429s** — rejected; see decision 2.
- **Ingestion sampling to solve the daily cap** — rejected; see decision 3. This
  reverses the readiness review's own recommendation, on its evidence.
- **A `Http404` metric alert on `Microsoft.Web/sites` as an interim reachability
  detector** — considered and **not built**. It needs neither Cloudflare nor the
  workspace, and this host serves only `/api`, so a burst of 404s is anomalous
  rather than normal. It is the cheapest partial cover for the gap above and
  remains available; it was not adopted here because its threshold would be a
  guess against no baseline at all, and because it detects the symptom on a host
  that is by then already failing. Recorded rather than dropped.
- **A second action group in the application subscription**, referenced
  alongside the Management one — the fallback if the cross-subscription hop
  proves inert. Costs one free resource and duplicate mail per alert. Not built
  before there is evidence it is needed.
- **A deliberately always-true heartbeat rule as a dead man's switch** —
  rejected. It proves delivery continuously only if something external notices
  the heartbeat stopping, which is the same unwatched-silence problem one level
  up.

## Validation and revisit triggers

- Validated only by the apply, then the two delivery tests, then the first week
  of firing. Until a notification has been seen to arrive, the rules are
  plumbing rather than coverage.
- Confirm ingestion against the cap after a full **uncapped** day. The pre-apply
  figures are a floor, not a measurement — they were sampled while the cap was
  already tripping.
- **Revisit when:** Cloudflare admits the availability agents (arm the test, and
  reconsider the `Http404` interim); the first real incident calibrates a
  threshold; ingestion sits comfortably under the cap and a pruned category
  could return; or `hashicorp/terraform-provider-azurerm#29149` closes, which
  changes what the post-apply Function App assertion is guarding against.

## Related decisions and references

- Amends [ADR 0010](0010-observability); closes the observability row of
  [ADR 0018](0018-as-built-plan-v02)'s remediation-debt table (TODO T-505)
- The reachability gap is a consequence of [ADR 0002](0002-cloudflare-edge)
- [Alerting and support](Alerting-And-Support) ·
  [Deployment Runbook](Deployment-Runbook) · [Cost analysis](Cost-Analysis)
- `infra/observability.tf` — every threshold's assumption, beside the resource
