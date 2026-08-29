# TODO

Actionable engineering work for the HybridCloudWorks website. Owner decisions,
production approvals, credentials, external access and live-environment
operations are *made* in [REVIEW.md](REVIEW.md); they are listed here as well,
marked **Gate: owner**, so this file answers "what is still open" without a
second document. What has not changed: nothing is resolved here that only a
human holding tenant, Cloudflare or repository-admin access can resolve.
Verified completion belongs in [CHANGELOG.md](CHANGELOG.md).

## Status — 2026-08-28

> **The Blog Machine program and four remediation passes are closed.** All
> seven Blog Machine phases (T-601…T-607) and 55 of the architecture review's
> 62 findings are merged; their entries are in [CHANGELOG.md](CHANGELOG.md),
> the per-finding record is
> [wiki/Architecture-Review-2026-08.md](wiki/Architecture-Review-2026-08.md),
> and the program of record is [wiki/Blog-Machine.md](wiki/Blog-Machine.md).
> Nothing about that work is repeated below; this file carries only what is
> still open.
>
> **T-526 is closed, and this file was wrong about it.** The Telegram webhook
> was already registered against Azure — `getWebhookInfo` on 2026-08-28 returned
> `https://api-azure.hybridcloudworks.com/api/telegram/webhook`, and `/help`
> answered in the chat, which is the acceptance criterion this file itself
> specified. It had been carried here as "the one deadline on this list" and a
> countdown against the GCP deletion, for work that was already done. Nobody
> re-ran anything to close it; running `-Mode Show` to *start* the work is what
> revealed it. Entry in [CHANGELOG.md](CHANGELOG.md).
>
> **There is no deadline on this list any more.** The GCP deletion no longer
> silences anything, which was the only time-bound consequence here.
>
> The `hcw-azure` workspace is **VCS-connected** (2026-08-26), working
> directory `infra`, auto-apply off. Merged infra code reaches HCP Terraform on
> its own; before that it only arrived when someone ran `terraform` from a
> checkout, which is why several merged changes sat unapplied.

| Priority | Open items |
| --- | ---: |
| Critical | 0 |
| High | 2 |
| Medium | 5 |
| Low | 2 |
| Total | 9 |

Seven of the nine are architecture-review findings still to be worked
(`T-714`, four Medium — two of them owner-gated — and two Low). The other
two are the pre-program platform gates: **T-518** (High) and **T-519**
(Medium). Both carry **Gate: owner** and have no repository-side half — what is
left of them is a Worker deployment and a set of feature flags, each needing
tenant or edge access. They are listed anyway, because a tracker that omits
them is quietly shorter than the truth.

