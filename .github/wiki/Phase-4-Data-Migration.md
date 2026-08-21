# Phase 4 — Data Migration

The decision log for moving Firestore and Firebase Storage onto Cosmos DB and Blob Storage. The
operator sequence is the [Migration-Runbook](Migration-Runbook); this page records *why* each thing
is the way it is, so a decision is never re-litigated from a log line. Plan-level context:
[Migration_Plan.md](../../Migration_Plan.md) §5.

Baseline: **Site-Main @ `088f458`** (2026-08-18, v1.7.0) — 68 Firestore collections, one GCS bucket.
Target: 73 Cosmos containers (72 generated from the manifest + `leases`), 5 blob containers.

## Decisions

### D1. The rehearsal account is keyless, serverless and identical in shape to production

`cosmos-site-sbx-cus` ([infra/scratch.tf](../../infra/scratch.tf)) has keys off, the same
firewall shape, the same database name `hcw`, and the same 72 containers from the same generated
spec. A key-authenticated rehearsal against an open account would pass while proving nothing about
`DefaultAzureCredential` + native RBAC — which is the path production takes. The healer's 2026-08-20
failure ("cannot be authorized by AAD token in data plane", see D9) is exactly the class of defect a
key would have hidden.

It differs only where a sandbox should: its own resource group, no `prevent_destroy`, the CAF `sbx`
environment token in every name. It holds a full copy of production data while on; the variables
that create it also destroy it. **Lifetime: to be recorded at runbook step 12.**

### D2. Production is locked by RBAC, not by a guard

While `migration_writer_enabled` is `false` (the default), the deploy identity holds no
database-scope Cosmos role and no blob-write role on production. The workflow's
"refuse write modes against production" step is the second lock, not the only one. The
production-import phase opens with that one variable, reviewed in HCP Terraform.

### D3. Partition keys — the window is open now and closes on the first import

All 73 containers are empty as of 2026-08-20. A partition-key path is immutable; changing one after
data lands means destroy and re-import. Current choices: 67 on `/id`; `content_versions` on
`/contentId`, `image_prompts_sets` on `/pageId`, `image_prompt_sets_prompts` on `/setName`,
`listen_and_learn_episodes` on `/setId` (each assigns ids unique only within its parent — flattening
under `/id` would silently overwrite on upsert); `admin_config` on a constant `/configScope` so the
ContentForge save stays one `TransactionalBatch`. Owner sign-off on this list is a gate before
runbook step 9 writes anything — even to scratch, because the rehearsal should exercise the final shape.

### D4. Collection dispositions

The manifest ([scripts/lib/migration-manifest.mjs](../../scripts/lib/migration-manifest.mjs))
classifies every entry — the 68 collections plus the subcollections it flattens — as one of five
dispositions (counts as of 2026-08-20):

- **migrate** (55) — exported, transformed, imported, reconciled. Includes `admins`, `admin_config`,
  `config`, `_snapshots` and the four flattened subcollections.
- **regenerate** (3) — derived data a ported job rebuilds: `homepage_feeds`, `tool_service_cache`,
  `rss_cache`. Migrating it would carry stale derived state across; the jobs that rebuild it are
  Phase 3 work.
- **reseed** (2) — seed data, re-run the seeder on Azure: `azure_landing_content`,
  `tool_service_catalog`.
- **transient** (5) — job and quota records with no value after cutover: `lab_jobs`,
  `tool_export_quota`, `tool_ai_plan_quota`, `submission_quota`, `lab_public_quota`.
- **probe** (15) — named so the preflight does not flag them as unmanifested, but not provisioned as
  containers and not migrated until someone decides: `articles`, `metadata`, `users`, the five
  `social_*` collections (`social_workspaces`, `social_libraries`, `social_library_items`,
  `social_schedule_slots`, `social_analytics`), the two seeder-written ones added 2026-08-20
  (`azure_architectures`, `azure_frameworks`), and five the first live preflight surfaced on
  2026-08-21 — `_rowy_` (3 docs, Rowy GUI metadata), `admin_audit_log` (1, the pre-FINDING-07
  singular), `dashboard_stats` (1, derived counters from the `maintainDashboardStats` trigger),
  `drafts` (1), `summaries` (1). **All ten of the original probes are empty in Firestore**, so the
  real decisions are the five new ones — and none needs a container: our port already keeps the
  dashboard document as `system/dashboard_stats_v1` and the ported trigger recomputes it. Runbook step 8 decides each from its measured count:
  content the site reads becomes `migrate` and gets a container; anything else becomes `transient`
  or is dropped from the manifest.

