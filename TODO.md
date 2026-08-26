# TODO

Actionable engineering work for the HybridCloudWorks website. Owner decisions,
production approvals, credentials, external access and live-environment
operations are *made* in [REVIEW.md](REVIEW.md); they are listed here as well,
marked **Gate: owner**, so this file answers "what is still open" without a
second document. What has not changed: nothing is resolved here that only a
human holding tenant, Cloudflare or repository-admin access can resolve.
Verified completion belongs in [CHANGELOG.md](CHANGELOG.md).

## Status — 2026-08-26

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
| High | 2 |
| Medium | 1 |
| Low | 0 |
| Total | 3 |

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

**All three that remain carry Gate: owner, and none of them is a repository
setting any more.** What is left is a DNS record, a Cloudflare change and a set
of feature flags — every one needs tenant or edge access, and no amount of
engineering here closes any of them.
They are listed anyway, because a tracker that omits them is quietly shorter
than the truth.

Nothing on this list has a repository-side half left. T-520 finished the same
day it was written: `functions_scm_lock_enabled` is armed, SCM answers `Deny`,
and run 32902534458 published through Kudu inside the per-run window and
restored the lock behind itself.
The ruleset half of T-523 is done — `20680114` now requires 12 contexts,
including `fmt, validate, tflint` and `Trivy IaC misconfiguration scan`.

## High

### T-517 — The apex is still served by Firebase Hosting

**Gate: owner** — [REVIEW.md](REVIEW.md), *Apex DNS cutover*. In flight as of
2026-08-24.

`hybridcloudworks.com` answers with Firebase Hosting's Fastly headers and a
Firebase-era CSP, and the reserved `/__/firebase/init.json` path returns 200
with `projectId hybridcloudworks-61e8d`. `www` and the Static Web App's default
hostname already serve the Azure site. Until the apex moves, the canonical
hostname of the production system is the one host not running on the platform
this repository builds — which makes every readiness statement about "the site"
a statement about a host most visitors never reach. Nothing in the repository
can move it: the record lives at Cloudflare and the custom-domain binding at
Azure.

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

**Gate: owner (Cloudflare)** — [REVIEW.md](REVIEW.md), *Timers and the
availability test*.

`availability_test_enabled` defaults to `false` and both the standard web test
and its alert are gated on it, so the alert inventory reports five rules rather
than six with one that can never fire. The reason it is off is measured rather
than cautious: Cloudflare's Bot Fight Mode serves datacenter clients — which is
exactly what Azure's availability agents are — a 403 interstitial for
`https://api-azure.<domain>/api/health`, and a WAF skip rule against it was
built, applied and confirmed **inert**, because Bot Fight Mode does not run on
the Ruleset Engine. So the Cloudflare side has to change before the test means
anything. It matters more than one rule out of six suggests: every other alert
needs the app healthy enough to emit telemetry, and reachability is the only
signal that survives the app being completely down.

## Test coverage follow-up

One boundary case is left, and it is not resolvable from the repository:

- The deployed no-op Labs job path, after a human supplies the Entra access
  needed for an authenticated live check (the live prerequisite remains in
  [REVIEW.md](REVIEW.md)).

The API base, public content limit, and partial configuration cases are
covered; see [CHANGELOG.md](CHANGELOG.md).

Completed items are removed from this file after the corresponding regular
entry is present in `CHANGELOG.md`; item numbers are not reused.
