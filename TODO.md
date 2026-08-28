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
| Critical | 5 |
| High | 14 |
| Medium | 31 |
| Low | 15 |
| Total | 65 |

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

Six specialist reviews, one per technology layer, run as parallel agents
against the merged main at `31f9613`: Azure platform, Terraform IaC, backend
Functions, frontend React, CI/CD, and the remaining ops surfaces (Cloudflare
Worker, PowerShell scripts, Python harness, VPS agent). Every finding below
carries a `file:line` anchor from this repository; the Critical tier and the
top of High were re-verified by hand against the code before being written
here, and where a claim could not be settled from the repository it is marked
**verify** rather than asserted.

Deliberately **not** re-reported: T-518, T-519, T-526, the unseeded Key Vault
secrets, the unseeded `admin_config` documents, and the missing analytics
provider. Those are owner gates already tracked, not review findings.

Two conventions carried over from the rest of this file: an entry says what
breaks and where, not merely that something is imperfect; and the areas that
came back **sound** are recorded at the end, because a review whose silence
cannot be distinguished from its omissions is not evidence of anything.

### Critical — act before the next deploy or cutover

**T-701 — An editor can publish content live, bypassing the publisher gate.**
`functions/src/lib/jobs.js:106,202,219-222`; `functions/src/functions/publish-jobs.js:39-50`;
`functions/src/lib/cms/publish.js:467`.
`POST /api/publishContent` requires `publisher`. The `publish-content` job type
registers with no `role`, so it inherits `registerJobType`'s `'editor'` default,
and `enqueueJob` escalates only when `spec.role !== 'editor'` — so it never
escalates. The worker then calls `processPublishContent(…, markLive: true)`,
which is guard-free because the only role check lives in the HTTP wrapper.
An editor-level token posting to `enqueueJob` publishes live.
**Verified, and broader than first reported: none of the eight registered job
types declares a role** (`forge-article`, `forge-from-url`, `voice-calibration`,
`generate-weekly-digest`, `batch-inspect`, `generate-listen-and-learn`,
`publish-content`, `fetch-rss-feeds`) — every one silently inherits `editor`.
The jobs platform is a second door onto every pipeline it wraps and nothing
forces that door to match the first one's lock.
**Fix:** make `role` mandatory in `registerJobType` (no default), declare
`role: 'publisher'` on `publish-content`, and add a test asserting each job
type's role is at least the role of the HTTP route performing the same action.

**T-702 — Both human confirmation gates self-approve when stdin is not a TTY.**
`scripts/lib/deploy-console.ps1:209`; all eight scripts' `[CmdletBinding]` lines.
`Confirm-Plan` returns `$true` unconditionally when
`-not [Environment]::UserInteractive -or [Console]::IsInputRedirected`. The
second gate does not prompt either: every script declares
`SupportsShouldProcess` **without** `ConfirmImpact = 'High'`, so under the
default `$ConfirmPreference = 'High'` `ShouldProcess` returns `$true` silently.
Net effect, verified: `pwsh -File bootstrap-terraform-oidc.ps1 -ElevateAccess < /dev/null`
escalates to tenant-root User Access Administrator with no prompt, and
`02-swa-token.ps1 -Rotate` invalidates the live SWA deploy token the same way.
**Fix:** `Confirm-Plan` must *refuse* in a non-interactive context rather than
assent, gated by an explicit `-Yes`/`-Force`; add `ConfirmImpact = 'High'` to
every destructive script.

**T-703 — The root-elevation removal reports "verified" when the verification
itself failed.** `scripts/bootstrap-terraform-oidc.ps1:450-470`;
`scripts/lib/deploy-console.ps1:441,444-445`.
`Invoke-Az -AllowFailure` returns `$null` on a failed call *and* on empty
output, so the read-back cannot distinguish "no assignment remains" from "the
list call was throttled, denied, or timed out". A failed read takes the `else`
branch and prints `Root-scope elevation removed (verified by reading
assignments back)` over a grant that may still be live. The comment three
lines above states this exact false-green is what the read-back exists to
prevent. The residue is a standing tenant-wide UAA grant with no owner and no
expiry.
**Fix:** have `Invoke-Az` distinguish failure from empty (sentinel value, or
check `$LASTEXITCODE` at the call site) and treat an *unreadable* result as the
red path.

