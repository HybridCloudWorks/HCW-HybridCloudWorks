# CHANGELOG

Completed features, fixes, enhancements, security fixes, and released changes.

**Classification (Code Review SOP, CODE_REVIEW_PROMPT.md v1.0, Phase 10):** this
file records **completed work only**. Outstanding engineering work belongs in
[TODO.md](TODO.md); human-resolvable blockers in [REVIEW.md](REVIEW.md);
required inputs in [CHECKLIST.md](CHECKLIST.md).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project has not cut a tagged release; entries are grouped under
`[Unreleased]` and reference the pull request that landed them.

---

## [Unreleased]

### Security

- **The data-migration workflow can no longer publish production data.** The
  repository is public, and `migrate-data.yml` uploaded `scripts/reports/` —
  document ids and 240-character field samples — as a workflow artifact, while
  the import dry-run printed document samples to the job log. Every migration
  script now writes a `*.summary.json` (counts, container names, warning
  tallies) beside its full report; only summaries are uploaded, with 1-day
  retention; the export lives in `$RUNNER_TEMP` and dies with the runner;
  `MIGRATION_CI=1` makes `--show-samples` an error; and the upload step refuses
  any non-summary JSON it finds.
- **No stored credential on either cloud for the migration.** Firestore and
  GCS reads authenticate through Workload Identity Federation
  (`google-github-actions/auth` + `applicationDefault()`); `connectFirestore()`
  refuses a `service_account` key file in CI, `connectCosmos()` refuses to
  start if `COSMOS_KEY` is set, and `FIREBASE_SERVICE_ACCOUNT_JSON` is retired
  before it was ever provisioned. The `azcopy` storage script — whose GCS
  source accepts only a downloaded key — was replaced by a Node copier on the
  same federated credentials.
- **Production Cosmos is locked by RBAC, not by a YAML guard.** The deploy
  identity's database-scope Data Contributor and blob-write roles on
  production exist only behind `migration_writer_enabled` (default `false`);
  the workflow's refusal of `target=production` for write modes is the second
  lock, not the only one.
- **Every GitHub Actions reference pinned to a commit SHA** — 35 `uses:`
  lines across all 12 workflows. A tag is a mutable pointer: whoever controls
  the action's repository can move `@v4` to different code at any time, and
  the March 2026 Aqua incident that broke this repository's Trivy step was
  exactly that. CodeQL's Actions pack raises one alert per unpinned
  third-party reference, so this closes that class of finding as well as the
  real supply-chain exposure. Each pin carries the version it was cut from as
  a trailing comment (`@ff2f1c6… # v4`), because a bare 40-character hex
  string tells a reviewer nothing; Dependabot's `github-actions` ecosystem
  was already configured and keeps SHA pins current the same way it keeps
  tags current. The repository standard already required this — one
  `actions/checkout` reference had been pinned and the other eleven had not.

### Fixed

- **The public content list failed the moment `PUBLIC_LIST_SQL_ORDER` went
  live** — Cosmos: "The index path corresponding to the specified order-by
  item is excluded". Computed properties are not covered by the `/*`
  wildcard (the comment in `public-reads.js` said they were); `/cp_sortDate/?`
  is now an explicit included path on `content` and `blogs`, applied live
  through ARM with the property preserved and carried in the generated spec so
  Terraform agrees. 40 minutes of 500s on the list endpoint, 2026-08-21.
- **New functions were not registered after the deploy** — SyncTriggers
  failed on a keyless `AzureWebJobsStorage` connection string the deploy
  leaves behind (the same cause as the 2026-08-20 every-route-404). 83
  deployed, 80 registered; `enqueueJob`, `getJob` and the job worker did not
  exist until the setting was deleted and triggers re-synced by hand.
  `deploy-functions.yml` now does both after every deploy and fails if the
  registered count is zero.
- **`cp_sortDate` is live on `content` and `blogs`** (healer run 32448029469,
  2026-08-21, first successful run on this estate) and the healer workflow can
  now be dispatched with `mode=inspect` to check the precondition for
  `PUBLIC_LIST_SQL_ORDER=1`, which `infra/main.tf` now sets — the public
  content list asks Cosmos for the newest N rather than an arbitrary N. T-206's
  final step. The custom role the healer needs is created once by the owner
  from `infra/roles/cosmos-container-writer.json` and consumed by data source;
  the Terraform identity deliberately cannot define roles (#137).
- **The healer can now actually heal.** `heal-computed-properties.yml` had never
  succeeded on this estate: `cp_sortDate` was absent from both `content` and
  `blogs` on 2026-08-21 with 1,142 documents in `content`. Setting
  `computedProperties` is a control-plane operation, and the SDK's
  `container.replace()` sends it to the data plane, which Cosmos refuses with
  an AAD token regardless of roles. `--apply` now does an ARM PUT on the
  container resource (polling the async operation and re-reading to confirm),
  authorized by a new custom role — SQL container read + write on the one
  account, nothing else; not "Cosmos DB Operator", which is
  `databaseAccounts/*` minus keys. `buildArmBody()` strips the read-only keys
  and is unit-tested. New output `cosmos_resource_group` → variable
  `COSMOS_RESOURCE_GROUP` (T-508).
- **`deploy-functions.yml`'s storage window now survives a same-region
  runner** (T-509): the same default-action Allow/Deny bracket
  `migrate-data.yml` gained in #134, with the Deny restored first and verified.
- **`heal-computed-properties.yml` still read `secrets.COSMOS_ENDPOINT`** after
  the value moved to a repository variable and the secret was deleted
  (2026-08-20); its next run failed with "COSMOS_ENDPOINT is not set". Now
  `vars.COSMOS_ENDPOINT`. The #128 changelog entry said both consuming
  workflows had been switched; only `migrate-data.yml` had.
- **`preflight-firestore-inventory.mjs` referenced `FIRESTORE_PROJECT_ID` without
  importing it.** Introduced when the Firestore connection moved into
  `connectFirestore()`; `node --check` and the 65 tests all passed because an
  undefined identifier is a runtime error on a line no test reaches. The
  first `mode=preflight` dispatch from `main` (run 32435060952, 2026-08-21)
  found it — after proving the GCP Workload Identity Federation chain end to
  end, which is the part that could not be tested locally. Fixed, and
  `scripts/` now has an ESLint config with `no-undef` as an error, run by
  the `scripts (migration)` CI job; a sweep of every script found no other
  instance.
- **`migrate-data.yml` carried `COSMOS_KEY` and `COSMOS_DATABASE:
  hybridcloudworks`.** Key auth is disabled on the account and the database is
  `hcw`, so every import would have failed — with an error naming neither.
  Both removed; the workflow also lacked `id-token: write`, so it had no OIDC
  path to either cloud.
- **Eleven `moved` blocks removed from `infra/main.tf`.** Verified no-ops:
  the centralus rebuild recreated every container from the spec while all
  were empty, and `terraform state list` shows only the `for_each` form. A
  three-line note records that the partition-key change happened through the
  rebuild.
- **Stale counts and comments.** `main.tf`'s partition-key comment (67 on
  `/id` and five exceptions, not 62 and four); the `cosmos_database_name`
  comment (the scripts default to `hcw`, not `hybridcloudworks`);
  `cosmos-client.js` (67 of 72, not 66 of 71); and the storage lifecycle rule
  for `articles/` is now documented as inert — Azure matches
  `<container>/<blob>` and no `articles` container exists.
- **`set-github-variables.ps1` and REVIEW §4.2 omitted `FUNCTION_APP_NAME`**,
  which is set and consumed by `deploy-functions.yml`.
- **`Azure/functions-action@v2` does not exist.** Found while resolving tags
  to SHAs: that action's newest tag is `v1.5.7` and its release branch is
  `releases/v1`, so `deploy-functions.yml` carried a reference that resolves
  to nothing and would have failed with "Unable to resolve action" the first
  time the workflow was enabled. Pinned to `v1.5.7`. The workflow is still
  `if: false`, which is why no run had ever surfaced it.

- **`frontend/.env.example` rewritten against the real environment surface**
  (T-403). `VITE_ENTRA_API_SCOPE` was required and undocumented — without it
  every token is acquired for no scope, so sign-in succeeds and every API call
  fails on audience. The file meanwhile documented `VITE_OWNER_ADMIN_EMAIL` /
  `_UID`, which nothing reads, and carried Firebase secret-set instructions for
  decommissioned tooling. Rewritten against the actual `import.meta.env`
  references.

