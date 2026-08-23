# TODO

Actionable engineering work for HCW-HybridCloudWorks.

**Classification (Code Review SOP, CODE_REVIEW_PROMPT.md v1.0, Phase 10):** this
file holds work an engineer can resolve without human input. Human decisions,
approvals, access, and credential ownership belong in [REVIEW.md](REVIEW.md).
Required inputs belong in [REVIEW.md](REVIEW.md) Part 4. Completed work moves to
[CHANGELOG.md](CHANGELOG.md).

**If this file lists no open items, there is no known outstanding engineering
work** — that is a valid state, not a missing document.

> **Completed items are deleted, not struck through.** On 2026-08-20 the 45
> resolved items that had accumulated here were removed after confirming each
> appears in CHANGELOG.md. Two that did not — the `.env.example` rewrite
> (T-403) and the `queryDocs` correction (T-311) — were written into CHANGELOG
> first. Item numbers are not reused: a gap in the sequence means the item was
> closed, and CHANGELOG is where it went.

---

## Status

| | |
| --- | --- |
| Open items | 7 |
| Critical | 0 |
| High | 2 |
| Medium | 2 |
| Low | 3 |

## Where we left off — 2026-08-21

**Phase 4 (data) is done on production.** `cosmos-site-prod-cus` holds 8,023
documents in 62 containers (0 failed, reconciled); `stsiteprodcus01` holds
1,438 blobs / 3.17 GiB (idempotent on re-run). `cp_sortDate` is live on
`content` and `blogs`. Full evidence: the
[Phase-4 page](.github/wiki/Phase-4-Data-Migration.md) (rows P1–P5, D11, D12).

**Pick up here, in order:**

1. **Apply and deploy are done** (2026-08-21). The `terraform apply` landed
   **0 added, 1 changed** — only the two `COSMOS_CONNECTION__*` settings were
   actually outstanding; the 13 timer flags and both `*_DELETE` settings had
   been applied in an earlier run. `deploy-functions` run 32533019315 then
   registered **104 functions**: 79 HTTP · 18 timer · 6 change-feed · 1 queue
   (84 before, plus 13 timers, the 6 change-feed functions and `cmsDeleteBlog`).
   The **93** this file used to predict was wrong — it counted 3 new timers
   instead of 13 and omitted the new delete route. `/api/health` 200 through
   Cloudflare, 403 at the origin.

   Two things that run reads left behind. The keyless `AzureWebJobsStorage`
   was back and broke the timer listeners for ~3 minutes until the workflow's
   delete-and-resync step ran (`syncfunctiontriggers` needed one retry) —
   visible in App Insights as `Azure.RequestFailedException` ending at
   22:30:34Z. The activity log then showed **Terraform**, not the deploy, is
   what writes it, and T-511 now strips it inside the apply itself.

   And the host log showed eight CMS functions refusing to start on route
   conflicts. **Fixed in this change** — seven `cms/*` templates were each
   declared two or three times, and the Functions host keys its route table on
   the template alone. They are now one registration per template via
   `httpRouteByMethod`, so **the next deploy registers 96 functions, all of
   them serving**, against 104 registered today of which 8 are dead. Fewer
   functions, more working endpoints. `route-inventory.test.js` property 4
   fails the build if a shared template ever comes back.

2. **Newest-first is confirmed** — `PUBLIC_LIST_SQL_ORDER = "1"` is live on the
   app and `/api/public/content?limit=8` returns strictly descending
   `Published At`, 2026-06-08 first, `total: 24`. The top is unchanged from the
   pre-flag baseline, which is the correct outcome and not a null result: 24
   published documents inside a 1,000-row `FETCH_WINDOW` means the SQL `ORDER
   BY` cannot change what the page shows. The cp_sortDate alias chain in
   `scripts/apply-computed-sortdate.mjs` matches `resolvePublishedDateValue` in
   `functions/src/lib/public-reads.js` alias for alias, so the SQL window and
   the in-memory sort cannot disagree.

