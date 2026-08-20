# Migration Plan — Personal-Site_HCW → HCW-HybridCloudWorks (Azure)

**Audience:** engineers executing the migration. **Status:** plan — Phase 2 executed, see the note below.
**Written** 2026-07-30; deployment note added 2026-08-19.
**Companion:** [Architecture_Plan.md](Architecture_Plan.md) — the target and why.

> ## ⚠️ PLEASE NOTE — what is *actually* deployed, as of 2026-08-19
>
> **Everything below this box is the plan as written on 2026-07-30. It describes what was designed
> to be deployed. It is not a description of the running estate.**
>
> **Migration_Plan §2 Phase 2 has since been executed.** The Azure infrastructure is live: **129
> resources**, applied from `infra/` through HCP Terraform (org `hcw`, project `Site`, workspace
> `hcw-azure`). As of 2026-08-19 `terraform fmt`, `terraform validate` and `terraform plan` are all
> clean — _"No changes. Your infrastructure matches the configuration."_
>
> Reaching that took a run of apply-time failures, and **fixing them changed the target**. Read the
> plan for intent and sequencing; read this box for what exists. Where the two disagree, this box
> wins.
>
> ### ⏳ A rebuild is staged in the repository and has NOT been applied
>
> `infra/` currently describes a **different estate from the one running**. The configuration has
> been changed to consolidate everything into `centralus` and to adopt the CAF instance-number
> convention; both force replacement, because Azure resource names and regions are immutable. The
> planned change is **125 to add, 3 to change, 125 to destroy** — verified clean, zero errors, not
> executed.
>
> Until that applies, the names in the table below are what is live. After it applies, every `scus`
> becomes `cus` and most resources gain an `-01`:
> `func-site-prod-cus-01`, `kv-site-prod-cus-01`, `stapp-site-prod-cus-01`, `stsiteprodcus01`.
> `cosmos-site-prod-cus` keeps its name — CAF assigns no instance number to Cosmos.
>
> **The rebuild has one hard prerequisite.** The Key Vault holds ~24 secrets that are seeded by hand
> and exist nowhere else in managed form; Terraform cannot recreate them. They must be exported
> before the teardown. Deployment Runbook **§1b** is the procedure, and its Step 5 — restoring the
> four `prevent_destroy` guards that had to be lifted to make this plan possible at all — is not
> optional.
>
> | The plan implies                                        | What is actually deployed                                                               | Why it changed                                                                                                                                             |
> | ------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Cosmos in the estate region, `southcentralus`           | `cosmos-site-prod-cus` in **`centralus`** — serverless, single-region, `zone_redundant = false` | Two Azure APIs govern Cosmos placement and they disagree. `southcentralus` is ARM-deployable but this subscription has **no Cosmos region access**; `southcentralus2` has access but ARM does not offer Cosmos there. `centralus` is the nearest region that passes both. |
> | An Azure OpenAI account behind the AI endpoints         | **Nothing. Retired entirely** — no account, no role assignment, no diagnostic setting, no `ai` resource group, no `AZURE_OPENAI_*` app settings | The pinned `gpt-4o` version was retired 2026-03-31, this subscription holds **zero TPM quota** for `gpt-4o` in every SKU, and DALL-E is not offered in the region. Nothing consumed it. |
> | Key Vault `kv-site-prod-scus`                           | **`kv-site-prod-scus-01`**                                                                | The unsuffixed name is globally taken by an unrelated tenant and is not soft-deleted anywhere in this tenant, so it is unrecoverable. `-01` is the instance suffix the Naming-Convention page reserves for exactly this. |
> | Static Web App in the estate region                     | `stapp-site-prod-scus`, running in **`centralus`**                                        | `southcentralus` does not offer `Microsoft.Web/staticSites` — only five regions do. The name keeps its `scus` token on purpose: it records the estate, not the control-plane region one service happens to demand. |
> | Phase 2 exit: applied to a **non-production** subscription | **Applied to the production subscriptions**, across three: Application `b9e02281…`, Management `02dfb8ad…`, Connectivity `8f3c6d82…` | There is no non-production subscription. The Identity landing zone is deliberately empty. Cost control is the budget resource — `budget_amount_usd` (default 150 USD) from `budget_start_date`. **The §7 cost gate still applies and has not been run.** |
> | Data living in Cosmos                                    | The `hcw` database and all **73 containers exist and are EMPTY**                          | Phase 4 has not run. The 1,395 documents are still only in Firestore.                                                                                       |
> | Wildcard CORS origins on storage                         | **Exact origins only, ports included**                                                    | Azure Storage accepts a literal `*` or fully-qualified origins and nothing in between; `https://*.<domain>` and `http://localhost:*` are rejected outright.  |
> | A CI runner                                              | **Not deployed** — `ci_runner_enabled = false`                                            | Deferred; ADR 0021 superseded.                                                                                                                              |
>
> **Two of these change how you work, not just what you read:**
>
> **The AI endpoints have no Azure backing service.** The 17 AI RPCs are no more blocked than they
> were, but whoever ports them writes against **external provider APIs, keyed from Key Vault** via
> the existing `*_API_KEY` app settings — which is what `functions/src/lib/openai-client.js` (no
> importers) was always shadowing. Do not re-add the Azure OpenAI account to unblock Phase 3; the
> absence is commented in `infra/main.tf` where someone would otherwise restore it.
>
> **The network is closed by default.** Cosmos, both storage accounts and Key Vault all default to
> `Deny`, scoped to the Functions integration subnet `snet-site-func-prod`. GitHub-hosted runners
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
> **What has not changed:** Phases 3, 4, 5 and 6 are all still ahead — port the 117 endpoints,
> migrate the data, cut over, decommission. §0's overlap problem remains the highest-probability
> cause of failure, and every day both repositories stay live it gets worse.