**T-704 — `04-telegram-webhook.ps1` has no working dry run and a decorative
verification — and it is the next script due to run (T-526).**
`scripts/cutover/04-telegram-webhook.ps1:68,146-153,150`; contrast
`scripts/cutover/03-keyvault-secrets.ps1:70`.
Three defects, all verified. (a) The Key Vault firewall open at `:68` is **not**
wrapped in `ShouldProcess`, unlike its twin in `03-keyvault-secrets.ps1` — so
`-WhatIf` still mutates the production vault's network ACL and extracts
`TELEGRAM-BOT-TOKEN`. (b) `setWebhook` is `ShouldProcess`-guarded but the
verify block runs unconditionally and throws at `:153`, so the dry run always
ends red and teaches the operator nothing. (c) `:150` prints `custom secret: set`
from `$(if ($after.has_custom_certificate -or $secret) …)` — `$secret` is always
non-empty by then, and `has_custom_certificate` describes self-signed certs, not
`secret_token`; Telegram's `getWebhookInfo` never returns the secret, so the line
is unconditionally "set" and verifies nothing.
**Fix:** guard `:68` with `ShouldProcess`; skip the verify block under
`$WhatIfPreference`; replace `:150` with a real check — re-POST to the target
with the derived `secret_token` header and assert it is no longer 401.
**Do this before running T-526**, not after.

**T-705 — The `production` environment is unprotected and `workflow_dispatch`
accepts any ref, so the 14-check gate is bypassable.**
`.github/workflows/deploy-functions.yml:16,40`;
`.github/workflows/deploy-azure-frontend.yml:16,30`; `infra/oidc.tf:153-166`.
Both deploy workflows are dispatch-only and bound to `environment: production`.
Because the federated credential's subject is environment-scoped
(`repo:…:environment:production`), it matches **regardless of branch** — so a
deploy can be dispatched from an unreviewed ref and ship to production with full
Azure credentials, past all 12 required contexts. Both workflow files' own
comments state that GitHub auto-creates a missing environment with no protection
rules. **`REVIEW.md:300` contradicts this**, recording the environment as
VERIFIED and "Gates production deploys" — the GitHub environments API is not
reachable through this session's proxy, so which is true is a **verify** item.
**Fix:** configure required reviewers and a `main`-only deployment-branch
restriction on the `production` environment; then reconcile REVIEW.md §4.4 with
what is actually configured.

### High

**Data durability**

**T-706 — Media storage is a single LRS copy, and the ADR that accepted LRS
relied on a second copy that no longer exists.** `infra/main.tf:434`;
`wiki/0018-as-built-plan-v02.md:56-57,73-74`; `wiki/0023-migration-estate-retirement.md:79-81`.
ADR 0018 accepted LRS explicitly *"while the Firebase source retains the
authoritative copy,"* with a revisit trigger of "when Firebase decommission
removes the second copy." ADR 0023 removed it. Every blob written since the
2026-08-21 cutover — CMS uploads, generated Listen & Learn audio, AI covers —
exists in one copy in one region. Versioning and soft delete protect against
overwrite and deletion, not against account or regional loss. The accepted-risk
predicate has expired without the decision being revisited.
**Fix:** move the content account to ZRS or RA-GRS (an in-place replication
change at this volume), or add object replication to a second region; record it
as ADR 0018's revisit trigger firing, in a superseding ADR.

**T-707 — Cosmos recovery is a 7-day window co-located with a single-region
account that can never be made multi-region.** `infra/main.tf:284-287,203-217`.
The only restore path for all production data is PITR whose backup storage lives
with the account. Three classes are unrecoverable: corruption found after 7 days
(this platform runs cleanup timers that delete and rewrite documents, so slow
discovery is likely), account deletion, and a Central US regional failure.
Serverless is single-region for life and the conversion is irreversible.
**Fix:** add a scheduled export of every container to blob storage on a
geo-redundant account (a few MB/day at this scale), or at minimum move to
`Continuous30Days` and document the residual out-of-account gap.