`preflight` reports probe entries with their counts and **exits 2 only on a collection the manifest
does not name at all** — so a new upstream collection stops the phase rather than being silently
dropped, while a probe is a question, not a failure.

### D5. `admins` — uid → oid remap is a later, human-reviewed step

Firebase uids and Entra object ids are unrelated. The rehearsal migrates `admins` faithfully
(keeping `firebaseUid`); the production import adds a `--remap` mapping file that a human reviews.
Not in this phase.

### D6. Storage — manifest-driven, faithful, no URL rewriting

[scripts/lib/storage-manifest.mjs](../../scripts/lib/storage-manifest.mjs) maps each GCS top-level
prefix to one of the five Terraform blob containers. `covers/`, `blogs/`, `certifications/`,
`speakerevents/` → same-named container, prefix stripped; `database/{certifications,blogs,speakerevents}/`
→ the family's container under `database/`; `image-gallery/`, `character/`, `listen-and-learn/`,
`draft-images/`, `published-images/` → `content`, prefix preserved. Skipped: `articles/` (90-day
scraped images the RSS job regenerates — note the Azure lifecycle rule for it is inert until the
scraper writes here) and `uploads/` (per-user temp keyed by Firebase uid). Probe: `thumbnails/` (empty),
`content-submissions/` (3 objects, public-submission images) and `designs/` (1 object) — the last two
surfaced by the first live inventory on 2026-08-21.

**Flag for the owner:** `published-images/` is publicly readable in Firebase; `content` is not in
the API's public-media container list here. That is a disclosure decision for the API, not the copy.

The copy carries `contentType`/`cacheControl` and stamps `gcsmd5`/`gcsgeneration`/`gcssource`
metadata; it is idempotent by `gcsmd5` match. `imageUrl`/`storagePath` values inside documents are
**not** rewritten — Firebase Storage stays warm until Go-Live and the re-pointing is its own
reviewed step.

### D7. Public repository → summaries only

The repository is public. The original workflow uploaded `scripts/reports/` — document ids and
240-character field samples — as an artifact, and the import dry-run printed samples to the log.
Both would have published production data. Now: every script writes a `*.summary.json` beside its
full report; only summaries are uploaded (1-day retention); `MIGRATION_CI=1` makes `--show-samples`
an error; the export lives in `$RUNNER_TEMP` and dies with the runner; the upload step refuses any
non-summary JSON. Full reports for a rehearsal that needs keeping go to the private
`migration-reports` container on scratch storage, never to an artifact.

### D8. Credentials — federated on both clouds

GCP through Workload Identity Federation (a dedicated read-only service account; no downloaded key
— the scripts refuse a `service_account` credential file in CI). Azure through the
`environment:data-migration` federated credential on the deploy identity. The Cosmos account has
keys disabled, so `COSMOS_KEY` cannot work and the client refuses it if set.

### D9. The healer is broken and it is not this phase's problem

`heal-computed-properties.yml` fails with 403 "cannot be authorized by AAD token in data plane" on
`PUT /dbs/hcw/colls/content`. `container.replace()` (setting `computedProperties`) is a
**control-plane** operation; a Cosmos data-plane role can never satisfy it. It needs an ARM role
(Cosmos DB Operator on the account) or a move to `az cosmosdb sql container update`. Tracked in
TODO; `cp_sortDate` only matters once `content`/`blogs` hold data, which is the production-import phase.

### D10. Why the probe exists

A 403 from Cosmos has two unrelated causes — the runner is not admitted by the firewall, or the
identity reached Cosmos and lacks a database-scope role — and they are indistinguishable from the
SDK error. Without the probe, a rehearsal exports everything and fails on the first upsert with an
error naming neither. `migration-probe.mjs` runs one `SELECT VALUE COUNT(1)` against `system` first and classifies
the failure. `system`, not `content`: the deploy identity holds container-scoped grants on `content`
and `blogs` for the healer, so those two answer on production even without the database-scope role
(run 32438525274 proved it). In runbook step 11 against production, `cause: rbac` on `system` is the
*expected* result — it is the proof that the production lock holds.