- **`queryDocs` does not discard the continuation token** (T-311) — recorded
  because the opposite was asserted in review, and a wrong finding costs more
  than none. `fetchAll()` consumes the token rather than dropping it: the SDK's
  `toArrayImplementation` loops `while (hasMoreResults())`, accumulating every
  page. No change was made because none was needed.

### Added

- **AI router** (`functions/src/lib/ai/router.js`, T-322 §4.4) — ported from
  Site-Main's `ai-model-router.js` with the provider model the owner chose on
  2026-08-21: **a provider is on when its key is present.** Anthropic, OpenAI
  and Gemini (public API by key; Vertex dropped — ADC is a GCP identity the
  app cannot hold), resolved in that order or pinned by
  `CONTENTFORGE_AI_PROVIDER`; an unresolved Key Vault reference counts as no
  key; no key → `AI_NOT_CONFIGURED` with a sentence naming the three
  secrets. `fetch` instead of axios; purpose → model table, JSON repair
  round trip, retry on 408/429/5xx, usage capture with cost estimates and
  the Anthropic prompt-cache marker all kept. 15 tests, none touching the
  network; the upstream cost tests came across.
- **`fetch-rss-feeds` — the first real platform job** (T-322), ported from
  Site-Main's `processRssFeeds`: 20 feeds across 8 providers through
  `rss-parser`, one `rss_cache` document per feed with `items[]` capped at 20
  on write (T-319's write-time cap), new `content` drafts through the
  existing four-stage dedup (≤ 10 per feed), and the `homepage_feeds/latest`
  round-robin aggregate. The admin "RSS Fetch" button enqueues it via
  `runJob()` instead of calling `fetchRssFeedsManual` (which never existed
  here); the `syncRssFeeds` timer stub now runs the same ingest every two
  hours behind its flag. TLS failures skip the feed with the reason recorded;
  one feed failing never abandons the sweep. 17 new tests. Not ported: the
  Telegram alert on feed errors — errors are in the job result.
- **Platform jobs — the pattern for every handler over Flex Consumption's
  230 s HTTP cap** (T-322 scaffold). `functions/src/lib/jobs.js`: a job-type
  registry, `POST /api/enqueueJob` (editor; type allowlist, per-type payload
  cap; 202 + jobId; message to Storage Queue `platform-jobs` through an output
  binding on the identity-based host connection), `GET|POST /api/getJob`
  (viewer), and a queue-triggered worker that claims with an etag-conditioned
  replace — at-least-once delivery never runs a job twice — and records
  `succeeded` / `failed` / `timeout` without rethrowing into the queue. New
  `jobs` container (30-day TTL, indexed like `lab_jobs`). Client:
  `frontend/src/lib/jobs.js` `runJob()` enqueues and polls with the Labs
  backoff. Built-in type `noop`. 14 new functions tests, 5 frontend tests; the
  route inventory now asserts the worker is the only queue trigger.
- **`infra/scratch.tf` — the migration rehearsal estate.** `cosmos-site-sbx-cus`
  (serverless, keys **off**, the same firewall shape, the same `hcw` database
  and the same 72 containers from the same generated spec) and
  `stsitesbxcus01` (the five content containers plus a private
  `migration-reports`) in their own resource group `rg-db-site-sbx-cus`,
  created only while `cosmos_scratch_enabled` / `storage_scratch_enabled` are
  true and destroyed when they are not. Mirrors production's posture on
  purpose: a key-authenticated rehearsal against an open account passes while
  proving nothing about the `DefaultAzureCredential` + RBAC path production
  takes. Outputs via `one()`; `set-github-variables.ps1` wave 2 seeds
  `COSMOS_SCRATCH_ENDPOINT`, `STORAGE_SCRATCH_ACCOUNT` and
  `SCRATCH_RESOURCE_GROUP` from them, and leaves them alone while null.
- **`scripts/migration-probe.mjs`.** One `SELECT VALUE COUNT(1)` that runs
  before the export and classifies a Cosmos 403 as `firewall` or `rbac` —
  two unrelated causes the SDK error does not distinguish, and which would
  otherwise surface only on the first upsert after a full export.
- **`scripts/migrate-storage-to-blob.mjs` + `scripts/lib/storage-manifest.mjs`.**
  Manifest-driven GCS → Blob `--inventory | --copy [--dry-run] [--overwrite] |
  --verify` on `@google-cloud/storage` + `@azure/storage-blob`, idempotent by
  `gcsmd5` metadata, carrying `contentType` / `cacheControl`, with a verify
  that compares counts, bytes, every object's MD5 and a deterministic
  byte-for-byte sample. `--inventory` exits 2 on an unmanifested prefix,
  mirroring the Firestore preflight. A vitest suite asserts every target
  container is one of the five Terraform names. Replaces
  `migrate-storage-to-blob.sh`.
- **Wiki pages `Migration-Runbook` and `Phase-4-Data-Migration`.**
  Referenced from eleven places (README, the plan, `_Sidebar`, the workflow,
  the manifest header); neither existed. The runbook is the twelve-step
  operator sequence with the evidence each step produces; the Phase-4 page is
  the decision log.
- **`WEBSITE_TIME_ZONE = "America/Chicago"` on the Function App.** Eight of
  Site-Main's sixteen schedules are declared in that zone; NCRONTAB on Linux
  evaluates in UTC unless told otherwise.
- **`storage_resource_group` output**, pairing with `storage_account` the way
  `web_resource_group` pairs with `functions_storage_account` — what
  `migrate-data.yml` scopes its per-run firewall window to.
- **The HCP Terraform → Azure bootstrap, which existed nowhere.**
  `infra/providers.tf` declares the `azurerm` provider with no credential —
  correct, because runs execute under HCP Terraform dynamic provider
  credentials — but the identity those credentials assume has to exist
  first, and nothing in this repository could create it. `infra/oidc.tf`
  creates the *GitHub Actions* identity, which only exists after a
  successful apply. Terraform cannot create the credential Terraform
  authenticates with. A repository-wide grep for `ARM_CLIENT_ID`,
  `TFC_AZURE_*` and `app.terraform.io` across `.tf`, `.yml` and `.md`
  returned nothing: the first apply had no documented path to authenticate,
  and the gap was invisible to file-by-file review because every individual
  file was correct and only the join between them was missing.

  `scripts/bootstrap-terraform-oidc.ps1` closes it. It creates
  `rg-hcw-bootstrap`, the `id-hcw-terraform` user-assigned managed identity,
  two federated credentials against `https://app.terraform.io` — one per run
  phase, because Entra matches token subjects exactly and case-sensitively
  with no wildcards, so a single credential leaves every apply failing at
  authentication while every plan succeeds — and Contributor plus Role Based
  Access Control Administrator at subscription scope (Contributor cannot
  create the role assignments `infra/` declares; RBAC Administrator cannot
  grant Owner, so the identity cannot escalate itself).

  A managed identity rather than an app registration, for the reason
  `infra/oidc.tf` already documents: app registrations need Application
  Administrator in Entra, which Azure Owner does not grant. The identity is
  deliberately **outside Terraform state**, in its own resource group —
  Terraform managing the credential it authenticates with means a destroy or
  a bad plan locks the workspace out of the subscription with no way back.

  The script is idempotent and preflights before it proposes anything: CLI
  present, signed in, tenant matches, subscription visible, role-assignment
  rights held, `Microsoft.ManagedIdentity` registered. Sign-in is performed
  by the script rather than demanded of the operator — being signed in to a
  different directory is the normal state for anyone working across tenants,
  so it runs `az login --tenant` itself and re-reads the account afterwards,
  because a directory switch also changes which subscriptions are visible.
  `-DeviceCode` covers sessions with no browser of their own (SSH,
  containers, Cloud Shell) and the case where the browser keeps reusing the
  wrong cached account; the script falls back to it automatically when the
  interactive flow fails, since that failure is environmental — no display,
  no loopback — more often than it is a credential problem. It handles the
  fresh-tenant case explicitly — a Global Administrator holds no Azure RBAC
  by default, which produces errors that suggest the wrong fix, so
  `-ElevateAccess` takes the documented one-time root-scope elevation, grants
  Owner on the target subscription, and removes the root grant again.

  Documented in Deployment Runbook §0 (which now tables the two OIDC
  handshakes side by side — confusing them strands the operator hunting for a
  `CLIENT_ID` that does not exist until after the first apply), CHECKLIST §8
  (the four workspace environment variables, contractual and exempt from the
  2-word rule), and REVIEW §4.0. The `iac-repo-standardizer` agent and the
  IaC Repository Standard both gained a **bootstrap identity** section making
  this the first thing audited on any repository, since the failure
  generalizes to every credential-free IaC repo.

### Changed

- **`migrate-data.yml` rewritten.** Dispatch-only; `id-token: write`;
  `environment: data-migration`; modes `preflight | inventory-gate |
  export-dry-run | rehearse | verify | storage-inventory | storage-rehearse`
  with `target` ∈ `scratch` (default) | `production` and a hard refusal of
  write modes against production. Step order is a correctness constraint:
  `npm ci`, the Site-Main checkout and the Cosmos probe all run before
  `google-github-actions/auth`, because the GitHub OIDC token it exchanges
  lives five minutes. Per-run storage firewall window with `always()` cleanup,
  mirroring `deploy-functions.yml`. `COSMOS_DATABASE: hcw`. Inputs reach the
  shell through `env`, never interpolated into `run:`.
- **`COSMOS_ENDPOINT` is a repository variable, not a secret.** It is a public
  URL and a non-sensitive Terraform output; as a secret it was masked in logs
  and unverifiable in the UI. `set-github-variables.ps1` now seeds it as a
  variable and deletes the old secret; both consuming workflows read
  `vars.COSMOS_ENDPOINT`. The script also takes
  `-GcpWorkloadIdentityProvider` / `-GcpServiceAccount` for the two WIF
  identifiers, and seeds `STORAGE_ACCOUNT` / `STORAGE_RESOURCE_GROUP`.
- **Migration scripts share one credential path.** `scripts/lib/cli.mjs` gains
  `connectFirestore()` (ADC, explicit `projectId`), `connectCosmos()`
  (`DefaultAzureCredential` only), `connectBlob()`, `classifyCosmosError()`,
  `writeReport()` (full report + publishable `.summary.json` sibling) and
  `showSamples()`; the migrator, preflight and verifier use them. The
  manifest is re-baselined at Site-Main `088f458` with `azure_architectures`
  and `azure_frameworks` added as `probe` — not provisioned, so the generated
  container spec is unchanged.
- **`Migration_Plan.md` rebaselined against Site-Main @ `088f458`.** §0 is now
  donor/recipient with a pinned baseline instead of "reconcile weekly" (the
  two repositories finished Phase 1 in incompatible directions); §2 carries
  real status; §4 carries the measured inventories — the six HTTP handlers
  over the 230 s Flex cap, the 16 timers with NCRONTAB and zone, the 11
  triggers with change-feed disposition and the three delete paths the feed
  cannot deliver, and the Vertex-default finding; §5 is rewritten around the
  tooling defects, the rehearsal estate, the five dispositions, the storage
  manifest and the public-repository rule; §6–§9 updated to match. The two
  links to the wrong GitHub org are gone.
- **Every image render site routes through `resolveMediaUrl()`** (T-318,
  sixteen files, commit `09154ad`). Stored site-relative
  `/api/public/media/...` paths now resolve against the Cloudflare API host,
  which the origin lock made the only working shape; absolute legacy URLs
  pass through untouched.
- **`oidc.tf`'s "deliberately NOT granted" note** now says what is true: the
  migration *does* use the deploy identity, on the scratch account at
  database scope, and holds nothing extra on production while
  `migration_writer_enabled` is off.
- **Every Terraform output renamed to the 2-word standard** (workload owner
  directive, 2026-08-18: `github_deploy_client_id` was four words). The
  standard now explicitly covers **outputs** — they are operator-facing,
  read off the state backend's Outputs tab — and states that **casing
  follows the language while the word count does not**: UPPER_SNAKE for
  GitHub variables, lower_snake for HCL. Outputs that feed a GitHub
  variable now mirror it: `client_id` ↔ `CLIENT_ID`.
  Headline renames: `github_deploy_client_id`→`client_id`,
  `github_deploy_federated_subjects`→`federated_subjects`,
  `function_app_default_hostname`→`function_hostname`,
  `static_web_app_default_hostname`→`swa_hostname`,
  `app_insights_connection_string`→`insights_connection`,
  `ci_runner_job_name`→`runner_job`. Two genuine **duplicates removed**:
  `azure_functions_hostname` and `azure_swa_hostname` returned values
  identical to their non-prefixed twins and were folded into one output
  each. One genuine **collision** resolved with a deliberate third word —
  the Function App and the deploy identity both expose a principal id, so
  `app_principal_id` / `deploy_principal_id`. No resource address,
  `azurerm_*` argument, or state-bearing name changed; `terraform fmt`
  and `validate` pass.
  Terraform **input** variables were deliberately NOT renamed: they must
  match HCP Terraform workspace keys exactly and several are set live, so
  they are a coordinated setting-plus-code change — filed as TODO T-507
  with the full proposed table. App settings read via `process.env`,
  `VITE_*` and `GITHUB_TOKEN` are contractual and untouched. The
  `iac-repo-standardizer` agent now sweeps every `.tf` file rather than a
  curated list — the gap that let `ci_runner_job_name` survive the first
  pass. (PR #117)

### Added

- **Free-tier disposition recorded on the Cost-Analysis wiki page** (now
  wiki-as-code, staged in `.github/wiki/`). Decisions from the workload
  owner's free-services meter review: runner image **stays on Docker Hub**
  (ACR rejected — month-13 cost for a failover-only image); Cosmos free
  tier is unusable by design (serverless); Service Bus / VM / SQL / LB
  12-month meters rejected as expiring traps; blob + egress discounts are
  automatic. Adds the standing **AI options reference** for the future AI
  RPCs: always-free F0 SKUs per task (Translator, Language, Vision,
  Content Safety, Document Intelligence, Speech) with the mechanics that
  make them budget-safe (throttle-not-bill on quota, create directly with
  F0 — Foundry-provisioned resources default to S0, keyless applies) and
  the explicit note that generative drafting/image work has no free Azure
  tier — that is Azure OpenAI or the SaaS keys. (PR #116)

- **CodeQL `actions` language added to the advanced matrix** — the retired
  Default setup had been scanning workflow files (`language:actions`); the
  advanced setup now owns that coverage across the repository's 12
  workflows. Context: the Tool status page's erroring `language:go` /
  `language:java-kotlin` entries are stale Default-setup configurations
  auto-created ~3 weeks ago from stray Go/Java snippet files inside the
  vendored `.claude/` harness — the exact paths the advanced config
  excludes. Those languages are deliberately NOT added to the matrix; the
  stale configurations are removed operator-side from the Tool status
  page's ⋯ menu. (PR #115)

- **Variable naming standard** (workload owner directive, 2026-08-18) —
  operator-set configuration names are UPPER_SNAKE_CASE, **maximum 2
  words** (3 only to break a real collision), with no provider prefixes:
  `CLIENT_ID`, `TENANT_ID`, `SUBSCRIPTION_ID`, `RESOURCE_GROUP`,
  `APP_HOSTNAME`. Contractual names (`VITE_*`, `GITHUB_TOKEN`) are exempt.
  Applied immediately to every workflow-consumed repository variable —
  all were still unset, so the renames are free: `AZURE_CLIENT_ID`→
  `CLIENT_ID`, `AZURE_TENANT_ID`→`TENANT_ID`, `AZURE_SUBSCRIPTION_ID`→
  `SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`→`RESOURCE_GROUP`,
  `FUNCTION_APP_HOSTNAME`→`APP_HOSTNAME` (`FUNCTIONS_STORAGE_ACCOUNT`
  keeps its third word to avoid colliding with the content account).
  The standard is codified in the `iac-repo-standardizer` agent — which
  now sweeps `vars.*`/`secrets.*` on every standardization run — and in
  the Wiki IaC-Repository-Standard page; CHECKLIST §7 carries the rule and
  an `APP_HOSTNAME` row. (PR #114)

- **Apply verification for the T-503–T-506 hardening (2026-08-18)** — the
  operator applied the full set in HCP Terraform; cold start passed,
  verifying the T-503 VNet runtime/package-pull path directly. A post-apply
  `validate-deployed` run is byte-identical to the pre-apply baseline (no
  external regression), and Repository Policy / IaC Validation / CI /
  CodeQL are all green on `main`. One verification remains blocked:
  `heal-computed-properties` — the probe for T-504's `0.0.0.0`
  Azure-datacenter sentinel — fails at Azure login because the
  `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID`
  repository variables were never set (a pre-existing gap, failing on every
  run before the hardening too; now recorded in CHECKLIST §7). Evidence
  table published as an addendum to the Wiki Resource-Validation-Report;
  plan v0.2 dispositions moved to APPLIED. (PR #112)

- **T-503 — Functions host storage network-restricted** (apply pending in
  HCP Terraform; the last item of the T-50x hardening series). The host
  storage account moves to default-Deny with three deliberate survivors:
  the Flex app's runtime/package-pull path (VNet integration + new
  `Microsoft.Storage` service endpoint on the integration subnet — which
  also makes the content account's existing subnet rule provably
  non-inert), a per-run firewall window in `deploy-functions.yml` (add
  runner IP → deploy → always-run remove) under a new Storage Account
  Contributor grant scoped to exactly this account, and operator windows
  via `functions_storage_admin_ip_rules`. Rollback is one variable:
  `functions_storage_network_default_action = "Allow"`. The
  `#trivy:ignore:AVD-AZU-0012` suppression is deleted — the CI gate now
  enforces the control it previously excused. New required inputs
  `AZURE_RESOURCE_GROUP` and `FUNCTIONS_STORAGE_ACCOUNT` recorded in
  CHECKLIST §7. Verify after apply with a functions deploy **and** a
  cold-start invocation. (PR #111)

- **T-504/T-505/T-506 — the security and observability remediation ADR-0018
  refused to ratify, now implemented in Terraform** (apply pending in HCP
  Terraform). **Cosmos hardening (T-504):** VNet service firewall allowing
  the Functions integration subnet (new `Microsoft.AzureCosmosDB` service
  endpoint), the `0.0.0.0` Azure-datacenter sentinel so
  heal-computed-properties keeps working from GitHub-hosted runners
  (variable-gated to drop later), operator-window `cosmos_admin_ip_rules`,
  `local_authentication_disabled` (variable, default true), and continuous
  backup (free 7-day tier). **Observability layer (T-505):**
  `infra/observability.tf` adds the `ag-hcw-ops-prod` action group and
  diagnostic settings for Key Vault, Cosmos (the plan's four categories),
  the content blob service and Azure OpenAI; the budget gains the approved
  50/75/90/100 ladder plus a Forecasted-at-100 alert routed through the
  group; Log Analytics gets the 0.25 GB/day cap. **Keyless OpenAI (T-506):**
  custom subdomain (planned replacement of the stateless account + both
  deployments — `openai-client.js` has zero importers, so nothing breaks),
  `local_auth_enabled = false`, Cognitive Services OpenAI User for the
  Function App identity, the primary-key output deleted, and an
  `AZURE_OPENAI_ENDPOINT` app setting for future keyless wiring. Plan
  v0.2-as-built dispositions updated to "resolved in code, closes on
  apply". (PR #108)

- **Infrastructure plan v0.2-as-built and ADRs 0018–0021** — implements the
  REVIEW §8.2 decision (workload owner, 2026-08-18) to supersede plan v0.1
  with a plan that describes the real system. `.azure/infrastructure-plan.json`
  is now version `0.2-as-built`: every implemented resource with its
  as-built properties, each deviation from v0.1 dispositioned as either a
  ratified decision or explicitly-unratified remediation debt (T-503–T-506,
  purge protection). Four ADRs staged to the Wiki: **0018** (umbrella
  supersede + disposition table), **0019** (single Function App —
  supersedes ADR-0004), **0020** (flat native Terraform root module —
  supersedes ADR-0005's AVM clause, resolves TODO T-502, and rewrites the
  README AVM guardrail to "pinned versions, stable addresses"), **0021**
  (Container Apps CI runner ratified as failover-only). ADR register
  updated; ADR-0004 marked superseded. New TODO **T-506** (keyless Azure
  OpenAI: RBAC grant, delete the key output, disable local auth).
  (PR #107)

- **Resource validation pass, first execution (2026-08-18)** — results
  published as the Wiki **Resource-Validation-Report** page (staged in
  `.github/wiki/`, linked from Home and the sidebar). External surface:
  edge live, TLS healthy to 2026-09-28, `www`/`api-azure` NXDOMAIN
  (consistent with same-origin), but Cloudflare bot challenge blocks all
  datacenter-IP validation of the origin. Plan-vs-code parity: ~40% of the
  approved plan's resources implemented, with material security-posture
  deviations (Cosmos open to the internet with key auth on, LRS vs ZRS,
  purge protection defaulted off, ungated keyed OpenAI) and material
  never-planned resources (CI runner, 71 containers, model deployments).
  Follow-ups filed: TODO T-504 (Cosmos hardening), T-505 (observability
  control layer); human decisions REVIEW §8.1 (Cloudflare synthetic-access
  rule) and §8.2 (reconcile implementation to plan, or supersede the plan
  as-built). (PR #106)

- **`validate-deployed.yml` — on-demand deployed-surface validation** — a
  `workflow_dispatch` workflow running the externally observable half of the
  Deployment Runbook's §4 verification from a GitHub-hosted runner: DNS for
  the apex/`www`/`api-azure` names, TLS certificate inspection, frontend
  status + security headers, and `scripts/smoke-deployed.mjs` tier 1
  (anonymous, no side effects) against a dispatch-time base URL (default
  `https://hybridcloudworks.com/api`). No secrets or cloud credentials —
  same doctrine as `ci.yml`; smoke tiers 2–3 remain operator-run. Results
  land in the job summary. The staged Deployment Runbook §4 references it.
  (PR #105)

- **IaC repository standardization** — the repository now carries the
  baseline governance surface expected of a permanent infrastructure repo:
  `.github/CONTRIBUTING.md`, `.github/SECURITY.md`, `.github/CODEOWNERS`, a
  pull-request template with a Terraform-plan gate, issue templates
  (including an infrastructure change request with blast-radius and rollback
  prompts), a root `.editorconfig`, and `infra/README.md` documenting layout,
  working rules, guardrails and the ALZ-absorption posture. The repository
  policy script allowlists exactly these files; narrative documentation still
  belongs in the Wiki. A new `iac-repo-standardizer` agent
  (`.claude/agents/`) encodes the standard so future repositories can be
  brought to the same baseline.
- **IaC validation gate** — `.github/workflows/iac-validate.yml` runs
  `terraform fmt`, `terraform validate` (via `init -backend=false`, so no
  credentials or state access), tflint (`infra/.tflint.hcl`) and a Trivy IaC
  misconfiguration scan on every pull request touching `infra/**`. Until now
  nothing validated Terraform changes at all while the prototype delivery
  workflow stayed disabled.
- **`prevent_destroy` guards on stateful resources** — the Cosmos DB account,
  both storage accounts and the Key Vault now refuse plans that would replace
  them; removing a guard is itself a reviewed change. Applied together with
  the `terraform fmt` drift that had accumulated in `main.tf`.
- **Deployment Runbook and IaC Repository Standard as wiki-as-code** — the
  day-1 apply procedure, day-2 operations, ALZ-absorption sequence, and the
  standard this repository now conforms to, staged under `.github/wiki/`
  (with updated `Home` and `_Sidebar`) and published to the GitHub Wiki by
  the new `sync-wiki.yml` workflow on merge to `main`. The workflow overlays
  staged pages only — unstaged wiki pages remain UI-editable — and uses the
  built-in `GITHUB_TOKEN`, so no PAT or additional GitHub App is required.
  Staged pages become repository-owned: they get PR review like the code
  they describe. The sidebar's repository links now point at the
  HybridCloudWorks org instead of the pre-move personal fork.

### Fixed

- **`iac-validate.yml` Trivy job unresolvable action pin** — the gate shipped
  in PR #103 referencing `aquasecurity/trivy-action@0.28.0`, a tag that no
  longer resolves: Aqua's 2026-03-19 security incident (trivy discussions
  #10425) saw trivy-action git tags re-pointed to malicious commits, and the
  v0.69.4 binary release was itself malicious. The job now installs the
  Trivy **binary** pinned to v0.69.3 — the latest release the advisory names
  safe — from the project's own release artifacts, verified against the
  release checksum manifest, and no longer uses the marketplace action at
  all. (PR #104)

### Changed

- **`deploy-infra.yml` rewritten while remaining hard-disabled** — the
  prototype workflow applied with `-auto-approve` on every push to `main`,
  masked failed plans with `continue-on-error`, and used unpinned actions.
  The replacement is `workflow_dispatch`-only, runs in a `production-infra`
  GitHub Environment for required-reviewer approval, starts an HCP Terraform
  run whose apply is confirmed in TFC where the state lives, and keeps the
  `if: ${{ false }}` gate until production applies are authorized.

- **Self-healing computed properties** — `.github/workflows/
  heal-computed-properties.yml` re-applies `cp_sortDate` on any push touching
  the Cosmos Terraform or container manifest, and every six hours — because
  Terraform applies run in TF Cloud on their own clock, a push-time heal can
  itself be overwritten, so the schedule is what guarantees the wound closes.
  With `PUBLIC_LIST_SQL_ORDER=1` live, a wiped property breaks the public
  content list, which is why this is automation rather than a runbook note.
  The OIDC deploy identity gains Cosmos Data Contributor scoped to exactly the
  `content` and `blogs` containers (`infra/oidc.tf`) — the one documented
  exception to its deliberate no-Cosmos posture, and the healer fails loudly
  on a schedule until that assignment is applied. (TODO.md T-206 follow-up)

- **`cp_sortDate` computed property + flag-gated ORDER BY** — T-206's last
  step, authored as operator tooling. `scripts/apply-computed-sortdate.mjs
  --inspect` reports non-ISO date values (the evidence gate), `--apply` adds a
  computed property that resolves the five published-date aliases server-side
  with a total fallback, and `PUBLIC_LIST_SQL_ORDER=1` then makes the public
  list's TOP window return the newest N documents instead of an arbitrary N.
  A computed property rather than a materialized field: no backfill, no
  write-site maintenance, and it cannot be missing — which is what makes
  ORDER BY on it safe under the module's own rule 2. The azurerm provider
  cannot express computed properties, so the script is the applier and the
  manifest records the drift hazard: a terraform apply that updates the
  container wipes the property. Applied to the live containers and flipped on
  2026-08-14; the deployed smoke test passed against the ordered window,
  closing T-206 entirely. (TODO.md T-206)

- **Deployed smoke test** — `scripts/smoke-deployed.mjs`, the runnable half of
  the work order's top item. Tier 1 exercises the anonymous surface with no
  side effects: the public filter and T-206 projection (asserting the eight
  excluded body fields stay excluded and `explanation` does not false-alarm),
  guard liveness on admin RPCs, CORS refusal and preflight, negative-cache
  headers, the health endpoint's non-disclosure, and that the seventeen
  notImplemented RPCs still 404. Tier 2 (`--cosmos`) executes the one
  assumption nothing has executed: that a failed Cosmos patch predicate
  surfaces through the JS SDK as code 412 and a missing document as 404 — the
  submission quota's correctness rests on it; it writes a single smoke-prefixed
  document into the TTL-bounded `submission_quota` container and deletes it.
  Tier 3 (`SMOKE_BEARER_TOKEN`) verifies a real token is admitted. Six unit
  tests pin the script's own assertion helpers, because a smoke test with a
  wrong filter passes against a broken deployment.

- **Anonymous public read API** — `GET public/content`, `public/content/{slugOrId}`,
  `public/snapshots/{id}`, `public/podcasts`, `public/feed`. The published/draft
  boundary is enforced server-side, replacing the Firestore security rules that
  previously performed that role. (#45)
- **Rate-limited public submission endpoint** — `POST public/submissions` with
  per-type validation, server-side document composition, and a rolling-hour
  anonymous quota, closing the unauthenticated `addDoc`-into-content path. (#45, #66)
- **Admin CMS REST surface** — certifications, social posts, recordings, speaker
  events, settings, images, AI providers / MCP servers, and usage records under
  `cms/*`, all behind the two-gate role guard. (#46, #47)
- **Authenticated file upload endpoint** — `POST cms/uploads/{container}` with a
  container allowlist, blob-path validation, and a server-enforced 15 MB decoded
  cap, replacing direct browser writes to Firebase Storage. (#62, #65)
- **Content pipeline RPCs** — `createContentItem`, `updateContentItem`,
  `transitionContentStatus`, and the publish pipeline, ported with their original
  dedup, quality-gate, state-machine, and audit semantics. (#43, #44, #59)
- **Admin identity, snapshots, ops health, content workflow, gallery, labs, and
  image-prompt RPCs** — 34 named RPCs total. (#50, #54, #55, #56, #57, #58)
- **`getLabJob` RPC** — single lab job with output, replacing the Labs console's
  per-document realtime subscription. (#65)
- **`GET public/platform-health`** — the landing page's four cloud-status
  indicators, ported from the Firebase original. Anonymous, with a five-minute
  cache that is the only thing bounding how hard the route can be made to hit
  four third-party status APIs; each provider degrades to `UNKNOWN`
  independently and the handler never returns 500, because a dead upstream must
  not blank the panel. Ported without adding a dependency — `axios` and
  `rss-parser` stay unreachable. (TODO.md T-316)
- **`POST cms/telemetry/legacy-blogs-read`** — the counter that will justify
  retiring the `blogs` fallback container. Guarded at `viewer`, unlike the
  anonymous Firebase original: its only caller is an admin page, so anonymity
  bought nothing and left an unauthenticated write endpoint anyone could use to
  poison the evidence. (TODO.md T-316)
- **Anonymous media delivery** — `GET public/media/{container}/{*blobPath}`,
  serving uploaded images through the Function App's managed identity with
  immutable cache headers and conditional-request support. The storage account
  stays closed to the internet; the container allowlist is a strict subset of
  the containers uploads may write to. (TODO.md T-105)
- **Self-hosted CI runner** — Azure Container Apps Job with KEDA scale-to-zero, an
  ephemeral JIT-config runner image published to Docker Hub with a GHCR mirror,
  and a `CI_RUNNER` repository-variable failover switch. (#48)
- **Labs agent API** — `POST agent/claimLabJob`, `agent/heartbeat`,
  `agent/completeLabJob`, behind a machine-identity guard (`LabAgent` App Role
  plus a `lab_agents/{agentId}` registry document bound to the credential's
  object id) that is disjoint from the admin role hierarchy. Claim atomicity is
  an ETag-guarded write with a lease, so a dead agent's jobs are picked up
  rather than stranded. (TODO.md T-401)
- **`code-reviewer` agent** — carries the Code Review SOP (CODE_REVIEW_PROMPT.md
  v1.0) as agent 39 of the harness. (#68)
- **SOP working documents** — `TODO.md`, `CHECKLIST.md`, `CHANGELOG.md`.

### Changed

- **Firebase-era smoke scripts and nested workflows removed.** Three live smoke
  scripts read `VITE_GCP_FUNCTIONS_URL` and built a `firebaseConfig` from
  `VITE_FIREBASE_*` — none of which the application sets any more, so they could
  not run — and `frontend/.github/` held the source repository's Firebase deploy,
  E2E and secret-rotation workflows, inert but reading as live configuration.
  Deleted rather than ported: a half-migrated script that looks runnable and is
  not is worse than no script, which is exactly what these were. A deployed
  smoke test is still wanted, written against Entra and the Azure routes.
  (TODO.md T-317)
- **Six unused dependencies dropped** from the functions package — `sharp`,
  `replicate`, `turndown`, `@mendable/firecrawl-js`, `axios` and `rss-parser`,
  none of them referenced anywhere under `src/`. (TODO.md T-407)
- **Frontend decoupled from Firebase.** All 34 files importing `firebase/firestore`,
  5 importing `firebase/auth`, and 4 importing `firebase/storage` now call the
  Azure Functions API. Public pages (#61), admin CRUD (#62), shared config
  libraries (#63), workflow pages and the editor (#64), remaining admin pages
  (#65), and submission forms (#66). The production bundle no longer contains a
  Firebase chunk.
- **Admin authentication swapped to Entra ID via MSAL** — `firebase/auth`
  eliminated from the admin surface; MFA is now an Entra Conditional Access
  policy rather than app-managed phone MFA; the Entra object id is the
  `admins/{oid}` registry key. (#60)
- **Realtime listeners replaced with polling** — the content editor polls its
  document every 20 s, the Labs dashboard polls a snapshot RPC every 15 s, and
  the Labs console polls an active job every 5 s. Conflict detection and
  online/offline semantics are preserved. (#64, #65)
- **`Review.md` renamed to `REVIEW.md`** and its scope narrowed to
  human-resolvable blockers, per the SOP.
- **Repository structure policy** (`scripts/validate-repository-structure.ps1`)
  now requires the five SOP documents, permits them at the root, and rejects
  case variants of their filenames.

### Fixed

- **The frontend CI gate now runs the whole test suite.** `test:admin` was a
  hand-curated file list — every new test file had to be added by hand, and
  eight known-stale failures elsewhere were simply never run. The eight were
  stale expectations, not application defects, and are fixed: the route
  contract now asserts the real pages behind `/gcp`, `/terraform`, `/github`,
  `/finops`, the three `/tools` routes and the two news routes (mocked, as the
  suite already did for other providers); and the PublishedPage tests drive
  the publish flow that actually exists — a pre-publish checklist modal whose
  "Publish Now" is what publishes — with the checklist itself now unit-tested.
  `test:admin` is plain `vitest run`; the one legitimately unrunnable file
  (`firestore.rules.test.js`, which needs the retired Firestore emulator
  setup) is excluded in vitest.config.js with the reason recorded.
  Default run: 15 files, 115 tests. (TODO.md T-320)
- **One anonymous list request could eat four seconds of the database's entire
  budget.** The public content list ran `SELECT TOP 1000 *` with no WHERE — an
  *arbitrary* 1000 documents of a ~1k-document container (so published articles
  could vanish from listings non-deterministically, made intermittent by the
  300 s cache), each transferred whole at ~20 KB including article bodies no
  list consumer renders. The public filter now runs in SQL, so the window
  counts published documents of the requested type/provider; and the projection
  is an audited explicit field list — the union of what the public list
  consumers actually read, pinned by a test naming the consumer behind each
  field. Of nine heavy body fields exactly one has a list reader
  (`explanation`, a Coder Corner excerpt fallback); the other eight stay out,
  which is where the RU win lives. The in-memory sort and the ORDER BY
  avoidance stay until a materialized sort field plus composite index can be
  deployed. (TODO.md T-206, steps 1–2)
- **The API contract can no longer lie about what exists.** It documented
  seventeen RPCs the admin UI invokes that were never registered — every call a
  live 404, invisible because nothing compared the document to the code. The
  contract now carries an explicit `rpc.notImplemented` block (all seventeen,
  blocked on provider credentials), and a test holds the whole document to
  account: invoked = implemented + notImplemented exactly; every implemented
  entry resolves to a registered route with the methods it advertises;
  registered method+route pairs and contract claims form a full bijection.
  Making the bijection true surfaced more drift, now fixed: `getLabJob` was
  implemented but missing from the invoked list, the Labs agent API had no
  contract entry at all, six registered admin/public routes were undocumented,
  and the `CRUD` shorthand entries now enumerate their real routes — recording
  honestly that social-posts has no PATCH and recordings no DELETE.
  (TODO.md T-207)
- **Public news pages showed no curated imagery.** #63 moved the cached-image
  lookup off an anonymous Firestore read onto an editor-gated `cms/*` endpoint,
  reached through a token acquisition that throws outright without a signed-in
  account. The hook runs on the public `/{provider}/news` route, so for every
  anonymous visitor the lookup failed and the grid rendered nothing where
  cached images used to appear. Reading a cached image is now anonymous
  (`GET public/curated-image/{articleId}`, returning only the URL — never the
  document, which carries an internal blob path and prompt metadata), while
  generating a missing one stays behind the admin gate and is no longer
  attempted without the `editor` role that the server requires — not merely
  when nobody is signed in, since a signed-in viewer would have collected a 403
  per article. That also keeps MSAL off the critical path of a public page.
  Archived images are withheld, so retiring an image in the gallery now keeps
  it off the public site, and a cache miss is cached for a minute rather than
  an hour so a freshly generated image is not hidden behind its own absence.
  (TODO.md T-210)
- **The anonymous submission limit of five could be turned into two hundred.**
  The quota read the counter, compared it, and wrote it back as three separate
  operations, so simultaneous requests all read the same value, all passed the
  check, and all wrote `count: 1` — accepted submissions bounded only by how
  many the caller sent, each landing in the review queue, and a counter left at
  1 so the trick repeated every burst rather than once an hour. The accepted
  path is now a single conditional atomic increment: Cosmos evaluates
  `count < limit` and applies the increment as one operation, and writes to one
  document serialize, so exactly five concurrent callers get through. Starting a
  window and rolling one over are the two things a predicate cannot express, so
  they go through operations that have a loser — a create that 409s and a
  replace that 412s — and the loser re-evaluates rather than assuming.
  (TODO.md T-204)
- **An IPv6 client had an unlimited submission budget.** The quota key was the
  hash of the full address, and a standard residential IPv6 allocation is a
  whole `/64` — 2^64 addresses, each hashing to its own counter, every one of
  them reading well under the limit, with `submission_quota` growing a document
  per address as a side effect. Addresses are now normalized before hashing:
  full address for IPv4, `/64` prefix for IPv6, with `::` expanded first so one
  address written three ways lands in one bucket, and `::ffff:` v4-mapped
  addresses treated as the IPv4 clients they are rather than collapsing every
  such client into a single shared bucket. (TODO.md T-205)
- **The editor could silently overwrite a colleague's save.** Replacing
  `onSnapshot` with a twenty-second poll left behind a one-shot "this response
  is my own write" flag that was consumed by whatever the next tick happened to
  return. At millisecond latency that was reliably our own write; at twenty
  seconds it can be a collaborator's — and the branch then adopted *their* edit
  marker as our baseline, so the next save passed the server's
  optimistic-concurrency check and their work vanished with no warning to
  either person. `saveEditorDraft` now returns the `blogEditedAt` it wrote and
  the client matches on that identity, so the flag is gone rather than merely
  narrowed. It also fixes an adjacent bug: a second save inside the poll window
  used to send the pre-save marker and conflict against the caller's *own*
  previous write. (TODO.md T-208)
- **Twenty seconds was long enough to lose an image reorder.** The poll had no
  change detection, so every idle tick re-applied the remote document over
  `orderedImageUrls` — local state the user drags into order and that is only
  persisted on save — and re-rendered the whole editor while doing it. Ticks
  that carry a marker we have already seen now return early. A genuine remote
  change still replaces the order; the tests assert both directions, because an
  early return that goes too far is just a stale editor. (TODO.md T-209)
- **`total` reported the page size.** Two public list endpoints measured it
  after slicing, so it always equalled `items.length` and any paginating
  consumer would conclude there was exactly one page. (TODO.md T-407)
- **Two routes the frontend called did not exist.** `recordLegacyBlogsRead` and
  `getPlatformHealth` were registered nowhere — both 404s. The health one meant
  every anonymous visitor saw four `CHECKING` indicators resolve to "Health
  check unavailable" on the landing page; the telemetry one meant
  fallback-container reads went unmeasured, which is the evidence for retiring
  that container. Both were invisible until T-101, because until then they were
  pointed at the decommissioned Google host. (TODO.md T-316)
- **Scheduled publishing works.** `scheduledPublishDate` had a complete write
  side and no read side: an operator scheduled a post, the server validated and
  stored the date, the UI confirmed it, and nothing ever published it — no
  error, no alert. `publishScheduledContent` now runs the same
  `processPublishContent` pipeline the Publish button uses, rather than a second
  implementation of it, clears the schedule only after a publish that actually
  happened, caps each tick at 25 with carry-over, and records failures under the
  `scheduled_publish_failures` alert type the ops dashboard has counted since
  the migration without ever having a producer. (TODO.md T-301)
- **Two concurrent publishes can no longer both succeed.** `patchDoc` gained an
  optional `ifMatch`, and the publish write is now conditioned on the ETag read
  at the top of `processPublishContent` — the status gate, quality and image
  reports and slug were all decided from that document. A lost race is reported
  as skipped rather than counted as a publish that did not happen. Timer-driven
  publishing is what turns this from theoretical into reachable. (TODO.md T-301)
- **The four timers no longer share one flag.** Enabling the scheduled publisher
  would also have armed `cleanupTempStorage`, an unimplemented TODO that deletes
  blobs. Each timer has its own flag; `FEATURE_FLAG_SCHEDULERS` is a master kill
  switch. The blob-GC job itself is still unwritten and still flagged off.
  (TODO.md T-302, flag half)
- **Every admin list sort worked again.** `PublishedPage` and `EditorListPage`
  kept the Firestore-only `?.toMillis?.() || 0`, which against the ISO strings
  Cosmos returns scores every document 0 — so every comparator returned 0, the
  lists rendered in raw database order while the sort controls appeared to work,
  and the timestamp columns showed an em dash. One `lib/dateUtils.js` now backs
  all of it. The review counted seven copies of that helper; there were **ten**,
  and a source guard in the new test file found the last three — one of which
  only surfaced when the bundler refused a redeclaration that ESLint had passed.
  (TODO.md T-304)
- **The review board no longer blanks on a scheduled item.** `BlogReviewBoard`
  called `.toDate()` on what is now an ISO string, inside a `setTimeout` and so
  outside the error boundary. (TODO.md T-303)
- **A published article can no longer 404 because a draft shares its slug.**
  The detail lookup ran `SELECT TOP 1` with no `ORDER BY` and applied the public
  filter afterwards, so it picked arbitrarily among duplicates and then rejected
  the winner. It now orders by `_ts` — a system property present on every
  document, so the drop-on-undefined trap does not apply — and finds the first
  public candidate. (TODO.md T-305)
- **The Labs dashboard reported agents "connected" through an outage.** The
  staleness clock advanced only inside the snapshot fetch's success path, so a
  failing poll froze it: `now - lastSeenAt` stopped growing and every agent
  stayed online for exactly as long as nothing was reachable. The clock is an
  independent interval again — it has to keep running when the fetch does not,
  which is the only condition under which it says anything. (TODO.md T-309)
- **A timed-out lab job was polled forever, and a network blip was displayed as
  a failure.** The console's terminal-status set omitted `timeout`, which the
  agent does report — while the output pane *in the same file* had the correct
  four-element list, so the loop kept polling a job its own display had already
  called finished. Both now read `TERMINAL_JOB_STATUSES` from
  `lib/labsPolling.js`. A transport error no longer writes `status: 'failed'`
  onto the job, which was indistinguishable from a real failure and stopped the
  poll permanently; it is separate state, shown as "still running — retrying",
  and the poll backs off from 5 s to a 60 s ceiling without ever giving up.
  (TODO.md T-308)
- **Overlapping polls could render an older document over a newer one.** Both
  the Labs snapshot (15 s interval) and the editor's remote-document watch
  (20 s) allow a 20 s request timeout, so ticks overlap under load and responses
  can land out of order. Both now skip a tick while one is in flight. In the
  editor the flag is released in a `finally`: its catch returns early on a
  missing document and on cancellation, and either path would otherwise have
  stopped the poll for the lifetime of the page. (TODO.md T-309)
- **The browser called Google Cloud, not Azure.** `api.js`, `publicApi.js` and
  `legacyBlogsTelemetry.js` each resolved `VITE_GCP_FUNCTIONS_URL` — a
  decommissioned Google Cloud Functions host — so roughly sixty call sites,
  including every authenticated admin request, would have been sent off-platform
  with an Entra bearer token attached. `lib/functionsBase.js` is now the single
  resolver over `VITE_AZURE_FUNCTIONS_URL`; the dead `azureConfig.js` provider
  switch was deleted. The base carries the Functions `api` route prefix and
  accepts either `/api` (same-origin) or an absolute origin (cross-origin), so
  deployment topology is configuration rather than code. A deploy build with no
  base configured now fails instead of shipping. (TODO.md T-101)
- **Every upload and every gallery delete would have thrown.**
  `blob-storage.js` required `STORAGE_CONNECTION_STRING`, which no file in
  `infra/` has ever produced — the code was written for shared-key auth while
  the infrastructure was built for managed identity. It now uses
  `DefaultAzureCredential` against `STORAGE_BLOB_ENDPOINT`, matching
  `cosmos-client.js`, and `generateSasUrl` signs with a user-delegation key
  instead of an account key. No key or connection string was added.
  (TODO.md T-104)
- **Uploaded images were unreachable, and the URL to them was stored anyway.**
  `allow_nested_items_to_be_public = false` is an account-level master override,
  so the three containers declared public in Terraform served 409 — while
  uploads returned the raw blob URL for pages to persist into Cosmos. Uploads
  now return the media-route URL, non-public containers return none, and the
  Terraform containers are declared `private`, which is what they always were.
  (TODO.md T-105)
- **Scheduled-publish dates were silently dropped** — `scheduledPublishDate` and
  the editor's `blogEditedAt` were parsed with Firestore `Timestamp`-only code
  paths that returned `0` for the ISO strings the API now returns. This would
  have emptied the scheduling calendar and disabled external-edit-conflict
  detection. (#64)
- **Labs agents would have shown permanently offline** — the staleness
  calculation understood only `Timestamp.toMillis()`. (#65)
- **Admin list projection was missing workflow fields** — `scheduledPublishDate`,
  `softDeletedAt`, `blogEditedAt` and eight others were absent from the snapshot
  projection that replaced whole-document Firestore reads. (#64)
- **MCP server connection state always read as disconnected** — the write-only
  `oauthToken` strip left consumers unable to detect a stored token; reads now
  carry a `hasOauthToken` boolean while the value itself never leaves the
  server. (#62)
- **Public list endpoint under-projected** — it returned a card-field subset
  while consumers read `frameworkConcepts`, `featured`, `altCoverImageVariants`
  and more; it now returns full documents with internal fields stripped. (#61)

### Security

- **Anonymously submitted HTML is sanitized on ingest.** `overviewHtml` arrives
  through the anonymous submission endpoint, is stored, and is eventually
  rendered with `dangerouslySetInnerHTML` on a public template — with a single
  client-side `DOMPurify.sanitize()` call standing between those two facts.
  Sanitizing at ingest makes safety a property of the stored data rather than of
  one component's rendering choice; the client-side call stays, because two
  layers is the point. No dependency was added: the sanitizer uses `cheerio`,
  already in the tree, so it parses rather than pattern-matching markup.
  (TODO.md T-408)
- **The Content-Security-Policy stopped granting the Firebase/GCP surface, and
  started granting Entra.** `connect-src` still allowed `*.googleapis.com`,
  `*.firebaseio.com`, `*.cloudfunctions.net`, `*.run.app` and
  `wss://*.firebaseio.com` long after the last Firebase import was deleted, plus
  `*.documents.azure.com`, which contradicts the rule that the browser never
  holds a Cosmos client. More consequential in the other direction:
  `login.microsoftonline.com` was **absent** from `connect-src` and `frame-src`,
  so admin sign-in and MSAL's silent token renewal could not have worked at all.
  Pinned by `csp.test.js`, since a CSP failure appears only in a browser console
  on a deployed site. (TODO.md T-404)
- **Key Vault failures are no longer indistinguishable from a missing secret.**
  Throttled, RBAC-denied and unreachable all returned `null`, the same value as
  "this secret does not exist" — and the one caller turns `null` into an error
  message naming the wrong cause. `null` now means absent and everything else
  throws, carrying the real reason. Reads are cached for five minutes, so a hot
  path no longer spends the vault's request budget on a value that changes
  approximately never. (TODO.md T-405)
- **`GET /api/health` stopped reporting the runtime.** It returned
  `process.version` and the deployment name to anyone — an unauthenticated
  inventory of exactly what an attacker enumerates first, and of no use to a
  liveness probe. (TODO.md T-402)
- **The role cache is bounded.** It is only reachable after a token verifies, so
  an anonymous caller could not grow it, but it had no eviction at all and grew
  with every distinct principal that ever signed in. (TODO.md T-408)
- **Authorization-denial auditing is pinned by a test.** The `admin_audit_logs`
  writer already existed in the guard's production composition — the finding was
  stale — but nothing failed if the line were deleted. Now something does.
  (TODO.md T-406)
- **The Cosmos account primary key is out of app settings.**
  `COSMOS_CONNECTION_STRING` carried it — readable by anyone with Contributor on
  the resource group, and present in Terraform state — for the sole benefit of a
  change-feed trigger binding whose two handlers were empty TODOs that
  nonetheless ran continuously and billed lease-container RU. The handlers, the
  registrations and the setting are all gone, and the route-inventory test now
  asserts zero change-feed registrations so reinstating one is a visible
  decision. It was also masking a real risk: the binding kept working off the
  key while `cosmos-client.js`, which uses managed identity, would have returned
  403 on every call if its role assignment were wrong — a half-working app is
  harder to diagnose than a uniformly broken one. (TODO.md T-315)
- **The Labs VPS agent no longer holds a database credential.** It ran on a
  third-party host with a Cosmos **account primary key** — read/write over all
  71 containers. It now authenticates to the Functions API with an Entra
  certificate and can reach three endpoints, each constrained server-side:
  claims are limited to the job types its registry document lists, results can
  only be written for jobs it currently holds, and `cancelled` is not a status
  it may report. Revocation is a field on the registry document and takes
  effect on the next call, with no cache in between. The rejected alternative
  and what still needs provisioning are recorded in REVIEW.md §0.4.
  (TODO.md T-401)
- **CORS applied to every route.** `lib/auth/http-route.js` is now the single
  registration helper for all 59 HTTP routes: it registers `OPTIONS`, evaluates
  CORS before the handler runs, and merges the headers onto every response
  including errors. Previously `cors.evaluate` was called by one route of
  fifty-eight, and the advertised method list predated the REST surface, so a
  browser preflighting any of the fourteen `PUT`/`PATCH`/`DELETE` routes would
  have refused to send. (TODO.md T-102)
- **Route-inventory test added** — the replacement for the `firestore.rules`
  default-deny catch-all that Azure has no equivalent of, and the test
  `require-role.js` declared in its header and never had. Every registration
  must be guarded or named in an explicit eight-entry public allowlist, must
  accept `OPTIONS`, and must evaluate CORS. Verified by mutation: an unguarded
  route and a raw `app.http` registration both fail it. (TODO.md T-103)
- **Dependency advisories cleared** — `dompurify` to `^3.4.13` (moderate: XSS via
  detached subtree after `IN_PLACE` hook removal; ships in the app bundle),
  `nanoid` override `^3.3.18` (high), `js-yaml` override `^4.3.1` (high). Both
  packages report zero advisories. (#67)
- **Anonymous write path closed** — public submissions now pass server-side
  validation and quota enforcement instead of writing directly to the content
  collection from the browser. (#45, #66)
- **`oauthToken` made write-only** on every read path for `mcp_servers`. (#47, #62)
- **Upload path hardened** — container allowlist, traversal-resistant blob path
  validation, and a decoded size cap enforced before storage is touched. (#62)
- **Snapshot endpoint allowlisted** to `certifications` and `speakerevents` so it
  cannot become a generic container read. (#45)
- **`speakerevents` snapshots no longer publish admin emails or hidden events.**
  `SANITIZERS` had a `certifications` entry and none for `speakerevents`, so raw
  rows were written into `_snapshots/speakerevents` and served anonymously —
  including `createdBy`/`updatedBy`, which carry the email of every admin who
  touched an event, and `display: false` records whose only filter was
  client-side. A positive field allowlist now governs what is published, and
  `getSnapshot` strips internal fields inside `items[]` rather than on the
  wrapper alone. A test asserts every snapshot collection has a sanitizer.
  **Takes effect on the next `publishSnapshot` run** — an already-published
  snapshot keeps its contents until then. (TODO.md T-201)
- **Soft-deleted podcasts, cache documents and AI insights are no longer served
  anonymously.** `listPodcasts` and `getFeed` applied no deletion filter, and
  `ai_insights` was filtered on `active !== false` only — so a soft-deleted
  insight still reached the news feed. `isSoftDeleted` was extracted as the
  portion of `isPublicDocument` that applies to collections with no editorial
  workflow, and both handlers now use it. The full predicate was deliberately
  **not** applied: these three collections carry no publication status, so it
  would have emptied the podcasts page, the news feed and the insights panel.
  (TODO.md T-202)
- **The anonymous feed endpoint is bounded.** `getFeed` ran
  `SELECT * FROM c WHERE c.provider = @provider` against both `rss_cache` and
  `ai_insights` with no ceiling, and `queryDocs` calls `.fetchAll()`. Both now
  cap at 200 documents — a runaway guard, not a page size: one `rss_cache`
  document is one feed, so sizing the bound to the 30 items the client renders
  would have dropped whole feeds. Items *within* a document remain unbounded,
  tracked as T-319. (TODO.md T-203)
- **Point reads against the four non-`/id` containers now fail loudly.**
  `readDoc`/`patchDoc`/`deleteDoc`/`replaceDocIfMatch` defaulted the partition
  key to the document id, which for `content_versions`, `image_prompt_sets_prompts`,
  `image_prompts_sets` and `listen_and_learn_episodes` reads the wrong logical
  partition and returns nothing — surfacing as a permanent `null`. They now
  throw unless given an explicit key, and a test keeps the map in step with
  `infra/cosmos-containers.json`. (TODO.md T-313)
- **`putConfig` no longer deletes stored OAuth tokens.** It is a full replace and
  reads never return `oauthToken`, so any read-modify-write round trip from an
  edit form would have wiped it. The token is carried forward unless explicitly
  supplied; an explicit empty string still revokes. The read-side
  `hasOauthToken` boolean is stripped from incoming bodies. (TODO.md T-314)
- **`cms/content` list rejects a malformed `limit`.** `?limit=abc` produced
  `TOP NaN` — a 500 carrying raw Cosmos error text — and `?limit=0` produced a
  silently empty list. Clamped like its four siblings, and `error.message` no
  longer reaches the client on any of the file's 500 paths. (TODO.md T-310)
- **`deleteSetArtifacts` queries one logical partition** instead of fanning out
  across all of them; `queryDocs` gained an optional `partitionKey`.
  (TODO.md T-312)
- **Uploads no longer accept an arbitrary content type.** `contentType` was
  taken verbatim from the body and stored as the blob's Content-Type, which the
  media route serves back: an editor could host `evil.html` as `text/html` on an
  org-owned domain. Six image types are now allowed, each having to agree with
  the path's extension — `badge.png` declared `text/html` and `evil.html`
  declared `image/png` are both refused. `image/svg+xml` is accepted only into
  containers the anonymous route does not serve, since an SVG on a public URL is
  a scriptable document in the storage origin and `nosniff` does not address a
  type that was declared rather than guessed. (TODO.md T-307)
- **A caller-chosen upload path can no longer replace a live asset.** Uploads
  from the admin route are conditioned on `If-None-Match: *` and answer 409
  instead of overwriting; `uploadBlob`'s default is unchanged, so the paths that
  rewrite deterministic keys on purpose still do. The condition is asserted
  against a mocked SDK rather than only against the handler's fake storage —
  that fake is what let T-104 stay green while every real upload threw.
  (TODO.md T-307)
- **Upload size is checked before memory is committed.** The 413 came after a
  full JSON parse, a full base64 string and a full `Buffer` decode — roughly a
  250 MB peak for a 100 MB body on a 2048 MB instance. `Content-Length` is now
  checked before the body is read and `dataBase64.length` before it is decoded,
  with the decoded count still the final authority. There is no
  `http.maxRequestBodySize` in `host.json` to complement this; the v2+
  `extensions.http` schema has no such key, so the anonymous submissions parse
  still needs its own check. (TODO.md T-306)

### Infrastructure

- Storage: `Storage Blob Delegator` role assignment for user-delegation SAS;
  media containers declared `private`, matching the account-level override that
  already made them so.

Authored but **never applied** — no Terraform `validate`, `plan`, or `apply` has
run from any session (see [REVIEW.md](REVIEW.md) §1.1).

- Cosmos DB serverless container specification (71 containers).
- Flex Consumption plan and pricing work. (#38, #41, #42)
- Container Apps Job definition for the CI runner. (#48)

---

## Notes

- Work merged before the SOP was adopted has been reconstructed from pull
  request history; entries reference PR numbers rather than release tags.
- Nothing in this file has been verified against a deployed environment.