**T-708 — The Cosmos database and containers carry no `prevent_destroy`.**
`infra/main.tf:305,365,1886`; guards present only at `298,516,807,1710`.
Verified: the guard covers the account, both storage accounts and the Key Vault,
but not the SQL database, the `for_each` container resource, or `leases`.
`prevent_destroy` on the account does not protect its children. Containers are
generated from `cosmos-containers.json` and partition keys are immutable, so a
regenerated spec that renames a container or alters a key produces a
data-destroying plan gated only by a human reading it. The in-file comment
"every container here is empty as of 2026-08-20" is now stale — production holds
roughly 70k documents.
**Fix:** add `lifecycle { prevent_destroy = true }` to the database, the
container `for_each` (it applies per instance) and `leases`; refresh the stale
comment in the same change.

**Availability and correctness**

**T-709 — The whole alert fabric converges on one cross-subscription action
group with one email receiver, and delivery has never been observed.**
`infra/observability.tf:30-47,157-189`.
Every rule has exactly one delivery path; that path crosses a subscription
boundary proven only to be *accepted* by ARM; the terminus is a single mailbox
with no second channel. The file's own comment ranks an inert path as "strictly
WORSE than the visible emptiness" it replaced.
**Fix:** run `az monitor action-group test-notifications` and record the result;
add a second receiver (SMS or Azure mobile-app push, both free); if the
cross-subscription hop proves inert, build the fallback ADR 0022 already names.

**T-710 — Jobs stranded in `running` are never reaped; the client polls
forever.** `functions/src/lib/jobs.js:331-335`;
`functions/src/functions/jobs-sweeper.js:4-6`.
The sweeper only re-drives `queued` jobs (verified in its own header). If a
worker dies mid-run — host restart, scale-in, deploy, or the platform timeout
beating a job's 28-minute budget — the document stays `running` permanently:
redelivery sees `status !== 'queued'` and returns `skipped`, the sweeper ignores
it, `getJob` reports `running` indefinitely, and the `onComplete` failure hook
never fires, so the Telegram failure notice is lost too. The queued gap was
closed deliberately; this is the same failure one state later.
**Fix:** add a second sweeper query for `status = 'running' AND startedAt <
now - (maxTimeoutMs + margin)` transitioning to `timeout` and invoking
`onComplete`. Separately confirm the platform timeout exceeds 28 minutes —
`host.json` sets no `functionTimeout`, so the job budget is racing the default.

**T-711 — `buildSnapshot` issues up to 2,000 concurrent Cosmos point reads, on a
path every Telegram message reaches.** `functions/src/lib/ops-health.js:154-157,190-198`;
`functions/src/lib/telegram/bot.js:270,400`.
It reads `SELECT TOP 2000` from `generated_content_images` then `Promise.all`s a
point read per row, purely to count orphans. That table grows by up to four rows
per AI cover run, so the bound is reachable. `/status`, `/queue`, `/alerts`,
`/digest`, `/ai` **and every free-form Telegram message** trigger it. Against the
~5,000 RU/s budget the public-reads header cites, one snapshot can 429 the
anonymous list endpoints.
**Fix:** replace the per-image probe with a `SELECT VALUE COUNT(1)` aggregate
over a maintained flag, or compute orphan counts in a timer; failing that, cap
concurrency to ~20 and cache the snapshot for 30-60s.

**T-712 — External calls inside the change-feed path have no timeout, so one
hung socket stalls a lease.** `functions/src/lib/triggers/ai-cover.js:151,171`;
`functions/src/lib/timers/publer-sync.js:124`; `functions/src/lib/notify.js:80`;
`functions/src/lib/telegram/bot.js:470`.
Replicate (POST and its 60-iteration poll), Publer and Telegram `sendMessage` are
called through bare `fetchImpl` with no `AbortController`. Node's `fetch` has no
default timeout. All three are reached from change-feed handlers, where a hung
connection blocks the invocation, the lease is never checkpointed, and every
subsequent change queues behind it. This is an inconsistency, not an unknown —
the correct pattern already exists in `ai/router.js:301-310`,
`content/scrape.js:41-50`, `triggers/fetch-image.js:75-83` and
`timers/link-check.js:33-40`.
**Fix:** route every outbound call through one `fetchWithTimeout` helper with an
explicit per-integration budget, and give the Replicate poll a wall-clock
deadline rather than only an iteration count.

