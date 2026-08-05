# Phase 4 — Data migration

**Status:** prepared, not executed. **Written:** 2026-08-05.
**Companions:** [Migration_Plan.md](../../Migration_Plan.md) §5 (the plan) and
[Architecture_Plan.md](../../Architecture_Plan.md) §5 (the target).

This document is the output of a review of `HybridCloudWorks/Site-Main` at commit `07f3123`
against the migration tooling in this repository. It records what the review found, the decisions
taken in response, and the runbook for executing the migration.

---

## 1. What the review found

The tooling that existed before this review — `scripts/migrate-firestore-to-cosmos.mjs`,
`scripts/verify-migration.mjs` and the Cosmos containers in `infra/main.tf` — was written against
an assumed data model. Checked against the real one, it had eight defects, four of which lose data
silently. "Silently" is the operative word: every one of them passes the document-count check that
was the only verification in place.

### 1.1 The migration would have locked every admin out — **critical**

`COLLECTION_MAP` did not contain `admins`.

`platform/firebase/firestore.rules:38` defines `isAdmin()` by reading the `admins` collection, and
line 74 explicitly denies all client access to it. It is the root of the entire authorisation model.
It was not migrated, and no count check would have noticed, because the collection was never
enumerated in the first place.

`admin_config` (ContentForge configuration) and `site_settings` were missing for the same reason.

### 1.2 Three of the fourteen mapped collections do not exist

`config`, `dashboard_stats` and `users` were in `COLLECTION_MAP` and had containers provisioned in
Terraform. `dashboard_stats` and `users` have **zero** `collection()` call sites anywhere in
Site-Main. `config` is worse — see 1.3.

Meanwhile roughly fifty collections that *do* exist were absent. `firestore.rules` declares 65
top-level `match` blocks.

### 1.3 `config` holds no documents — its data is in subcollections

`firestore.rules` matches `config/providers/{providerId}`, `config/tags/{tagId}` and
`config/settings/{settingId}`. The payload lives one level down, under three parent documents that
Firestore does not require to exist.

`firestore.collection('config').get()` therefore returns zero documents. The old script would have
migrated nothing, and `verifyCollection` would have compared `0 === 0` and printed a tick.

### 1.4 No subcollection was migrated at all

Beyond `config`, Site-Main has four more:

| Source path                          | Used by                                          |
| ------------------------------------ | ------------------------------------------------ |
| `content/{id}/versions`              | `VersionHistoryDialog.jsx`, publish pipeline e2e |
| `image_prompts/{pageDocId}/sets`     | `useImagePrompts.js:121,174`                     |
| `image_prompt_sets/{setName}/prompts`| `useImagePrompts.js:281`                         |
| `listen_and_learn/{setId}/episodes`  | `ListenAndLearnPage.jsx:245`                     |

Editor version history was going to be dropped on the floor.

Note the naming trap: `image_prompts/{id}/sets` cannot become a container called
`image_prompt_sets`, because that is already a *distinct* top-level collection. It becomes
`image_prompts_sets`.

### 1.5 Timestamp conversion only walked the top level

`transformDocument` iterated `Object.entries(data)` once. A Timestamp nested inside an object or an
array — `{meta: {audit: {updatedAt: Timestamp}}}` — was written to Cosmos as
`{_seconds, _nanoseconds}` and every date comparison on the far side silently stopped working.

This is exactly the defect Migration_Plan §5 flags as "the classic defect here", one level down from
where it was being guarded against.

### 1.6 A document's own `id` field could overwrite its identity

```js
docs.push({ _firestoreId: doc.id, id: doc.id, ...doc.data() });
```

The spread comes last. Any document carrying its own `id` field won, `_firestoreId` was then deleted
by the transform, and the original Firestore identity was gone. Two documents whose data `id` fields
matched would collapse into one on upsert.

### 1.7 Partition keys contradicted the data-access layer — **causes 404s at runtime**

`functions/src/lib/cosmos-client.js:60` reads:

```js
const { resource } = await container.item(id, partitionKey || id).read();
```

The partition key **defaults to the document id**, and no caller in `functions/src` passes an
explicit one. Every container partitioned on something else — `content` and `blogs` on
`/cloudProvider`, `certifications` on `/issuer`, `lab_jobs` on `/status`, `lab_agents` on
`/agentId`, `generated_content_images` on `/contentId`, `audits` on `/userId` — would have returned
404 for every point read.

`content` had a second, independent problem. Site-Main writes the provider under **two** field
names: `ContentReviewBrowser.jsx:91` reads
`item['Cloud Provider'] || item.cloudProvider || 'Unknown'`. Every document using the spaced form
would have fallen through to the `'unknown'` default partition.

