# TODO

Actionable engineering work for the HybridCloudWorks website. Owner decisions,
production approvals, credentials, external access and live-environment
operations are *made* in [REVIEW.md](REVIEW.md); they are listed here as well,
marked **Gate: owner**, so this file answers "what is still open" without a
second document. What has not changed: nothing is resolved here that only a
human holding tenant, Cloudflare or repository-admin access can resolve.
Verified completion belongs in [CHANGELOG.md](CHANGELOG.md).

## Status — 2026-08-24

> The items below describe the estate **as it will be once PR #218 is applied**.
> Nothing in that pull request has been applied yet, so several read ahead of
> the live tenant: FTP basic auth is still `allow: true`, no alert rule of any
> kind exists in either subscription, and versioning is still off on the content
> account. `REVIEW.md` is scrupulous about this distinction and this file should
> be too — a tracker that describes a future estate in the present tense is how
> a reviewer concludes work is done that has not started.

| Priority | Open items |
| --- | ---: |
| High | 2 |
| Medium | 6 |
| Low | 2 |
| Total | 10 |

Nine of these are new on 2026-08-24: the Go-Live readiness review's open
findings, plus what the `fix/go-live-remediation` branch deliberately leaves
open. Seven carry **Gate: owner** — the remaining work is a decision, a tenant
or Cloudflare change, or a repository setting, and no amount of engineering here
closes it. They are listed anyway, because a tracker that omits them is quietly
shorter than the truth.

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

### T-520 — The SCM endpoint is publicly reachable

`scm_ip_restriction_default_action` is `"Allow"` while the front-end origin is
locked to `Deny`, and that is a live gap rather than a decision. The Flex
Consumption deploy publishes *through* Kudu and GitHub-hosted runners have no
stable egress IPs, so denying SCM outright breaks every deploy. The credential
half is already closed — basic authentication is off on both SCM and FTP, so
anything reaching the endpoint must present an Entra token — but the endpoint
itself still answers the internet. Closing it properly means a per-run SCM
firewall window in `deploy-functions.yml`, opened and closed the way the storage
account's already is, with an `always()` restore step that fails if the `Deny` is
not back. The comment beside the setting in `main.tf` points at `REVIEW.md` for
this item; move the pointer here the next time that file is edited.

### T-521 — Twelve files point at a `REVIEW.md` Part 4 that no longer exists

`REVIEW.md` held `PART 4 — REQUIRED INPUTS` — the single inventory of every
variable, secret and setting with a live status (`SET`, `VERIFIED`, `MISSING`,
`RETIRED`) — until `59e471b` cut the file from 1,011 lines to 58 and moved the
narrative to the Wiki. Twelve references survived the move:
`.github/CONTRIBUTING.md` (twice), `.github/templates/infrastructure_change.md`,
`scripts/validate-repository-structure.ps1`, `infra/README.md`,
`infra/outputs.tf`, `infra/variables.tf`, `wiki/Deployment-Runbook.md` (three
times) and `wiki/Variables-And-Secrets.md` (twice). Two of them are live
procedure: CONTRIBUTING tells a contributor to record new required inputs there,
and the Deployment Runbook tells an operator to move an entry from `SET` to
`VERIFIED` after an apply. Both instructions have nowhere to land. The defect is
the absent section, not the references — editing one of the twelve deepens the
inconsistency. Decide once between restoring Part 4 as the status inventory
(`wiki/Variables-And-Secrets.md` is the *placement* rule and deliberately holds
no status) and repointing all twelve in a single change.

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

### T-523 — The IaC checks are not required to merge

**Gate: owner (repository administration)** — [REVIEW.md](REVIEW.md).

`iac-validate.yml` runs `terraform fmt`, `validate` and `tflint` in one job and
Trivy at HIGH/CRITICAL in a second, on every `infra/**` change, and
`.github/CONTRIBUTING.md` states that CI must be green before merge — but the
`main` ruleset does not require either job, so the statement is a convention
rather than a gate. A branch with a red Trivy run merges exactly as easily as
one with a green run, which makes every "CI enforces this" line in CONTRIBUTING
true only while someone is watching. Requiring the two check contexts is a
repository setting, not a code change.

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

## Low

### A-001 — Associate the unlabelled form controls

`jsx-a11y/label-has-associated-control` reports 20 violations across
`frontend/src` — `<label>` elements with no associated control. The rule is
disabled in `eslint.config.js`; it was off because it crashed on ESLint 9, and
since the ESLint 10 upgrade it runs correctly and these are real findings.
Associate each label with its control (nesting, or `htmlFor`/`id`), then delete
the rule's `off` entry so it cannot regress. Screen-reader users get no field
name from an unassociated label, so each one is a small but genuine defect.

### T-525 — Three repository variables have no reader

**Gate: owner (repository administration)** — [REVIEW.md](REVIEW.md).

`COSMOS_SCRATCH_ENDPOINT`, `STORAGE_SCRATCH_ACCOUNT` and
`SCRATCH_RESOURCE_GROUP` are set on the repository and nothing consumes them:
the four Terraform outputs that fed them are deleted along with the scratch
estate, and the `$waveTwo` list in `scripts/set-github-variables.ps1` never held
a scratch entry — the outputs' own header claiming that script consumed them was
already untrue. After the teardown applies they name resources that no longer
exist. Harmless, and worth deleting for the same reason the outputs were: a
value nothing reads is a value the next person assumes is load-bearing.

## Test coverage follow-up

One boundary case is left, and it is not resolvable from the repository:

- The deployed no-op Labs job path, after a human supplies the Entra access
  needed for an authenticated live check (the live prerequisite remains in
  [REVIEW.md](REVIEW.md)).

The API base, public content limit, and partial configuration cases are
covered; see [CHANGELOG.md](CHANGELOG.md).

Completed items are removed from this file after the corresponding regular
entry is present in `CHANGELOG.md`; item numbers are not reused.
