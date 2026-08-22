# Migration Plan — Personal-Site_HCW → HCW-HybridCloudWorks (Azure)

**Audience:** engineers executing the migration. **Status:** Phases 2–4 done; every port before cutover merged 2026-08-21; next is the cutover sequence (§6)
against **Site-Main @ `088f458`** (2026-08-18, v1.7.0); see the note below.
**Written** 2026-07-30; deployment note added 2026-08-19; rebaselined against Site-Main and the
migration tooling 2026-08-20.
**Companion:** [Architecture_Plan.md](Architecture_Plan.md) — the target and why.

> ## ⚠️ PLEASE NOTE — what is *actually* deployed, as of 2026-08-20
>
> **Everything below this box is the plan as written on 2026-07-30. It describes what was designed
> to be deployed. It is not a description of the running estate.**
>
> **Migration_Plan §2 Phase 2 has since been executed.** The Azure infrastructure is live: **129
> resources**, applied from `infra/` through HCP Terraform (org `hcw`, project `Site`, workspace
> `hcw-azure`). As of 2026-08-20 `terraform fmt`, `terraform validate` and `terraform plan` are all
> clean — _"No changes. Your infrastructure matches the configuration."_
>
> Reaching that took a run of apply-time failures, and **fixing them changed the target**. Read the
> plan for intent and sequencing; read this box for what exists. Where the two disagree, this box
> wins.
>
> ### ✅ Rebuilt into centralus on 2026-08-19 — these are the live names
>
> The estate was torn down and rebuilt to consolidate every resource into `centralus` and adopt the
> CAF instance-number convention. Azure names and regions are both immutable, so this was a
> replacement rather than an edit: **125 destroyed, 125 created**. Nothing of this workload remains
> in `southcentralus`.
>
> | | |
> | --- | --- |
> | API (public) | `https://api-azure.hybridcloudworks.com/api` — **the only address clients can reach** |
> | Function App origin | `func-site-prod-cus-01.azurewebsites.net` — locked to Cloudflare, returns **403** to everything else |
> | Static Web App | `stapp-site-prod-cus-01` → `calm-ground-0d0e6a010.7.azurestaticapps.net` |
> | Cosmos | `cosmos-site-prod-cus`, database `hcw`, 73 containers, **empty** |
> | Key Vault | `kv-site-prod-cus-01`, 19 secrets |
> | Storage | `stsiteprodcus01` (content) · `stsitefuncprodcus01` (Functions host) |
> | Resource groups | `rg-{web,db,stor,sec,conn}-site-prod-cus` |
>
> **The origin lock changes how §4 must be written.** The Function App refuses every caller outside
> Cloudflare's IP ranges. Anything that talks to the API — the SPA, a port-verification script, a
> smoke test, a local `curl` — must use `api-azure.hybridcloudworks.com`, never the
> `azurewebsites.net` hostname. A direct call returns `403` with nothing in the body explaining why.
> Cloudflare stamps `x-hcw-origin-secret` on the way through, which is what lets
> `functions/src/lib/auth/client-identity.js` trust `CF-Connecting-IP` for rate limiting.
>
> **The Function App holds 80 deployed functions** as of 2026-08-20. The first deploy from `main`
> succeeded; `/api/health` answers `200` through Cloudflare and `403` at the origin, and an anonymous
> rate-limited route answering `200` is the end-to-end proof of the origin-secret handshake. §5
> below — the data — is still entirely ahead: every container is empty.
>
> | The plan implies                                        | What is actually deployed                                                               | Why it changed                                                                                                                                             |
> | ------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Cosmos in the estate region, `southcentralus`           | `cosmos-site-prod-cus` in **`centralus`** — serverless, single-region, `zone_redundant = false` | Two Azure APIs govern Cosmos placement and they disagree. `southcentralus` is ARM-deployable but this subscription has **no Cosmos region access**; `southcentralus2` has access but ARM does not offer Cosmos there. `centralus` is the nearest region that passes both. |
> | An Azure OpenAI account behind the AI endpoints         | **Nothing. Retired entirely** — no account, no role assignment, no diagnostic setting, no `ai` resource group, no `AZURE_OPENAI_*` app settings | The pinned `gpt-4o` version was retired 2026-03-31, this subscription holds **zero TPM quota** for `gpt-4o` in every SKU, and DALL-E is not offered in the region. Nothing consumed it. |
> | Key Vault `kv-site-prod-scus`                           | **`kv-site-prod-cus-01`**                                                                | The unsuffixed name is globally taken by an unrelated tenant and is not soft-deleted anywhere in this tenant, so it is unrecoverable. `-01` is the instance suffix the Naming-Convention page reserves for exactly this. |
> | Static Web App in the estate region                     | `stapp-site-prod-cus-01`, running in **`centralus`** like everything else                                        | `southcentralus` does not offer `Microsoft.Web/staticSites` — only five regions do, and this was the estate's one naming exception until the centralus consolidation retired it. The whole estate is now the region this resource always ran in. |
> | Phase 2 exit: applied to a **non-production** subscription | **Applied to the production subscriptions**, across three: Application `b9e02281…`, Management `02dfb8ad…`, Connectivity `8f3c6d82…` | There is no non-production subscription. The Identity landing zone is deliberately empty. Cost control is the budget resource — `budget_amount_usd` (default 150 USD) from `budget_start_date`. **The §7 cost gate still applies and has not been run.** |
> | Data living in Cosmos                                    | The `hcw` database and all **73 containers exist and are EMPTY**                          | Phase 4 has not run. The **8,064** documents (measured 2026-08-21; the 1,395 figure was the editor's collections only) are still only in Firestore. |
> | Wildcard CORS origins on storage                         | **Exact origins only, ports included**                                                    | Azure Storage accepts a literal `*` or fully-qualified origins and nothing in between; `https://*.<domain>` and `http://localhost:*` are rejected outright.  |
> | A CI runner                                              | **Not deployed** — `ci_runner_enabled = false`                                            | Deferred; ADR 0021 superseded.                                                                                                                              |
>
> **Two of these change how you work, not just what you read:**
>
> **The AI endpoints have no Azure backing service.** The 17 AI RPCs are no more blocked than they
> were, but whoever ports them writes against **external provider APIs, keyed from Key Vault** via
> the existing `*_API_KEY` app settings. `functions/src/lib/openai-client.js` used to shadow that
> decision — it imported `@azure/openai` and read `AZURE_OPENAI_*` settings that no longer exist,
> while having no importers of its own. It was **deleted on 2026-08-20**, along with the
> `@azure/openai` dependency it was the only consumer of, so nobody ports the AI RPCs by wiring up
> a service that is not there. Do not re-add the Azure OpenAI account to unblock Phase 3; the
> absence is commented in `infra/main.tf` where someone would otherwise restore it.
>
> **The network is closed by default.** Cosmos, both storage accounts and Key Vault all default to
> `Deny`, scoped to the Functions integration subnet `snet-site-func-prod-cus-01`. GitHub-hosted runners
> have public dynamic IPs, so `deploy-functions.yml` opens a per-run firewall window and closes it
> again. **A deploy or a data-migration run from anywhere else needs an operator IP window** (the
> `*_admin_ip_rules` variables) or it fails on a network denial that does not announce itself as one.
>
> **Also worth knowing before you touch `infra/`:**
>
> - The backend **must** resolve to workspace `hcw-azure`. The other workspace in this org, `HCW`,
>   holds 85 GCP/Firebase/VPS resources belonging to `saulpatinojr/Personal-Site_HCW` — a plan
>   pointed there proposes **destroying all of them**.
> - The HCP Terraform **project name `Site` is a segment of the OIDC subject** the federated
>   credentials must match. Moving the workspace between projects breaks authentication with
>   `AADSTS70021` until `scripts/bootstrap-terraform-oidc.ps1` is re-run with the new `-TfcProject`.
> - State was re-synced on 2026-08-19 with `terraform apply -refresh-only`: the subnet delegation
>   action recorded in state (`.../subnets/action`) was stale against what Azure actually assigns
>   (`.../subnets/join/action`). No infrastructure changed; the record caught up to reality.
>
> **What has not changed:** Phases 4, 5 and 6 are still ahead — migrate the data, cut over,
> decommission. Phase 3 is under way. §0's overlap problem has been **resolved by decision rather
> than by reconciliation** — read it before touching `frontend/`.

The source repository, `HybridCloudWorks/Site-Main`, becomes **archival** at the end of this plan.
Until it does, it is the **source of truth** for the live site, and that is the single most
important operational fact below.

---

## 0. The overlap problem — resolved by decision, not reconciliation

`frontend/` here began as an imported copy of Site-Main on 2026-07-22. The original version of this
section asked for weekly reconciliation. **That is impossible now, and it was the wrong goal.**

The two repositories took Phase 1 in opposite directions, and both finished it. This repository
**eliminated** Firebase from the frontend: zero `firebase/*` imports, every read through the Azure
API. Site-Main **encapsulated** it: v1.7.0 moved all 364 Firebase call sites behind `lib/data/`
(37 files) and `lib/auth/` (4 files). Both are correct Phase 1 outcomes. They are also mutually
exclusive — a file from one side cannot be copied into the other without bringing its data layer
with it. 335 upstream commits have landed since the import, and no import SHA was ever recorded.

So the relationship is **donor and recipient with a pinned baseline**, not two copies to keep in
step:

- **Baseline: Site-Main @ `088f458`** (2026-08-18, v1.7.0) — 116 functions (89 HTTP, 16 scheduled,
  11 triggers), 68 Firestore collections, one GCS bucket, 18 `defineSecret` names. Every count in
  this document is measured there.
- **`frontend/` here is the only safe base and is never re-synced.** Upstream work arrives by
  hand-porting, file by file, weighed by what it gives a visitor. The 140 files Site-Main added
  since the import have been sorted: nine worth porting (TODO T-409), a 2,600-line education
  refactor the visitor cannot see (not ported), four scoped projects (T-410), and 41 files of
  Firebase plumbing that must never cross.
- **Site-Main was prepared for this migration with this repository as the named target.** Its
  `TODO.md` "Carried to cutover" lists nine binding decisions; `OWNER-ACTIONS.md` names three owner
  gates; it ships `scripts/inventory-collections.mjs --diff <our-manifest>` specifically to gate our
  cutover; its 11 Firestore triggers already avoid `event.data.before`. **This is a cutover against
  existing contracts, not a greenfield port.**

**Rule for the duration:** feature work lands in Site-Main while it is live. It reaches here only
by deliberate port, recorded in TODO — never by merge, never by copy.

---

## 1. Sequencing principle

**Decouple in the old repository first; port second.** Work that removes a Firebase dependency while
the Firebase implementation is still running is safe, testable against production, and reversible.
The same work done during cutover is none of those things.

This is what makes the migration cheap: most of the risk can be retired **before** anything is
deployed to Azure.

---

## 2. Phases

| Phase | Goal                                     | Runs in       | Status / exit criterion                                         |
| ----- | ---------------------------------------- | ------------- | --------------------------------------------------------------- |
| 0     | Reconcile the two repositories           | Both          | **Retired** — replaced by the pinned baseline in §0             |
| 1     | Decouple from Firebase behind interfaces | Both          | **DONE on both sides** — here: zero `firebase/*` imports; Site-Main: v1.7.0 `lib/data/` + `lib/auth/` encapsulation |
| 2     | Stand up Azure infrastructure            | This repo     | **DONE 2026-08-19** — 129 resources, plan clean; **104 functions deployed 2026-08-21** (84 before the T-323/T-324 deploy; 96 after the route-conflict merge, which retires 8 dead registrations) |
| 3     | Port the API and workers                 | This repo     | **DONE 2026-08-21** — the HTTP surface per `.azure/api-surface.json`, the six long handlers as platform jobs, 15 of 16 timers, the 11 triggers as 6 change-feed functions + 3 delete paths; what is not ported is a deliberate demotion (Cloud Tools T-410, Listen & Learn T-411, the D3 admin cluster); see §4 |
| 4     | Migrate data                             | `scripts/` + `migrate-data.yml` | **DONE on production 2026-08-21** — 8,023 documents / 62 containers / 0 failed, reconciled; 1,438 blobs / 3.17 GiB verified. Re-runnable for the delta before cutover (upsert, `gcsmd5`) |
| 5     | Cutover                                  | DNS           | Live on Azure, Firebase warm                                    |
| 6     | Decommission and archive                 | Both          | GCP down, Site-Main archived                                    |

Phases 3 and 4 are independent and should run in parallel: the rehearsal needs none of Phase 3's
handlers, and Phase 3 needs no data to register routes.

> **These are not the same numbers as the Wiki's.** The [Implementation
> TODO](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki/Implementation-TODO) numbers
> _delivery_ phases 0–8; this table numbers _migration_ phases 0–6. Only Phase 4 means roughly the
> same thing in both. Phase 3 is the worst collision — it is "Port the API and workers" here and
> "Empty platform and observability" there. Cite this document's phases as **"Migration_Plan §N"**
> and the Wiki's as **"Phase N"**. The Implementation TODO carries the full mapping table.

