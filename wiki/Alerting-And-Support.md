# Alerting and support

**Scope:** what pages an operator, what each page means, what to look at first,
and — stated as plainly as the coverage itself — what nothing watches.

**State:** the rules described here are declared in `infra/observability.tf` on
`fix/go-live-remediation` and **have not been applied**. Until that apply runs,
`az monitor metrics alert list` and `az monitor scheduled-query list` return
empty in both subscriptions, which is what the Go-Live readiness review found on
2026-08-24. Read every "fires when" below as a description of the configuration,
not of the live tenant.

**Authority:** this page does not authorize anything. Tuning a threshold is a
normal pull request; arming the availability test or the timers is an owner
decision recorded in `REVIEW.md`.

## Read this before the rules

Five rules is not the same as coverage. Three things make this fabric less than
an inventory of it suggests, and all three are worth knowing before the first
one fires.

### Reachability is not covered

`azurerm_monitor_metric_alert.api_availability` carries `count = 0`. The
availability test it watches is created with `enabled = false`, and the alert is
gated on the same variable so that an inventory cannot report a reachability
alert that nothing can fire. Both are off for a measured reason: Cloudflare's
Bot Fight Mode answers datacenter clients — which is exactly what Azure's
availability agents are — with a 403 interstitial, and a WAF skip rule against
it was built, applied and confirmed **inert**, because Bot Fight Mode does not
run on the Ruleset Engine.

That gap is not one rule out of six. It is the cover for **the failure this
platform has actually had, three times**:

| Date | What happened |
| --- | --- |
| 2026-08-20 | Every route returned 404 |
| 2026-08-21 | 83 functions deployed, 80 registered |
| 2026-08-21 | Timer listeners down through the 104-function deploy |

All three are the same shape: the host is up and healthy, the functions are not
registered, requests 404. **None of the five armed rules detects it.** `Http5xx`
does not count 404s. `AppExceptions` cannot fire because no handler runs to
throw. The availability rule is the only one that asks from outside, and it is
the one that cannot be armed.

