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
| High | 6 |
| Medium | 3 |
| Low | 1 |
| Total | 10 |

Seven of the ten are the **Blog Machine program** (T-601…T-607), opened
2026-08-28 — the engineering initiative this tracker is now headlined by. The
program of record, with the architecture, verified code anchors, locked owner
decisions and backlog, is
[wiki/Blog-Machine.md](wiki/Blog-Machine.md); the entries below carry only
what "open" means for each phase.

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