## Open questions (owner)

| # | Question | Decided at | Answer |
| --- | --- | --- | --- |
| Q1 | The fifteen `probe` entries (D4): which migrate, which are residue? Preflight 2026-08-21: the original ten are **empty**; the five new ones hold 7 documents between them and none has a reader | runbook step 8 | — (recommendation: drop all fifteen) |
| Q2 | Storage probes: `thumbnails/` (empty — drop), `content-submissions/` (3 objects), `designs/` (1): copy into `content` or drop? | runbook step 10 | — |
| Q2b | `covers/` is 3.10 GiB of the 3.17 GiB bucket — 1,011 AI/uploaded covers for 1,142 content documents. Copy all, or only covers still referenced by a document? | before step 10 copy | — (recommendation: copy all; referenced-only pruning is a later cleanup with the document set in hand) |
| Q3 | `published-images/` public on Azure? | before Go-Live | — |
| Q4 | Partition-key list (D3) signed? | before step 9 | — |
| Q5 | Scratch copy lifetime after sign-off? | step 12 | — |

## Evidence log

| Date | Step | Artifact / link | Result |
| --- | --- | --- | --- |
| 2026-08-20 | 1 | [PR #128](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/pull/128) — tooling, scratch.tf, workflow, docs | CI green |
| 2026-08-20 | 2 | SA `hcw-migration-reader`; provider `github-actions/providers/github-actions-hcw` (repo id 1268997852, `main` only); repo variables `GCP_*` | done |
| 2026-08-20 | 3 | Environment `data-migration`, reviewer `saulpatinojr`. Site-Main read token: **not yet** (needs the GitHub UI — App or PAT) | partial |
| 2026-08-20 | 4 | TFC `cosmos_scratch_enabled` / `storage_scratch_enabled` = true; applied: **86 add, 1 change, 0 destroy**; `set-github-variables.ps1` seeded the scratch variables and moved `COSMOS_ENDPOINT` to a variable | done |
| 2026-08-21 | 5 | [Run 32435842524](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/actions/runs/32435842524) `mode=preflight` — WIF proven; **8,064 documents, 8,004 to migrate**; exit 2 on five unmanifested collections (added as `probe`, PR #130). Summary artifact verified: counts only | gate loop |
| 2026-08-21 | 5 | [Run 32436854557](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/actions/runs/32436854557) `mode=preflight` after #130 — **exit 0**, no unmanifested collections, 8,064 / 8,004 / 60 | **pass** |
| 2026-08-21 | 7 | [Run 32437095217](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/actions/runs/32437095217) `mode=export-dry-run` — 8,023 documents across 62 collections (8,004 + 19 subcollection docs); warnings: `id-field-conflict` 60, **`id-collision` 0** | **pass** |
| 2026-08-21 | 9 | [Run 32437751076](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/actions/runs/32437751076) `mode=rehearse target=scratch` — Azure login via the `environment:data-migration` credential; probe reached `content` on Entra auth in 1.3 s; dry-run 8,023 across 62; **import 8,023/8,023, 0 failed**; reconciliation **62 containers, 0 missing, 0 extra, 0 field mismatches**. First pass, no retries. Summaries verified counts-only | **pass** |
| 2026-08-21 | 10 | [Run 32438131444](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/actions/runs/32438131444) `mode=storage-inventory` — **1,438 objects, 3.17 GiB** (`covers/` 1,011 objects / 3.10 GiB); exit 2 on three unmanifested prefixes: `database/{blogs,speakerevents}/` (13 objects, added as `migrate`), `content-submissions/` (3) and `designs/` (1) (added as `probe`). `thumbnails/`, `draft-images/`, `published-images/` are all empty | gate loop |
| 2026-08-21 | 11 | [Run 32438525274](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/actions/runs/32438525274) `mode=verify target=production` — **60 of 62 containers refused `executeQuery`** (no database-scope role); `content` and `blogs` readable through the healer's container grants and **empty** (0 of 1,142 / 0 of 242). Production is empty and locked. Found a probe flaw: it checked `content`, which the healer grant makes readable, so it said OK instead of `rbac` — probe moved to `system` | **pass** (run shows failed by design) |