This repository becomes **archival** at the end of this plan. Until it does, it is the **source of
truth**, and that is the single most important operational fact below.

---

## 0. The overlap problem, stated first

`frontend/` in the target repository is an **imported copy** of this one. It still contains
`firebase.json` and `.firebaserc`, and its own README flags it as _"Requires reconciliation with the
old repository."_

Meanwhile this repository is still being actively developed — on 2026-07-30 alone it took a Vertex
outage fix, a Cloud Tools scheduler, six Firestore index retirements and two page refactors.

**Every day both repositories are live, they diverge.** Divergence is the highest-probability cause
of migration failure here — higher than any technical risk in §4–§6.

**Rule for the duration:** feature work lands here, gets carried across in the same week, or does
not land at all. Phase 1 exists to shorten that window.

---

## 1. Sequencing principle

**Decouple in the old repository first; port second.** Work that removes a Firebase dependency while
the Firebase implementation is still running is safe, testable against production, and reversible.
The same work done during cutover is none of those things.

This is what makes the migration cheap: most of the risk can be retired **before** anything is
deployed to Azure.

---

## 2. Phases

| Phase | Goal                                     | Runs in       | Exit criterion                                                  |
| ----- | ---------------------------------------- | ------------- | --------------------------------------------------------------- |
| 0     | Reconcile the two repositories           | Both          | `frontend/` is a byte-faithful copy of this repo at a known SHA |
| 1     | Decouple from Firebase behind interfaces | **This repo** | Zero direct `firebase/*` imports outside an adapter layer       |
| 2     | Stand up Azure infrastructure            | Target repo   | **DONE 2026-08-19** — 129 resources applied to the *production* subscriptions; see the note at the top |
| 3     | Port the API and workers                 | Target repo   | All 117 endpoints answering, parity-tested                      |
| 4     | Migrate data                             | Scripts       | 1,395 documents in Cosmos, reconciled                           |
| 5     | Cutover                                  | DNS           | Live on Azure, Firebase warm                                    |
| 6     | Decommission and archive                 | Both          | GCP down, this repo archived                                    |

Phases 1 and 2 are independent and should run in parallel by different people.