**T-522 moved to [issue #231](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/231)**
on 2026-08-26 — the recovery objectives and the Cosmos export that would
support them, joined on 2026-08-28 by the remainder of T-707 (an out-of-account
copy of media, which no account setting can provide). Neither is closed and
neither is abandoned; both are tracked where a feature with a design, a cost
model and acceptance criteria belongs, rather than as a tracker line that only
ever said "two numbers are missing".

## Owner actions left behind by closed findings

These are the residue of remediated findings: the code half is merged and
in [CHANGELOG.md](CHANGELOG.md), and what remains needs access this repository
does not have. They are not counted in the nine above, because the
engineering work on them is done.

- **`production` deployment-branch rule (from T-705).** Reduced to one setting
  by an owner decision on 2026-08-29: **required reviewers are deliberately not
  configured**, because this is a single-operator estate and a reviewer you
  approve yourself is not a control — it is a click that produces an audit
  trail implying oversight that did not happen. The half that still matters and
  costs nothing: Settings → Environments → `production` → Deployment branches →
  *Selected branches* → `main`. Without it the environment-scoped federated
  credential matches from any branch, so `workflow_dispatch` can ship an
  unreviewed ref past all 12 required contexts. The guard step in both
  workflows stays as the backstop — nothing in a checkout can prove an
  environment rule set outside the repository is still set.
- **Action-group delivery test (from T-709).** An optional SMS receiver is
  wired as an independent second channel, via a `dynamic` block so an unset
  variable leaves the action group byte-identical. Run
  `az monitor action-group test-notifications` and set `ops_sms_receiver`;
  delivery has still never been observed.
- **Ruleset bypass for the manifest push (from T-726).** The workflow is now
  two jobs, so nothing holding `contents: write` also holds the Azure identity
  or runs `npm ci`. What remains: for that push to land on a main protected by
  twelve required contexts, the ruleset must bypass the Actions token — so
  every workflow with `contents: write` can push past all checks. Narrow the
  bypass to a deploy key scoped to `frontend/data/content-manifest.json`, or
  replace the push with an auto-merging pull request.
- **Retire or gate the SWA token (from T-727).** It is the estate's last
  long-lived credential and is now isolated in a job that installs nothing.
  Retiring it means OIDC-based SWA deployment; short of that, make it an
  environment secret on a *protected* `production` and set a rotation cadence.
  Recorded as an accepted exception in [REVIEW.md](REVIEW.md).
- **A TFC API token for the plan assertion (from T-724).**
  `scripts/assert-expected-plan.mjs` fails when a plan contains anything but
  the known permanent diff, but the plan lives in HCP Terraform and
  `iac-validate.yml` has no workspace token, so it is run by hand today.
- **A scheduled-query alert on `unresolvedSecrets` (from T-720).**
  `/api/health` now reports how many app settings arrived as an unresolved
  `@Microsoft.KeyVault(…)` reference. It is 0 in a healthy estate; an alert on
  "greater than 0 for 15 minutes" turns four silent failure classes into one
  page. Needs an apply.
- **Vault seeding and seeded documents (from the Blog Machine program).**
  `PREVIEW-SIGNING-SECRET` (staging links; the preview route 404s and
  notifications say "link unavailable" until then), `REPLICATE-API-KEY` (AI
  heroes; the default heroes cover its absence once the ~8 covers are uploaded
  and `admin_config/default_heroes` is seeded), and
  `admin_config/social_autopost` `{ enabled, accountIds: [{ id, provider }],
  scheduleDelayMinutes }` with the Publer account ids from the Social Hub.
  Absent or disabled, every one of these paths no-ops rather than failing.

## The architecture review — open findings

Six specialist reviews, one per technology layer, run against merged main at
`31f9613`: Azure platform, Terraform IaC, backend Functions, frontend React,
CI/CD, and the remaining ops surfaces (Cloudflare Worker, PowerShell scripts,
Python harness, VPS agent). 62 findings, `T-701`…`T-762`; **55 resolved** as of 2026-08-28
(#249 records; #250, #257, #258 and the CI/Terraform pass remediate).

**The review of record is
[wiki/Architecture-Review-2026-08.md](wiki/Architecture-Review-2026-08.md)** —
it carries the method, the evidence standard, every finding's failure mode,
recommendation and outcome, the cross-cutting observations, and the areas that
came back sound, organised by layer. The entries below carry only what "open"
means for each finding, in the order they should be worked. This split follows
the Blog Machine precedent: the Wiki holds the narrative, this file holds the
list.

Every finding cites `file:line`. Three evidence levels are distinguished in the
Wiki page: **verified** (re-read against the code by a second reader after the
finding was written), **reported** (the anchor resolves but no second reader
re-derived it), and **verify** (could not be settled from the repository —
exactly one finding, T-705).

Deliberately **not** re-reported, being owner gates rather than findings:
T-518, T-519, the unseeded Key Vault secrets, the unseeded
`admin_config` documents, and the absent analytics provider.

### High — 1 of 12 open

| ID | Layer | Finding | Anchor |
| --- | --- | --- | --- |
| T-714 | frontend | **Needs an owner decision.** The 104 pre-rendered documents are discarded at boot (`createRoot`, not `hydrateRoot`). The seed mechanism exists but is deliberately never mounted in the browser, and switching to `hydrateRoot` without wiring it trades a spinner for hydration mismatches on every page. This is an architectural change needing real-browser verification, not a quiet fix | `main.jsx`, `hooks/prerenderData.js` |

### Medium — 4 of 30 open

| ID | Layer | Finding | Anchor |
| --- | --- | --- | --- |
| T-718 | azure | Cosmos firewall admits every Azure datacenter IP; the T-503 per-run window pattern already exists | `main.tf:252-269` |
| T-728 | ci | One OIDC identity serves everything: read-only monitors run with deploy rights | `oidc.tf:41-46,176-202` |

**Open, owner-gated:** T-719 (measure workspace volume on an uncapped day),
T-721 (telemetry vs SWA tier cost decision).

### Low — 2 of 15 open

| ID | Layer | Finding | Anchor |
| --- | --- | --- | --- |
| T-749 | ci | SCM lock flip — **Gate: owner**, overlaps T-520 | `main.tf`, workspace variable |
| T-754 | tf | `main.tf` is a 2,037-line six-concern file; splitting is state-safe file moves | `main.tf` |

## High

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

It gates two other things, which is why it outranks its own blast radius:
the Blog Machine's scheduled throughput (`forgeScheduled`,
`publishScheduledContent`), and the Cosmos backup-tier change from T-707,
which only pays for itself once scheduled work is generating documents.

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