---

## 3. Phase 1 — the refactors worth doing here, first

> **Status 2026-08-20: 3.1–3.4 are done, with the evidence noted under each; 3.5 was done upstream;
> 3.6 is still open.** The text below is kept as written because it explains *why* each item
> mattered, and two of them (3.1, 3.5) shaped how Phase 3 and Phase 4 are being executed.

These are the "leverage" items. **Each improves this codebase whether or not the migration ever
happens**, which is what makes them safe to do now.

### 3.1 Put every Firestore read behind a data-access layer — _the big one_ — DONE, both sides

> Here: `frontend/src` has zero `firebase/*` imports; every read goes through `lib/api.js` against
> the Azure API. Site-Main: v1.7.0 put all 364 call sites behind `lib/data/`. The two
> implementations are incompatible by construction — see §0.

**34 frontend files import `firebase/firestore` directly** (measured 2026-07-30; the earlier estimate
of 47 was overstated). There is no Cosmos equivalent for browser-direct, rule-enforced database
access (Architecture_Plan §5.1), so all of them must become API calls eventually.

Do it in two moves, both in this repo:

1. **Introduce `src/lib/data/` adapters.** Every component talks to a named function (`listContent`,
   `getCertifications`) instead of composing Firestore queries. Implementation still calls
   Firestore. No behaviour change; fully testable today.
