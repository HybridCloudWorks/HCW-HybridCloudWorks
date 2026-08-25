# TODO

Actionable engineering work for the HybridCloudWorks website. Owner decisions,
production approvals, credentials, external access and live-environment
operations are *made* in [REVIEW.md](REVIEW.md); they are listed here as well,
marked **Gate: owner**, so this file answers "what is still open" without a
second document. What has not changed: nothing is resolved here that only a
human holding tenant, Cloudflare or repository-admin access can resolve.
Verified completion belongs in [CHANGELOG.md](CHANGELOG.md).

## Status — 2026-08-25

> PR #218 is **partly** applied, and the distinction matters when reading the
> items below. The alerting half is live: `alert-cosmos-throttle-prod-cus` as a
> metric rule, plus `alert-func-http5xx-prod-cus`, `alert-func-latency-prod-cus`
> and `alert-app-exceptions-prod-cus` as log rules, all enabled — verified
> against the tenant 2026-08-25, after #219 fixed the three ARM rejected at
> create time. The **teardown has not applied**: `rg-db-site-sbx-cus` still
> holds `cosmos-site-sbx-cus` and `stsitesbxcus01`, and the plan authorised in
> `REVIEW.md` is still waiting on an approval. A tracker that describes a future
> estate in the present tense is how a reviewer concludes work is done that has
> not started; one that keeps saying "not applied" after it applied is how the
> same reviewer stops trusting the file.

| Priority | Open items |
| --- | ---: |
| High | 2 |
| Medium | 3 |
| Low | 0 |
| Total | 5 |

Five items closed on 2026-08-25. Four in #220 — T-520, T-521, T-523 and A-001,
the ones that did not need access outside the repository — and T-525, which the
owner closed directly by deleting the three variables. Their entries are in
[CHANGELOG.md](CHANGELOG.md).

**All five that remain carry Gate: owner, and none of them is a repository
setting any more.** What is left is a DNS record, a Cloudflare change, two
numbers, an identity decision and a set of feature flags — every one needs
tenant or edge access, and no amount of engineering here closes any of them.
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

### T-522 — No RTO or RPO is stated anywhere

**Gate: owner for the two numbers** — [REVIEW.md](REVIEW.md), *Recovery
objectives*.

Neither term appears in any file in the repository. The recovery settings do
exist — Cosmos continuous backup on the free 7-day tier, 7-day blob and
container soft delete on the Functions host account, versioning plus a 30-day
non-current-version expiry on the content account — but each was chosen against
a plausible default rather than a target, so nothing says whether seven days is
generous or short, and no test would fail if a restore took a week. Once the
owner supplies the two numbers this becomes a Wiki page, and it should state
what has actually been *restored* rather than what is configured: nothing here
has ever been recovery-tested.

### T-524 — The two `data-migration` federated credentials outlive the job they were for

**Gate: owner (identity)** — [REVIEW.md](REVIEW.md), *Migration-era identity
trust*.

`infra/oidc.tf` still declares federated credentials for
`environment:data-migration`, and nothing references that environment —
`migrate-data.yml` was the only consumer and it was deleted in `59e471b`. A
federated credential grants no permission of its own; it decides which OIDC
subject may act *as* the deploy identity, so with the production-write grants
revoked a `data-migration` token now inherits the same reduced role set a branch
token gets. That is why this is a tidy-up rather than an incident. It is still a
standing trust relationship for a job that cannot run, and retiring one is an
identity change rather than a Terraform cleanup — which is why the remediation
branch escalated it instead of deleting it.

## Test coverage follow-up

One boundary case is left, and it is not resolvable from the repository:

- The deployed no-op Labs job path, after a human supplies the Entra access
  needed for an authenticated live check (the live prerequisite remains in
  [REVIEW.md](REVIEW.md)).

The API base, public content limit, and partial configuration cases are
covered; see [CHANGELOG.md](CHANGELOG.md).

Completed items are removed from this file after the corresponding regular
entry is present in `CHANGELOG.md`; item numbers are not reused.