Until the probe below is armed (TODO **T-519**), that failure class is caught
by a human running the check in *[The failure with no alert](#the-failure-with-no-alert)*
below, by the scheduled `Monitor Functions Registered` workflow (which reads
ARM, not the network path), or by the assertion inside `deploy-functions.yml`,
which only runs when someone deploys.

Since 2026-08-28 the arm path no longer waits on a Cloudflare plan change:
[ADR 0024](0024-edge-availability-probe) probes `/api/health` from a
Cloudflare Worker cron — the one external-shaped client Bot Fight Mode does
not challenge — reporting into `availabilityResults`, with a success-counting
rule (`edge_probe_availability`, gated on `availability_probe_alert_enabled`)
that fires as readily on a dead probe as on an unreachable API. Deploying the
Worker and arming the rule are the owner procedure in
`edge/availability-probe/README.md`.

### Delivery is unproven

Every rule routes solely through `azurerm_monitor_action_group.ops`
(`ag-plat-prod-cus-01`), which lives in the **Platform Management**
subscription, while four of the five rules live in the **application**
subscription. Neither `azurerm_monitor_metric_alert` nor
`azurerm_monitor_scheduled_query_rules_alert_v2` has a per-rule email field, so
there is no second path.

What is proven: ARM *accepts* the cross-subscription reference — the existing
budget carries the same reference and applied. What is **not** proven: that a
notification has ever been delivered through it. The budget cannot settle it
either way, because it also carries `contact_emails` as an independent path and
would mail on that alone with the action group completely inert.

So an inert action group produces rules that exist, make
`az monitor metrics alert list` non-empty, and page nobody — which is strictly
worse than the visible emptiness this fabric was built to fix. Two tests settle
it, and they answer different questions; both are in the
[Deployment Runbook](Deployment-Runbook#4-post-apply-verification) §4 sequence.
Until one of them has been seen to arrive, treat every rule below as plumbing
rather than as coverage.

### Silence is not health

Four of the five rules need the application to be healthy enough to emit
telemetry, and the two log rules additionally need the Log Analytics workspace
to be ingesting. The workspace was found `OverQuota` on 2026-08-24 — dropping
every billable table — with nothing anywhere saying so. `logs_daily_cap` exists
to make that specific silence loud, and it is deliberately built to keep working
from inside a capped workspace: the daily cap stops collection of *billable*
tables, and `Usage` is not billable.

## The rules

| Rule | Sev | Fires when | What it usually means | Look at first |
| --- | :---: | --- | --- | --- |
| `alert-func-http5xx` | 1 | More than 5 `Http5xx` on the Function App in 15 min | The host answered and failed: a cold start that timed out, a worker that died mid-request, an unhandled 500 | Application Insights → **Failures**, filtered to the window, grouped by operation |
| `alert-func-latency` | 2 | Mean `HttpResponseTime` above 5 s over 30 min | A slow dependency, or cold starts dominating a low-traffic window | Application Insights → **Performance**, split by operation; then check whether a deploy landed in the window |
| `alert-cosmos-throttle` | 2 | More than 10 Cosmos responses with `StatusCode = 429` in 15 min | Retries are no longer absorbing throttling | Cosmos → **Insights** → normalized RU consumption, to find the container and partition key range |
| `alert-app-exceptions` | 1 | More than 5 `AppExceptions` rows in 15 min | Handlers are throwing | The `AppExceptions` table, grouped by `ProblemId` and `OperationName` |
| `alert-logs-capacity` | 2 | Billable ingestion passes 80% of the daily cap since the 08:00 UTC reset | Telemetry is about to stop for the day, taking the two log-based signals with it | The `Usage` table, grouped by `DataType`, over the same window |
| ~~`alert-api-availability`~~ | 1 | **Not created** (`count = 0`) | — | See *[Reachability is not covered](#reachability-is-not-covered)* |

### Notes that change what you do

**5xx and exceptions are not redundant.** A 5xx with no exception is the host; an
exception with no 5xx is a handler that caught the error and degraded. If both
fire together, start with the exception. If only the 5xx fires, start with the
host — instance restarts, cold-start failures, package state.

**Cosmos throttling has no throughput dial.** The account is serverless
(ADR 0003), so there is nothing to turn up. A firing throttle alert points at a
query or a partition key, not at capacity. Note also that per-request Cosmos
logs go away with the same change that adds this rule — `CDBDataPlaneRequests`
is pruned for being most of the daily cap — so from that apply on this is
answered from metrics, not from logs.

**One mail per incident, not one every five minutes.** The four workload rules
are *stateful* (`auto_mitigation_enabled = true`): each fires once, stays fired
while the condition holds, and sends a single Resolved mail once the condition
has been clear for three evaluation periods — fifteen minutes on the PT5M rules.
They were not stateful when they first went live, and `alert-app-exceptions`
demonstrated the difference on the night of 2026-08-25: a stateless log rule
re-notifies on *every* evaluation whose condition is met, and because each
window is three to six times the evaluation frequency, the same burst is counted
by several consecutive evaluations and the mail continues after the exceptions
have stopped. Nothing about detection changed — same frequency, same query, same
threshold. **If a rule is still noisy after this, it is firing too often, not
notifying too often**, and the fix is the query or the threshold, below.

**To check what is actually deployed, run the workflow — do not read it off the
repository.** Actions → **Verify Alert Rule State** → Run workflow. It logs in
with the deployment identity, reads the three workload rules through ARM, and
prints `autoMitigate`, the mute duration, frequency, window and severity into
the job summary, which is legible from a phone. This exists because a green TFC
run proves ARM *accepted* an apply, not that a rule now behaves differently, and
because `autoMitigate` is invisible from the repository, from CI and from the
run list — the one attribute that decides whether a firing rule mails once or
every five minutes. The job is read-only by construction: the identity's grant
on this group is Monitoring Reader (`infra/oidc.tf`), which carries no verb that
can change anything, and notably not `listKeys` on the workspace. A red run
means at least one rule is stateless or missing, and the summary says which.

**The capacity alert is muted for 6 hours after it fires**, deliberately.
Ingestion only goes up between resets, so once it is past 80% it stays past, and
an hourly rule would send the same mail until 08:00 UTC. When it fires, prune a
diagnostic category before raising the cap; raising the cap moves spend into the
Platform Management budget ([Cost analysis](Cost-Analysis)).

**Every threshold here is a first estimate.** None of these numbers is
incident-derived; each records its assumption beside the resource. Tune them
against the first week of real firing rather than leaving an estimate in place
because it is written down — and tune rather than mute.

That week has started. `alert-app-exceptions` fired at 23:06 on 2026-08-25, the
first firing of any rule on this platform. Before changing its threshold or its
severity, find out what is actually throwing — a rule that pages on five
exceptions is right if those five are one broken handler and wrong if they are a
retried dependency being logged five times:

```kusto
AppExceptions
| where TimeGenerated > ago(24h)
| summarize Count = count(),
            Sample = any(OuterMessage)
        by ProblemId, OperationName, SeverityLevel
| order by Count desc
```

Then choose per finding, in this order — each costs more coverage than the one
before it:

1. **Fix the throw.** The cheapest alert to silence is one with nothing to fire
   on, and a handler that throws six times an hour is telling you something.
2. **Filter the query**, if the exceptions are genuine but expected — a
   dependency that is retried and recovers, a client abort. Excluding a named
   `ProblemId` keeps the rule sensitive to everything else; raising the
   threshold blinds it to everything equally. The query is `exceptions` on the
   component (classic schema — see the note in `infra/observability.tf`), so a
   filter reads `exceptions | where problemId != "…"`.
3. **Require it to persist.** `failing_periods` is 1-of-1 on every rule, so one
   spike pages. Two of two means the condition has to survive a second
   evaluation, which costs five minutes of detection latency and removes
   single-burst noise.
4. **Raise the threshold**, once there is a baseline to raise it against.
5. **Lower the severity.** Sev1 on exceptions asserts that a throwing handler is
   as urgent as the API returning 5xx. If a week of firing says otherwise, Sev2
   is the honest number — but change it because the evidence says so, not to
   make the mail quieter, and note that severity alone does not change what the
   action group sends.

An [alert processing rule](https://learn.microsoft.com/azure/azure-monitor/alerts/alerts-processing-rules)
is the right tool for a *planned* silence — a deploy window, a known-bad
weekend — because it is time-boxed and visible. It is the wrong tool for a rule
that is simply mis-tuned, because the suppression outlives the reason for it.

## The failure with no alert

Run this when the site is reported down but Azure looks healthy, and as step 1
of the post-apply sequence:

```bash
az functionapp function list -n func-site-prod-cus-01 -g rg-web-site-prod-cus --query "length(@)" -o tsv
az functionapp config appsettings list -n func-site-prod-cus-01 -g rg-web-site-prod-cus --query "[?name=='AzureWebJobsStorage'] | length(@)" -o tsv
az functionapp config appsettings list -n func-site-prod-cus-01 -g rg-web-site-prod-cus --query "[?name=='RUNTIME_CONFIG_WRITER'].value | [0]" -o tsv
```

A function count of `0`, or an `AzureWebJobsStorage` count of `1`, is the
condition behind all three recorded incidents. The mechanism is documented at
`infra/main.tf` beside the azapi strip pair: `azurerm` writes an
`AzureWebJobsStorage` connection string with an empty account key on every write
to the site and never shows it in a plan, the host prefers it over the
identity-based setting, and every storage call then fails on the signature —
which presents as SyncTriggers not registering functions, not as a storage
error.

`RUNTIME_CONFIG_WRITER` should read `azapi-strip`. If it reads `azurerm`, the
strip did not complete and the app is running on the first write.

The repair is to re-apply `infra/` so the strip runs again. **Do not delete the
setting by hand** — that hides the regression from the assertion in
`deploy-functions.yml`, which is the only automated detector this failure class
has.

## Break-glass: storage after shared-key authentication is disabled

`fix/go-live-remediation` sets `shared_access_key_enabled = false` on both
production storage accounts, `stsiteprodcus01` (content and media) and
`stsitefuncprodcus01` (Functions host state and deployment packages). **That
apply has not run** — key access reads `true` on both accounts today — so what
follows describes the estate from the apply onward.

Nothing in the platform reads an account key. The Function App uses its managed
identity, the deploy workflow uploads with the deploy identity's Entra token,
and the media SAS the app hands out is a *user delegation* SAS, which Entra
authorizes and which is therefore unaffected — a service or account SAS would
have broken. The keys were two standing credentials no code path used.

**The first person to hit this will read it as an outage.** It is not. Azure
Storage answers a shared-key request on such an account with **HTTP 403** and an
error saying key-based authentication is not permitted, and two common operator
tools reach for shared key by default:

- `az storage` **data-plane** commands (`blob list`, `blob download`,
  `container list`, …) default to key authentication and will fail.
- The portal's **Storage Browser** chooses an authentication method for you and
  uses the account key when it can.

### The credential half

Add `--auth-mode login` to every `az storage` data-plane command, or export
`AZURE_STORAGE_AUTH_MODE=login` for the session. In the portal, switch the
authentication method to your Microsoft Entra account on the container blade.

```bash
export AZURE_STORAGE_AUTH_MODE=login
az storage container list --account-name stsitefuncprodcus01 --auth-mode login -o table
```

That alone is not enough. An Entra request needs a **data-plane** role, and the
control-plane roles an operator normally holds do not grant one: Owner,
Contributor and Storage Account Contributor gave access to data only because
they carry `listKeys`, which is precisely what has stopped mattering. Reading
blobs needs `Storage Blob Data Reader`; writing needs `Storage Blob Data
Contributor`. The configuration declares those roles for the Function App
identity and for the deploy identity, and **for no human** — the same posture as
`admin_object_ids` on Key Vault, where standing human access to production is
not treated as a steady state. Granting one to an operator is a role assignment,
so it is a change with a reviewer.

### The network half, which is the one that surprises

Fixing the credential does not make either account reachable from a laptop.

- **`stsitefuncprodcus01`** has an operator path: `functions_storage_admin_ip_rules`.
  Populate it, apply, do the work, empty it, apply again — the same
  populate/apply/work/empty pattern as the Key Vault and Cosmos admin variables.
- **`stsiteprodcus01`** has none. Its network rules are `default_action = "Deny"`
  with `bypass = ["AzureServices"]` and the Functions integration subnet, and
  there is no operator IP variable on it at all. Its data plane is not reachable
  from outside that subnet, with or without a key. Reaching it means changing
  code, and that is deliberate: public media is served through the Function
  App's identity at `GET /api/public/media/{container}/{*path}`, not by anyone
  browsing the account.

### What still works, unchanged

Control-plane commands — `az storage account show`, `az storage account update`,
`az storage account network-rule add/remove` — authorize through Azure RBAC and
are unaffected. That is why `deploy-functions.yml` still opens and closes its
per-run firewall window normally.

### Rollback

Set `storage_shared_access_key_enabled = true` in the `hcw-azure` workspace and
apply. One edit, both accounts. Reach for it if a deploy starts failing with an
authentication error against storage, or if the host stops cold-starting — and
note that the latter does **not** present as a storage failure; it presents as
404s on every route, which is the same signature as the section above.

Rolling back to debug an operator's own access is the wrong reason: that
re-enables two standing credentials nothing uses, to solve a problem
`--auth-mode login` and a role assignment solve properly.

## Related

- [Deployment Runbook](Deployment-Runbook) — §4 post-apply verification, §6
  day-2 operations
- [Cost analysis](Cost-Analysis) — what the alert fabric and the daily cap cost
- [ADR 0022](0022-alerting-fabric) — why these rules and not others, and the
  reachability trade
- `infra/observability.tf` — every threshold's stated assumption, beside the
  resource