2. **Flip adapters to HTTP one at a time**, backed by new endpoints in the existing Firebase
   Functions. Each flip is independently shippable and revertible.

By the end, the frontend has no database SDK at all, and the Azure port becomes "change a base URL."
**This is the difference between a migration and a rewrite.**

Start with the **71 `useFirestoreCollection` / `useFirestoreQuery` / `useFirestoreDocument` call
sites** — they are already funnelled through hooks, which is the natural seam.

### 3.2 Isolate auth behind a provider interface — DONE

> Here: MSAL behind `frontend/src/lib/auth/`; the Entra SPA registration (REVIEW §2.2) is the
> remaining owner gate before admin sign-in works. Site-Main: `lib/auth/` (4 files).

5 files import `firebase/auth` (measured; earlier estimate of 8 was overstated). Wrap sign-in,
sign-out, token acquisition and claim reads in one module. Entra/MSAL then swaps in at one place
instead of five.

### 3.3 Isolate storage — DONE

5 files import `firebase/storage`. Same treatment; Blob Storage swaps in behind it.

> Here: uploads go through the API with user-delegation SAS; every render site calls
> `resolveMediaUrl()` (commit `09154ad`, 2026-08-20) so stored site-relative paths resolve against
> the Cloudflare API host in the cross-origin topology.

### 3.4 Fix `staticwebapp.config.json` — the soft 404 is already there and already broken — DONE

**`frontend/staticwebapp.config.json` exists** — the claim in an earlier draft that "No such file
exists anywhere in the target repository yet" was wrong.

The file has the exact soft-404 defect described: `responseOverrides.404` is already present but
misconfigured — it maps 404 responses back to `/index.html` **with `statusCode: 200`**:

```json
"responseOverrides": {
  "404": {
    "rewrite": "/index.html",
    "statusCode": 200
  }
}
```

This is a soft 404 from the Azure side, identical to the Firebase problem. Unknown URLs return
HTTP 200 and the SPA renders a NotFound page client-side.

The fix is already one line — change `"statusCode": 200` to `"statusCode": 404`:

```json
"responseOverrides": {
  "404": {
    "rewrite": "/index.html",
    "statusCode": 404
  }
}
```

`navigationFallback.rewrite` must stay as `/index.html` for client-side routing to work. Only the
status code on the explicit 404 override needs to change.

This is a one-line change, do it now.

### 3.5 Audit the 11 Firestore triggers for change-feed compatibility — DONE upstream

Cosmos's change feed delivers current state and **does not surface deletes**. Any trigger relying on
the before-image or on deletion needs redesign (Architecture_Plan §5.3). Do the audit now — it is
reading, not writing, and it de-risks the Phase 3 estimate.

> Site-Main did this: none of its 11 triggers reads `event.data.before` any more. The per-trigger
> change-feed disposition — which port as-is, which retire, which need an explicit delete endpoint
> because the feed cannot see a delete — is the trigger table in §4.

### 3.6 Decide `blogs`

242 legacy documents, reached only through a fallback path in `BlogDetailTemplate` and
`ArchitectureDetailTemplate`. Its six composite indexes were retired on 2026-07-30 as orphaned. If
it is genuinely dead, cutover is the cheapest moment to drop it. If it is not, that fallback path is
load-bearing and must be ported.

---

## 4. Phase 3 — porting 116 functions (89 HTTP · 16 timers · 11 triggers)

> **Read before writing any handler — the four constraints the infrastructure now imposes.**
>
> 1. **The API is reachable only at `https://api-azure.hybridcloudworks.com/api`.** The
>    `azurewebsites.net` origin is restricted to Cloudflare IP ranges and returns `403` to your
>    laptop, a GitHub runner and a browser alike. A 403 from a cross-origin fetch reads as an auth
>    or CORS fault, so this costs an afternoon if you meet it without knowing.
> 2. **Every backing store denies by default.** Cosmos, Key Vault and both storage accounts admit
>    the Functions integration subnet and nothing else. Local development against them needs an
>    `*_admin_ip_rules` window: populate → apply → work → empty → apply. The Function App itself is
>    already inside the subnet, so deployed code needs nothing.
> 3. **There are no keys.** Cosmos key authentication is disabled, storage SAS is user-delegation
>    signed via managed identity, and secrets resolve from Key Vault. `DefaultAzureCredential` and
>    `az login` are the whole local story — if a handler wants a connection string, the design has
>    gone wrong.
> 4. **AI handlers write against external provider APIs.** There is no Azure OpenAI account, no
>    `AZURE_OPENAI_*` setting, and `openai-client.js` was deleted. The `*_API_KEY` app settings
>    resolve from Key Vault and are what the 17 AI RPCs should use.
>
> **The first deploy is worth doing before the first handler.** It settles whether the rebuilt
> identity authenticates, whether the smoke test passes through Cloudflare, and whether the
> origin-secret handshake works — three unknowns that otherwise surface in the middle of debugging
> business logic.

**Where Phase 3 stands (2026-08-21, measured at Site-Main `088f458`):** done. **104 functions are
deployed** (79 HTTP · 18 timer · 6 change-feed · 1 queue): the HTTP surface per `.azure/api-surface.json`, the
six >230 s handlers as platform jobs (§4.1), 15 of the 16 timers behind their flags (§4.2), and the
11 triggers as six change-feed functions plus the three delete endpoints (§4.3). The tables below
are now the record of what each upstream export became; every row was read from the source.

Do not port the endpoints one by one in isolation. Group them:

| Group                                    | Count  | Notes                                                                  |
| ---------------------------------------- | ------ | ---------------------------------------------------------------------- |
| Admin CRUD / snapshots                   | large  | Mostly mechanical; shared auth middleware ports once                   |
| Content pipeline (ContentForge, publish) | medium | Highest business risk; port with the publish-contract tests            |
| Cloud Tools                              | ~10    | Self-contained; good first vertical slice                              |
| Labs                                     | ~6     | Depends on the runner contract — coordinate with `vps-agent`           |
| Telegram / Social / notify               | ~10    | External integrations; re-point webhooks last                          |
| Scheduled                                | 16     | Table below — the syntax is different *and* the clock is different     |
| Firestore triggers → change feed         | 11     | Table below — three need an explicit delete path the feed cannot give  |