**T-713 — The storage firewall stays open if a deploy dies mid-window.**
`.github/workflows/deploy-functions.yml:97-101,248-264`.
The deploy flips the Functions host storage account to `--default-action Allow`
for the upload and sync. The `always()` close steps do not run on runner loss,
infrastructure failure or a force-cancel — in those cases the account (the host's
secret repository) stays network-open indefinitely, with only Entra data-plane
auth remaining. Stale `ci-deploy-scm-*`/`ci-smoke-*` allow rules for recycled
runner IPs persist the same way, and `monitor-functions-registered.yml` checks
function count and app settings but never firewall posture.
**Fix:** add `defaultAction == Deny` and zero-`ci-*`-rules assertions to the
hourly monitor workflow, which already logs in with sufficient rights — an
orphaned window then pages within the hour.

**T-714 — Pre-rendered HTML is discarded at boot: the client calls `createRoot`,
not `hydrateRoot`.** `frontend/src/main.jsx:16`; `frontend/scripts/prerender.mjs:219`;
`frontend/src/App.jsx:275`.
The build writes 104 real HTML documents and `prerender.mjs:219` states "the
client bundle still hydrates into it." Verified: it does not — `createRoot`
discards existing container children and renders from scratch. Because every
route is `React.lazy` behind one `<Suspense>`, a visitor sees the pre-rendered
article paint, then React clear the container, then a spinner, then the content
again once the route chunk downloads. That is worse than either a pure SPA or
true hydration, and it discards the LCP/CLS benefit the pre-render exists for.
**Fix:** serialize the prerender seed into the document, switch to
`hydrateRoot`, and preload the route chunk for the rendered path. If hydration
is too risky now, at minimum stop claiming it in `prerender.mjs`.

**T-715 — A 456 kB `vendor-charts` chunk is modulepreloaded on every page, to
render zero charts.** `frontend/vite.config.js:29-39,124-179`; verified in
`frontend/dist/index.html`.
The chunking predicate runs first, so React's `jsx-runtime` lands *inside*
`vendor-charts`, making it a static dependency of the app entry —
`dist/index.html` modulepreloads it. Compounding it: `d3` is a declared
dependency **no source file imports** (verified: zero matches in `frontend/src`),
`recharts` is used in one admin file and `chart.js` in one widget — two charting
stacks for two components.
**Fix:** drop `d3`, consolidate on one charting library, scope
`pickChartsChunk` to `node_modules/` paths (`id.includes('d3')` is a loose
substring test), and add a build assertion that fails if `dist/index.html`
modulepreloads any chunk above ~150 kB.

**T-716 — Public list pages download the entire content corpus and filter it in
the browser, three times over.** `frontend/src/hooks/useBlogData.js:216,231`;
`useProviderLandingContent.js:160,188`; `useFrameworkData.js:190,199`;
`frontend/src/lib/publicApi.js:37-47`.
`fetchPublicContentList` accepts `type` and `provider` and the server expands
provider aliases — no call site passes either. `/aws/blog` fetches every
published document with bodies and discards non-AWS rows in JS. The three hooks
use three cache keys and two different limits for the same request, and
`usePublicData` has no shared cache, so `/aws` → `/aws/blog` → `/aws/frameworks`
triggers three near-identical full-corpus downloads.
**Fix:** pass `{ provider, type }` server-side, unify the limit, and give
`usePublicData` a module-level promise cache keyed on the request URL.

**T-717 — `usePublicData` renders the previous route's data when a fetch fails,
and every consumer discards `error`.** `frontend/src/hooks/usePublicData.js:43-50,79-84`;
`frontend/src/components/templates/BlogDetailTemplate.jsx:63-68`.
On a key change the hook keeps `prev.data` to avoid an empty flash; on rejection
it sets `error` but leaves `data` untouched. So `/aws/blog/a` → `/aws/blog/b`
with a failed request for `b` renders **article A's** title, body and image while
the template emits canonical, `og:url` and `og:title` for **b**. `useBlogData.js:254`
and `useFrameworkData.js:214` hardcode `error: null`, so no error reaches any UI
on those paths, and there is no retry — one network blip is terminal.
**Fix:** clear `data` when the key changes *and* the fetch errors, surface
`error` through the wrapper hooks, render an error state in the detail
templates, and add one bounded retry for network/5xx in `publicGet`.