### 1.8 `--collections` silently migrated everything

```js
const collectionsArg = args.find((a) => a.startsWith('--collections'));
const collectionsArgValue = collectionsArg ? args[args.indexOf(collectionsArg) + 1] : null;
```

`--collections=content` matches the `find`, so `collectionsArg` is truthy — but the value is read
from the *next* argv entry, which is `undefined`. `targetCollections` becomes `null`, and `null`
means "all". A run scoped to one collection became a full migration, with no warning.

### 1.9 Three sources of truth, all different

The container list was maintained independently in `COLLECTION_MAP` (14 entries),
`verify-migration.mjs` (8 entries) and `infra/main.tf` (13 containers). No two agreed.

---

## 2. Decisions taken

### 2.1 One manifest

`scripts/lib/migration-manifest.mjs` is now the only place a collection is declared. The migrator,
the verifier, the preflight and — via a generated `infra/cosmos-containers.json` — Terraform all
read it. `node scripts/generate-cosmos-container-spec.mjs --check` fails a build if the generated
file has drifted.

Each collection carries a **disposition**:

| Disposition  | Container? | Documents copied? | Meaning                                          |
| ------------ | ---------- | ----------------- | ------------------------------------------------ |
| `migrate`    | yes        | yes               | The default                                      |
| `reseed`     | yes        | no                | Seed data; a seeding script recreates it         |
| `regenerate` | yes        | no                | Cache; a scheduled job refills it                |
| `transient`  | yes        | no                | In-flight jobs and quota counters                |
| `probe`      | **no**     | no                | Declared in rules, no writer found — preflight decides |

Provisioning and migrating are separate questions. `lab_jobs` carries no data across but
`functions/src/functions/labs-http.js` writes it on every request, so the container must exist.

Current totals: **71 containers provisioned, 64 migrated**.

### 2.2 Every container is partitioned on `/id`

This is the one decision in this document that is **irreversible after the first data load** — a
Cosmos partition key path cannot be changed; you destroy the container and re-import.

The reasoning:

1. `cosmos-client.js` already assumes it (§1.7). Aligning infrastructure to the code that was
   already written is cheaper and less surprising than the reverse.
2. The dataset is ~1,100 small documents. There is no volume to spread. The only thing a partition
   key buys at this size is a cheap point read, which `/id` gives and a low-cardinality key does not.
3. The Firestore composite indexes describe the real query load — `(Live, scheduledPublishDate)`,
   `(type, Live, publishedAt)`. Neither filters on provider or owner, so a "natural" partition key
   fans out across partitions on the list queries *as well as* on the point reads.
4. It sidesteps the `'Cloud Provider'` / `cloudProvider` split entirely.

If the site grows past a few gigabytes in one container, revisit — but revisit before loading data,
not after.

### 2.3 The transform is faithful

It converts what Cosmos cannot store — Timestamp, GeoPoint, DocumentReference, Bytes, at any depth —
and satisfies Cosmos's own constraints on `id` and reserved properties. It does **not** rename,
normalise, default or drop business fields, including the `'Cloud Provider'` split. Reshaping data
mid-migration hides bugs on the far side; the API port handles the split the same way Site-Main's
`providerOf()` does today.

Original identity is always preserved as `firestoreId`, and `firestoreParentPath` for subcollection
documents. That is what makes a re-run idempotent and a reconciliation report auditable.

### 2.4 Export and import are separate commands

Migration_Plan §5 asks to "run it many times against a scratch Cosmos account before the real one".
One read-only export to JSONL on disk, then as many imports as you like — reproducible, diffable,
and no repeated production reads while a decision is still being argued over.

### 2.5 Verification checks fields, not just counts

`verify-migration.mjs` now does three things: count parity, **which specific ids** are missing or
extra, and a deep field-level comparison of a deterministic sample against the exported source.
A transform that drops a field passes a count check every time.

---

## 3. Open questions — resolve before cutover

| # | Question                                                                                              | Owner        | Blocks   |
| - | ----------------------------------------------------------------------------------------------------- | ------------ | -------- |
| 1 | Do `users`, `articles`, `newsletters`, `metadata`, `plaud_ingest`, `homepage_feeds`, `azure_landing_content` hold documents? All are `probe`. | Preflight run | Manifest |
| 2 | Does `blogs` ship at all? Migration_Plan §3.6. Currently migrated on the assumption that it does.       | Product      | Nothing — safe either way |
| 3 | Is `/id` accepted as the partition key for every container? §2.2. Irreversible after first load.        | Architecture | First Terraform apply |
| 4 | `admins` is the authorisation root. What replaces `firestore.rules` `isAdmin()` on Azure, and is it tested to at least the same coverage? Migration_Plan §8 calls this the most dangerous silent loss. | Architecture | Cutover |
| 5 | Any unmanifested collection the preflight turns up.                                                     | Preflight run | Manifest |