**Port Cloud Tools first as a vertical slice.** It is self-contained, has live tests, exercises
HTTP + scheduled + Cosmos + Key Vault + an external API, and its failure blast radius is one page.
Everything learned there applies to the other groups.

**Carry the secrets model across deliberately:** `defineSecret` bindings become Key Vault references
with managed identity. No connection strings, no keys in app settings.

### 4.1 The six HTTP handlers that cannot survive as HTTP

Flex Consumption caps an HTTP response at **230 s** at the load balancer — `host.json` cannot raise
it. Non-HTTP triggers are unbounded (30 min default), and memory is per-app (512 / 2048 / 4096 MB).
Six Site-Main handlers declare longer server timeouts, none enqueue, and all make the browser wait.
On five of them the client's own abort already disagrees with the server, so the "works on
Firebase" claim is weaker than it looks:

| Handler | Server | Client abort today | Port as |
| --- | --- | --- | --- |
| `generateListenAndLearn` | 540 s / 1 GiB | **20 s** (no entry) | **deferred → T-411** (Google TTS via ADC, YouTube key, GCS audio, no frontend here) |
| `refreshToolServiceCache` | 300 s / **4 GiB** | 120 s | async job; the memory is likely already solved by the Price List Query API move recorded in `main.tf` |
| `forgeArticle` | 300 s / 1 GiB | 300 s | **ported 2026-08-21** as `forge-article` (`sourceContentIds` ≤ 10 covers the bulk loop) |
| `fetchRssFeedsManual` | 300 s | 45 s, retried | `202` and reuse the scheduled job |
| `generateWeeklyDigest` | 300 s | **20 s** (no entry) | **ported 2026-08-21** as `generate-weekly-digest`; `dryRun` is the same job, polled |
| `batchInspect` | 300 s | 45 s, retried | **ported 2026-08-21** as the `batch-inspect` job — selects and inspects in one pass, 4 s stagger kept |

Reuse the job pattern that already exists on both sides: a `lab_jobs` document plus a client poll at
5–10 s (`runToolExpertModeValidation`, `enqueueLabJob`). Fix the client/server timeout mismatch in
the same change. There is no SSE or streaming anywhere, so the cap bites only these six. Tracked as
TODO T-322.

> **2026-08-21:** the job scaffold exists — `functions/src/lib/jobs.js` (enqueue → Storage Queue →
> queue-triggered worker → `getJob`), `frontend/src/lib/jobs.js` `runJob()`, container `jobs`. Each
> of the six is now "port the worker, `registerJobType()`, switch the page to `runJob()`"; the order
> and blockers are in TODO T-322.

### 4.2 The 16 timers — NCRONTAB, and the clock

Two things change, not one. Cloud Scheduler accepts five-field cron *and* natural language
(`every 24 hours`, `every friday 09:00`); Azure timer triggers take six-field NCRONTAB with a
seconds column. And Cloud Scheduler applies a per-job `timeZone`, while Azure applies one
app-wide `WEBSITE_TIME_ZONE` — now set to `America/Chicago` in `infra/main.tf`, because eight of
the sixteen declare it. The one UTC schedule is the casualty: it has to be re-expressed in Chicago
time and will drift an hour across DST, or be pinned with an explicit offset in the handler.

`every 24 hours` in Cloud Scheduler means "24 hours after deploy", which is an hour nobody chose;
the NCRONTAB column below picks one. Change the hour, not the intent.

