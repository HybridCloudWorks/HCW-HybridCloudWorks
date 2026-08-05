# Migration Plan — Personal-Site_HCW → HCW-HybridCloudWorks (Azure)

**Audience:** engineers executing the migration. **Status:** plan. Written 2026-07-30.
**Companion:** [Architecture_Plan.md](Architecture_Plan.md) — the target and why.

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
| 2     | Stand up Azure infrastructure            | Target repo   | Terraform applied to a non-production subscription, costed      |
| 3     | Port the API and workers                 | Target repo   | All 117 endpoints answering, parity-tested                      |
| 4     | Migrate data                             | Scripts       | 1,395 documents in Cosmos, reconciled                           |
| 5     | Cutover                                  | DNS           | Live on Azure, Firebase warm                                    |
| 6     | Decommission and archive                 | Both          | GCP down, this repo archived                                    |

Phases 1 and 2 are independent and should run in parallel by different people.

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

---

## 5. Phase 4 — data migration

> **Updated 2026-08-05 after reviewing Site-Main @ `07f3123`.** The tooling and the collection
> inventory below were checked against the source repository for the first time. The headline
> numbers survived; the collection list did not. Full findings, decisions and runbook:
> **[docs/data-migration/README.md](docs/data-migration/README.md)**.
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

**One irreversible decision needs sign-off before the first Terraform apply:** every Cosmos
container is now partitioned on `/id`. `functions/src/lib/cosmos-client.js` already defaults the
partition key to the document id and no caller overrides it, so the previous keys (`/cloudProvider`,
`/issuer`, `/status`, `/userId`, …) would have returned 404 on every point read. A partition key
path cannot be changed once the container holds data. Rationale in
[docs/data-migration/README.md §2.2](docs/data-migration/README.md).

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
