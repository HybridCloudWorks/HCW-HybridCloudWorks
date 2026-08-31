# TODO

**The one open-work document for the HybridCloudWorks website.** Engineering
work, owner decisions, production approvals, credentials, external access and
live-environment operations all live here. Verified completion belongs in
[CHANGELOG.md](CHANGELOG.md); the required-inputs inventory is
[Required-Inputs](wiki/Required-Inputs.md) in the Wiki.

`REVIEW.md` held the owner-gated half until 2026-08-29, and every item in it was
already mirrored here under **Gate: owner** so that this file could answer "what
is still open" on its own. Two files, one restating the other, is one file too
many. Its work sections are below, unabridged.

**Nothing changed about what those items require.** Nothing here is resolved by
an engineer working from a checkout if it needs tenant, Cloudflare or
repository-admin access — the carried-over sections say so in their own words,
and `Gate: owner` still marks the rest.

## Status — 2026-08-31

> **Five items are open. None is critical, none has a deadline, and none can be
> closed from a checkout.** Each carries what to run or click, and what a
> successful result looks like, so a real failure can be told apart from a
> reporting failure.
>
> **The architecture review is closed.** All 62 findings (`T-701`…`T-762`) are
> resolved or carried below as owner gates. The per-finding record — method,
> evidence standard, every failure mode and outcome — is
> [wiki/Architecture-Review-2026-08.md](wiki/Architecture-Review-2026-08.md),
> which is now a dated historical document rather than a live list. Its three
> findings that still need an owner (`T-719`, `T-721`, `T-749`) are stated in
> full below instead of by reference, because a tracker that says "see the
> review" is a tracker you have to read two documents to use.
>
> **The `hcw-azure` workspace is VCS-connected, and auto-apply is off.** Merging
> infra code queues a plan that waits for approval at
> https://app.terraform.io/app/hcw/workspaces/hcw-azure/runs — it does not
> apply on its own, and `terraform apply` from a desktop is refused outright.
> Every run carries the permanent diff, which replaces three `azapi` resources
> and restarts the function app.
>
> This file was wrong about that twice in opposite directions, and the reason is
> worth keeping: HCP Terraform's workspace **Description** is free text beside
> the real settings, validated by nothing, and it read "CLI-driven; no VCS
> connection". That sentence was read and reported as configuration. Corrected
> in the workspace on 2026-08-31. A field that contradicts its own workspace
> reads exactly like a setting.

**This table is the list below, and nothing else.** An earlier version counted
five, because the two owner actions left by closed findings were tracked in a
different section from the five findings that carry `T-` numbers — so the
summary said five above a list of seven. That is the T-722 defect, in the
document restructured to prevent it, and it is why there is now one table
rather than a count and a list that can drift apart. Found by review, 2026-08-31.

| # | Open item | Priority | What closes it |
| ---: | --- | --- | --- |
| 1 | `T-726` — the ruleset bypass | — | Built; create the App, enable auto-merge, then drop the bypass actor |
| 2 | `T-719` — the ingestion cap is binding | Medium | One day at a raised cap, to learn what demand actually is |
| 3 | `T-721` — telemetry costs 5× the workload | Medium | Pull an ingestion lever, after 2 |
| 4 | `T-518` — arm the remaining 15 timers | High | A repeated, observed procedure |
| 5 | `T-519` — arm the reachability alert | Medium | One query, then one variable |

Item 1 carries no severity because it is not a review finding: it is an owner
action left behind by a finding that is closed. Item 2 is a measurement, 3 a
cost decision waiting on it, 4 a repeated procedure, and 5 one query followed by
one variable.

**Closed on 2026-08-31 and removed from this list:** seeding `TFC_TOKEN` (done),
and `T-749`, the SCM lock — Terraform owns
`scm_ip_restriction_default_action`, a live read shows `Deny all`, so the
variable is already `true` and the last Deploy Functions run succeeded on
2026-08-30 at 01:21 UTC. The tracker had it open against a reality where it was
applied.

## What is open, and exactly what closes it

### 1. T-726 — the App is built; two settings remain

**The repository half is done (2026-08-31).** `publish-content-manifest.yml`'s
`commit` job no longer pushes to `main`. It mints a GitHub App installation
token, pushes a branch and opens a pull request that the required checks run on
— which they do precisely because the pull request is not opened with
`GITHUB_TOKEN`. The job's own permission is now `contents: read`, and
`scripts/workflow-write-permissions.test.mjs` is down to one entry.