| Site-Main export | Schedule | Zone | NCRONTAB here | Status here |
| --- | --- | --- | --- | --- |
| `publishScheduledContent` | `*/15 * * * *` | Chicago | `0 */15 * * * *` | **implemented**, flag off |
| `fetchRssFeeds` | `every 2 hours` | — | `0 0 */2 * * *` | **implemented** (`syncRssFeeds`, shares the `fetch-rss-feeds` job's ingest), flag off |
| `cleanupTempStorage` (Azure-only) | — | — | `0 0 0 * * *` | **implemented**, flag off; prefix + age, dry-run until `TEMP_STORAGE_CLEANUP_DELETE` |
| `checkAgentHealth` (Azure-only) | — | — | `0 */5 * * * *` | **implemented**, flag off; marks agents silent > 90 s `offline` |
| `syncSocialCalendarScheduled` | `every 5 minutes` | Chicago | `0 */5 * * * *` | **implemented**, flag off; D12 — stays off until the delta import |
| `generateReviewerDigest` | `0 7 * * *` | Chicago | `0 0 7 * * *` | **implemented**, flag off |
| `cleanupRejectedContent` | `0 4 * * *` | Chicago | `0 0 4 * * *` | **implemented**, flag off |
| `cleanupSoftDeletedContent` | `0 */4 * * *` | Chicago | `0 0 */4 * * *` | **implemented**, flag off |
| `monitorPublishingPipeline` | `0 */6 * * *` | Chicago | `0 0 */6 * * *` | **implemented**, flag off |
| `checkLiveLinks` | `0 6 * * 1` | Chicago | `0 0 6 * * 1` | **implemented**, flag off |
| `reVerifyCertifications` | `0 0 * * 0` | Chicago | `0 0 0 * * 0` | **implemented**, flag off |
| `refreshToolServiceCacheScheduled` | `every 24 hours` | — | `0 0 3 * * *` | demoted with Cloud Tools (T-322) |
| `forgeScheduled` | `every 24 hours` | — | `0 30 3 * * *` | **implemented**, flag off (and Auto-Forge off in Forge Memory) |
| `cleanupUnusedCertImages` | `every 24 hours` | — | `0 0 5 * * *` | **implemented**, flag off; dry-run until `CERT_IMAGE_CLEANUP_DELETE` |
| `fetchPodcastFeeds` | `every 2 hours` | — | `0 30 */2 * * *` | **implemented**, flag off |
| `fetchBlogListings` | `every 6 hours` | — | `0 15 */6 * * *` | **implemented**, flag off; skips itself while `FIRECRAWL_API_KEY` is a stub |
| `refreshPlaudToken` | `every 12 hours` | — | `0 0 */12 * * *` | **implemented**, flag off |
| `scrapeSkillsHubRss` | `every friday 09:00` | **UTC** | `0 0 4 * * 5` (04:00 CDT ≈ 09:00 UTC; 03:00 CST in winter) | **implemented**, flag off |

Every timer stays behind its own `FEATURE_FLAG_<NAME>` under the `FEATURE_FLAG_SCHEDULERS` master
switch (`infra/main.tf`), and is turned on one at a time during cutover (§6 step 7) — after being
observed firing at the intended local time (§7).

### 4.3 The 11 triggers — change feed, and the deletes it cannot see

The Cosmos change feed delivers the **current** document and never a delete. Site-Main's 3.5 audit
left no trigger reading `event.data.before`, which is why eight of the eleven port as
`app.cosmosDB` change-feed functions with no redesign. Three depend on the delete they will never
receive; each needs the logic moved into an explicit delete endpoint that the admin UI calls.

| Trigger | Watches | Before-image? | On delete today | Port as |
| --- | --- | --- | --- | --- |
| `downloadSpeakerEventImage` | `speakerevents` | no (value marker) | ignored (`!after?.exists` returns) | **`mirrorSpeakerEventImages`** (2026-08-21) |
| `downloadCertBadgeImage` | `certifications` | no | ignored | **`mirrorCertificationImages`** |
| `downloadBlogCoverImage` | `blogs` | no | ignored | **`processBlogChanges`** |
| `generateBlogCoverImage` | `blogs` | no | ignored | **`processBlogChanges`** (SVG, no sharp) |
| `inspectAndPopulateContent` | `content` | no | ignored | **`processContentChanges`**; `batch-inspect` remains the backfill |
| `generateAiCoverOnContentTrigger` | `content` | no (rising-edge claim) | ignored | **`processContentChanges`** (Replicate REST; no WebP variants / mascot) |
| `notifyOnWorkflowAlertActivation` | `workflow_alerts` | no | ignored | **`notifyWorkflowAlerts`** |
| `syncToolExpertModeRuns` | `lab_jobs` | no | ignored | demoted with Cloud Tools (nothing writes `artifactRef` here) |
| `createSlugPageOnTrigger` | `blogs` | no | slug page should go | **`processBlogChanges` + `DELETE /api/cms/blogs/{id}`** (the slug page is fields on the document) |
| `maintainDashboardStats` | `content` | **yes** (`beforeData` / `afterData`) | decrements counters | **`processContentChanges`** via `content_stats_markers` (idempotent) **+ `DELETE /api/cms/content/{id}` and `deleteContentItem` move the counters** |
| `syncSocialPostToPubler` | `social_posts` | **yes** (`before?.publerPostIds`) | `!after` → un-publish on Publer | **`syncSocialPostsToPubler`** for upserts; **`DELETE /api/cms/social-posts/{id}` un-publishes first** |

`lab_jobs` is a `transient` collection in the manifest — it is not migrated, but its container
exists, and the change feed on it is how `syncToolExpertModeRuns` works, so the container stays.

### 4.4 AI handlers — the default provider has no Azure equivalent

> **Decided 2026-08-21 (owner): a provider is on when its key is present, nothing more.**
> `functions/src/lib/ai/router.js` resolves Anthropic → OpenAI → Gemini from `ANTHROPIC_API_KEY`,
> `OPENAI_API_KEY`, `GEMINI_API_KEY` (an unresolved Key Vault reference counts as absent);
> `CONTENTFORGE_AI_PROVIDER` pins one when several exist; no key → every AI handler fails with
> `AI_NOT_CONFIGURED`, a plain sentence. Vertex is gone (ADC is a GCP identity the app cannot hold);
> Gemini is reached through the public Gemini API by key instead, same model ids. The four AI
> workers in T-322 share this one door.

Site-Main's `lib/ai-model-router.js` resolves the active provider from
`CONTENTFORGE_AI_PROVIDER`, **defaulting to `vertex`**, and reaches Vertex through `@google/genai`
with `vertexai: true` — Application Default Credentials, a GCP identity that a Function App cannot
hold. Its `case 'azure'` branch exists but has no account behind it
here (Architecture note at the top: the Azure OpenAI account was retired, and the reason it was
retired has not changed). So the port for all 17 AI RPCs is: route to a **direct** provider
(Anthropic, OpenAI) keyed from Key Vault through the existing `*_API_KEY` app settings, and treat
Vertex as a provider id that is disabled on Azure rather than a default.

**The port is bounded by `.azure/api-surface.json`, not by the export count.** That contract was
derived by static extraction from `frontend/src`: the frontend invokes **50 named RPC functions**
through `lib/api.js` (49 exist in the source; `publishContentToBlogs` is a naming drift against
`publishContent` and must be reconciled, not carried), and **34 files touch 22 Firestore collections
directly** — including the public architecture pages and all four submission forms. Every direct
touch needs a REST endpoint before the frontend can be rewired, because the browser must never hold
a Cosmos client or key. The contract lists the endpoints, what each replaces, the realtime→polling
decision, and the auth (Firebase→MSAL) and storage (Firebase→SAS) migration file lists. Port to the
contract; anything in the 105 exports that no frontend call reaches is dead weight until proven
otherwise.

---

## 5. Phase 4 — data migration

> **Rebaselined 2026-08-20 against Site-Main @ `088f458`.** The 2026-08-05 pass (at `07f3123`)
> found the collection inventory wrong and fixed it; the four corrections it recorded — the 65 + 5
> undercount, `admins` not migrating, `config` holding its data only in subcollections, no
> subcollection migrating — are all reflected in the manifest below and are not repeated here. This
> pass found the **tooling** wrong in three ways that mattered more, one of them a data-exposure
> defect on a public repository (§5.2), fixed them, and built a rehearsal estate (§5.4) so the
> import is proven on a throwaway account before it touches production.
>
> The operator sequence is the **[Migration-Runbook](.github/wiki/Migration-Runbook.md)**; the
> decision log is **[Phase-4-Data-Migration](.github/wiki/Phase-4-Data-Migration.md)**. Both live
> in `.github/wiki/` and sync to the GitHub wiki.
>
> The document counts in this section are still the 2026-07-30 measurements. Runbook step 5
> (`mode=preflight`, read-only) replaces them with measured ones; do not plan a cutover on these.

### 5.1 What moves — 68 collections, 80 manifest entries, 73 containers

`scripts/lib/migration-manifest.mjs` is the one inventory. It drives the migrator, the verifier and
Terraform (through the generated `infra/cosmos-containers.json`, checked current in CI), and names
**80** top-level entries: Site-Main's 68 declared collections plus twelve legacy ones that exist in
Firestore but not in its rules. Each carries one of five dispositions:

| Disposition | Entries | Containers | Meaning |
| --- | --- | --- | --- |
| `migrate` | 55 | 55 + 7 | exported, transformed, imported, reconciled. Seven subcollections are flattened into containers of their own: `content_versions`, `config_providers`, `config_settings`, `config_tags`, `image_prompts_sets`, `image_prompt_sets_prompts`, `listen_and_learn_episodes` |
| `regenerate` | 3 | 3 | `homepage_feeds`, `tool_service_cache`, `rss_cache` — derived; the ported job rebuilds it. Migrating it imports staleness |
| `reseed` | 2 | 2 | `azure_landing_content`, `tool_service_catalog` — run the seeder on Azure |
| `transient` | 5 | 5 | `lab_jobs` and four quota collections. The container exists (the change feed on `lab_jobs` is load-bearing, §4.3); the data does not move |
| `probe` | 15 | 0 | `articles`, `metadata`, `users`, five `social_*`, `azure_architectures`, `azure_frameworks` — all **empty** in the 2026-08-21 preflight — plus five that preflight surfaced: `_rowy_` (3), `admin_audit_log` (1), `dashboard_stats` (1), `drafts` (1), `summaries` (1). Named so the preflight does not flag them, not provisioned, **decided at runbook step 8** |

That is 72 generated containers plus `leases` for the change feed: **73**.

**Measured 2026-08-21** (runbook step 5, the first live preflight): **8,064 documents, 8,004 to
migrate**, 60 skipped as cache/transient. The 2026-07-30 figure of 1,395 was a count of the editor's
collections, not the database: `audits` (3,090) and `admin_audit_logs` (2,921) are three quarters of
the volume, `content` is 1,142 (was 947), `blogs` still 242, `certifications` still 110, and
`content/{id}/versions` holds 12. Shape findings worth carrying into the transform review:
`certifications.issueDate` / `expDate` are a mix of Firestore `Timestamp` and ISO string,
`certifications.certState` boolean-or-string, `certifications.issuer` array-or-string,
`content.Author` string-or-object, `podcasts.duration` number-or-string, and every
`tool_architecture_plans.pillarAlignment.*` string-or-number. 60 documents carry an `id` field that
disagrees with the document id (`certifications` 52, `frameworks` 3, `youtubevideos` 5) — the
transform keeps the document id and moves the field to `dataId` with an `id-field-conflict`
warning, so the export summary will show exactly 60 of those. Still minutes per run, which is what makes
"rehearse until clean" cheap.

### 5.2 The tooling — and the three things that were wrong with it

`preflight` → `export` → `import --dry-run` → `import` → `verify` were already implemented,
idempotent, and separated so one read-only export feeds unlimited rehearsal imports. The recursive
Firestore type conversion (`Timestamp`, `GeoPoint`, `DocumentReference`, `Bytes` at any depth) was
already right. What was wrong was around them:

| Defect | Why it mattered | Fix (2026-08-20) |
| --- | --- | --- |
| **This repository is public**, and `migrate-data.yml` uploaded `scripts/reports/` — document ids and 240-character field samples — as an artifact; the import dry-run printed samples to the log | Production data would have been world-readable | Every script writes a `*.summary.json` (counts, names, warning tallies) beside its full report and only summaries are uploaded, 1-day retention; the export lives in `$RUNNER_TEMP`; `MIGRATION_CI=1` makes `--show-samples` an error; the upload step refuses any non-summary JSON |
| The workflow carried `COSMOS_KEY` and `COSMOS_DATABASE: hybridcloudworks` | Key auth is disabled on the account and the database is `hcw` — every import would have failed with an error naming neither | Both removed; `scripts/lib/cli.mjs` refuses to start if `COSMOS_KEY` is set |
| Firestore authenticated with `cert(JSON.parse(readFileSync(SA_JSON)))` — a downloaded service-account key — and `migrate-storage-to-blob.sh` shelled out to `azcopy`, whose GCS source accepts only that key | A long-lived GCP key in a GitHub secret, for a one-shot read | **Workload Identity Federation**: `google-github-actions/auth` writes an `external_account` credential; `connectFirestore()` uses `applicationDefault()` and refuses a `service_account` file in CI. The storage copy is Node (`@google-cloud/storage` + `@azure/storage-blob`) — §5.6 |

Two smaller ones in the same pass: `id-token: write` was missing (no OIDC at all), and a Cosmos 403
has two unrelated causes — the firewall, or the identity reached Cosmos and lacks a database-scope
role — that the SDK error does not distinguish. `scripts/migration-probe.mjs` runs one
`SELECT VALUE COUNT(1)` on `system` first and names the cause — `system` rather than `content`, because the healer's container-scoped grant on `content` makes it readable on production without the database-scope role.

### 5.3 How it runs

`migrate-data.yml` is dispatch-only, one run at a time, in the `data-migration` environment
(required reviewer). Inputs: `mode` ∈ `preflight · inventory-gate · export-dry-run · rehearse ·
verify · storage-inventory · storage-rehearse`; `target` ∈ `scratch` (default) · `production`;
`collections`; `prefixes`; `site_main_ref`. Every mode is read-only against Firestore and GCS.
`rehearse` and `storage-rehearse` write to Azure and **refuse `target=production`**. That refusal is
the second lock, not the only one: while `migration_writer_enabled` is `false` in Terraform the
deploy identity holds no database-scope Cosmos role and no blob-write role on production, so the
workflow could not write there if the guard were deleted.

Step order is a correctness constraint: the GitHub OIDC token the GCP step exchanges lives five
minutes, so `npm ci`, the Site-Main checkout and the Cosmos probe all run before it.

Locally, keyless on both clouds:

```bash
gcloud auth application-default login            # the same viewer roles as the WIF identity
az login                                         # an identity with the scratch database role
cd scripts && npm ci
node preflight-firestore-inventory.mjs                               # read-only
node migrate-firestore-to-cosmos.mjs --export --out export/          # read-only
COSMOS_ENDPOINT=… node migration-probe.mjs                           # which 403 is it
COSMOS_ENDPOINT=… node migrate-firestore-to-cosmos.mjs --import --from export/ --dry-run
COSMOS_ENDPOINT=… node migrate-firestore-to-cosmos.mjs --import --from export/
COSMOS_ENDPOINT=… node verify-migration.mjs --from export/           # counts + ids + fields
```

`--show-samples` works on a laptop and is refused in CI. The laptop's IP must be in
`cosmos_admin_ip_rules`; one window admits both accounts.

### 5.4 The rehearsal estate — `infra/scratch.tf`

`cosmos-site-sbx-cus` and `stsitesbxcus01` in `rg-db-site-sbx-cus`, created only while
`cosmos_scratch_enabled` / `storage_scratch_enabled` are true (both default `false`; ~$0 when on
and empty). Same posture as production on purpose — serverless, keys **off**, the same firewall
shape, the same database name, the same 72 containers from the same spec — because a
key-authenticated rehearsal against an open account passes while proving nothing about the
`DefaultAzureCredential` + RBAC path production takes. The healer's 2026-08-20 failure (TODO T-508)
is exactly the class of defect a key would have hidden. Different only where a sandbox should be:
its own resource group, no `prevent_destroy`, the CAF `sbx` token in every name. It holds a full
copy of production data while on; flipping the variables off destroys it.

### 5.5 Irreversible decisions — one window, still open

The three interlocking decisions from the 2026-08-05 pass stand, with corrected numbers. They are
usually presented separately; read them together, because each constrains the others. **Every
container is empty as of 2026-08-20, so the window is open now and closes on the first import** —
the rehearsal included, because the rehearsal should exercise the final shape.

1. **Serverless capacity mode.** Converting to provisioned throughput is one-way, and the conversion
   formula is `RU/s = partitions × 5000` — at 73 containers that is ~365,000 RU/s provisioned at
   once, with a hand-scaled floor of 400 RU/s per container. Serverless is also single-region for
   life; regions cannot be added later.
2. **One container per Firestore collection.** Reversing it means a re-import. It is the right call
   *because* the account is serverless — idle containers are free, and it preserves the
   per-container indexing policies and the 1:1 verification the tooling is built on. If the capacity
   mode ever changes, consolidation must happen first, in the same project.
3. **Partition keys.** 67 containers on `/id`; five exceptions — `content_versions` on
   `/contentId`, `image_prompts_sets` on `/pageId`, `image_prompt_sets_prompts` on `/setName`,
   `listen_and_learn_episodes` on `/setId`, and `admin_config` on a constant `/configScope` so the
   ContentForge save stays one `TransactionalBatch`.

The four subcollection keys are a **correctness** matter, not tuning: each assigns document ids
that are unique only within their parent — a set name, a prompt name, an exam-area slug.
`listen_and_learn/publish.js:97` says so in its own comment: *"the doc id is the area slug."*
Flattened into one container under `/id`, those documents silently overwrite each other on upsert —
no error, no 409, no log line.

The keys the first draft had were not merely suboptimal, they were wrong: `generated_content_images`
used `/contentId` on a field written as the empty string on every document (`cms-functions.js:3139`),
`lab_jobs` used `/status` — a *mutable* field, and a partition key value cannot be changed in place —
and `lab_agents` used `/agentId`, which `vps-agent/index.js:33-34` writes identically to `id`.
Meanwhile the real query load groups by nothing: of ~40 `content` query sites, exactly one filters
on a provider. They were corrected in the spec and applied through the centralus rebuild while every
container was empty; the eleven `moved` blocks that carried the change were removed once state
confirmed it.

`content_versions` is the exception because every read is scoped to one parent content document
(`VersionHistoryDialog.jsx:33`), the delete is a per-parent cascade (`cms-functions.js:2832`), and it
is the only container that grows without bound — one document per content save.

Full evidence with citations in the header of `scripts/lib/migration-manifest.mjs`, and on the
[Phase-4-Data-Migration](.github/wiki/Phase-4-Data-Migration.md) page.

### 5.6 Storage — one bucket onto five containers

`scripts/lib/storage-manifest.mjs` maps each GCS top-level prefix to one of the five Terraform blob
containers; `scripts/migrate-storage-to-blob.mjs` does `--inventory` (exit 2 on an unmanifested
prefix), `--copy [--dry-run]` and `--verify`, idempotent by a `gcsmd5` metadata match, carrying
`contentType` / `cacheControl` across. The verify step compares counts and bytes per prefix, every
object's `gcsmd5` against the live listing, and downloads a deterministic sample from both sides to
compare byte-for-byte — the check that catches a truncated stream.

| GCS prefix | Container | Blob prefix | Disposition |
| --- | --- | --- | --- |
| `covers/` `blogs/` `certifications/` `speakerevents/` | same name | stripped | migrate |
| `database/certifications/` `database/blogs/` `database/speakerevents/` | the family's container | `database/` | migrate |
| `image-gallery/` `character/` `listen-and-learn/` `draft-images/` | `content` | preserved | migrate |
| `published-images/` | `content` | preserved | migrate — **owner flag**: public in Firebase; `content` is not a public container here. A disclosure decision for the API, not for the copy |
| `content-submissions/` `designs/` | `content` | preserved | migrate — surfaced by the 2026-08-21 inventory (3 + 1 objects); owner decision 2026-08-21 |
| `thumbnails/` | — | — | skip: empty, and nothing on Azure reads thumbnails (owner decision 2026-08-21) |
| `articles/` | — | — | skip: 90-day scraped images the RSS job regenerates (the Azure lifecycle rule for them is inert until the scraper writes here) |
| `uploads/` | — | — | skip: per-user temp keyed by Firebase uid |

`imageUrl` / `storagePath` values **inside documents are not rewritten** by the migration. The
transform is deliberately faithful; Firebase Storage stays warm until Go-Live, and the re-pointing
is its own reviewed step (§5.7) — which is also what keeps §6's rollback a pure DNS change.

### 5.7 Deferred to the production-import phase

Step 12 was signed on 2026-08-21; the phase opens with `migration_writer_enabled = true` in
Terraform and `PRODUCTION_IMPORT_ENABLED = true` in GitHub, in that order — the sequence is the
"production import" section of the [Migration-Runbook](.github/wiki/Migration-Runbook.md). Deferred
past the import itself, named here so none is forgotten: the `admins` uid → oid remap (mapping file, human review, a `--remap`
import option, keep `firebaseUid`); the production grants that variable creates; removing the
workflow's production guard; the write-freeze and delta strategy between export and cutover; the
media-URL re-pointing and the `published-images` decision; `cp_sortDate` re-application once the
healer works (T-508); the `regenerate` and `reseed` jobs; `FEATURE_FLAG_SCHEDULERS` and the
per-timer flags; the Telegram webhook (§6 step 6); `lab_agents` / `vps-agent`; GCP decommission.

---

## 6. Phase 5 — cutover

**Where this starts from.** The Static Web App serves Azure's placeholder page until the first
frontend deploy — `deploy-azure-frontend.yml` is still `if: false`, waiting on the SWA token (REVIEW
§4.3) and the Entra SPA registration (REVIEW §2.2). The API is live. The data is not there. All
three have to be true before step 1.

1. Deploy everything to Azure; keep Firebase fully live.
2. Run both in parallel with Azure reachable on a preview hostname. The SWA's default
   `*.azurestaticapps.net` host is that hostname; nothing needs creating.
3. Run the production import (the phase after the rehearsal — §5.7), with a write-freeze on
   Site-Main's admin from export to verification. Re-run the verification gates (§7) against Azure.
4. Bind the custom domains. `hybridcloudworks.com` and `www` become SWA custom domains — the `asuid`
   TXT record Terraform already manages (`cloudflare_record.azure_swa_txt_validation`) is the
   ownership proof, so the binding does not wait on DNS moving. `admin.hybridcloudworks.com` binds
   the same way if the admin UI keeps its own host.
5. Move DNS at Cloudflare: the apex and `www` CNAMEs from the Firebase origin to the SWA hostname.
   **Keep TTL low for at least 48 hours beforehand.** The API host `api-azure.` does not move — it
   has been on Azure since Phase 2.
6. Re-point external webhooks — **Telegram is the one that will be forgotten, and it is two
   changes, not one.** The receiver was missing until 2026-08-22 (this step assumed one existed);
   it is now `POST /api/telegram/webhook` (T-512, ported with the owner's decision to keep the
   bot). Deploying it changes nothing on its own: the URL and secret token are registered with
   **Telegram**, not in code, so `setWebhook` has to be re-run or the bot keeps POSTing at the
   Cloud Functions URL until GCP is decommissioned — at which point it goes quiet with no error
   anywhere in Azure. `scripts/cutover/04-telegram-webhook.ps1` does both halves and preflights
   the receiver first, because a webhook pointed at a 404 makes Telegram back off. The secret
   derives from `sha256(TELEGRAM_BOT_TOKEN)`, which is already in Key Vault.
7. Turn the timers on: `FEATURE_FLAG_SCHEDULERS` then the per-timer flags, one at a time, each
   observed firing once (§7).
8. Watch for 24–48 hours before touching GCP.

**Rollback is DNS** for as long as Firebase remains deployed. Do not decommission anything in GCP
until Azure has run a full week including every scheduled job — the daily and weekly timers are
exactly what a short soak will miss. Firebase Storage stays warm the whole time: the migrated
documents still carry their original `imageUrl` / `storagePath` values until the re-pointing step
in §5.7 runs, deliberately, so a rollback needs nothing rewritten.

---

## 7. Verification gates

Reuse what exists. This repository's baseline is:

```bash
cd functions && npx vitest run   # 822 pass / 50 files
cd frontend  && npx vitest run src/   # 105 pass / 14 files
cd frontend  && npx eslint src        # 0 errors
npm run build                         # 90 HTML documents pre-rendered
```

Infrastructure has its own gates, all currently green: `terraform fmt -check`,
`terraform validate`, an empty `terraform plan`, and
`scripts/validate-repository-structure.ps1`. CI additionally runs `tflint` and a
Trivy IaC scan, neither of which is installed locally — so an IaC change is not
fully checked until it has been pushed.

Add for the migration:

- **Test against the Cloudflare host, never the origin.** `scripts/smoke-deployed.mjs --base
  https://api-azure.hybridcloudworks.com/api`. Pointing any check at `azurewebsites.net` produces a
  403 that looks like a broken deployment and is not.

- **Inventory gate.** `migrate-data.yml` `mode=inventory-gate` — Site-Main's own
  `inventory-collections.mjs --diff` against our manifest, at a recorded Site-Main SHA. Must pass
  before any import, and again immediately before the production import: a collection added
  upstream in between is exactly what it catches.
- **Reconciliation.** `reconciliation.summary.json` shows `failed: 0` on every container — on
  scratch during the rehearsal, on production after the import. And `SELECT VALUE COUNT(1)` on
  production `content` stays **0** until the production-import phase begins; runbook step 11 is the
  read that proves it.
- **Endpoint parity.** Every one of the 89 HTTP endpoints answers with the same shape as Firebase.
  Record the Firebase responses **before** cutover; they are the fixtures.
- **Authorisation parity.** `firestore.rules` has emulator-backed tests today; its replacement must
  be tested to at least that coverage. Architecture_Plan §5.1 — this is the most dangerous silent
  loss in the migration.
- **Pre-render parity.** 90 documents, and grep the built HTML for each page's distinctive content.
  This repo has broken pre-rendered output three times with every unit test passing.
- **Scheduled-job proof.** Each of the 16 timers observed firing at least once in Azure — **at the
  right local time**. `WEBSITE_TIME_ZONE = America/Chicago` is set on the app; a timer that fires
  five hours early passed the "fired once" test and failed the real one.
- **Cost gate.** Actual spend measured against USD 150 after one full week, before decommissioning.

---

## 8. Risk register

| Risk                                               | Severity | Mitigation                                                          |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| Authorisation rules not faithfully re-implemented  | **High** | Port `firestore.rules` tests to API tests before removing the rules |
| AI handlers default to Vertex / ADC, which has no Azure equivalent | **High** | §4. The router's `azure` branch has no account behind it; route every AI RPC to a direct provider (Anthropic / OpenAI) keyed from Key Vault before porting the 17 RPCs |
| Cost overrun from hourly resources                 | **High** | Architecture_Plan §3; cost gate before decommission                 |
| Collections missed by the migration inventory      | **High** | §5. One manifest drives migrator, verifier and Terraform; `preflight` exits 2 on anything unmanifested; the inventory gate runs Site-Main's own diff |
| Feature delta never ported — site regresses against what visitors have today | Closed | §0 disposition; T-409 ported 2026-08-21 (the D1 list, with tests); D2/D3 stay deliberate |
| Six HTTP handlers exceed the 230 s Flex Consumption cap | Medium | §4 / T-322. Convert to jobs; fix the client/server timeout mismatch in the same change |
| Change-feed semantics lose delete-driven behaviour | Medium   | §3.5 done upstream; §4 trigger table names the two delete endpoints to write |
| Cron syntax differences silently disable a job, or time zone shifts it | Medium | §4 timer table (NCRONTAB + `WEBSITE_TIME_ZONE`); §7 scheduled-job proof at the right local time |
| Telegram/webhook re-registration forgotten         | Medium   | §6 step 6 — the receiver exists (T-512); `setWebhook` still has to be re-run. `scripts/cutover/04-telegram-webhook.ps1` |
| `speakerevents/` storage rule is open in Firebase  | Medium   | Do not carry it forward: `speakerevents` is a private container here, served through the API like every other |
| Labs runner contract drift                         | Medium   | Coordinate `vps-agent` with Phase 3 labs group                      |
| Repo divergence during the overlap                 | Closed   | §0 — resolved by pinning the baseline and porting by hand; was "reconcile weekly" |
| Production data published through a public-repository artifact | Closed | §5.2 — summaries only, export never leaves the runner, samples refused in CI |
| 47 browser-direct reads discovered late            | Closed   | §3.1 done on both sides                                             |
| AI provider egress cost after cutover              | Low      | Decide provider in Architecture_Plan §7.4                           |

---

## 9. What to do first, concretely

If only one thing starts this week: **runbook steps 2–4** — the GCP Workload Identity binding, the
`data-migration` environment, and the scratch apply. All three are owner or operator gates, nothing
in Phase 4 moves until they exist, and together they take an afternoon.

Second: **the first `mode=preflight` run.** It is read-only, it needs only step 2, and it replaces
every document count in this plan with a measured one.

Third, in parallel and independent of both: **T-322**, the six handlers that cannot survive the
230 s cap — because every one of them is on the Phase 3 critical path and none of them is a
mechanical port.