### Medium

| ID | Layer | Finding | Anchor |
| --- | --- | --- | --- |
| T-718 | azure | Cosmos firewall admits every Azure datacenter IP by default; the narrower per-run window pattern already exists for the host storage account (T-503) | `main.tf:252-269`, `variables.tf:315-318` |
| T-719 | azure | The 5xx and latency alerts are log rules, so they stop evaluating when the workspace hits its daily cap; the post-prune margin was never measured against an uncapped day | `observability.tf:329-341`, `main.tf:80-84` |
| T-720 | azure | Key Vault reference failures are silent and indistinguishable — unseeded, RBAC-revoked, network-denied and rotated-broken all present as a feature quietly turning off | `main.tf:1174-1260,665-673` |
| T-721 | azure | Cost shape is inverted: telemetry ~USD 20/mo is 5x the workload, and SWA Standard is justified in-file by features the Free tier also has | `Cost-Analysis.md:74-84`, `main.tf:138-144` |
| T-722 | tf | `swa_token` output contradicts the file header's "sensitive outputs intentionally omitted" and the credential-free principle | `outputs.tf:5-7` vs `18-22` |
| T-723 | tf | Secrets in state: the azapi app-settings read-back captures the entire live settings map unredacted, and `cloudflare_origin_secret` stores a real shared-secret value | `main.tf:1454-1465,2029-2035` |
| T-724 | tf | The permanent 3-add/1-change/3-destroy plan shape is asserted only in a comment, so real drift can hide beside it | `main.tf:1379-1407,1462-1464` |
| T-725 | tf | `cloudflare ~> 4.0` admits versions that fail validate (`cloudflare_record` needs 4.52); `required_version = ">= 1.5"` is unbounded | `providers.tf:6,23-27` |
| T-726 | ci | `publish-content-manifest.yml` pushes straight to main with `contents: write`, and runs `npm ci` in the same job that holds both write and `id-token` | `publish-content-manifest.yml:28-29,60,71-86` |
| T-727 | ci | The SWA deployment token is the last long-lived credential, used in the same job that just built untrusted dependencies | `deploy-azure-frontend.yml:152` |
| T-728 | ci | One OIDC identity serves everything: read-only monitors run with Storage/Website/Cosmos write rights | `oidc.tf:41-46,176-202` |
| T-729 | ci | No `concurrency` group on the frontend deploy, and neither deploy has a rollback path — a failed smoke test leaves the bad package live | `deploy-azure-frontend.yml:15-30`, `deploy-functions.yml:302-345` |
| T-730 | backend | A Telegram send failure escapes `handleUpdate` (the `send` is outside the try), returning 500 and turning one command into a retry storm that re-enqueues jobs | `telegram/bot.js:436-447`, `telegram-http.js:110-112` |
| T-731 | backend | The change feed has no per-invocation work budget: `maxItemsPerInvocation: 50` against documents that can each need four Replicate generations | `change-feed.js:86-93`, `triggers/handlers.js:128-166` |
| T-732 | backend | The route-inventory guard test probes only `methods[0]`, so merged verbs behind one registration are never guard-checked (no live gap found — 28/28 handlers verified by hand) | `route-inventory.test.js:216`, `auth/http-route.js:274-301` |
| T-733 | backend | One trigger's failure cancels the remaining triggers and the stats update for that document; only the inspect branch is individually wrapped | `triggers/handlers.js:128-166` |
| T-734 | backend | `generateAltTexts` fetches scraped external URLs with no SSRF guard, no timeout and no size cap — while the correct primitive exists in `triggers/fetch-image.js` | `content/inspect.js:246,309-310` |
| T-735 | backend | A `forge_ready` notification lost to a transient Telegram failure is lost permanently: nothing writes to the document again unless a human acts | `triggers/forge-ready-notify.js:102-117` |
| T-736 | frontend | MSAL (236 kB) is in the static import graph of the public `/{provider}/news` route, so anonymous visitors download and execute it | `useGenerateCuratedImages.js:4,80` → `useAdminAuth.js:17-18` |
| T-737 | frontend | Eleven public routes are neither pre-rendered nor in the sitemap, and four of five detail templates are never pre-rendered; `/admin/*` and `/preview/*` have no `X-Robots-Tag` | `prerender-entry.jsx:61-72`, `prerender.mjs:245-253` |
| T-738 | frontend | Provider and field normalization is reimplemented four times and has already diverged — VMware/Ansible documents match on the landing page but vanish from `/vmware/blog` | `useBlogData.js:13-53` vs `useProviderLandingContent.js:24-57` |
| T-739 | frontend | N+1 fetch on the public news grid: one `curated-image` request per article, repeated on every remount | `useGenerateCuratedImages.js:209-216` |
| T-740 | frontend | Route changes never move focus and are never announced; `PageLoader` has no `role="status"`; `Skeleton` has no dark-mode token | `ScrollToTop.jsx:7-9`, `App.jsx:174-178,273`, `Skeleton.tsx:52` |
| T-741 | ops | The harness closes a workflow as `completed` when nothing ran, and CI asserts that behaviour — the exact failure its docstring says it prevents | `tooling/workflow.py:341-344,398`, `ci.yml:120-125` |
| T-742 | ops | The harness CI check never exercises `handoff_valid` or `scalar` — the regex parsing that decides whether an agent's claimed work is real | `ci.yml:117-137`, `tooling/workflow.py:273-301` |
| T-743 | ops | The `vps-agent` CI check runs no tests at all — `npm ci` only — on the surface that shells to `docker run` and holds a long-lived Entra certificate | `ci.yml:49-50`, `vps-agent/package.json:10-12` |
| T-744 | ops | `maxConcurrentJobs` is not enforced: the guard reads `activeJobs` before awaiting the claim, and the 15s poll interval is shorter than the 20s claim timeout | `vps-agent/index.js:157-167,123` |
| T-745 | ops | The availability alert's 15-minute window has no headroom for App Insights ingestion lag, so normal 1-3 minute delay plus one missed cron pages Sev 1 on a healthy site | `wrangler.toml:23`, `observability.tf:869-883` |
| T-746 | ops | A failed probe leaves no diagnosable trace: no `[observability]` block, no catch in `scheduled`, so the three causes the alert conflates have no tiebreaker | `edge/availability-probe/worker.js:145-149`, `wrangler.toml` |
| T-747 | ops | `edge/availability-probe` is absent from `.github/dependabot.yml` (zero impact today — no dependencies) | `.github/dependabot.yml` |

