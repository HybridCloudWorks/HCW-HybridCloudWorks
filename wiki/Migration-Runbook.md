# Migration Runbook

The operator sequence for moving the live site's data from Firebase onto the Azure platform, from
"tooling merged" to "rehearsal verified on the scratch account". Each step names who runs it, what it
produces, and what the evidence has to show before the next step starts.

Decisions behind the steps — partition keys, dispositions, the public-repository rule, why the
rehearsal uses a keyless account — live on [Phase-4-Data-Migration](Phase-4-Data-Migration).
The phase-level picture is [Migration-Plan](Migration-Plan) §5.

**Who:** **[CI]** a `Migrate data` workflow run · **[OP]** the operator at a terminal · **[OWN]** the
owner, deciding.

> **Archived 2026-08-24 — none of this runs any more.** The `Migrate data`
> workflow and the five scripts it dispatched were deleted in `59e471b`; the
> rehearsal estate is torn down and the deploy identity's production-write
> grants are revoked. Every command below now fails at the first step. The
> sequence is kept as the record of how the migration was actually performed
> and what each gate proved — the Wiki sidebar files it under *Historical* for
> the same reason. It is evidence, not a current procedure, and it is not a
> route back to Firebase.

## Rules that apply to every step

1. **Nothing here writes to production.** Every workflow mode is read-only against Firestore and
   GCS. The two modes that write to Azure (`rehearse`, `storage-rehearse`) refuse `target=production`,
   and the deploy identity holds no write role on production until `migration_writer_enabled` is
   flipped in Terraform — two independent locks.
2. **No artifact ever contains data.** The repository is public; job logs and artifacts are
   world-readable. Only `*.summary.json` files (counts, container names, warning tallies) are
   uploaded, with 1-day retention. Full reports stay on the runner. If a summary ever shows an `id`,
   `sample` or `preview` key, stop and treat it as an incident.
3. **No stored credentials.** Firestore/GCS through GCP Workload Identity Federation; Azure through
   the `environment:data-migration` federated credential. There is no service-account key and no
   `COSMOS_KEY`; the scripts refuse both if present.
4. **One run at a time.** The workflow's concurrency group is `data-migration`, never cancelled
   mid-run.

## The sequence

### 1. [CI via PR] Tooling, infrastructure and docs land on `main`

Gates: `iac-validate`, `scripts (migration)`, `functions`, `frontend`, repository policy.
Evidence: the merged PR. Nothing in it creates Azure resources — `cosmos_scratch_enabled` and
`storage_scratch_enabled` default to `false`.

### 2. [OP, GCP] Read-only identity and the WIF binding

In the Firebase project, create a dedicated **read-only** service account — *not* Site-Main's deploy
account — with `roles/datastore.viewer` and `roles/storage.objectViewer` on the one bucket. Bind
`roles/iam.workloadIdentityUser` for
`principalSet://…/attribute.repository/HybridCloudWorks/HCW-HybridCloudWorks` on the existing
Workload Identity pool. If the provider's attribute condition pins `assertion.repository` to
Site-Main, widen it to both repositories.

Evidence: repository variables `GCP_WORKLOAD_IDENTITY_PROVIDER` (the full provider resource name)
and `GCP_SERVICE_ACCOUNT` (the email), set through
[`scripts/set-github-variables.ps1`](../../scripts/set-github-variables.ps1) wave 1.

### 3. [OP, GitHub] Environment and the remaining variables

- Environment `data-migration` with a required reviewer. The name is an OIDC subject — exact.
- `COSMOS_ENDPOINT` becomes a repository **variable** (it is a public URL); delete the secret of the
  same name.
- A read token for Site-Main: an org GitHub App with `contents: read` on Site-Main only
  (`SITE_MAIN_APP_ID` variable + `SITE_MAIN_APP_PRIVATE_KEY` environment secret), or as a fallback a
  fine-grained PAT as `SITE_MAIN_READ_TOKEN` with its 90-day expiry recorded in Required-Inputs §4.3.

Evidence: `gh variable list` and `gh secret list --env data-migration` match Required-Inputs §4.2–4.4.

### 4. [OP, HCP Terraform] Create the scratch estate

Set `cosmos_scratch_enabled = true` and `storage_scratch_enabled = true` in the `hcw-azure`
workspace. The plan must show roughly 85 adds (resource group, Cosmos account, database, 72
containers, role assignments, storage account, 6 containers) and **zero** destroys — nothing carrying
`prevent_destroy` is touched. Apply, then re-run `set-github-variables.ps1` so wave 2 picks up
`COSMOS_SCRATCH_ENDPOINT`, `STORAGE_SCRATCH_ACCOUNT` and `SCRATCH_RESOURCE_GROUP` from the outputs.

Evidence: the TFC run link; `terraform output cosmos_scratch_endpoint` non-null.

### 5. [CI] `mode=preflight`

Read-only Firestore inventory. Produces `preflight-inventory.summary.json` — the first real document
counts since 2026-07-30. Exit 2 means a collection exists in Firestore that the manifest does not
name at all; the fix is a manifest entry (`migrate`, `regenerate`, `reseed`, `transient` or
`probe`), never a workflow change. The fifteen `probe` entries are reported with their counts and do
not fail the run — they are the input to step 8.

### 6. [CI] `mode=inventory-gate`

Site-Main's own `scripts/inventory-collections.mjs --diff` against our manifest, at a recorded
Site-Main SHA. Produces `inventory-diff.summary.json` and the diff text (collection names only —
safe to publish). Must pass before any import.

