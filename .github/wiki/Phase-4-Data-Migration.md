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
- **probe** (10) — named so the preflight does not flag them as unmanifested, but not provisioned as
  containers and not migrated until someone decides: `articles`, `metadata`, `users`, the five
  `social_*` collections (`social_workspaces`, `social_libraries`, `social_library_items`,
  `social_schedule_slots`, `social_analytics`), and the two seeder-written ones added 2026-08-20,
  `azure_architectures` and `azure_frameworks`. Runbook step 8 decides each from its measured count:
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
`speakerevents/` → same-named container, prefix stripped; `database/certifications/` →
`certifications` under `database/`; `image-gallery/`, `character/`, `listen-and-learn/`,
`draft-images/`, `published-images/` → `content`, prefix preserved. Skipped: `articles/` (90-day
scraped images the RSS job regenerates — note the Azure lifecycle rule for it is inert until the
scraper writes here) and `uploads/` (per-user temp keyed by Firebase uid). Probe: `thumbnails/`.

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
error naming neither. `migration-probe.mjs` runs one `SELECT VALUE COUNT(1)` first and classifies
the failure. In runbook step 11 against production, `cause: rbac` is the *expected* result — it is
the proof that the production lock holds.

## Open questions (owner)

| # | Question | Decided at | Answer |
| --- | --- | --- | --- |
| Q1 | The ten `probe` entries (D4): which migrate, which are residue? | runbook step 8 | — |
| Q2 | `thumbnails/`: copy or drop? | runbook step 10 | — |
| Q3 | `published-images/` public on Azure? | before Go-Live | — |
| Q4 | Partition-key list (D3) signed? | before step 9 | — |
| Q5 | Scratch copy lifetime after sign-off? | step 12 | — |

## Evidence log

| Date | Step | Artifact / link | Result |
| --- | --- | --- | --- |
| 2026-08-20 | 1 | [PR #128](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/pull/128) — tooling, scratch.tf, workflow, docs | CI green |
| 2026-08-20 | 2 | SA `hcw-migration-reader`; provider `github-actions/providers/github-actions-hcw` (repo id 1268997852, `main` only); repo variables `GCP_*` | done |
| 2026-08-20 | 3 | Environment `data-migration`, reviewer `saulpatinojr`. Site-Main read token: **not yet** (needs the GitHub UI — App or PAT) | partial |
| 2026-08-20 | 4 | TFC `cosmos_scratch_enabled` / `storage_scratch_enabled` = true; plan = **86 add, 1 change, 0 destroy** | apply pending |