### Low

| ID | Layer | Finding | Anchor |
| --- | --- | --- | --- |
| T-748 | azure | The HCP Terraform principal holds Key Vault Secrets Officer it cannot use by design — until an `admin_ip_rules` window opens and it can | `main.tf:1728-1732,1679-1687` |
| T-749 | azure | SCM (Kudu) remains default-Allow; the per-run window it waits on has presumably been exercised many times since 2026-08-24 (overlaps T-520) | `main.tf:1055-1077`, `variables.tf:886-889` |
| T-750 | tf | CORS origins and the SWA hostname are hardcoded in the function app block while the storage account derives both from `var.domain` | `main.tf:993-1000` vs `483-487` |
| T-751 | tf | The 18-timer catalogue is maintained twice by hand; adding a timer without updating the validation makes it impossible to arm | `main.tf:864-890` vs `variables.tf:1008-1023` |
| T-752 | tf | Tag contract values duplicate and diverge from their source variables (`workload = "hybridcloudworks"` vs the `site` name token) | `variables.tf:937-949,158-162,188-192` |
| T-753 | tf | Several variable names exceed the standard's two-word rule; most are already set in the workspace, so this is a report, not a rename request | `variables.tf:359,370,390,550,574,628` |
| T-754 | tf | `main.tf` is a 2,037-line six-concern file; splitting by concern is pure file moves (addresses unchanged, no `moved` blocks needed) | `infra/main.tf` |
| T-755 | ci | The Trivy checksum manifest is fetched from the same origin as the binary it verifies; the workflow's own comment recommends the fix | `iac-validate.yml:159-165` |
| T-756 | ci | `inputs.mode` is interpolated inline into a `run:` command — the only deviation from the repo's deliberate env-var pattern | `heal-computed-properties.yml:94` |
| T-757 | ci | Gate coverage gaps: `vps-agent` is install-only and the frontend gate runs the `test:admin` subset only | `ci.yml:41,49-50` |
| T-758 | ci | `dependency-review` requests `pull-requests: write` on a fork-facing trigger, where the token is downgraded and the comment silently degrades | `dependency-review.yml:21-24,36` |
| T-759 | ops | VPS job images are pinned by mutable tag on a root-equivalent Docker socket, and no systemd unit, Dockerfile or update runbook exists for the component | `vps-agent/lib/capabilities.js:19,30,45` |
| T-760 | backend | Dead exports that are wrong if used: `batchRead` omits partition keys (throws for the five non-`/id` containers) and `watchChangeFeed` logs where App Insights cannot see | `cosmos-client.js:571-574,587-614` |
| T-761 | backend | The daily forge budget is enforced in one caller with a read-then-act race, and its ledger is written by a best-effort path that swallows its own failures | `timers/forge-scheduled.js:82-98`, `content/forge.js:290-292` |
| T-762 | frontend | Duplicate route declarations leave dead dispatcher branches and a second provider-derivation path, because the static twins sit outside `ProviderLayout` | `App.jsx:227-228,317-333,510-535` |