> **These are not the same numbers as the Wiki's.** The [Implementation
> TODO](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki/Implementation-TODO) numbers
> _delivery_ phases 0–8; this table numbers _migration_ phases 0–6. Only Phase 4 means roughly the
> same thing in both. Phase 3 is the worst collision — it is "Port the API and workers" here and
> "Empty platform and observability" there. Cite this document's phases as **"Migration_Plan §N"**
> and the Wiki's as **"Phase N"**. The Implementation TODO carries the full mapping table.

---

## 3. Phase 1 — the refactors worth doing here, first

These are the "leverage" items. **Each improves this codebase whether or not the migration ever
happens**, which is what makes them safe to do now.

### 3.1 Put every Firestore read behind a data-access layer — _the big one_

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

### 3.2 Isolate auth behind a provider interface

5 files import `firebase/auth` (measured; earlier estimate of 8 was overstated). Wrap sign-in,
sign-out, token acquisition and claim reads in one module. Entra/MSAL then swaps in at one place
instead of five.

### 3.3 Isolate storage

5 files import `firebase/storage`. Same treatment; Blob Storage swaps in behind it.

### 3.4 Fix `staticwebapp.config.json` — the soft 404 is already there and already broken

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

### 3.5 Audit the 11 Firestore triggers for change-feed compatibility

Cosmos's change feed delivers current state and **does not surface deletes**. Any trigger relying on
the before-image or on deletion needs redesign (Architecture_Plan §5.3). Do the audit now — it is
reading, not writing, and it de-risks the Phase 3 estimate.

### 3.6 Decide `blogs`

242 legacy documents, reached only through a fallback path in `BlogDetailTemplate` and
`ArchitectureDetailTemplate`. Its six composite indexes were retired on 2026-07-30 as orphaned. If
it is genuinely dead, cutover is the cheapest moment to drop it. If it is not, that fallback path is
load-bearing and must be ported.

---

## 4. Phase 3 — porting 117 functions

Do not port 117 endpoints one by one in isolation. Group them:

| Group                                    | Count (approx) | Notes                                                                  |
| ---------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| Admin CRUD / snapshots                   | large          | Mostly mechanical; shared auth middleware ports once                   |
| Content pipeline (ContentForge, publish) | medium         | Highest business risk; port with the publish-contract tests            |
| Cloud Tools                              | ~10            | Self-contained; good first vertical slice                              |
| Labs                                     | ~6             | Depends on the runner contract — coordinate with `vps-agent`           |
| Telegram / Social / notify               | ~10            | External integrations; re-point webhooks last                          |
| Scheduled (16)                           | 16             | Timer triggers; verify cron expressions, they are not identical syntax |

**Port Cloud Tools first as a vertical slice.** It is self-contained, has live tests, exercises
HTTP + scheduled + Cosmos + Key Vault + an external API, and its failure blast radius is one page.
Everything learned there applies to the other groups.

**Carry the secrets model across deliberately:** `defineSecret` bindings become Key Vault references
with managed identity. No connection strings, no keys in app settings.

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