3. **The frontend deploy has not happened, and is not a step on its own** — it
   is Migration_Plan §6 step 1, gated three ways:
   `deploy-azure-frontend.yml` is still `if: ${{ false }}`,
   `AZURE_STATIC_WEB_APPS_API_TOKEN` is unset (the repository holds **no**
   secrets at all), and `VITE_ENTRA_CLIENT_ID` / `VITE_ENTRA_TENANT_ID` /
   `VITE_ENTRA_API_SCOPE` are unset. T-409 ships with it whenever it runs.
   The SWA itself is up at `calm-ground-0d0e6a010.7.azurestaticapps.net`, which
   is the §6 step 2 preview hostname.

4. **The cutover sequence** (Migration_Plan §6) — owner-gated: Entra SPA
   registration + `Admin` app role, SWA token, DNS + SWA domain validation, Key Vault secrets
   (`ANTHROPIC-API-KEY` first; the inspector, forge, digest, AI cover and
   alerts all no-op cleanly without their keys), the Telegram webhook, then
   the delta import with Site-Main's Publer sync and VPS heartbeat paused and
   `FEATURE_FLAG_SYNC_SOCIAL_CALENDAR` still off, then flags on one timer at a
   time after observing the Chicago-time fire. Nothing on this list blocks it.

**State to keep in mind:**

- Locks: `migration_writer_enabled = true` stays on in TFC for the cutover
  delta run; `PRODUCTION_IMPORT_ENABLED` is unset (workflow-side lock closed).
  The scratch estate (`rg-db-site-sbx-cus`) is kept through the production
  dress rehearsal — flip `cosmos_scratch_enabled` / `storage_scratch_enabled`
  off afterwards.
- The cutover delta import must follow **pausing Site-Main's Publer sync timer
  and the VPS agent** — both rewrite `social_posts` / `lab_agents` every few
  minutes (D12). Everything else already reconciles.
- Owner-gated items live in REVIEW, not here: Entra SPA registration (admin
  sign-in), the SWA deploy token (frontend deploy), the Site-Main read token
  (`inventory-gate` in CI; the local two-clone form already passed), and the
  two Key Vault secrets in T-321.
- The local `C:\Users\saulp\Workspace\Site-Main` clone is stale; the baseline
  is `088f458`. `git pull` before reading it.

---

## MEDIUM

### T-515 — Pre-rendering was never ported — CLOSED 2026-08-23 (#182)
**Files:** `frontend/scripts/prerender.mjs` · `frontend/scripts/prerender-entry.jsx` · `frontend/package.json`

The site shipped as a bare SPA shell for the whole migration: `/about` was 2,808
bytes with 967 characters of text and the generic title, against 24,902 / 2,717
and the right title on the Firebase site it replaces. Three HTML documents in
`dist`, against a §7 gate of 90 that was describing Site-Main's build.

`npm run build` now runs `scripts/prerender.mjs` after `vite build`. It renders
every route in its manifest through the real application and writes static HTML
beside the SPA, which is untouched and still hydrates. **80 documents**; /about
is 19,668 bytes with 3,565 characters of text, more than the site it replaces.

Three bugs had to be fixed first, and one was not an SSR problem at all: twelve
components passed an ARRAY to `<title>` (`<title>{x} | HCW</title>` is two
children, which React 19 refuses), so those routes had no title client-side
either — and they were shared templates, so they took a large share of the site
with them.

The step **fails the build** on a route that throws, renders its error boundary,
or comes back shell-sized, and the deploy workflow asserts the document count
separately. Both exist because the original failure was invisible: a shell
builds, tests, deploys and browses exactly like a real site.