Questions 1 and 5 are answered by running the preflight, which needs a Firebase service-account key.
That is the first thing to do and it is entirely read-only.

---

## 4. Runbook

### Prerequisites

```bash
cd scripts
npm install

export GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json
export COSMOS_ENDPOINT=https://<account>.documents.azure.com:443/
export COSMOS_DATABASE=hybridcloudworks
# For a scratch account with no RBAC yet:
export COSMOS_KEY=<key>
# For the real account, omit COSMOS_KEY and `az login` — cosmos-client.js runs
# on managed identity and requires that COSMOS_KEY is not set.
```

### Step 1 — measure the source (read-only)

```bash
node scripts/preflight-firestore-inventory.mjs
```

Writes `reports/preflight-inventory.json`. Exits non-zero if it finds a collection the manifest does
not know about. Resolve open questions 1 and 5 from its output and update the manifest before going
further. Replace the estimated counts in Migration_Plan §5 with what this measures.

### Step 2 — provision the containers

```bash
node scripts/generate-cosmos-container-spec.mjs
cd infra && terraform plan
```

Read the plan carefully. Seven containers change partition key, which Terraform executes as
destroy-and-recreate. **Safe only while they are empty.** Do this before any data load.

### Step 3 — export (read-only)

```bash
node scripts/migrate-firestore-to-cosmos.mjs --export --out export/
```

One JSONL file per container, plus `reports/migration-export.json`. Warnings about rewritten ids,
`id`-field conflicts and id collisions surface here, while the source is still available to
disambiguate. An id collision fails the run.

### Step 4 — rehearse against a scratch account

```bash
node scripts/migrate-firestore-to-cosmos.mjs --import --from export/ --dry-run
node scripts/migrate-firestore-to-cosmos.mjs --import --from export/
node scripts/verify-migration.mjs --from export/ --sample 25
```

Repeat until clean. Imports are idempotent, so re-running converges rather than duplicating.

### Step 5 — the real load

Same three commands against the production Cosmos account, then archive
`reports/reconciliation.json` as the migration record.

### Step 6 — re-seed and let caches refill

`tool_service_catalog` is re-seeded; `rss_cache` and `tool_service_cache` refill on their scheduled
jobs. Confirm each one has actually run before decommissioning anything in GCP — Migration_Plan §6
is right that a short soak misses exactly this.

---

## 5. What is deliberately not migrated

| Collection             | Disposition  | Why                                              |
| ---------------------- | ------------ | ------------------------------------------------ |
| `rss_cache`            | `regenerate` | Refilled by the scheduled fetch                  |
| `tool_service_cache`   | `regenerate` | Refilled by the scheduled refresh                |
| `tool_service_catalog` | `reseed`     | Seed data; re-seed rather than import drift      |
| `lab_jobs`             | `transient`  | In-flight job records, worthless after cutover   |
| `lab_public_quota`     | `transient`  | Per-uid rate-limit counters; let them reset      |
| `tool_export_quota`    | `transient`  | Per-user rate-limit counters; let them reset     |
| `tool_ai_plan_quota`   | `transient`  | Per-user rate-limit counters; let them reset     |

All seven still get a container — the runtime writes to them from the first request.

---

## 6. Files

| Path                                       | Purpose                                              |
| ------------------------------------------ | ---------------------------------------------------- |
| `scripts/lib/migration-manifest.mjs`       | Single source of truth for collections               |
| `scripts/lib/firestore-transform.mjs`      | Firestore → Cosmos document conversion               |
| `scripts/lib/cli.mjs`                      | Argument parsing, logging, Cosmos connection, retry  |
| `scripts/lib/firestore-transform.test.mjs` | 36 tests over the transform, manifest and CLI parser |
| `scripts/preflight-firestore-inventory.mjs`| Measures the source; read-only                       |
| `scripts/migrate-firestore-to-cosmos.mjs`  | Export and import                                    |
| `scripts/verify-migration.mjs`             | Reconciliation with field-level checks               |
| `scripts/generate-cosmos-container-spec.mjs`| Renders `infra/cosmos-containers.json`              |
| `infra/cosmos-containers.json`             | Generated — read by `infra/main.tf`                  |

Run the tests with `cd scripts && npm test`.
