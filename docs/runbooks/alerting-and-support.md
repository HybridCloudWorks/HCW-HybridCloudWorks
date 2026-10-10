# Alerting and support

**Scope:** what pages an operator, what each page means, what to look at first,
and — stated as plainly as the coverage itself — what nothing watches.

**State:** the rules described here are declared in `infra/observability.tf`
and `infra/lab-hybrid.tf` on `main`, in two resource groups and two
subscriptions, and [The rules](#the-rules) below has a row for each one. Which
of them the live tenant holds is read every Monday by the **Verify Alert Rule
State** workflow, which takes its list from those files rather than from this
page (PLAT-4, #964); see
[To check what is actually deployed](#to-check-what-is-actually-deployed).

> **Corrected 2026-09-07.** This block used to read "declared on
> `fix/go-live-remediation` and **have not been applied**", and told the reader
> to treat every "fires when" below as configuration rather than as the live
> tenant. Both halves are now wrong, and in the direction that matters: an
> operator was being told nothing was watching while rules were firing.
>
> - **The branch is gone.** `fix/go-live-remediation` no longer exists on
>   `origin`; every rule it declared is on `main` in `infra/observability.tf`.
> - **At least one rule is demonstrably live.**
>   `alert-api-reachability-prod-cus` was armed on 2026-09-01 when T-519
>   closed — this page says so itself, forty lines below — and
>   [Availability probe](../runbooks/availability-probe.md) records the same
>   arming. `alert-cosmos-export-daily` and `alert-cosmos-export-full` are
>   bound to `cosmos_export_enabled` ([ADR 0028](../decisions/0028-cosmos-out-of-account-export.md)).
> - **What is still not settled here is which rules the last apply carried.**
>   That is a live-tenant question this page cannot answer from the
>   repository. Since PLAT-4 (#964) the **Verify Alert Rule State** workflow
>   answers it weekly for every declared rule; the commands below are the
>   same reads by hand.

The Go-Live readiness review of 2026-08-24 found `az monitor metrics alert
list` and `az monitor scheduled-query list` empty in both subscriptions. That
reading is what the paragraph above described, and it is many applies old.
Re-read it rather than trusting a date. The application subscription's group
holds the workload rules, one command per rule type:

```powershell
az monitor scheduled-query list -g rg-web-site-prod-cus -o json | ConvertFrom-Json | Select-Object name, enabled
```

```powershell
az monitor metrics alert list -g rg-web-site-prod-cus -o json | ConvertFrom-Json | Select-Object name, enabled
```

```powershell
az monitor activity-log alert list -g rg-web-site-prod-cus -o json | ConvertFrom-Json | Select-Object name, enabled
```

**The capacity rule and the lab rules are in none of those.** They read the
Log Analytics workspace, so they are declared in
`azurerm_resource_group.platform_mgmt`, a different resource group **and a
different subscription**, which is why they need their own read:

```powershell
az monitor scheduled-query list -g rg-mgmt-plat-prod-cus --subscription sub-plat-mgmt-prod-cus -o json | ConvertFrom-Json | Select-Object name, enabled
```

```powershell
az monitor activity-log alert list -g rg-mgmt-plat-prod-cus --subscription sub-plat-mgmt-prod-cus -o json | ConvertFrom-Json | Select-Object name, enabled
```

A rule named in this page and absent from the list that should hold it has not
been applied; a rule present with `enabled: True` is watching the live tenant
now. An empty activity-log list is the expected reading until a rule of that
type is declared. Looking for `alert-logs-capacity` in `rg-web-site-prod-cus`
and concluding it was never applied is the one easy mistake here.

**Authority:** this page does not authorize anything. Tuning a threshold is a
normal pull request; arming the availability test or the timers is an owner
decision, made on an `owner-gated` GitHub issue and recorded in
`CHANGELOG.md` once taken.

## Read this before the rules

An inventory of rules is not the same as coverage. Two things make this fabric
less than its inventory suggests, and both are worth knowing before the first
one fires. A third, whether a page is delivered at all, was open until
2026-08-30 and is settled; its section is kept because the way it was proven
is the way to re-prove it.

### Reachability is covered, but not by the Azure test

This heading read *Reachability is not covered* until 2026-09-07. It was
written before [ADR 0024](../decisions/0024-edge-availability-probe.md) and
outlived the gap it named: the section's own body has recorded the Worker probe
as armed since 2026-09-01. The Azure availability test is still not created,
which is the part that remains true and is why the section is kept.

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
registered, requests 404. **None of the log or metric rules detects it.**
`Http5xx` does not count 404s. `AppExceptions` cannot fire because no handler
runs to throw. The availability rule is the only one that asks from outside —
and **it is armed as of 2026-09-01 (T-519 closed):**
`alert-api-reachability-prod-cus`, fed by the Worker probe below, fires when
successes in a trailing 30-minute window drop below 3 of the expected 6.

Until that date this failure class was caught only by a human running the
check in *[The failure with no alert](#the-failure-with-no-alert)* below, by
the scheduled `Monitor Functions Registered` workflow (which reads ARM, not
the network path, and which GitHub delivers 22% of the time), or by the
assertion inside `deploy-functions.yml`, which only runs when someone deploys.
Those remain the diagnosing checks that name WHICH condition; the probe is the
one that notices fast.

Since 2026-08-28 the arm path no longer waits on a Cloudflare plan change:
[ADR 0024](../decisions/0024-edge-availability-probe.md) probes `/api/health` from a
Cloudflare Worker cron — the one external-shaped client Bot Fight Mode does
not challenge — reporting into `availabilityResults`, with a success-counting
rule (`edge_probe_availability`, gated on `availability_probe_alert_enabled`)
that fires as readily on a dead probe as on an unreachable API. Deploying the
Worker and arming the rule are the owner procedure in
[Availability-Probe](../runbooks/availability-probe.md).

### Delivery is proven, on both channels

This heading read *Delivery is unproven* until PLAT-4 (#964), six weeks after
the evidence that settled it was recorded.

Every rule routes solely through `azurerm_monitor_action_group.ops`
(`ag-plat-prod-cus-01`), which lives in the **Platform Management**
subscription, while most rules live in the **application** subscription.
Neither `azurerm_monitor_metric_alert` nor
`azurerm_monitor_scheduled_query_rules_alert_v2` has a per-rule email field, so
a rule has no path of its own; the action group's two receivers, `ops-email`
and `ops-sms`, are the two paths.

What has been observed, and where it is recorded:

- **Both receivers deliver.** On 2026-08-30 a test notification sent to
  `ag-plat-prod-cus-01` through the CLI arrived in the `ops-email` inbox (fired
  21:36 UTC), and the same command with `-a sms` reached the `ops-sms` phone
  the same evening, which closed T-709. Recorded in
  [CHANGELOG.md](../repo/changelog.md) under *Live confirmations completed*:
  "Observe an alert actually being delivered. Done 2026-08-30."
- **A rule in the application subscription reaches the group across the
  boundary.** `alert-app-exceptions-prod-cus` fired at 23:06 on 2026-08-25 and
  its mail kept arriving every five to ten minutes until the rule was made
  stateful; [CHANGELOG.md](../repo/changelog.md), "The alert rules re-notified
  every five minutes, because a scheduled query rule is stateless by default."
  That is the hop the budget could never prove, because the budget also mails
  `contact_emails` directly.

The portal's **Test action group** button is not evidence either way. On
2026-08-30 it reported *"There was a problem completing this test"* with status
`Unknown` and delivered nothing, while the CLI form of the same test delivered
within a minute. Re-prove delivery with the CLI after any change to the action
group. Both pairs below are PowerShell; the first line of each reads the
receiver off the action group, so nothing is retyped.

```powershell
$e = (az monitor action-group show -n ag-plat-prod-cus-01 -g rg-mgmt-plat-prod-cus --subscription sub-plat-mgmt-prod-cus -o json | ConvertFrom-Json).emailReceivers | Where-Object name -eq 'ops-email'
```

```powershell
az monitor action-group test-notifications create --action-group ag-plat-prod-cus-01 --resource-group rg-mgmt-plat-prod-cus --subscription sub-plat-mgmt-prod-cus --alert-type budget -a email ops-email $e.emailAddress usecommonalertschema
```

```powershell
$s = (az monitor action-group show -n ag-plat-prod-cus-01 -g rg-mgmt-plat-prod-cus --subscription sub-plat-mgmt-prod-cus -o json | ConvertFrom-Json).smsReceivers | Where-Object name -eq 'ops-sms'
```

```powershell
az monitor action-group test-notifications create --action-group ag-plat-prod-cus-01 --resource-group rg-mgmt-plat-prod-cus --subscription sub-plat-mgmt-prod-cus --alert-type budget -a sms ops-sms $s.countryCode $s.phoneNumber
```

Success is two independent witnesses: the command returns `"state":
"Complete"` with a `"Status": "Succeeded"`, as it did on 2026-08-30, **and**
the mail or text arrives within a few minutes. The first without the second is the portal's failure
mode again, a verdict on nothing.

### Silence is not health

Most rules need the application to be healthy enough to emit telemetry, and
every log rule additionally needs the Log Analytics workspace to be ingesting.
The workspace was found `OverQuota` on 2026-08-24 — dropping every billable
table — with nothing anywhere saying so. `alert-logs-capacity` exists to make
that specific silence loud, and it is deliberately built to keep working from
inside a capped workspace: the daily cap stops collection of *billable* tables,
and `Usage` is not billable. The two metric rules do not read the workspace at
all, and the rules that count successes (reachability, the two export rules,
the lab heartbeat) fire on silence rather than being silenced by it: a capped
workspace makes them page, not sleep.

## The rules

| Rule | Sev | Fires when | What it usually means | Look at first |
| --- | :---: | --- | --- | --- |
| `alert-func-http5xx` | 1 | More than 5 HTTP 5xx on the Function App in 15 min, evaluated every 5 min. From #250 until the apply of #816 the deployed window was 30 min, on reasoning that belonged to the availability probe | The host answered and failed: a cold start that timed out, a worker that died mid-request, an unhandled 500 | Application Insights → **Failures**, filtered to the window, grouped by operation |
| `alert-func-latency` | 2 | P95 request duration above 5 s over 30 min, evaluated every 5 min | A slow dependency, or cold starts dominating a low-traffic window | Application Insights → **Performance**, split by operation; then check whether a deploy landed in the window |
| `alert-cosmos-throttle` | 2 | More than 10 Cosmos responses with `StatusCode = 429` in 15 min | Retries are no longer absorbing throttling | Cosmos → **Insights** → normalized RU consumption, to find the container and partition key range |
| `alert-app-exceptions` | 1 | More than 5 `AppExceptions` rows in 15 min | Handlers are throwing | The `AppExceptions` table, grouped by `ProblemId` and `OperationName` |
| `alert-telegram-delivery` | 2 | A `[notify] Telegram API error` or `[notify] notifyTelegram failed` trace in the last hour, evaluated every 15 min (stateful) | Telegram refused or failed a notification to the owner: the bot is blocked, or the chat id is stale. Every owner notification is silent until it is fixed, which is why this pages by SMS and mail instead | `AppTraces` for messages starting `[notify]` over the last two hours; then message the bot from the owner's Telegram account |
| `alert-api-reachability` | 1 | Fewer than 3 `edge-api-health` successes in `availabilityResults` in 30 min, of the 6 expected, evaluated every 5 min (stateful). Gated on `availability_probe_alert_enabled`, armed 2026-09-01 (T-519) | The API is unreachable over the Cloudflare path, or the edge probe itself has stopped; from a visitor's seat they are the same incident | `AppAvailabilityResults` for `edge-api-health` over the last hour, then [Availability probe](availability-probe.md) |
| `alert-cosmos-export-daily` | 2 | No `cosmosExportCompleted` event, full or delta, in the last 2 days, evaluated daily. **Stateless**: mails once a day until a run completes. Gated on `cosmos_export_enabled` | The 03:00 UTC exporter is not finishing, and the out-of-account copy is going stale | `AppEvents` for `cosmosExportCompleted`, and `AppExceptions` for the export timer and job; then [Cosmos restore](cosmos-restore.md) |
| `alert-cosmos-export-full` | 2 | On a Monday, no full export completed in the trailing 2 days, evaluated daily. **Stateless**: one mail per missed Sunday. Gated on `cosmos_export_enabled` | Sunday's full did not land: deltas keep accumulating and deletes stay unreconciled until the next full | The same `AppEvents` rows, filtered to `mode` `full` |
| `alert-logs-capacity` | 2 | Billable ingestion passes 80% of the daily cap since the 08:00 UTC reset. In `rg-mgmt-plat-prod-cus`, Management subscription | Telemetry is about to stop for the day, taking the log-based signals with it | The `Usage` table, grouped by `DataType`, over the same window |
| ~~`alert-api-availability`~~ | 1 | **Not created** (`count = 0`, gated on `availability_test_enabled`) | — | See *[Reachability is covered, but not by the Azure test](#reachability-is-covered-but-not-by-the-azure-test)* |
| `alert-lab-heartbeat` | 1 | No `Heartbeat` row from `arcs-lab-hybrid-prod-cus-01` in 30 min, evaluated every 15 min (stateful). In `rg-mgmt-plat-prod-cus`, Management subscription | The lab host is down, the Azure Monitor Agent is stopped, or the host cannot reach Azure; public lab submission fails closed meanwhile | `ssh hcw-lab 'systemctl status azuremonitoragent himdsd hcw-labs-agent --no-pager'`; the Hostinger panel if ssh fails |
| `alert-lab-disk` | 2 | Root filesystem past 85% used, hourly. Management subscription | Docker images, Coder workspaces or pg_dumps filling the disk | `ssh hcw-lab 'df -h /; sudo docker system df; sudo ls -l /var/backups/coder'` |
| `alert-lab-unit-failed` | 2 | A `hcw-unit-failed` line in `Syslog` from the lab host in the last hour, evaluated every 15 min. Management subscription | The Coder backup, the labs agent, Caddy or Vault entered the failed state; the line names the unit | `ssh hcw-lab 'systemctl --failed --no-pager; sudo journalctl -t hcw-unit-failed --since -2h --no-pager'`, which lists the failed units and the notifier's own lines naming them |

### To check what is actually deployed

Run the workflow rather than reading it off the repository:
[Verify Alert Rule State](https://github.com/saulpatinojr/HCW-HybridCloudWorks/actions/workflows/verify-alert-state.yml)
→ **Run workflow**, or read Monday's scheduled run there. It exists because a
green TFC run proves ARM *accepted* an apply, not that a rule now behaves
differently, and because `autoMitigate`, the one attribute that decides whether
a firing rule mails once or every five minutes, is invisible from the
repository, from CI and from the run list.

The list of rules is not written in the workflow. `scripts/verify-alert-state.mjs`
derives it from `infra/` at the commit it runs, through
`scripts/lib/alert-declarations.mjs`: every alert resource in the module, its
Azure name, resource group, subscription, `count` gate and action group. It then
reads each resource group's scheduled query, metric and Activity Log alert
rules through Azure Resource Manager, and the action group, and writes one row
per declared rule to the job summary (legible from a phone) and to the log:

| State | What it means | What to do |
| --- | --- | --- |
| `OK` | Live, enabled, wired to `ag-plat-prod-cus-01`, `autoMitigate` as declared | Nothing |
| `MISSING` | Declared, not live. If the detail says the create is **waiting for an apply**, `scripts/assert-expected-plan.mjs` declares it and the run has not been confirmed | Confirm the pending run in the `hcw-azure` workspace; otherwise the rule was deleted out of band, and an apply restores it |
| `DISABLED` | Live with `enabled: false`; nothing in `infra/` disables a rule, so this was done by hand | Find out who and why first (the Activity Log has the write), then re-apply |
| `NOT WIRED` | Live, but its actions do not name the ops action group | Re-apply; the rule pages nobody until then |
| `DRIFT` | `autoMitigate` differs from the declaration | Re-apply |
| `NOT AUTHORIZED` | The workflow's identity could not read that resource group. The rules' state is **unknown**, which is not the same finding as `MISSING` | See the identity note below |
| `READ FAILED` | ARM answered with some other error; the detail carries the status and code, with IDs masked | Re-run; if it repeats, the detail says what ARM refused |
| `ABSENT` | A `count`-gated rule whose gate `GATES` does not record, and absent. Not a failure, and not a pass either | Record the gate in `GATES`; the test suite already refuses a new gate without an entry |
| `GATED OFF` | A `count`-gated rule whose gate is recorded as off (`GATES` in the script), and absent | Nothing. Arming the gate is an owner decision; record it in `GATES` in the same change |

The action group gets its own row: it fails if it is missing, disabled, or has
no receiver whose status is `Enabled`. Receiver names and statuses are printed;
the address and number are not, because the report is public. A live rule that
no declaration names is listed and does not fail the run.

**The identity, and what it cannot yet read.** The job runs as `github_reader`
(`READER_CLIENT_ID`), which writes nowhere in the estate and holds Reader on
`rg-web-site-prod-cus` (`infra/oidc.tf`). It holds **nothing in the Management
subscription**, so until a read grant on `rg-mgmt-plat-prod-cus` is applied,
the capacity rule, the lab rules and the action group report
`NOT AUTHORIZED` and every run is red on them. That is deliberate: an unknown
state is not a pass. The grant is the owner's decision, recorded on #964.

The same check runs from an operator's machine under the operator's own
rights, which do reach the Management subscription. Run it from the repository
root of a checkout of `main` that includes PLAT-4's verifier; `True` means the
script is there:

```powershell
Test-Path scripts/verify-alert-state.mjs
```

```powershell
node scripts/verify-alert-state.mjs
```

Success is a last line reading **Every expected rule is live, enabled and wired
to its action group.** and `$LASTEXITCODE` of `0`; `1` means a finding named in
the table, and `2` means the check could not run (most often: no `az login`).
To print the declared inventory without touching Azure:

```powershell
node scripts/verify-alert-state.mjs --list
```

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

**One mail per incident, not one every five minutes.** The workload rules are
*stateful* (`auto_mitigation_enabled = true`, or a metric rule's own default):
each fires once, stays fired while the condition holds, and sends a single
Resolved mail once the condition has been clear for three evaluation periods —
fifteen minutes on the PT5M rules. The exceptions are deliberate:
`alert-logs-capacity`, `alert-lab-disk` and `alert-lab-unit-failed` mute for
six hours instead, and the two export rules are stateless because Azure refuses
auto-resolution on a rule evaluated less often than every twelve hours.
They were not stateful when they first went live, and `alert-app-exceptions`
demonstrated the difference on the night of 2026-08-25: a stateless log rule
re-notifies on *every* evaluation whose condition is met, and because each
window is three to six times the evaluation frequency, the same burst is counted
by several consecutive evaluations and the mail continues after the exceptions
have stopped. Nothing about detection changed — same frequency, same query, same
threshold. **If a rule is still noisy after this, it is firing too often, not
notifying too often**, and the fix is the query or the threshold, below.

**The capacity alert is muted for 6 hours after it fires**, deliberately.
Ingestion only goes up between resets, so once it is past 80% it stays past, and
an hourly rule would send the same mail until 08:00 UTC. When it fires, prune a
diagnostic category before raising the cap; raising the cap moves spend into the
Platform Management budget ([Cost analysis](../architecture/cost-analysis.md)).

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
of the post-apply sequence. The latest **Monitor Functions Registered** run's
job summary answers all three questions below, if one has landed since the
change; these are the same reads by hand. All are PowerShell.

Which expected functions are not registered. This reads
`functions/function-inventory.json`, so run it from the repository root of a
checkout of `main`, and only when `main` is what was last deployed (the
monitor reads the deployed commit's copy itself). Confirm the file is there
first; `True` means it is:

```powershell
Test-Path functions/function-inventory.json
```

```powershell
az functionapp function list -n func-site-prod-cus-01 -g rg-web-site-prod-cus -o json | ConvertFrom-Json | ForEach-Object name | node scripts/check-registered-functions.mjs
```

Success is a first line of two equal numbers, the size of the inventory twice
(`248 of 248` when this was written), and `$LASTEXITCODE` of `0`. Anything
missing is listed beneath as `` `name` (trigger) ``, and the exit code is `1`.

The strip's stamp, which should be one row reading `azapi-strip`, and the
`AzureWebJobsStorage` row count, which should be `0`:

```powershell
az functionapp config appsettings list -n func-site-prod-cus-01 -g rg-web-site-prod-cus -o json | ConvertFrom-Json | Where-Object name -eq 'RUNTIME_CONFIG_WRITER' | Select-Object name, value
```

```powershell
(az functionapp config appsettings list -n func-site-prod-cus-01 -g rg-web-site-prod-cus -o json | ConvertFrom-Json | Where-Object name -eq 'AzureWebJobsStorage' | Measure-Object).Count
```

An expected function missing, or an `AzureWebJobsStorage` count of `1`, is the
condition behind all three recorded incidents: every function missing on
2026-08-20, three timers on 2026-08-21. The mechanism is documented in
`infra/functionapp.tf` beside the azapi strip pair: `azurerm` writes an
`AzureWebJobsStorage` connection string with an empty account key on every write
to the site and never shows it in a plan, the host prefers it over the
identity-based setting, and every storage call then fails on the signature —
which presents as SyncTriggers not registering functions, not as a storage
error.

`RUNTIME_CONFIG_WRITER` should read `azapi-strip`. If it reads `azurerm`, the
strip did not complete and the app is running on the first write. When that
can happen, and why no Terraform ordering prevents it, is in
[Deployment runbook](deployment-runbook.md) §4 step 1.

The repair is to re-apply `infra/` so the strip runs again. **Do not delete the
setting by hand** — that hides the regression from the assertions in
`deploy-functions.yml` and `monitor-functions-registered.yml`, which are the
automated detectors this failure class has. When the strip's two reads are
healthy and functions are still missing, the strip is not the cause: the named
functions failed to start, and the host log says why.

## Break-glass: storage after shared-key authentication is disabled

`shared_access_key_enabled = false` on both production storage accounts,
`stsiteprodcus01` (content and media) and `stsitefuncprodcus01` (Functions host
state and deployment packages), comes from `storage_shared_access_key_enabled`,
which **defaults to `false` on `main`** (`infra/variables.tf`,
`infra/storage.tf`).

> **Corrected 2026-09-07.** This paragraph credited the retired
> `fix/go-live-remediation` branch and asserted "**That apply has not run** —
> key access reads `true` on both accounts today". The branch is gone and the
> setting is on `main`, so the claim's basis no longer exists. Whether the
> apply has landed on the live accounts is a tenant read, not something this
> page can assert either way — take it from the accounts themselves before
> assuming you still have key access:
>
> ```powershell
> az storage account list -o json | ConvertFrom-Json | Where-Object { $_.name -in 'stsiteprodcus01','stsitefuncprodcus01' } | Select-Object name, resourceGroup, allowSharedKeyAccess
> ```
>
> `allowSharedKeyAccess: False` on both rows means everything below already
> applies. The two accounts sit in **different** resource groups —
> `stsiteprodcus01` in `rg-stor-site-prod-cus` and `stsitefuncprodcus01` in
> `rg-web-site-prod-cus` — which is why this reads the subscription and filters
> rather than passing one `-g`.

What follows describes the estate from that apply onward.

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

- [Deployment Runbook](../runbooks/deployment-runbook.md) — §4 post-apply verification, §6
  day-2 operations
- [Cost analysis](../architecture/cost-analysis.md) — what the alert fabric and the daily cap cost
- [ADR 0022](../decisions/0022-alerting-fabric.md) — why these rules and not others, and the
  reachability trade
- `infra/observability.tf` — every threshold's stated assumption, beside the
  resource