**Deliberately not pre-rendered.** Article detail pages need the article list at
build time and CI cannot reach the API (issue #175); wiring pre-rendering to that
would make every deploy depend on a permanent bot-protection exception. Listing
pages carry the links. Admin routes are behind sign-in and have no search value.

**Still open, split out:** 8 routes serve another provider's content
(`/vmware/news` is titled "Azure Platform News") — issue #183. `trailingSlash` is
still `"never"` while every indexed URL uses the trailing form; a canonical-URL
decision, not a bug. Framework mode was NOT adopted: the hard part (rendering
under Node) is identical either way, and the restructure buys nothing more once
`ssr: false` is settled. Now a smaller step if it is wanted.

**DNS is no longer blocked on this.**

### T-516 — Admin AI settings governed nothing — CLOSED 2026-08-23 (#181)
**Files:** `functions/src/lib/ai/ai-config.js` · `functions/src/lib/ai/router.js` · `frontend/src/lib/aiEngine.js`

The AI Engine page wrote provider toggles and an order field into `ai_providers`
and the router never opened that container — it read environment variables only.
Every switch was decorative. The page was also inverted: Vertex listed as enabled
(removed at the port; it needs GCP ADC a Function App cannot hold), OpenAI listed
as deprecated and deleted on every page load (the router calls it), plus three
providers nothing routes text to.

Now: configuration can disable and reorder providers but never enable one without
a key; an unreadable configuration changes nothing, so a Cosmos blip cannot switch
the site's AI off; absent means on. Six feature switches, one per real call site,
gated in the router and guarded by a source scan that fails if a call site carries
no feature or a catalogue entry has none.

Order is Gemini → OpenAI → Anthropic. **`GEMINI-API-KEY` is not seeded**, so
Gemini is first in preference and unreachable until it is; the router falls
through to OpenAI meanwhile.

### T-321 — Finish the post-rebuild re-pointing
**Files:** Key Vault `kv-site-prod-cus-01`

The centralus rebuild, the CAF renaming, the bootstrap-identity swap, the Key
Vault re-seed, the origin lock, the client re-pointing, the first deploy from
`main` and the end-to-end origin-secret proof are all **done** — see CHANGELOG
and REVIEW.md Part 1. What remains:

- **Two runtime-read Key Vault secrets are missing**: `GCP-SERVICE-ACCOUNT-JSON`
  and `GITHUB-APP-PRIVATE-KEY`. Both are multi-line blobs resolved by
  `getSecret()` at execution time rather than through an app-setting reference,
  which is exactly why the diff that verified the other 19 did not catch them —
  it compared against `@Microsoft.KeyVault(...)` references, and these have
  none. Procedure in REVIEW.md §3.1; seed with `--file`, not `--value`.

  The data migration does **not** need the first one: `migrate-data.yml`
  authenticates to GCP through Workload Identity Federation and the scripts
  refuse a service-account key in CI. It is only the ported runtime code paths
  that still read it.

### T-411 — Port Listen & Learn (study podcasts) as a scoped project
**Files:** Site-Main `functions/listen-and-learn/*` (2,800 lines incl. tests) · `src/pages/admin/ListenAndLearnPage.jsx` · certification detail pages

Deferred out of T-322 on 2026-08-21. The generator is a five-stage pipeline
(study guide scrape → skill areas → YouTube videos per area → dialogue script
→ MP3) with three external services this platform does not hold: Google
Text-to-Speech (called with `GoogleAuth` application-default credentials —
Azure has none; Azure AI Speech or a TTS key is a decision), the YouTube
Data API (`YOUTUBE_API_KEY`, not in Key Vault), and GCS for the audio (blob
`content/listen-and-learn/` is the obvious home, the `listen_and_learn` +
`listen_and_learn_episodes` containers already migrated). Nothing renders
episodes in this frontend — the admin page and the certification-page player
both post-date the import — so the worker, the two containers' read API, the
player and the admin page land together or not at all. Run it on the job
scaffold (`generate-listen-and-learn`, area-by-area saves as upstream).

### T-319 — Bound `items[]` within an `rss_cache` document
**Files:** `functions/src/lib/public-reads.js` (getFeed) · `functions/src/functions/schedulers.js` (syncRssFeeds)

The *document* count the feed endpoint returns is bounded. Nothing bounds the
`items[]` array inside a document, so a single runaway feed still produces a
large anonymous response.

Left open deliberately rather than guessed: truncating the array means choosing
which end to keep, and `syncRssFeeds` is a stub, so nothing in the repository
establishes whether items are written newest-first or appended. **Truncating the
wrong end silently hides the newest news** — the entire point of the feature.

**Fix:** when `syncRssFeeds` is implemented, cap the array at write time (the
natural place, since the writer knows the order) and add a matching read-side
ceiling in `getFeed`. If a read-side cap is wanted sooner, sort `items` by
`pubDate` in the handler before slicing rather than trusting stored order.

### T-507 — Coordinated rename of Terraform input variables
**Files:** `infra/variables.tf` + every `.tf` reference + the HCP Terraform workspace

The naming sweep standardized every Terraform **output** and deliberately left
the **input** variables alone: their keys must match the HCP Terraform workspace
keys exactly, and all are now set in the live workspace — so each rename is a
coordinated change. Update the workspace key and the code in one PR, or the next
plan fails on a missing required variable.

> **This list was rewritten on 2026-08-20.** The original named
> `azure_subscription_id`, `resource_group_name` and `project_name`, none of
> which exist any more — the first was replaced by the three
> `subscription_app` / `_mgmt` / `_conn` variables during the ALZ split. A
> rename list naming variables that are already gone is worse than no list.

Workspace-set variables, which break loudly if the rename is uncoordinated:

| Current | Proposed |
| --- | --- |
| `entra_tenant_id` | `tenant_id` (mirrors `TENANT_ID`) |
| `entra_api_audience` | `api_audience` |
| `budget_alert_email` | `budget_email` |
| `cloudflare_api_token` | `cloudflare_token` |
| `cloudflare_zone_id` | `cloudflare_zone` |
| `cloudflare_origin_secret` | `cloudflare_secret` |

Defaulted remainder — lower risk, still coordinated, since an operator may have
overridden any of them: `azure_location`→`location`,
`cosmos_db_account_name`→`cosmos_account`,
`cosmos_local_auth_disabled`→`cosmos_keyless`,
`cosmos_allow_azure_datacenter_ips`→`cosmos_azure_ips`,
`cosmos_admin_ip_rules`→`cosmos_admin_ips`,
`functions_storage_network_default_action`→`funcsa_default_action`,
`functions_storage_admin_ip_rules`→`funcsa_admin_ips`,
`storage_account_name`→`storage_account`, `function_app_name`→`function_name`,
`key_vault_name`→`vault_name`, `purge_protection_enabled`→`purge_protection`,
`budget_amount_usd`→`budget_usd`, `vnet_address_space`→`vnet_cidr`,
`functions_subnet_prefix`→`subnet_prefix`, `github_deploy_ref`→`deploy_ref`,
`admin_ip_rules`→`admin_ips`.

Already conforming, no action: `environment`, `instance`, `domain`, `tags`,
`github_org`, `github_repo`, `subscription_app`, `subscription_mgmt`,
`subscription_conn`.

Sequence it as one PR that renames in code, with the workspace keys renamed in
the same maintenance window, and a plan run immediately after to prove nothing
became unset. **Not urgent** — the current names are verbose, not wrong.

---

## LOW

### T-410 — Upstream delta deferred as scoped projects, not cherry-picks
**Files:** `frontend/src/` (admin)

From the same 140-file inventory as T-409, these are real features that land
on the conflict set and need design, not a copy:

- **Admin queue cluster** — 11 files, ~2,300 lines, plus `ContentReviewBrowser`
  (744) and the browser trio. A substantial editor upgrade; touches 5 files
  both sides rewrote.
- **`ArchitectureListingPage`** — the one net-new visitor route; depends on the
  deleted `useArchitectureDesignData` hook.
- **drawio tooling** — 5 files; only if wanted.
- **`ListenAndLearn`** — weakest candidate: the most Firebase-entangled, needs
  an `onSnapshot` → polling rewrite.

Explicitly **not** porting: `EducationTemplate.jsx` (712) and the six other
`data/*/education.js` — Site-Main extracted content this repo still ships
inline; the visitor sees nothing change. And never: `lib/data/*` (37) and
`lib/auth/*` (4), Site-Main's Firebase encapsulation layer.

### T-408 — `test:admin` names files explicitly rather than globbing
**File:** `frontend/package.json`

Each new frontend test file has to be added by hand or CI silently does not run
it — the failure mode where a test exists, passes locally, and gates nothing.
Everything else that was under this item is complete and recorded in CHANGELOG.

### T-514 — Telemetry died at the ingestion cap, and requests were never on
**Files:** `functions/host.json` · workspace `log-plat-prod-cus-01`

**Root cause found 2026-08-22, and it was two separate faults wearing one coat.**

**1. The workspace was over its daily cap.** `log-plat-prod-cus-01` has
`dailyQuotaGb: 0.25`; `dataIngestionStatus` read **OverQuota** with
`quotaNextReset: 08:00Z`. Ingestion stopped at **01:33Z** and every trace after
that was discarded at the door — including the `[cors]` allowlist line added
specifically to diagnose T-513, and the `[telegram]` warning used as the
control that "proved" worker logs never arrive. **That control was a false
negative.** Worker logging works; the evidence was being thrown away.

What filled a 250 MB budget:

| Category | 24h volume | Messages |
| --- | --- | --- |
| `Azure.Core` | **39.3 MB** | 76,125 |
| `Azure.Identity` | 4.4 MB | 21,469 |
| `Host.Startup` | 2.5 MB | 16,269 |
| everything else | ~4 MB | — |

`Azure.Core` logs every SDK HTTP request and response at Information, and the
host polls blob leases continuously. The platform's own chatter ate the budget;
application logs were collateral. Both are now `Warning` in `host.json`.
Raising the cap would have paid for the noise instead of removing it.

**2. `Host.Results` was set to `Error`, so `AppRequests` was always empty.**
Request telemetry is emitted at Information; that category at Error empties the
table. Not a symptom of the cap — `AppRequests` had **zero rows, ever**. It is
also the table that answers *"did the timer fire"*, so Migration_Plan §7's
scheduled-job gate was unobservable by construction. Restored to `Information`.
`Host.Aggregator` was on `Trace`, the most verbose level available, for a
diagnosis nobody recorded; now `Warning`.

**A tooling trap worth remembering.** `az monitor app-insights query --app
<appId>` returned **zero rows for every query**, including with no time filter,
while the workspace held 138,220 traces. The component is workspace-based
(`ingestionMode: LogAnalytics`) with the workspace in a different subscription,
and the proxy silently returns empty rather than erroring. **Query
`az monitor log-analytics query -w cf80dc24-2499-49a0-8c66-9522bcc294ed` and
the `AppTraces` / `AppRequests` / `AppExceptions` tables directly.** Trusting
the proxy cost hours and produced two wrong conclusions.

**Verified after the 08:00Z reset.**

- **Traces resumed.** `Function.<name>` and `Function.<name>.User` rows are
  arriving again, including handlers' own `context.log`. The earlier "no worker
  telemetry reaches App Insights" conclusion was a cap artifact and is
  withdrawn — worker logging works.
- **The restart loop is gone.** 20 `/health` samples over 8.5 minutes returned
  a single `startedAt`; the old cadence was roughly one restart every four
  minutes. T-511's in-apply strip holds.
- **`AppRequests` is STILL EMPTY** — zero rows for the app's entire history,
  and still zero after `Host.Results` was corrected to `Information` and
  deployed. `Host.Results: Error` explains the history but not the present.
  **This is the open remainder of this item.**

  It is not blocking: the `Function.<name>` traces are a better invocation
  oracle anyway, because they carry `Trigger Details: ScheduleStatus` with
  `Last`/`Next` already in Chicago local time — which is exactly the comparison
  Migration_Plan §7 asks for, and what `AppRequests` would not have given.

**And a trap worth knowing before reading any of this.** `always_ready = 0`, so
the app scales to zero and a worker torn down between flush intervals takes its
buffered telemetry with it. A handful of probes produced nothing for twenty
minutes; three sustained minutes of traffic produced rows within four. **An
empty result from a cold app is not evidence.** Send traffic, keep sending it,
then query.

**The cap is tighter than the function app alone.** 24h ingestion was ~262 MB
against a 250 MB cap: `AppTraces` 207 MB (the `Azure.Core` flood, now fixed),
but also `CDBDataPlaneRequests` 17.8 MB, `AppExceptions` 15.6 MB, `AppMetrics`
and `AppPerformanceCounters` 13.9 MB, and Cosmos partition/query stats 7.7 MB.
**Cosmos diagnostics share this workspace** and cannot be fixed in `host.json`.
Once the post-fix baseline is visible, decide whether 250 MB is the right
number or whether the Cosmos diagnostic settings should be trimmed.

### T-511 — `azurerm` re-injects the keyless `AzureWebJobsStorage` on every apply
**Files:** `infra/main.tf` (azapi pair) · `infra/providers.tf` · `.github/workflows/deploy-functions.yml`
**Category:** Dependency maintenance · **Label:** Deferred (upstream) — **worked around in-apply, not outstanding**

`azurerm_function_app_flex_consumption` writes an `AzureWebJobsStorage`
connection string with an **empty AccountKey** on every apply, whatever
`storage_authentication_type` says, and never shows it in plan —
[hashicorp/terraform-provider-azurerm#29149](https://github.com/hashicorp/terraform-provider-azurerm/issues/29149),
open since March 2025, still open on the 5.1.0 in `.terraform.lock.hcl`. The
host prefers it over the identity-based `AzureWebJobsStorage__accountName`,
tries shared-key auth with no key, and fails every storage call on the
signature.

It does not fail as "storage". It fails as SyncTriggers not registering new
functions (a build or routing problem, to look at) and as
`The listener for function 'Functions.X' was unable to start` on every timer
and queue trigger (nothing at all, to look at). Three incidents: 2026-08-20
every route 404; 2026-08-21 83 deployed / 80 registered; 2026-08-21 the
104-function deploy, timer listeners down for ~3 minutes.

**Attribution was wrong until 2026-08-21.** `main.tf` and `deploy-functions.yml`
both blamed the deploy. The Azure activity log settles it: the 20:02Z deploy
*deleted* the setting, Terraform's 20:31Z apply was the only `sites/config`
write after it, and the setting was back.

**Fixed in-apply, not patched afterwards.** `azapi_resource_action.function_app_settings`
reads the settings azurerm has just written and
`azapi_update_resource.function_app_settings_without_webjobs_storage` writes
them back without that key, both triggered by the function app resource. The
setting never survives the apply that creates it, so there is no post-apply
step, no scheduled job and nothing to remember. `deploy-functions.yml`
**asserts it is absent and fails the deploy if it is not** — a repair there
would hide a regression in the strip, which is exactly how this stayed a
recurring incident instead of becoming a bug: every occurrence was quietly
cleaned up by the next deploy.

Two things deliberately **not** used:

- `"AzureWebJobsStorage" = ""` in `app_settings`, the workaround the issue is
  best known for. It worked until early May 2026 and then stopped, confirmed by
  three separate reporters. An empty value is also indistinguishable from a
  misconfiguration to anyone reading the file later.
- Managing the whole function app as `azapi_resource`. It avoids the provider
  bug entirely but trades a well-understood resource for a hand-written ARM
  body, which is a much larger surface to get wrong for one bad key.

**Revisit** when #29149 closes: delete both azapi resources, the azapi provider
from `providers.tf` and `.terraform.lock.hcl`, and this item — then keep the
`deploy-functions.yml` assertion, which is the regression guard either way.

### D-001 — ESLint 10 upgrade blocked upstream
**Category:** Dependency maintenance · **Label:** Deferred

`eslint-plugin-react@7.37.5` calls `context.getFilename()`, which ESLint 10
removed, so every `react/*` rule crashes — and the plugin's peer range tops out
at `eslint ^9.7`. The repository itself is ready (already on flat config); the
block is entirely in the plugin ecosystem.

Dependabot #17 was closed with `@dependabot ignore this major version` so it
stops recreating a PR that cannot go green. **Revisit when
`eslint-plugin-react`, `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y`
declare ESLint 10 support**, then `@dependabot unignore eslint` or bump
manually.

---

## Test recommendations

Backend coverage is strong; frontend coverage of the migration was effectively
zero when the review ran, and most of that gap has since been closed. What
remains unwritten:

| Type | Scenario | Assertion | Covers |
| --- | --- | --- | --- |
| Integration | Route inventory over `index.js` | guard + OPTIONS + CORS per registration | Route coverage |
| Unit | `api.js` with `VITE_BACKEND_PROVIDER=azure` | resolves to `VITE_AZURE_FUNCTIONS_URL` | API base resolution |
| Unit | `cms-content.list` limit `abc` / `0` / `-5` / `99999` | clamped to [1,500] | Input bounds |
| Unit | `putConfig` omitting `oauthToken` | stored token preserved | Partial-update safety |
| Live | `runJob('noop', { delayMs: 3000 })` on the deployed app | 202 within 1 s; the job document reaches `succeeded` | the platform-jobs path end to end — blocked on the Entra admin sign-in (REVIEW §2.2) |

The origin-lock assertion — an anonymous request through Cloudflare succeeds
while the same request to the `azurewebsites.net` origin returns 403 — now
runs on every deploy as the last step of `deploy-functions.yml`.
