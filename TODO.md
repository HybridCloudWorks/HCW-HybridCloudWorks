# TODO

Actionable engineering work for the HybridCloudWorks website. Owner decisions,
production approvals, credentials, external access and live-environment
operations are *made* in [REVIEW.md](REVIEW.md); they are listed here as well,
marked **Gate: owner**, so this file answers "what is still open" without a
second document. What has not changed: nothing is resolved here that only a
human holding tenant, Cloudflare or repository-admin access can resolve.
Verified completion belongs in [CHANGELOG.md](CHANGELOG.md).

## Status — 2026-08-28

> **T-517 closed: the apex serves the Azure site.** The owner verified serving
> on 2026-08-28, after the zone export of 2026-08-27 showed the apex CNAME at
> the Static Web App with no Firebase record left. The owner also **forwent
> the DNS rollback**: Firebase is scheduled for deletion rather than held
> through a soak. That decision creates the one new urgency on this list —
> T-526, the Telegram webhook re-registration, which fails *silently* the
> moment GCP is deleted. Entry in [CHANGELOG.md](CHANGELOG.md).
>
> **The T-519 probe path is merged (#234, ADR 0024)** — a Cloudflare Worker
> cron probe and a success-counting alert, both inert until the owner deploys
> the Worker and flips `availability_probe_alert_enabled`.
>
> **PR #218 is fully applied, and this note said otherwise for a day.** Its own
> closing sentence — that a tracker which keeps saying "not applied" after it
> applied is how a reviewer stops trusting the file — described this paragraph.
> Corrected 2026-08-26.
>
> The alerting half is live and now **stateful**: `alert-cosmos-throttle-prod-cus`
> as a metric rule, plus `alert-func-http5xx-prod-cus`,
> `alert-func-latency-prod-cus` and `alert-app-exceptions-prod-cus` as log
> rules, after #219 fixed the three ARM rejected at create time and #226 set
> `auto_mitigation_enabled` on the three log rules. Read back from ARM on
> 2026-08-26 by `Verify Alert Rule State`: all three report
> `autoMitigate: true`.
>
> The **teardown applied on 2026-08-25** — 3 added, 2 changed, 92 destroyed, the
> destroy count matching the authorisation exactly. `rg-db-site-sbx-cus`,
> `cosmos-site-sbx-cus` and `stsitesbxcus01` are gone and `az group list` no
> longer returns the group ([REVIEW.md](REVIEW.md), *Executed: the migration-era
> teardown*).
>
> The `hcw-azure` workspace is **VCS-connected** as of 2026-08-26, working
> directory `infra`, auto-apply off. Merged infra code now reaches HCP Terraform
> on its own; before that it only arrived when someone ran `terraform` from a
> checkout, which is why several merged changes sat unapplied.

| Priority | Open items |
| --- | ---: |
| Critical | 0 (all five closed 2026-08-28) |
| High | 14 |
| Medium | 31 |
| Low | 15 |
| Total | 60 |

**The count changed shape on 2026-08-28.** It previously read 10, of which
seven were the Blog Machine program (T-601…T-607) — now closed and merged, so
those seven left the list. Three platform items remained: T-526 and T-518
(High) and T-519 (Medium). The other 62 are the **architecture review** opened
the same day — six specialist reviews, one per technology layer, recorded as
T-701…T-762 below. A tracker that grows by 62 in a day is not a tracker that
got worse; it is one that was previously describing a smaller surface than the
estate actually had. Nothing in the review is a regression from the program:
the program's own code drew four findings, the pre-existing platform drew the
rest.

Five items closed on 2026-08-25. Four in #220 — T-520, T-521, T-523 and A-001,
the ones that did not need access outside the repository — and T-525, which the
owner closed directly by deleting the three variables. Their entries are in
[CHANGELOG.md](CHANGELOG.md).

T-524 closed on 2026-08-26: the owner authorised retiring the two
`data-migration` federated credentials and they are removed from
`infra/oidc.tf`. Its entry is in [CHANGELOG.md](CHANGELOG.md).

T-522 moved to **[issue #231](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/231)**
on 2026-08-26 — the recovery objectives and the Cosmos export that would support
them. It is not closed and it is not abandoned; it is tracked where a feature
with a design, a cost model and acceptance criteria belongs, rather than as a
tracker line that only ever said "two numbers are missing". The analysis behind
it is in the issue so it does not get redone.

**The three pre-program items (T-518, T-519, T-526) carry Gate: owner and
have no repository-side half.** What is left of them is a webhook
registration, a Worker deployment and a set of feature flags — every one
needs tenant or edge access. They are listed anyway, because a tracker that
omits them is quietly shorter than the truth. Two of them now also gate
program phases: T-526 gates the T-606 Telegram loop, T-518 gates T-607's
scheduled throughput.

The program entries, by contrast, are almost entirely repository-side
engineering — the first substantial engineering work this tracker has carried
since the RPC surface (#180). T-520 finished the same
day it was written: `functions_scm_lock_enabled` is armed, SCM answers `Deny`,
and run 32902534458 published through Kudu inside the per-run window and
restored the lock behind itself.
The ruleset half of T-523 is done — `20680114` now requires 12 contexts,
including `fmt, validate, tflint` and `Trivy IaC misconfiguration scan`.

## The Blog Machine program — closed 2026-08-28

All seven phases (**T-601…T-607**) are engineering-complete and merged —
#236 (Phase 0 + plan), #237, #238, #239, #240, #241, #242 and the Phase 7
close-out PR. The program entry is in [CHANGELOG.md](CHANGELOG.md); the
program of record, per-phase as-built notes and the backlog stay in
[wiki/Blog-Machine.md](wiki/Blog-Machine.md).

What remains is **activation, all owner-gated**, tracked where each gate
already lives rather than re-opened here:

- **T-526** — Telegram webhook re-registration (the entire approve-by-reply
  loop is silent until the webhook points at Azure; run before the GCP
  deletion). Inline approve/reject buttons (wiki §5b) ride the same re-run.
- **T-518** — timer arming (`forgeScheduled`, `syncRssFeeds`,
  `publishScheduledContent` are flag-off until the workspace variables and
  four-gate procedure are run).
- **Vault seeding** — `PREVIEW-SIGNING-SECRET` (staging links; the route
  404s and notifications say "link unavailable" until then) and
  `REPLICATE-API-KEY` (AI heroes; the designed default heroes cover its
  absence once the ~8 covers are uploaded and `admin_config/default_heroes`
  is seeded).
- **Social autopost** (backlog #1, landed post-program) —
  `admin_config/social_autopost` `{ enabled, accountIds: [{ id, provider }],
  scheduleDelayMinutes }` seeded with the Publer account ids from the Social
  Hub. Absent or disabled, publishes queue nothing; enabled, every first
  live publish schedules a captioned post in Publer after the delay.

## The architecture review — opened 2026-08-28

Six specialist reviews, one per technology layer, run against merged main at
`31f9613`: Azure platform, Terraform IaC, backend Functions, frontend React,
CI/CD, and the remaining ops surfaces (Cloudflare Worker, PowerShell scripts,
Python harness, VPS agent). 62 findings, `T-701`…`T-762`.

**The review of record is
[wiki/Architecture-Review-2026-08.md](wiki/Architecture-Review-2026-08.md)** —
it carries the method, the evidence standard, every finding's failure mode and
recommendation, the cross-cutting observations, and the areas that came back
sound, organised by layer. The entries below carry only what "open" means for
each finding, in the order they should be worked. This split follows the
Blog Machine precedent: the Wiki holds the narrative, this file holds the
list.

Every finding cites `file:line`. Three evidence levels are distinguished in
the Wiki page and reproduced in the tables here: **verified** (re-read against
the code by a second reader after the finding was written), **reported** (the
anchor resolves but no second reader re-derived it), and **verify** (could not
be settled from the repository — exactly one finding, T-705).

Deliberately **not** re-reported, being owner gates rather than findings:
T-518, T-519, T-526, the unseeded Key Vault secrets, the unseeded
`admin_config` documents, and the absent analytics provider.

### Critical — CLOSED 2026-08-28

All five are fixed in code and verified by the suite; entries move to
[CHANGELOG.md](CHANGELOG.md) on merge. One residual owner action remains and
is listed under T-705.

- **T-701** — `registerJobType` now requires an explicit `role` (no default),
  all nine registered types declare one, `publish-content` is `publisher`
  matching its HTTP twin, and escalation compares hierarchy level rather than
  string inequality. `jobs.roles.test.js` asserts both properties. The new
  validation immediately caught a ninth registration — the built-in `noop` —
  that the review had missed.
- **T-702** — `Confirm-Plan` refuses in a non-interactive context instead of
  assenting, naming `-Force` as the deliberate unattended path; the six
  destructive scripts now declare `ConfirmImpact = 'High'` so `ShouldProcess`
  prompts too.
- **T-703** — `Invoke-Az` records whether the call failed, `Test-LastAzFailed`
  exposes it, and the root-elevation read-back treats an unreadable result as
  the red path with the manual removal command printed.
- **T-704** — the Key Vault window is `ShouldProcess`-guarded, the verify block
  is skipped under `-WhatIf` (printing what it would check), and the decorative
  secret line is replaced by a behavioural test: a POST without the token must
  answer 401 and one carrying it must answer 200, which also proves the vault
  token matches the deployed one. **T-526 is now safe to run.**
- **T-705** — both deploy workflows now fail a dispatch from any ref but `main`,
  and REVIEW.md §4.4 no longer claims a gate that may not exist.
  **Owner action, still open:** confirm required reviewers and a `main`-only
  deployment-branch rule on the `production` environment, then set that row to
  what you find. The guard step is a backstop, not the gate.

### High

Full rationale and recommendation for each:
[wiki/Architecture-Review-2026-08.md](wiki/Architecture-Review-2026-08.md).

| ID | Layer | Finding | Evidence | Anchor |
| --- | --- | --- | --- | --- |
| T-706 | azure | Media storage is a single LRS copy — ADR 0018 accepted LRS only while Firebase held the second copy, and ADR 0023 removed it | verified | `main.tf:434` |
| T-707 | azure | Cosmos recovery is 7-day PITR co-located with a single-region account that can never be made multi-region | verified | `main.tf:284-287,203-217` |
| T-708 | tf | The Cosmos database and containers carry no `prevent_destroy`, behind a generated spec with immutable partition keys | verified | `main.tf:305,365,1886` |
| T-709 | azure | One cross-subscription action group, one email receiver, delivery never observed | verified | `observability.tf:30-47,157-189` |
| T-710 | backend | Jobs stranded in `running` are never reaped; the client polls forever and the failure hook never fires | verified | `jobs.js:331-335`, `jobs-sweeper.js:4-6` |
| T-711 | backend | `buildSnapshot` fans out up to 2,000 concurrent point reads on a path every Telegram message reaches | verified | `ops-health.js:154-157,190-198` |
| T-712 | backend | Replicate, Publer and Telegram are called with no timeout from change-feed handlers, so one hung socket stalls a lease | verified | `ai-cover.js:151,171`, `notify.js:80` |
| T-713 | ci | The storage firewall stays open if a deploy dies mid-window, and nothing detects it | reported | `deploy-functions.yml:97-101,248-264` |
| T-714 | frontend | 104 pre-rendered documents are discarded at boot — `createRoot`, not `hydrateRoot`, while `prerender.mjs` claims hydration | verified | `main.jsx:16`, `prerender.mjs:219` |
| T-715 | frontend | A 456 kB chart bundle is modulepreloaded on every page to render zero charts; `d3` is a dependency nothing imports | verified | `vite.config.js:29-39`, `dist/index.html` |
| T-716 | frontend | Public list pages download the whole corpus and filter in-browser, three times, with three cache keys | reported | `useBlogData.js:216`, `publicApi.js:37-47` |
| T-717 | frontend | A failed fetch renders the previous route's content under the new route's canonical and OG tags | reported | `usePublicData.js:43-50,79-84` |

### Medium

| ID | Layer | Finding | Anchor |
| --- | --- | --- | --- |
| T-718 | azure | Cosmos firewall admits every Azure datacenter IP; the narrower per-run window pattern already exists (T-503) | `main.tf:252-269` |
| T-719 | azure | The 5xx and latency alerts are log rules, so they stop evaluating at the workspace cap; the margin was never measured | `observability.tf:329-341` |
| T-720 | azure | Key Vault reference failures are silent and indistinguishable across four different causes | `main.tf:1174-1260` |
| T-721 | azure | Telemetry costs ~5x the workload; SWA Standard is justified in-file by Free-tier features | `Cost-Analysis.md:74-84`, `main.tf:138-144` |
| T-722 | tf | `swa_token` output contradicts its own file header and the credential-free principle | `outputs.tf:5-7` vs `18-22` |
| T-723 | tf | Secrets in state: the azapi read-back captures the whole live settings map; `cloudflare_origin_secret` stores a real value | `main.tf:1454-1465,2029-2035` |
| T-724 | tf | The permanent plan diff is asserted only in a comment, so real drift can hide beside it | `main.tf:1379-1407` |
| T-725 | tf | `cloudflare ~> 4.0` admits versions that fail validate; `required_version` has no ceiling | `providers.tf:6,23-27` |
| T-726 | ci | A scheduled workflow pushes to main past the gate, and runs `npm ci` holding both write and `id-token` | `publish-content-manifest.yml:28-29,60` |
| T-727 | ci | The SWA deployment token is the last long-lived credential, used in the job that just built npm dependencies | `deploy-azure-frontend.yml:152` |
| T-728 | ci | One OIDC identity serves everything: read-only monitors run with deploy-grade rights | `oidc.tf:41-46,176-202` |
| T-729 | ci | No concurrency group on the frontend deploy, and neither deploy has a rollback path | `deploy-azure-frontend.yml:15-30` |
| T-730 | backend | A Telegram send failure escapes `handleUpdate`, returns 500, and turns one command into a job-duplicating retry storm | `bot.js:436-447` |
| T-731 | backend | The change feed has no per-invocation work budget: 50 items against documents needing four Replicate calls each | `change-feed.js:86-93` |
| T-732 | backend | The guard test probes only `methods[0]`, so merged verbs are unchecked (28/28 verified sound by hand) | `route-inventory.test.js:216` |
| T-733 | backend | One trigger's failure cancels the remaining triggers and the stats update for that document | `triggers/handlers.js:128-166` |
| T-734 | backend | Scraped external URLs are fetched with no SSRF guard, timeout or size cap, while the right primitive exists unused | `content/inspect.js:246` |
| T-735 | backend | A `forge_ready` notification lost to a transient failure is lost permanently — nothing writes to the doc again | `forge-ready-notify.js:102-117` |
| T-736 | frontend | MSAL (236 kB) is in the static import graph of the public news route despite a correct runtime gate | `useGenerateCuratedImages.js:4,80` |
| T-737 | frontend | Eleven public routes are neither pre-rendered nor in the sitemap; four of five detail templates are never pre-rendered | `prerender-entry.jsx:61-72` |
| T-738 | frontend | Provider normalization is reimplemented four times and has diverged — VMware/Ansible posts vanish from their own blog | `useBlogData.js:13-53` |
| T-739 | frontend | N+1 fetch on the public news grid, repeated on every remount | `useGenerateCuratedImages.js:209-216` |
| T-740 | frontend | Route changes never move focus and are never announced; `PageLoader` has no role; `Skeleton` has no dark token | `ScrollToTop.jsx:7-9` |
| T-741 | ops | The harness closes a workflow where nothing ran as `completed`, and CI asserts that behaviour | `tooling/workflow.py:398` |
| T-742 | ops | The harness CI check never exercises the handoff validator it exists to protect | `ci.yml:117-137` |
| T-743 | ops | The `vps-agent` CI check runs no tests — on the surface that shells to `docker run` and holds a certificate | `ci.yml:49-50` |
| T-744 | ops | `maxConcurrentJobs` is not enforced: the guard reads the counter before awaiting the claim | `vps-agent/index.js:157-167` |
| T-745 | ops | The availability alert's 15-minute window has no headroom for ingestion lag, so a healthy site can page Sev 1 | `observability.tf:869-883` |
| T-746 | ops | A failed probe leaves no trace: no Worker logging, so the three conflated alert causes have no tiebreaker | `worker.js:145-149` |
| T-747 | ops | `edge/availability-probe` is absent from Dependabot (zero impact today — no dependencies) | `.github/dependabot.yml` |

### Low

| ID | Layer | Finding | Anchor |
| --- | --- | --- | --- |
| T-748 | azure | The Terraform principal holds Key Vault Secrets Officer it cannot use — until a seeding window opens and it can | `main.tf:1728-1732` |
| T-749 | azure | SCM remains default-Allow; the flip waits on an observed deploy that has presumably happened (overlaps T-520) | `main.tf:1055-1077` |
| T-750 | tf | CORS origins and the SWA hostname are hardcoded where the sibling block derives both | `main.tf:993-1000` |
| T-751 | tf | The 18-timer catalogue is maintained twice by hand; a mismatch makes a timer impossible to arm | `main.tf:864-890` |
| T-752 | tf | Tag contract values diverge from their source variables (`workload` vs the `site` name token) | `variables.tf:937-949` |
| T-753 | tf | Several variable names exceed the standard's two-word rule; report only, since they are set in the workspace | `variables.tf:359,370,390` |
| T-754 | tf | `main.tf` is a 2,037-line six-concern file; splitting is pure file moves and state-safe by construction | `infra/main.tf` |
| T-755 | ci | The Trivy checksum manifest shares an origin with the binary it verifies | `iac-validate.yml:159-165` |
| T-756 | ci | A dispatch input is interpolated inline into a `run:` command — the only such deviation | `heal-computed-properties.yml:94` |
| T-757 | ci | Gate coverage: `vps-agent` is install-only and the frontend gate runs the admin subset only | `ci.yml:41,49-50` |
| T-758 | ci | `dependency-review` requests `pull-requests: write` on a fork-facing trigger where it degrades silently | `dependency-review.yml:21-24` |
| T-759 | ops | VPS job images are pinned by mutable tag on a root-equivalent socket; no install or rotation runbook exists | `vps-agent/lib/capabilities.js:19` |
| T-760 | backend | Dead exports that are wrong if used: `batchRead` omits partition keys; `watchChangeFeed` logs where nothing reads | `cosmos-client.js:571-574` |
| T-761 | backend | The daily forge budget has one enforcement point, a read-then-act race, and a ledger that swallows failures | `forge-scheduled.js:82-98` |
| T-762 | frontend | Duplicate route declarations leave dead dispatcher branches and a second provider-derivation path | `App.jsx:317-333,510-535` |


## High

### T-526 — The Telegram webhook still points at GCP, and GCP is scheduled for deletion

**Gate: owner** — Cutover-Runbook §3d; the receiver itself was T-512, done.

The bot's webhook URL and secret are registered with **Telegram**, not in
code, so nothing that has shipped or merged moves it: the bot keeps POSTing
at the old Cloud Functions URL until `setWebhook` is re-run. While Firebase
existed as a rollback that was a dormancy; now that the owner has scheduled
GCP for deletion (T-517 close-out), it is a countdown — the moment GCP is
deleted the bot goes quiet **with no error anywhere in Azure**, which is
exactly the failure the runbook warns about. The re-registration cannot run
from this repository's tooling environment (it needs PowerShell 7, the bot
token or a Key Vault firewall window, and network access to
`api.telegram.org` — all owner-held). It is two commands:

```powershell
./scripts/cutover/04-telegram-webhook.ps1 -Mode Show   # what is registered now
./scripts/cutover/04-telegram-webhook.ps1              # point it at Azure
```

**Verified when** `/help` in the chat answers with the command list. Run it
*before* the GCP deletion, not after: a webhook pointed at a dead URL makes
Telegram back off, so the bot stays broken for a while even after the fix.

### T-518 — Nothing is scheduled: all 18 timers are permanent no-ops

**Gate: owner** — [REVIEW.md](REVIEW.md), *Timers and the availability test*.

`functions/src/functions/schedulers.js` checks `FEATURE_FLAG_SCHEDULERS` first
and skips the handler *before* reading the per-timer flag, so while the master
switch is `"false"` all 18 timers log "disabled — skipping" and do nothing. Until
2026-08-24 that setting was a hardcoded literal in `main.tf`, which meant
`enabled_timers` could not arm anything at all and no document said so; it is now
`var.schedulers_master_enabled`, default `false`. Arming needs **both** it and a
name in `enabled_timers`, one timer at a time, through the four gates in
[Cutover-Runbook](wiki/Cutover-Runbook.md) step 5 — where the acceptance
criterion is the observed invocation, not the applied setting. Until then the
platform runs no scheduled work of any kind: no feed sync, no cleanup, no
digest.

## Medium

### T-519 — Reachability is the one signal with no alert behind it

**Gate: owner (Worker deploy)** — [ADR 0024](wiki/0024-edge-availability-probe.md);
[REVIEW.md](REVIEW.md), *Timers and the availability test*.

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
  [REVIEW.md](REVIEW.md)).

The API base, public content limit, and partial configuration cases are
covered; see [CHANGELOG.md](CHANGELOG.md).

Completed items are removed from this file after the corresponding regular
entry is present in `CHANGELOG.md`; item numbers are not reused.