**Owner action 1 — create the App.** Organisation settings → Developer settings
→ GitHub Apps → New GitHub App. Repository permissions: **Contents: Read and
write** and **Pull requests: Read and write**, nothing else. No webhook. Install
it on this repository only, then generate a private key.

Store both here:
https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/settings/variables/actions
— variable `MANIFEST_APP_ID` (the numeric App ID from the App's page), and at
https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/settings/secrets/actions
— secret `MANIFEST_APP_PRIVATE_KEY` (the whole PEM, `-----BEGIN` line included).

**Success:** the next nightly run that finds a change opens a pull request
titled `chore: refresh content manifest (N article routes)`. Until both are set
the job warns that the App is not configured and does nothing else — it does not
fail.

**Owner action 2 — enable auto-merge.**
https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/settings → Pull
Requests → **Allow auto-merge**. It was **off** when this was built, so without
it the pull request opens and waits for you. The workflow reports that as a
notice naming this setting rather than failing.

**Then remove the bypass.** Once a manifest pull request has merged through the
checks, the Actions token no longer needs to be a bypass actor on the ruleset:
https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/settings/rules — that
is what actually closes T-726. Removing it before the App works would stop the
nightly refresh landing at all, so it goes last.

**What this cost, stated plainly:** one stored non-expiring App private key. It
grants push-a-branch and open-a-pull-request on this repository and cannot merge
past a check — strictly less than the bypass it retires, which is why it was
chosen over a deploy key (repository-wide, also stored, and the bypass survives)
and over accepting the risk.

### 2. T-719 — the cap is binding, measured 2026-08-31

**This is no longer a margin question.** Billable ingestion, aligned to the
08:00 UTC cap reset:

| Cap-day | GB | | Cap-day | GB |
| --- | ---: | --- | --- | ---: |
| 08-30 | 0.2710 | | 08-24 | 0.2692 |
| 08-29 | 0.2591 | | 08-23 | 0.2691 |
| 08-28 | 0.2345 | | 08-22 | 0.2691 |
| 08-27 | 0.2292 | | 08-21 | 0.2625 |
| 08-26 | 0.2140 | | 08-20 | 0.0657 |
| 08-25 | 0.2690 | | 08-19 | 0.0013 |

Seven days pinned inside 0.009 GB of each other, just above a 0.25 cap. Natural
demand does not land on the same number six times; that is the ceiling. So
`function_http_5xx` and `function_response_time` — **log** rules, because Flex
Consumption publishes no HTTP metrics — have been going dark for part of most
days, along with the telemetry itself. That is the silent-under-cap failure the
alerting fabric was built to eliminate, happening.

**This is not the first observation, and the entry said otherwise before it was
checked.** `wiki/Cost-Analysis.md` already recorded the workspace "sitting *at*
that cap (`dataIngestionStatus: OverQuota`)" — a single reading, used to argue
that the top of the USD 17–21 range was the realistic figure. What the series
above adds is that it is not an incident but the normal state, on dated
evidence, which is what turns a cost note into an alerting problem.

The commands that produced this, and how to read `dataIngestionStatus`, are
below under *Reading the ingestion volume*.

**What closes it:** raise `logs_daily_quota_gb` in the workspace
(https://app.terraform.io/app/hcw/workspaces/hcw-azure/variables) to a number the
platform cannot reach in a day, approve the run, leave it one full cap period,
read the volume, put it back. That measures **demand** rather than the ceiling,
which is the number item 3 needs to size its lever. Record it here with the date.

**Do not set it to -1.** Azure accepts that for "unlimited", but the
`logs_daily_cap` alert threshold is this value times 0.8, so an unlimited
workspace gives that rule a negative threshold and it fires forever about a cap
that does not exist. The variable refuses it.

**Anchors, by name rather than by line.** The line numbers this entry carried
until 2026-08-31 came from the architecture review, which states outright that
its anchors are pinned to a commit and unmaintained — and they had drifted:
`observability.tf:329-341` landed in a comment above the alert it meant, and
`main.tf:138-144` pointed past the end of a file that T-754 had cut to 102
lines. Names do not drift.

- `infra/observability.tf` — `function_http_5xx` and `function_response_time`
  are the log rules that stop evaluating at the cap; `logs_daily_cap` is the
  80% alert whose threshold derives from the quota.
- `infra/main.tf` — `azurerm_log_analytics_workspace.hcw` carries
  `daily_quota_gb`.
- `infra/variables.tf` — `logs_daily_quota_gb`.

#### Reading the ingestion volume

Is today measurable at all — a day at the cap is truncation, not demand:

```powershell
az monitor log-analytics workspace show --resource-group rg-mgmt-plat-prod-cus --workspace-name log-plat-prod-cus-01 --subscription 02dfb8ad-ec22-42e3-8cdc-17fd6e00b17e -o json | ConvertFrom-Json | Select-Object -ExpandProperty workspaceCapping
```

**Success:** `dailyQuotaGb`, a `quotaNextResetTime` near 08:00 UTC, and
`dataIngestionStatus`. `RespectQuota` means collection is running; `OverQuota`
means any volume number is a floor.

Then the daily volume, using the same `/ 1000.0` the alert uses so the two agree:

```powershell
az monitor log-analytics query --workspace cf80dc24-2499-49a0-8c66-9522bcc294ed --subscription 02dfb8ad-ec22-42e3-8cdc-17fd6e00b17e --analytics-query "Usage | where IsBillable | where StartTime > ago(14d) | summarize IngestedGb = round(sum(Quantity) / 1000.0, 4) by CapDay = bin(StartTime - 8h, 1d) + 8h | order by CapDay desc" -o json | ConvertFrom-Json | Format-Table CapDay, IngestedGb -AutoSize
```

**Success:** about 14 rows, one per cap-day. The query is one line because on
Windows `az` is a batch file that cannot receive an argument containing a
newline — a multi-line query arrives truncated at the first break and the call
still exits 0.

### 3. T-721 — telemetry costs five times the workload it observes — after item 2

Telemetry runs about USD 17–21 a month against an application-subscription
workload of roughly USD 4 — together roughly 80% of predictable Azure spend on a
platform that documents cost to the cent.

**Raising the cap is not the answer on its own.** At roughly USD 2.76/GB,
doubling it roughly doubles the larger of those two numbers. The levers are:
drop the `host.json` log level, or move `AppTraces` — about 38% of the cap — to
the Basic table plan at roughly USD 0.65/GB. Item 2's measurement is what says
which is enough.

**Separately, re-justify the Static Web App Standard tier** (about USD 9/month).
The in-file rationale cites custom domain plus SSL, SPA routing and 100 GB
bandwidth — all of which the Free tier also provides. The genuinely
Standard-only features are the SLA and pull-request staging environments, which
the rationale does not mention. Downgrade if neither is load-bearing.

**Anchors, by name.** `wiki/Cost-Analysis.md`, the section beginning "The
largest controllable line is telemetry"; and `infra/frontend.tf`, where the
Standard tier and the comment justifying it live — **not** `infra/main.tf`,
which T-754 cut to 102 lines and which the review's anchor pointed past the end
of.

### 4. T-518 — arm the remaining 15 timers — repeated procedure

Three of eighteen are armed and observed: `CHECK_AGENT_HEALTH`,
`CLEANUP_TEMP_STORAGE`, `PUBLISH_SCHEDULED_CONTENT`. `schedulers_master_enabled`
is already `true` and `enabled_timers` is the HCL-typed workspace variable
holding those three.

For each remaining timer, one at a time: add its name at
https://app.terraform.io/app/hcw/workspaces/hcw-azure/variables, approve the run,
then observe it firing before adding the next. The evidence standard is the
observed invocation, not the applied setting — `wiki/Cutover-Runbook.md` step 5
has the four gates.

```powershell
pwsh -File scripts/cutover/05-verify-timer.ps1 -Name publishScheduledContent -Hours 24
```

**Success:** a single summary row with a plausible invocation count and a
`ScheduleStatus` section filtered to that timer. If the count barely changes
between `-Hours 1` and `-Hours 24`, stop — that was the signature of the query
truncation fixed on 2026-08-31, and it means the window is not being applied.

**Note the interaction with item 2:** arming timers adds `AppTraces` volume
against a cap that is already binding. Take that measurement first, or arm and
watch the volume with it.

### 5. T-519 — the probe is deployed; arm the alert once a row lands

The Cloudflare Worker was deployed on 2026-08-31 and runs on `*/5 * * * *`.
Every other alert needs the app healthy enough to emit telemetry; this is the
only signal that survives the app being down.

Confirm a result landed — ingestion lags a few minutes:

```kusto
availabilityResults | where name == "edge-api-health" | order by timestamp desc | take 5
```

**Only after rows with `success == 1` are visible**, set
`availability_probe_alert_enabled = true` in the workspace and approve the run.
The alert fires on ABSENT successes rather than present failures, so arming it
before the first observed success creates a rule that fires immediately and
permanently on the missing data it watches for.

## Optional, and only if you want the feature

None of these blocks anything. Each path no-ops when its key is absent; seed at
**Admin → Platform → API Keys**, which writes straight to Key Vault through a
role that can create a secret version and cannot read one:
https://hybridcloudworks.com/admin/api-keys

| Secret or document | What it turns on | Without it |
| --- | --- | --- |
| `REPLICATE-API-KEY` | AI-generated hero images | The default-hero fallback covers it, once the covers below exist |
| ~8 cover images + `admin_config/default_heroes` | A deterministic hero per provider when generation is off or fails | Posts publish with no cover |
| `admin_config/social_autopost` | Scheduled social posting. Shape: `{ enabled, accountIds: [{ id, provider }], scheduleDelayMinutes }`, with Publer account ids from the Social Hub | No autoposting |
| `YOUTUBE-API-KEY` | Listen & Learn "watch next" links. ~505 of 10,000 daily quota units per certification | Episodes publish with an empty video list |
| `GCP-BILLING-API-KEY` | The GCP column in the public pricing tool. GCP console → enable the Cloud Billing API → create an API key → restrict it to that API. **Not a billing credential** — it reads Google's public price list | The GCP column is absent; AWS and Azure still render |

`GEMINI-API-KEY` already covers Listen & Learn speech; nothing to provide.

## Repository settings still worth a look

Neither is counted above, because neither is a finding — they are settings that
are currently choices rather than defaults.

- **`production` deployment-branch rule.** Without it the environment-scoped
  federated credential matches from **any** branch, so `workflow_dispatch` can
  ship an unreviewed ref past all twelve required contexts. The guard step in
  both workflows is the backstop, and nothing in a checkout can prove a rule set
  outside the repository is still set.
  https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/settings/environments
  → `production` → Deployment branches → **Selected branches** → `main`.

  Required reviewers stay deliberately unconfigured (owner, 2026-08-29): a
  reviewer you approve yourself is not a control, it is a click that produces an
  audit trail implying oversight that did not happen.

- **Two ruleset settings, both `false`.**
  https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/settings/rules →
  `Default`. `strict_required_status_checks_policy` off means a head need not be
  up to date with `main` before merge; `required_review_thread_resolution` off
  means an unresolved thread does not block. Decide each. Zero required
  approvals remains the deliberate single-operator decision under T-705 and this
  does not reopen it.


## The long-form records

Everything below is evidence for the items above, not a second list of them.
Each carries how the finding was established, what was observed, and the limits
of that observation — the part a summary loses and the next reader needs before
changing anything.

### T-518 — 15 of 18 timers are still no-ops; the mechanism is proven

**Gate: owner** — [TODO.md](TODO.md), *Timers and the availability test*.

`functions/src/functions/schedulers.js` checks `FEATURE_FLAG_SCHEDULERS` first
and skips the handler *before* reading the per-timer flag. Until 2026-08-24 that
setting was a hardcoded literal in `main.tf`, which meant `enabled_timers` could
not arm anything at all and no document said so; it is now
`var.schedulers_master_enabled`. Arming needs **both** it and a name in
`enabled_timers`, through the four gates in
[Cutover-Runbook](wiki/Cutover-Runbook.md) step 5 — where the acceptance
criterion is the observed invocation, not the applied setting.

**The master switch went `true` on 2026-08-30**, with `CHECK_AGENT_HEALTH` and
`CLEANUP_TEMP_STORAGE` in `enabled_timers`. That left sixteen no-ops **at that
moment** — see the paragraph below for where the count stands now — so the
platform still ran almost no scheduled work, but "nothing is scheduled" was no
longer true and the arming mechanism was no longer an assumption.

**`PUBLISH_SCHEDULED_CONTENT` was armed and then observed on the evening of
2026-08-30 Chicago time** — `2026-08-31` in UTC, which is why the surrounding
entries and the timestamps below appear to disagree. Every timestamp in this
section is CDT (`-05:00`), matching what the host itself writes; the two UTC
instants are named as UTC where they appear. The observation is unusually
clean, because it straddles the apply:

```
publishScheduledContent  8 invocations  4 ran  4 skipped
                         first 2026-08-30 18:30:00 CDT  last 2026-08-30 20:15:00 CDT
```

Eight invocations at exactly fifteen-minute spacing with no gap. The four at
18:30, 18:45, 19:00 and 19:15 skipped; the four at 19:30, 19:45, 20:00 and
20:15 ran. The apply that set the flag landed at 00:30 UTC on 2026-08-31, which is
19:30 CDT on 2026-08-30 — so the split falls on the boundary rather than near
it. That is the same timer,
observed skipping and then running, with the flag change as the only variable:
a stronger reading than a bare "it fired", because it also proves the gate the
flag controls.

The clock came from the host in the same run: eight `ScheduleStatus` rows, all
`-05:00`, firing on :00 :15 :30 :45 **Chicago local**. So both halves hold for
this timer independently.

One honest limit, which the script prints itself: a RAN invocation is one whose
traces carry no skip line, and a dropped `.User` trace would look identical.
The durable side effect — content actually transitioning to published — is the
second witness Cutover-Runbook Gate 4 asks for, and it only appears when
something was genuinely due. Nothing was, so the no-op is correct and
unwitnessed by that second path.

So of the eighteen: fifteen remain no-ops, and `CHECK_AGENT_HEALTH`,
`CLEANUP_TEMP_STORAGE` and `PUBLISH_SCHEDULED_CONTENT` are armed and observed.

It gates two other things, which is why it outranks its own blast radius:
the Blog Machine's scheduled throughput (`forgeScheduled`,
`publishScheduledContent`), and the Cosmos backup-tier change from T-707,
which only pays for itself once scheduled work is generating documents. It also
gates any meaningful cost measurement — a bill taken while nothing is scheduled
prices an idle platform (Migration-Plan §7).

**Both halves of the gate passed on 2026-08-30.** The clock half needed nothing
armed: `app.timer()` registers on the real schedule unconditionally and the flag
is checked *inside* the handler, so every timer had been firing since deploy and
logging `disabled — skipping`, with the host writing `ScheduleStatus` carrying
`WEBSITE_TIME_ZONE` offsets each time. `cleanupTempStorage` reported
`"Last":"2026-08-29T00:00:00.005764-05:00"`, `"Next":"2026-08-30T00:00:00-05:00"`
— local midnight, offset applied, which is the §7 comparison delivered by the
platform rather than computed by a script.

The handler half came from `checkAgentHealth` after arming: twelve invocations
between `04:55:00Z` and `05:50:00Z`, exactly five minutes apart with no gaps, no
`disabled — skipping` anywhere in the window, and the handler's own
`[checkAgentHealth] 0 agent(s) marked offline` on each one. Host row and `.User`
row are separate emitters, which is what "two independent witnesses" means; the
zero is a correct no-op, not a missing witness.

Two departures from the runbook are worth recording. Both timers were armed in a
single apply rather than one at a time — safe here only because
`TEMP_STORAGE_CLEANUP_DELETE` pins `cleanupTempStorage` to dry-run
(`functionapp.tf`), so the second timer could not touch data. And the evidence
above was read with direct KQL, not through
`scripts/cutover/05-verify-timer.ps1`: that script reported a tally of tens of
thousands of invocations for a query returning two rows, and was rewritten the
same day to aggregate in the workspace instead.

**That rewrite treated a symptom, and the miscount was root-caused on
2026-08-31 instead.** `az` on Windows is a batch file, which cannot receive an
argument containing a newline, so a multi-line query handed to
`--analytics-query` arrived truncated at the first line break: `AppTraces`
survived and the whole pipeline after it was discarded. The call still exited
0. Azure ran the truncated query and returned every unfiltered row in the
table, so the script rendered tens of thousands of rows with every projected
column blank — and its preflight, truncated the same way, read a missing
column as zero and reported "no worker traces" in the same run. The tell was
in the record for a week: the count barely moved between `-Hours 1` and
`-Hours 24`, and a window that changes 24-fold cannot return the same total
unless the window is not being applied. Fixed by flattening every query before
it leaves PowerShell, and by asserting that returned rows carry the columns the
caller asked for — a truncated query answers a different question rather than
failing, which is why nothing in the error handling ever fired.

**Confirmed end-to-end in the same run** (2026-08-30 CDT / 2026-08-31 UTC), on
the Windows host where it failed:
the same command that had returned 58,265 blank rows returned one correct
summary row, the `ScheduleStatus` section came back filtered to the requested
timer and ordered, and the preflight reported 431 worker traces where it had
been reporting none. That last number is the one worth remembering — the
"telemetry gap" this script reported three times never existed.

The fifteen that remain go one at a time, each observed firing before the next
is added.

### T-519 — Reachability is the one signal with no alert behind it

**Gate: owner (Worker deploy)** — [ADR 0024](wiki/0024-edge-availability-probe.md);
[TODO.md](TODO.md), *Timers and the availability test*.

`availability_test_enabled` defaults to `false` and both the standard web test
and its alert are gated on it, for a measured reason: Cloudflare's Bot Fight
Mode serves datacenter clients — which is exactly what Azure's availability
agents are — a 403 interstitial for `https://api-azure.<domain>/api/health`,
and a WAF skip rule against it was built, applied and confirmed **inert**,
because Bot Fight Mode does not run on the Ruleset Engine. It matters more
than one rule out of six suggests: every other alert needs the app healthy
enough to emit telemetry, and reachability is the only signal that survives
the app being completely down.

**The gate changed shape on 2026-08-28.** ADR 0024 routes around Bot Fight
Mode instead of waiting on it: `edge/availability-probe` is a Cloudflare
Worker on a 5-minute cron whose same-zone subrequest is not challenged,
reporting every `/api/health` attempt to Application Insights, with a
success-counting alert (`edge_probe_availability`, gated on
`availability_probe_alert_enabled`, default `false`) in the same fabric as
every other rule. What remains is owner-held but no longer a plan decision:
deploy the Worker with wrangler, seed the connection-string secret, observe a
`success == 1` row, then flip the variable
([Availability-Probe](wiki/Availability-Probe.md) is the procedure). The standard
web test stays in Terraform, disarmed, for the day #127 upgrades the plan.

## Test coverage follow-up

One boundary case is left, and it is not resolvable from the repository:

- The deployed no-op Labs job path, after a human supplies the Entra access
  needed for an authenticated live check (the live prerequisite remains in
  [TODO.md](TODO.md)).

The API base, public content limit, and partial configuration cases are
covered; see [CHANGELOG.md](CHANGELOG.md).

## Owner-gated work, carried from REVIEW.md

Everything from here to the end arrived from `REVIEW.md` on 2026-08-29. These
need tenant administration, production approval, a credential, external access,
or a live confirmation — none of them can be closed from a checkout.

**One section was deleted rather than carried: "Immediate: restore admin
access".** It described a live `403` from `POST /api/bootstrapCurrentUserAdmin`
and asked for the Entra `Admin` app role to be assigned. The owner confirmed on
2026-08-29 that the admin portal loads and signs in immediately, so the role is
assigned and the 403 is gone. It had been sitting at the top of the document
marked *Immediate* — the loudest item in the tracker, describing something that
was already fixed. The `Admin` app role assignment survives as one clause of the
Entra row below, which is where it belongs.

## Owner decisions and external access

| Item | Human action required | Safe repository-side state |
| --- | --- | --- |
| Entra application | Confirm SPA client ID, tenant ID, API audience/scope, redirect URIs, consent, and the `Admin` app role assignment | `frontend/.env.example` documents names; no client secret is committed |
| Frontend release | Approve whether releases remain manual or become push-triggered. **The credential half of this row is closed (T-727, 2026-08-31):** the deploy mints its token from ARM per run under federated identity, and the stored secret is deleted — there is nothing left to provide or rotate | `deploy-azure-frontend.yml` stays dispatch-only |
| Production infrastructure | Approve HCP Terraform plan/apply and any DNS, custom-domain, or Cloudflare changes | Terraform remains the infrastructure source of truth |
| Timers and the availability test | See items 3 and 4 above for the procedure and what success looks like. Decide whether to arm the remaining 15 schedulers, adding each to `enabled_timers` one at a time and observing it before the next. `schedulers_master_enabled` is already `true`; `CHECK_AGENT_HEALTH`, `CLEANUP_TEMP_STORAGE` and `PUBLISH_SCHEDULED_CONTENT` are armed and proven. Separately deploy the edge probe before enabling its Terraform alert | The three proven timers remain armed; the other 15 remain no-ops. The Azure availability test remains disabled because Bot Fight Mode challenges Azure agents; T-519's Cloudflare Worker is the approved path around it and still needs an owner deployment |
| Recovery objectives (decided 2026-08-30) | **RTO 8 hours, RPO 24 hours.** Chosen to match what the estate can actually meet today — periodic Cosmos backup, one operator, no on-call — rather than an aspiration nobody has rehearsed. Deliberately not RPO 1 h: that needs the T-707 continuous-backup tier, which costs money while the platform is still nearly idle and would commit to a drill that has never been run. Revisit once scheduled work is generating documents, which is also when T-707 starts to pay for itself. The remaining work in **[issue #231](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/231)** is now measurement against these numbers — a timed restore — not the numbers themselves | Cosmos carries `Continuous30Days`; content/media storage is RA-GRS with versioning and soft delete; Functions host storage remains LRS with soft delete. No scheduled out-of-account Cosmos export exists, no restore has been timed, and no result is justified against a stated objective |
| Key Vault | Provide only the secrets needed by enabled features; never put values in GitHub variables or Vite config. **The approved procedure changed on 2026-08-29**: seeding is now **Admin → Platform → API Keys**, and the desktop script is break-glass rather than the default path | Code reads secrets server-side and degrades optional integrations when absent |
| Function App vault write (decided 2026-08-29) | **Approved.** The app may create new secret versions, through a CUSTOM role holding only `Microsoft.KeyVault/vaults/secrets/setSecret/action` — not `Key Vault Secrets Officer`, which would also grant get, list, delete and purge. It may also refresh its own Key Vault references (`Microsoft.Web/sites/config/Write`, scoped to the one site, with `config/list/action` excluded so it cannot read its settings back). Weighed against what it replaces: the previous procedure opened the production vault's firewall to a human IP on every rotation, and left it open once | The app cannot read a secret back out of the vault, cannot delete one, and cannot enumerate its own app settings through ARM. `/api/cms/secrets` is `super_admin` on both verbs and returns no value in any response — asserted by scanning the whole serialised body, not by trusting a field list |
| GCP pricing integration | Seed `GCP-BILLING-API-KEY` if the GCP column in the public pricing tool is wanted, or leave it unseeded and that column stays absent. Get it from the GCP console: enable the Cloud Billing API, create an API key, restrict it to that API. **This is not a billing credential** — the Cloud Billing Catalog API serves the public price list, and it is read for the site's comparison tools, not for anything this estate is charged for | No GCP credential is stored in the repository. The service-account JSON this row used to ask for is retired (2026-08-29): the API key is what Google documents for this API, and it removed a vault SDK client, an OAuth library and a bespoke seeding script |
| AI providers | Decide which external providers should be enabled and provide their keys through Key Vault | The AI router only enables a provider when its server-side key is present |
| Third-party integrations | Provide owner-controlled Publer, Klaviyo, YouTube, Telegram, Hostinger, or other credentials and approve webhook changes before activation | Integration secrets are server-side and optional paths remain gated |
| Listen & Learn speech | Nothing to provide: it synthesises with Gemini TTS on the existing `GEMINI-API-KEY`. Audio is billed against that key at roughly $0.17 an episode / $0.87 a certification on the default model; every run is logged to the AI Engine usage tab under "Breakdown by Feature", so the spend is checkable there rather than estimated. Azure AI Speech is a written, tested fallback for the day the preview Gemini TTS models are retired; using it means creating a Cognitive Services resource, which is a spend decision and is not assumed | Provider is chosen by key presence, Gemini first. With no key at all the feature still publishes each episode's transcript, takeaways and videos and records `audioError` instead of failing |
| Listen & Learn video links | Seed `YOUTUBE-API-KEY` if the curated "watch next" links are wanted. One certification costs ~505 of the default 10,000 daily quota units | Optional. Without it, episodes generate and publish with an empty video list |
| VPS Labs agent | Provide the host operator, Entra client/certificate, API scope, and deployment approval for the Hostinger agent | `vps-agent/` uses the API and holds no database credential |

## Live confirmation still requiring an authorized operator

- Verify the Entra role claim and API audience in a newly issued access token.
- Verify the admin registry record and the resulting `getCurrentAdminStatus`
  response in the deployed environment.
- Confirm the public API and Static Web App custom domain after any DNS or edge
  change.
- ~~**Observe an alert actually being delivered.**~~ **Done 2026-08-30.** A
  sample budget alert from `ag-plat-prod-cus-01` arrived in the `ops-email`
  receiver's inbox (fired 21:36 UTC; receiver status `Enabled`). The email path
  is proven end to end, across the subscription boundary, for the first time.

  **Use the CLI, not the portal button.** The portal's **Test action group**
  reported *"There was a problem completing this test"* with status **Unknown**
  on two attempts and delivered nothing. The same operation through the CLI
  returned `"Status": "Succeeded"` / `"state": "Complete"` and the email arrived
  a minute later:

      az monitor action-group test-notifications create \
        --action-group ag-plat-prod-cus-01 \
        --resource-group rg-mgmt-plat-prod-cus \
        --subscription 02dfb8ad-ec22-42e3-8cdc-17fd6e00b17e \
        --alert-type budget -a email ops-email <address> usecommonalertschema

  The API response and the inbox are two independent witnesses, which is the
  standard the Cutover-Runbook asks for and what the portal alone could never
  supply — its `Unknown` was a verdict on nothing. Note also the argument shape:
  it is `-a email <name> <address> <schema>`, not a `--email-receiver` flag, and
  the whole thing is one line — a backtick continuation pasted into Git Bash
  gets read as a command name.

  Second, this file named the group `ag-ops-prod-cus` until the same day, which
  is no resource: `observability.tf:36` builds
  `ag-plat-${environment}-${region_abbreviation}-${instance}`, `hcw-ops` is only
  the short name, and it lives in `rg-mgmt-plat-prod-cus` in the **Management**
  subscription because the action group follows its resource group there.

  **The SMS channel was proven the same evening** and T-709 is closed. Same
  command shape, `-a sms <name> <countryCode> <phoneNumber>` in place of
  `-a email …`; read the values off the action group rather than retyping them.
  Both channels have now been observed delivering, which is the first time this
  estate has had a second path to fall back on.
- Confirm any third-party webhook or scheduled integration after its owner has
  approved a real external mutation test.
- ~~Apply the Terraform change that creates the `listenandlearn` blob
  container.~~ **Applied 2026-08-30.** `az storage container-rm show` reports
  `listenandlearn` with `publicAccess: None` — private, as intended;
  `PUBLIC_MEDIA_CONTAINERS` in `blob-paths.js` is what makes an episode
  reachable, not the container ACL. The same apply declares the fallback
  `AZURE_SPEECH_*` settings, which stay unresolved and inert.

## Accepted risks

A decision to live with a finding rather than fix it. An accepted risk with no
record is indistinguishable from an unfixed one: the next reviewer re-raises it,
or someone "fixes" it without knowing it was a choice.

| Risk | Accepted | Reasoning, and what compensates |
| --- | --- | --- |
| **Key Vault purge protection is off** on `kv-site-prod-cus-01`, which holds 18 live secrets. Raised as Go-Live blocker B2 on 2026-08-24 | Owner, 2026-08-24 | Enabling it is a **one-way** switch: once on it cannot be turned off, a deleted vault can no longer be purged, and its name stays reserved for the retention period — which removes the teardown-and-recreate path a single-environment estate depends on. The secrets are seeded and resolving, so the exposure is not "unprotected during setup". Compensating control: soft delete at 90 days, which still makes an accidental delete recoverable. What is given up is protection against a *deliberate* purge by someone already holding the rights to perform one. Recorded in the same terms in `infra/variables.tf` and `infra/README.md` |
| ~~**The Static Web Apps deployment token is a Terraform output** (`swa_token`)~~ Raised as T-722, 2026-08-28 | **CLOSED (T-727).** The output was deleted on 2026-08-30 and the owner deleted the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret on 2026-08-31; the deploy mints the token from ARM under federated identity, per run. No stored, non-expiring credential remains in this repository's secrets. Not an accepted risk any more, and kept in this table only so the row does not appear to have been quietly dropped | The token is in state via `azurerm_static_web_app.hcw.api_key` whether or not the output exists, so deleting the output would hide it rather than retire it. `sensitive` keeps it out of logs and plan output; it is still visible on the HCP Terraform Outputs tab to anyone with state read. It is the estate's **last long-lived credential** — everything else a workflow uses is federated OIDC. Compensating control, 2026-08-28: `deploy-azure-frontend.yml` now isolates it in a job that installs nothing, so a compromised build dependency cannot reach it (T-727). Retiring it means moving the SWA deploy to OIDC, or at minimum making this an environment secret on a *protected* `production`; both need owner access. The `outputs.tf` header now names the exception instead of contradicting it |
| **`cloudflare_origin_secret` is a real shared-secret value in Terraform state.** Raised as T-723, 2026-08-28 | Recorded 2026-08-28 | Unavoidable rather than chosen: Terraform configures the Cloudflare end of the origin handshake, so the value has to pass through it. It was simply never written down, which is the part that is fixed here. **Rotation consequence, which is the reason this needs a record:** the value must change in three places in one window — the HCP Terraform workspace variable, Key Vault `CF-ORIGIN-SECRET`, and the Cloudflare transform rule Terraform writes — and a mismatch throws on *every anonymous request*, so a partial rotation is a full outage of the public API rather than a degradation. The companion exposure — the azapi read-back exporting the whole live app-settings map into state — is not accepted but *bounded*: it is safe only while every secret-shaped setting is a Key Vault reference, and `functions/src/functions/app-settings-secrets.test.js` now fails CI if one is not |

## Handling rules

- Never paste secret values, private keys, access tokens, or personal data into
  this file, issues, logs, or the Wiki.
- A missing credential is not an engineering task. Record its name, owner, and
  approved storage location only.
- Historical migration pages and the two archived plans are evidence, not
  current instructions for restoring Firebase services.

---

Completed items are removed from this file after the corresponding regular
entry is present in `CHANGELOG.md`; item numbers are not reused.