### 7. [CI] `mode=export-dry-run`

Exports every migrating collection to the runner's temp directory and discards it. Proves WIF end to
end and the Firestore → Cosmos transform on real documents. `migration-export.summary.json` must
show zero `id-collision` warnings; any other warning code is a tally to read, not a blocker.

### 8. [OWN] Decide the probes

From the step 5 and 7 numbers, decide each of the fifteen `probe` entries: content the site reads
(→ `migrate`, which adds a container to the spec — a Terraform change) or residue (→ `transient`, or
drop the entry). `azure_architectures` and `azure_frameworks` are the two most likely to be real;
the five `social_*` collections and `users` the most likely to be empty. Same question for the
`thumbnails/` storage prefix in step 10. Record the answers on the Phase-4 page.

### 9. [CI] `mode=rehearse target=scratch` — repeat until clean

Export → import `--dry-run` → import → verify, all on one runner. Produces
`connectivity-probe.json`, `migration-import.summary.json`, `reconciliation.summary.json`. Done when
`reconciliation.summary.json` shows `failed: 0` on every container.

Expected first-run failures and what they mean:

| Symptom | Cause | Fix |
| --- | --- | --- |
| probe: `cause: rbac` | role assignment still propagating (up to ~15 min after the apply) | wait, re-run |
| probe: `cause: firewall` | runner not admitted — `cosmos_allow_azure_datacenter_ips` is off | it must be on for GitHub-hosted runners |
| import: 429 tallies | serverless RU throttling | re-run with `--concurrency 2` (the script's retry usually absorbs it) |
| verify: `missing` on one container | partial import after a 429 storm | re-run; import is idempotent (upsert) |

### 10. [CI] `mode=storage-inventory` → [OWN] → [CI] `mode=storage-rehearse` ×2

Inventory lists the GCS bucket by top-level prefix and exits 2 on any prefix the storage manifest
does not name. Owner confirms `published-images/` (public in Firebase; `content` is **not** a public
container here — a disclosure decision for the API, not the migration) and `thumbnails/`.
Then copy + verify into scratch storage **twice**: the second run must report `unchanged == total`,
which is the idempotency proof.

### 11. [CI] `mode=verify target=production`

Read-only on both sides. Expected: the probe on `system` reports **`cause: rbac`** (the identity
reached Cosmos and was refused — proving the production lock); the reconciliation shows `content` and
`blogs` readable with **0 documents** (the healer's two container-scoped grants) and every other
container refused. The run shows as *failed* — that is the evidence, not a defect. This is the last piece of evidence for the phase: production is still empty and still
locked.

### 12. [OWN] Sign-off

Record on the Phase-4 page: the summary set from steps 5–11, the TFC run links, and the decision on
the scratch data copy's lifetime — flip the variables off (destroys the copy), or keep it for the
production dress rehearsal. Write the date either way.

## The production import

Same workflow, same evidence set, `target=production`. Opened by two locks in this order and closed
in reverse:

1. **[OWN, HCP Terraform]** `migration_writer_enabled = true` → apply. Plan must show exactly **three
   adds** — the database-scope Cosmos role, Storage Blob Data Contributor and Storage Account
   Contributor on `stsiteprodcus01` — and nothing else.
2. **[OP, GitHub]** repository variable `PRODUCTION_IMPORT_ENABLED = true`. The workflow guard reads it.
3. **[OWN]** Write-freeze on Site-Main's admin for the duration of steps 4–6 (minutes). Anything
   written in Firestore after the export starts is not on Azure until the next run — which is safe
   to repeat: the import is an upsert.
4. **[CI]** `mode=rehearse target=production` — export → dry-run → import → verify. Expect the probe on
   `system` to answer (the role is now there), then the same shape as the scratch run:
   `failed: 0` on 62 containers.
5. **[CI]** `mode=storage-rehearse target=production` twice — `copied = 1438` then `unchanged = 1438`.
6. **[CI]** `mode=verify target=production` — read-only reconciliation. Expect `social_posts` and
   `lab_agents` to drift within minutes (Site-Main's 5-minute Publer sync and the VPS agent's
   heartbeat keep writing them — Phase-4 page D12); everything else must match. `failed: 0` on all
   62 is reachable only in the cutover delta run, after those two writers are paused.
7. **[OP]** Unset `PRODUCTION_IMPORT_ENABLED`. Leave the Terraform switch on only if a delta run is
   planned before cutover; otherwise flip it back and apply (three destroys).

Not part of this run, by design: the `admins` uid→oid remap (waits on the Entra registrations —
the documents carry `firebaseUid` meanwhile), media-URL re-pointing (Firebase Storage stays warm),
`cp_sortDate` (T-508), the regenerate/reseed jobs and the timers (Phase 3), the Telegram webhook
(cutover, §6). The partition-key window closes at step 4 of this list.

## Local equivalents

Every mode has a laptop form, keyless on both clouds:

```text
gcloud auth application-default login      # same viewer roles as the WIF identity
az login                                   # an identity with the same Cosmos role on scratch
cd scripts && npm ci
node preflight-firestore-inventory.mjs
node migrate-firestore-to-cosmos.mjs --export --out ./export
COSMOS_ENDPOINT=https://cosmos-site-sbx-cus.documents.azure.com:443/ node migration-probe.mjs
COSMOS_ENDPOINT=… node migrate-firestore-to-cosmos.mjs --import --from ./export --dry-run
```

`--show-samples` is available locally and refused in CI. The laptop's IP has to be in
`cosmos_admin_ip_rules` for the Cosmos steps — one window admits both accounts.