### Examined and found sound

Recorded so the absence of a finding means something.

- **Identity and OIDC** — federated-only deploy identity with both subject forms,
  scoped (never subscription-level) role grants, traced-to-consumer hygiene,
  clean revocation records, and subject assertions under test.
- **Secretless data plane** — managed identity throughout; shared keys disabled
  on both storage accounts and Cosmos local auth off.
- **Backend security primitives** — the three-gate role model (fail-closed,
  bounded cache, unknown-role throw), the public read surface (server-side
  visibility filter in both SQL and JS, `TOP` on every query, field projection,
  identical 404s), the signed preview route (HMAC, constant-time compare,
  uniform refusal), the submission quota's compare-and-increment, the
  rising-edge claim evaluator, the AI router's failover and repair logic, the
  SSRF guard in `fetch-image.js`, the Telegram webhook's constant-time secret
  check, and the job worker core's etag-conditioned claim.
- **Contract integrity** — `api-surface.json` and the registered routes agree
  bidirectionally at method level, with `notImplemented` enforced as
  unregistered. No drift found.
- **Terraform discipline** — root-module shape re-evaluated against ADR 0020's
  revisit triggers (none fired), credential-free providers, committed lock file,
  exactly one justified `ignore_changes`, both azapi uses re-verified as still
  necessary on azurerm 5.1.0, account-level lifecycle guards, typed and
  validated variables with no dead entries.
- **CI supply chain** — every third-party action pinned to a full commit SHA
  (Trivy replaced by a checksum-verified binary after the marketplace
  compromise), explicit `permissions:` on every workflow, no
  `pull_request_target`, no untrusted input reaching `run:`, and the
  required-context/path-filter pattern correctly avoiding the stuck-"Expected"
  trap.
- **Frontend correctness gates** — the prerender refuses to publish error
  boundaries, 404 renders and sub-420-character shells; canonical and
  trailing-slash policy is coherent; `app-shell.html` is kept distinct from
  `dist/index.html` so arbitrary URLs cannot 200 with home-page content;
  `/preview` isolation holds on all four mechanisms; CSP carries no
  `unsafe-inline` and is guarded by a test; `usePublicData`'s race safety and
  prerender seeding are correct.
- **Edge probe** — the telemetry genuinely matches the alert: probe name,
  envelope shape, cadence and threshold all line up with `observability.tf`,
  secret handling is write-only and loud on absence, and all four failure paths
  are tested. The gaps (T-745, T-746) are operability, not correctness.
- **VPS agent design** — no data-plane credential, server-side capability
  authorization, certificate rather than secret, argv-array command
  construction, and a thorough container sandbox. The gaps are test coverage
  and operations, not the security model.

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