> **Updated 2026-08-05 after reviewing Site-Main @ `07f3123`.** The tooling and the collection
> inventory below were checked against the source repository for the first time. The headline
> numbers survived; the collection list did not. Full findings, decisions and runbook:
> **[Phase 4 data migration](https://github.com/saulpatinojr/HCW-HybridCloudWorks/wiki/Phase-4-Data-Migration)**
> in the Wiki.
>
> Four corrections matter enough to state here:
>
> - **16 populated collections was an undercount of what has to move.** `firestore.rules` declares
>   **65** top-level collections plus **5 subcollections**. The migration tooling mapped 14, three
>   of which (`config`, `dashboard_stats`, `users`) do not exist in Site-Main at all.
> - **`admins` was not being migrated.** It is the collection `firestore.rules` `isAdmin()` reads —
>   the root of the authorisation model. So were `admin_config` and `site_settings`.
> - **`config` holds no documents of its own.** Its data lives in `config/providers/*`,
>   `config/tags/*` and `config/settings/*`. A top-level read returns zero, and a count check
>   compares 0 against 0 and passes.
> - **No subcollection was being migrated**, including `content/{id}/versions` — the editor's
>   version history.
>
> The document counts in the table below are still the 2026-07-30 measurements.
> `node scripts/preflight-firestore-inventory.mjs` replaces them with current ones and is
> read-only; run it before planning the cutover.

**1,395 documents across 16 populated collections.** This is the easy part; resist over-engineering
it.

| Collection             | Docs | Note                                              |
| ---------------------- | ---- | ------------------------------------------------- |
| `content`              | 947  | The real one. Partition key decision matters here |
| `blogs`                | 242  | See §3.6 — may not need migrating                 |
| `certifications`       | 110  | Partly machine-generated from Microsoft Learn     |
| `rss_cache`            | 24   | Regenerable — do not migrate, let it refill       |
| `speakerevents`        | 18   |                                                   |
| `social_posts`         | 15   |                                                   |
| `lab_jobs`             | 11   | Transient — do not migrate                        |
| `tool_service_catalog` | 8    | Seed data; re-seed rather than migrate            |
| `tool_service_cache`   | 8    | Regenerable — let the scheduled refresh rebuild   |
| remainder              | ~12  |                                                   |

**Migrate roughly 1,100 documents, not 1,395.** Caches, transient job records and seed data should
be regenerated on the far side — migrating them imports staleness and hides bugs.

Requirements: a dry-run mode, a reconciliation report (source count vs target count vs field-level
spot checks), and idempotent re-runnability. At this volume a single script run is minutes, so **run
it many times against a scratch Cosmos account before the real one.**

All four are now implemented. Export and import are separate commands so one read-only export
against production can feed unlimited rehearsal imports:

```bash
node scripts/preflight-firestore-inventory.mjs                        # measure, read-only
node scripts/migrate-firestore-to-cosmos.mjs --export --out export/   # read-only
node scripts/migrate-firestore-to-cosmos.mjs --import --from export/ --dry-run
node scripts/migrate-firestore-to-cosmos.mjs --import --from export/
node scripts/verify-migration.mjs --from export/                      # counts + ids + fields
```

Timestamps and any Firestore `Timestamp` fields need explicit conversion — silent coercion to
strings is the classic defect here, and this codebase already has date fields in three different
shapes (`Timestamp`, ISO string, epoch ms) as of the Cloud Tools work.

The conversion the tooling had was one level deep, so a `Timestamp` nested inside an object or an
array still went across as `{_seconds, _nanoseconds}` — the same defect, one level down. It is now
recursive and covers `Timestamp`, `GeoPoint`, `DocumentReference` and `Bytes` at any depth.

**Three interlocking irreversible decisions need sign-off before the first Terraform apply.** They
are usually presented separately; they should be read together, because each one constrains the
others:

1. **Serverless capacity mode.** Converting to provisioned throughput is one-way, and the conversion
   formula is `RU/s = partitions × 5000` — at 66 containers that is ~330,000 RU/s provisioned at
   once, with a hand-scaled floor of 400 RU/s per container. Serverless is also single-region for
   life; regions cannot be added later.
2. **One container per Firestore collection.** Reversing it means a re-import. It is the right call
   *because* the account is serverless — idle containers are free, and it preserves the
   per-container indexing policies and the 1:1 verification the tooling is built on. If the capacity
   mode ever changes, consolidation must happen first, in the same project.
3. **Partition keys.** 62 containers on `/id`; four flattened subcollections keyed by their parent.

The partition key choice for those four is a **correctness** matter, not tuning: `content_versions`,
`image_prompts_sets`, `image_prompt_sets_prompts` and `listen_and_learn_episodes` each assign
document ids that are unique only within their parent — a set name, a prompt name, an exam-area
slug. `listen_and_learn/publish.js:97` says so in its own comment: *"the doc id is the area slug."*
Flattened into one container under `/id`, those documents silently overwrite each other on upsert —
no error, no 409, no log line.

The previous keys were not merely suboptimal, they were wrong: `generated_content_images` used
`/contentId` on a field written as the empty string on every document (`cms-functions.js:3139`),
`lab_jobs` used `/status` — a *mutable* field, and a partition key value cannot be changed in place —
and `lab_agents` used `/agentId`, which `vps-agent/index.js:33-34` writes identically to `id`.
Meanwhile the real query load groups by nothing: of ~40 `content` query sites, exactly one filters
on a provider.

`content_versions` is the exception because every read is scoped to one parent content document
(`VersionHistoryDialog.jsx:33`), the delete is a per-parent cascade (`cms-functions.js:2832`), and it
is the only container that grows without bound — one document per content save.

Full evidence with citations in the header of `scripts/lib/migration-manifest.mjs`, and on the
[Phase 4 data migration](https://github.com/saulpatinojr/HCW-HybridCloudWorks/wiki/Phase-4-Data-Migration)
Wiki page.

---

## 6. Phase 5 — cutover

1. Deploy everything to Azure; keep Firebase fully live.
2. Run both in parallel with Azure reachable on a preview hostname.
3. Re-run the verification gates (§7) against Azure.
4. Move DNS at Cloudflare. **Keep TTL low for at least 48 hours beforehand.**
5. Re-point external webhooks — **Telegram is the one that will be forgotten.** Its webhook URL and
   secret token are registered with Telegram, not in code; the secret derives from
   `sha256(TELEGRAM_BOT_TOKEN)`.
6. Watch for 24–48 hours before touching GCP.

**Rollback is DNS** for as long as Firebase remains deployed. Do not decommission anything in GCP
until Azure has run a full week including every scheduled job — the daily and weekly timers are
exactly what a short soak will miss.

---

## 7. Verification gates

Reuse what exists. This repository's baseline is:

```bash
npx vitest run src/          # 361 pass / 44 files
npx eslint src functions     # 0 errors
npm run build                # 90 HTML documents pre-rendered
```

Add for the migration:

- **Endpoint parity.** Every one of the 117 endpoints answers with the same shape as Firebase.
  Record the Firebase responses **before** cutover; they are the fixtures.
- **Authorisation parity.** `firestore.rules` has emulator-backed tests today; its replacement must
  be tested to at least that coverage. Architecture_Plan §5.1 — this is the most dangerous silent
  loss in the migration.
- **Pre-render parity.** 90 documents, and grep the built HTML for each page's distinctive content.
  This repo has broken pre-rendered output three times with every unit test passing.
- **Scheduled-job proof.** Each of the 16 timers observed firing at least once in Azure.
- **Cost gate.** Actual spend measured against USD 150 after one full week, before decommissioning.

---

## 8. Risk register

| Risk                                               | Severity | Mitigation                                                          |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| Repo divergence during the overlap                 | **High** | §0. Shorten the window; reconcile weekly                            |
| Authorisation rules not faithfully re-implemented  | **High** | Port `firestore.rules` tests to API tests before removing the rules |
| Cost overrun from hourly resources                 | **High** | Architecture_Plan §3; cost gate before decommission                 |
| Collections missed by the migration inventory      | **High** | §5. One manifest drives migrator, verifier and Terraform; preflight fails on anything unmanifested |
| Change-feed semantics lose delete-driven behaviour | Medium   | §3.5 audit before estimating                                        |
| 47 browser-direct reads discovered late            | Medium   | §3.1 done first, in this repo                                       |
| Cron syntax differences silently disable a job     | Medium   | §7 scheduled-job proof                                              |
| Telegram/webhook re-registration forgotten         | Medium   | §6 step 5                                                           |
| Labs runner contract drift                         | Medium   | Coordinate `vps-agent` with Phase 3 labs group                      |
| AI provider egress cost after cutover              | Low      | Decide provider in Architecture_Plan §7.4                           |

---

## 9. What to do first, concretely

If only one thing starts this week: **§3.1, the data-access layer in this repository.** It is the
largest risk, it is reversible, it is testable against a running production system, and it converts
the hardest part of the migration into a configuration change.

Second: **§0 reconciliation**, because everything else decays while the two repositories drift.
