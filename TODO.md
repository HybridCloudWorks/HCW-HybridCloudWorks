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
| High | 1 |
| Medium | 4 |
| Low | 2 |

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

   Two things that run reads left behind: the keyless `AzureWebJobsStorage`
   came back with the deploy and broke the timer listeners for ~3 minutes until
   the workflow's delete-and-resync step ran (`syncfunctiontriggers` needed one
   retry) — expected, self-healing, and visible in App Insights as
   `Azure.RequestFailedException` ending at 22:30:34Z. And **T-510** below,
   which the deploy surfaced rather than caused.

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
   registration + `Admin` app role, SWA token, DNS + `asuid`, Key Vault secrets
   (`ANTHROPIC-API-KEY` first; the inspector, forge, digest, AI cover and
   alerts all no-op cleanly without their keys), the Telegram webhook, then
   the delta import with Site-Main's Publer sync and VPS heartbeat paused and
   `FEATURE_FLAG_SYNC_SOCIAL_CALENDAR` still off, then flags on one timer at a
   time after observing the Chicago-time fire. **T-510 blocks the admin UI
   part of it**; nothing else on this list does.

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

## HIGH

### T-510 — Eight CMS functions are disabled by route conflicts
**Files:** `functions/src/functions/admin-crud-http.js` · `admin-integrations-http.js` · `image-prompts-http.js` · `functions/src/functions/route-inventory.test.js`

The Azure Functions host keys its route table on the **route template alone**,
not on template + method. Two functions that declare the same `route` with
different `methods` are a conflict: the host keeps one and marks the other *"is
in error: The route specified conflicts with the route defined by function
X"*. Seven routes are shared this way, so eight functions never start.
Measured live off the deployed route table, 2026-08-21:

| Route | Live | Disabled |
| --- | --- | --- |
| `cms/certifications` | POST `cmsCreateCertification` | GET `cmsListCertifications` |
| `cms/certifications/{id}` | DELETE `cmsDeleteCertification` | PATCH `cmsPatchCertification` |
| `cms/recordings` | POST `cmsCreateRecording` | GET `cmsListRecordings` |
| `cms/social-posts` | POST `cmsCreateSocialPost` | GET `cmsListSocialPosts` |
| `cms/settings` | GET `cmsGetSettings` | PUT `cmsPutSettings` |
| `cms/config/{collection}/{id}` | DELETE `cmsDeleteConfig` | PUT `cmsPutConfig`, PATCH `cmsPatchConfig` |
| `cms/keyword-config/{collection}/{id}` | DELETE `cmsDeleteKeywordDoc` | PUT `cmsPutKeywordDoc` |

Confirmed from outside: `POST /api/cms/certifications` returns **401** (alive,
guard reached), `GET /api/cms/certifications` returns **404** (not registered).
So the admin UI cannot list certifications, recordings or social posts, cannot
edit a certification, cannot save settings, and cannot write config or keyword
documents.

**Not caused by the T-323/T-324 deploy** — App Insights first records these at
21:39:15Z on 2026-08-21, with the 84-function deploy. It is a live defect that
has simply had no caller yet, because the admin surface is not deployed.

**Why the tests did not catch it.** `route-inventory.test.js` mocks
`@azure/functions` with `http: (name, options) => httpRegistrations.set(name,
options)` — a Map keyed by **function name**. Two functions sharing a route are
two distinct keys, so both look registered and both pass every assertion. The
test proves each route is guarded; it cannot prove the host will serve it.

**Fix:** merge each conflicting pair into one registration that declares all its
methods and dispatches on `request.method` — the shape `cmsGetSettings` /
`cmsPutSettings` should have had from the start. Then add an assertion to
`route-inventory.test.js` that no two registrations share a route template,
which is the check that keeps this from returning. The smoke test should also
fail on a host route conflict rather than only checking `/api/health`.

---

## MEDIUM

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
