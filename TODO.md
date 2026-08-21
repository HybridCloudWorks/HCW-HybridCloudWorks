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
| Open items | 11 |
| Critical | 0 |
| High | 0 |
| Medium | 8 |
| Low | 3 |

## Where we left off — 2026-08-21

**Phase 4 (data) is done on production.** `cosmos-site-prod-cus` holds 8,023
documents in 62 containers (0 failed, reconciled); `stsiteprodcus01` holds
1,438 blobs / 3.17 GiB (idempotent on re-run). `cp_sortDate` is live on
`content` and `blogs`. Full evidence: the
[Phase-4 page](.github/wiki/Phase-4-Data-Migration.md) (rows P1–P5, D11, D12).

**Pick up here, in order:**

1. **`terraform -chdir=infra apply`** — 1 change, `PUBLIC_LIST_SQL_ORDER = "1"`
   (#138 merged, `--inspect` precondition: **clean**, run 32448514462 — 1,142 + 242 documents, every date alias ISO-sortable). Then read
   `https://api-azure.hybridcloudworks.com/api/public/content?limit=8` and
   confirm newest-first; baseline before the flag had 2026-06-08 at the top.
2. **T-322 is closed** (2026-08-21). Four of the six run as jobs
   (`fetch-rss-feeds`, `batch-inspect`, `forge-article`,
   `generate-weekly-digest`) and the stale-queued sweeper is in;
   `refresh-tool-service-cache` is demoted to the Cloud Tools port and
   `generate-listen-and-learn` is deferred to **T-411** (three Google services
   and no frontend here). Next: **T-323**.
3. **T-323 / T-324** below — the 16 timers and the 11 triggers, tables in
   Migration_Plan §4.2 / §4.3.
4. **T-409** — the visitor-facing upstream delta.

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

### T-322 — Six HTTP handlers exceed the Flex Consumption 230 s cap
**Files:** `functions/src/functions/*` (the six below) · `frontend/src/lib/api.js` · `functions/host.json`

Flex Consumption hard-caps an HTTP response at **230 s** at the load balancer;
the setting in `host.json` cannot raise it. Non-HTTP triggers are unbounded
(30 min default). Six of Site-Main's HTTP handlers declare longer server
timeouts, none of them enqueue, and all of them make the browser wait — and on
five of them the client's own abort already disagrees with the server:

| Handler | Server | Client abort today | Port as |
| --- | --- | --- | --- |
| `generateListenAndLearn` | 540 s / 1 GiB | **20 s** (no entry) | async — episodes already save incrementally |
| `refreshToolServiceCache` | 300 s / **4 GiB** | 120 s | async; the memory is likely already solved by the Price List Query API move recorded in `main.tf` |
| `forgeArticle` | 300 s / 1 GiB | 300 s | async; also called in a sequential bulk loop |
| `fetchRssFeedsManual` | 300 s | 45 s, retried | 202 + reuse the scheduled job |
| `generateWeeklyDigest` | 300 s | **20 s** (no entry) | async; the `dryRun` preview needs a fast path |
| `batchInspect` | 300 s | 45 s, retried | async — hardcoded `sleep(4000)` × N |

**Scaffold landed 2026-08-21 (PR "Platform jobs").** `functions/src/lib/jobs.js`
is the pattern every one of the six sits on: `POST /api/enqueueJob {type,
payload}` → 202 + jobId → Storage Queue `platform-jobs` → `jobs-worker.js`
runs the registered worker under its own timeout (non-HTTP budget, 30 min on
Flex) → `GET|POST /api/getJob`. Client: `frontend/src/lib/jobs.js`
`runJob(type, payload)` enqueues and polls with the Labs backoff. The claim is
an etag-conditioned replace, so at-least-once delivery never runs a job
twice; a job-level failure is recorded, never rethrown. Built-in type `noop`
proves the path on a deployed app (`runJob('noop', { delayMs: 3000 })`).

**First worker ported 2026-08-21: `fetch-rss-feeds`** (`functions/src/lib/rss/`,
`rss-jobs.js`). The admin "RSS Fetch" button enqueues it through `runJob()`;
the `syncRssFeeds` timer runs the same ingest every two hours behind
`FEATURE_FLAG_SYNC_RSS_FEEDS`. It fills `rss_cache` (the public `/feed`
endpoint) and `homepage_feeds/latest`, and drafts new `content` through the
four-stage dedup. Not ported with it: the Telegram alert on feed errors (no
notifier here yet) — errors land in the job result instead.

Each remaining port is: port the worker, `registerJobType('<kebab-name>',
{ worker, timeoutMs, maxPayloadBytes })`, switch the page to `runJob()`.
Order by value and entanglement:

1. **The AI router is in** (`functions/src/lib/ai/router.js`, 2026-08-21):
   providers by key presence, Anthropic → OpenAI → Gemini, `AI_NOT_CONFIGURED`
   when none. **`batch-inspect` is in** (2026-08-21, `functions/src/lib/content/`):
   one job that selects `ingested` documents (flagged first) and runs the
   ported inspector on each — scrape (`fetch` + cheerio + turndown, strict
   TLS, reader/headless fallbacks behind `CONTENTFORGE_SCRAPE_FALLBACK_ENABLED`
   / `CONTENTFORGE_HEADLESS_FALLBACK_*`), publish-date extraction, format
   rotation off `scrapedAt`, the verbatim analysis prompt + voice block,
   critique with one automatic revision (`needs_rework` if still generic),
   `buildInspectionUpdateData` with its upstream tests. Optional switches,
   all default off: `CONTENTFORGE_METADATA_ONLY`, `CONTENTFORGE_ALT_TEXT_ENABLED`,
   `CONTENTFORGE_ANALYSIS_MODEL`. **Not ported:** the architecture-diagram
   path (`inspectArchitectureSource`, multimodal) — a `type: 'architecture'`
   document records `inspectError` naming it — and cover-on-inspect (flag
   only).
   **`forge-article` and `generate-weekly-digest` are in** (2026-08-21,
   `functions/src/lib/content/{forge,forge-config,forge-pipeline,forge-grader,drafting,digest}.js`,
   `forge-jobs.js`). The forge pipeline is the upstream one: dedupe against
   the published corpus (fails open) → `admin_config/forge_profile` +
   `forge_prompts` (defaults when missing, 5-min cache) → format rotation →
   master prompt + voice block + forge module instruction + word soup →
   draft → dash scrub, banned-phrase scan, module validation with mechanical
   repair → grade (keyword prescreen, then one model call, best-fit weighted
   overall) → `forge_ready` above the publish threshold and clean, else
   `editing` → content patch + `content_versions` + `admin_audit_logs` +
   `forge_stats` counters (three writes, not one transaction — stated in the
   file header). `forge-article` takes `sourceContentId` or
   `sourceContentIds` (≤ 10, the upstream bulk loop). `generate-weekly-digest`
   takes `{ days, dryRun }`; the Mailing List page has the two buttons
   (preview / draft) upstream had. **No ContentForge page exists here** (it
   post-dates the import) — the job is reachable through `POST /api/enqueueJob`
   and the page is part of the T-409/D3 admin port, together with
   `gradeContentItem`, `assignForgeImages` and the config endpoints.
   `forgeScheduled` (daily auto-forge) is a T-323 timer.
   **`generate-listen-and-learn` is deferred → T-411**: it needs Google
   Text-to-Speech through ADC, a YouTube Data API key and GCS audio uploads,
   and neither the admin page nor the certification-page player exists in
   this frontend; porting the worker alone would produce episodes nothing
   can play.
2. `refresh-tool-service-cache` — **demoted**: this repo's frontend has no
   Cloud Tools pages at all (no `getToolComparisonData`, no
   `tool_service_*` reads — the vertical post-dates the 2026-07-22 import),
   so the cache would feed nothing. It belongs to a Cloud Tools port as a
   whole (T-410-class scoped project: pricing worker ~1,000 lines incl. AWS
   SigV4 + bulk offer documents and a GCP column that needs a credential the
   app cannot hold, plus the read handler and pages).

Known gap, closed 2026-08-21: the job document is written before the output
binding sends the message, so a binding failure left a job `queued` forever.
`platformJobSweeper` (`jobs-sweeper.js`, every 15 min, behind
`FEATURE_FLAG_PLATFORM_JOB_SWEEPER` under the schedulers master switch)
re-enqueues jobs `queued` for more than 10 minutes and stamps
`requeuedAt` / `requeueCount`; the worker's etag-conditioned claim makes a
duplicate delivery harmless. Turn the flag on with the first real job
traffic. The
client/server timeout mismatch disappears with `runJob()`: there is no
per-call timeout left to mismatch. `generateAiCoverOnContentTrigger`'s 540 s
must still stay under the 900 s rising-edge claim window (T-324).

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

### T-323 — Port the 16 timers (NCRONTAB + `America/Chicago`)
**Files:** `functions/src/functions/schedulers.js` · `functions/host.json` · `infra/main.tf` (flags)

Four are registered here, one implemented (`publishScheduledContent`). The
other fifteen are in the table in Migration_Plan §4.2 with their NCRONTAB
expressions already translated — `every 24 hours` and friends picked an
explicit hour; the one UTC schedule (`scrapeSkillsHubRss`) is re-expressed in
Chicago time and will drift an hour across DST unless the handler pins it.
`WEBSITE_TIME_ZONE = America/Chicago` is set on the app. Each timer stays
behind its own `FEATURE_FLAG_<NAME>` under the `FEATURE_FLAG_SCHEDULERS`
master switch and is turned on one at a time at cutover, after being observed
firing at the intended **local** time. `regenerate` / `reseed` collections
(`homepage_feeds`, `tool_service_cache`, `rss_cache`, `azure_landing_content`,
`tool_service_catalog`) are empty on Azure until their jobs run — port those
jobs first.

### T-324 — Port the 11 Firestore triggers as change-feed functions, plus the three delete paths
**Files:** `functions/src/functions/*` (`app.cosmosDB`) · the `leases` container

Table in Migration_Plan §4.3. Eight port as change-feed functions with no
redesign. Three depend on deletes the change feed never delivers and need the
logic moved into explicit endpoints the admin UI calls: `createSlugPageOnTrigger`
→ `DELETE /blogs/{id}` removes the slug page; `maintainDashboardStats` →
recompute-on-change plus `DELETE /content/{id}` triggering the recompute (the
stats doc is `system/dashboard_stats_v1`); `syncSocialPostToPubler` → upserts
via the feed, the `!after` un-publish branch into `DELETE /social-posts/{id}`.
`generateAiCoverOnContentTrigger`'s timeout must stay under the 900 s
rising-edge claim window.

### T-409 — Port the visitor-facing upstream delta (Site-Main @ `088f458`)
**Files:** `frontend/src/components/{shared,architecture}/` · `frontend/src/data/{ansible,vmware}/education.js`

Of the 140 files Site-Main added since the 2026-07-22 import, these are the
ones a visitor would notice — Firebase-free and small (~590 lines + two data
files). Everything else is a refactor the visitor cannot see (D2), a scoped
project (T-410), or Firebase plumbing that must never come across.

| File | Lines | Visitor gets | Cost |
| --- | --- | --- | --- |
| `components/shared/RichTextBody.jsx` | 47 | richer article bodies | needs `CodeBlock`, recover from the deletions |
| `components/shared/CoderCornerSnippet.jsx` | 78 | code snippets in blogs | same dependency |
| `components/architecture/WafAssessment.jsx` + `config/wellArchitectedPillars.js` | 114 + 178 | WAF radar and pillar scores | none |
| `components/architecture/FeaturedArchitecture.jsx` + `lib/colorClasses.js` | 124 + 47 | featured-architecture hero | none |
| `data/ansible/education.js`, `data/vmware/education.js` | 206 + 199 | **genuinely new content** (95-line stubs here) | copy the data only |

Each wires into a template both sides rewrote (`ArchitectureDetailTemplate`,
`BlogDetailTemplate`, `FrameworkDetailTemplate`, `pages/{aws,azure}/ArchitecturePage`)
— hand-wire, do not merge. Five tests ride along. **Never re-sync `frontend/`
from Site-Main**: it encapsulated Firebase behind `lib/data/` (364 call sites);
we eliminated it (0 imports). The two are incompatible by construction.

### T-302 — Blob GC is still unwritten (flag split done)
**File:** `functions/src/functions/schedulers.js`

**The flag half is resolved.** Each timer has its own `FEATURE_FLAG_<NAME>` and
`FEATURE_FLAG_SCHEDULERS` is a master kill switch, so enabling the publisher no
longer arms anything else. Terraform sets all four individual flags to `"false"`.

**What remains is `cleanupTempStorage` itself**, still an unimplemented TODO.
The hazard is real and unchanged: an orphan query has to enumerate every blob
and every referencing document, and anything it fails to enumerate it
classifies as an orphan and deletes. Only `delete_retention_policy { days = 7 }`
makes that recoverable.

The finding's stated blocker does **not** apply — `queryDocs` does not truncate
(corrected; see CHANGELOG). The real constraint is that `fetchAll` materialises
the whole result set, so the enumeration needs a cursor rather than a bigger
window. **Make the first version dry-run regardless.**

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
| Integration | the six T-322 handlers as jobs | 202 within 1 s; job document reaches a terminal state | T-322 |

The origin-lock assertion — an anonymous request through Cloudflare succeeds
while the same request to the `azurewebsites.net` origin returns 403 — now
runs on every deploy as the last step of `deploy-functions.yml`.
