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

**The next move is the data-migration rehearsal.** The function deploy this
paragraph used to point at happened on 2026-08-20: 80 functions live, the
rebuilt identity authenticates, the smoke test passes through Cloudflare, and
the origin-secret handshake is proven by an anonymous rate-limited route
answering 200 through Cloudflare and 403 at the origin. The
[Migration-Runbook](.github/wiki/Migration-Runbook.md) carries the sequence
from here; nothing below is a prerequisite for its first steps.

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

Reuse the existing job pattern — a `lab_jobs` document plus a client poll at
5–10 s (`runToolExpertModeValidation`, `enqueueLabJob` already do this). Fix
the client/server timeout mismatch in the same change. There is no SSE or
streaming anywhere, so the cap bites only these six. For the background
handlers set `functionTimeout` ≥ 10 min in `host.json`;
`generateAiCoverOnContentTrigger`'s 540 s must stay under the 900 s rising-edge
claim window.

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

### T-509 — `deploy-functions.yml`'s storage firewall window is inert from a same-region runner
**Files:** `.github/workflows/deploy-functions.yml`

The per-run `network-rule add` on the Functions host storage account has the
same flaw `migrate-data.yml` hit on 2026-08-21 (run 32444649912): Azure's
storage firewall ignores IP rules for requests that originate in the storage
account's own region, and GitHub-hosted runners are Azure VMs. Every deploy
so far drew a runner outside `centralus`; the first one that does not will
fail the package upload with a 403 that reads like an auth problem.

`migrate-data.yml` now also sets `--default-action Allow` for the window and
restores `Deny` in the `always()` step (data-plane access still needs an
Entra token — `allowBlobPublicAccess` is false). Apply the same two lines to
the deploy workflow, or move the deploy onto the in-VNet runner
(`ci_runner_enabled`) and drop the window entirely. Not urgent until it
bites; cheap to do before it does.

### T-508 — `heal-computed-properties` needs an ARM role, not a data-plane one
**Files:** `.github/workflows/heal-computed-properties.yml` · `scripts/heal-computed-properties.mjs` · `infra/oidc.tf`

Run 32420399977 (2026-08-20) failed with `403 … cannot be authorized by AAD
token in data plane` on `PUT /dbs/hcw/colls/content`. The healer calls
`container.replace()` to set `computedProperties`, and that is a
**control-plane** operation: the deploy identity's container-scoped Cosmos
Built-in Data Contributor can never satisfy it, no matter the scope.

Two fixes, pick one: grant the identity **Cosmos DB Operator** on the account
(ARM role, `azurerm_role_assignment`, not `azurerm_cosmosdb_sql_role_assignment`)
and keep the SDK call; or rewrite the step as
`az cosmosdb sql container update --idx-policy/--computed-properties` after
`azure/login`, which uses the ARM token the login already minted. The second
keeps the identity's data-plane footprint at zero for a job that does not read
data.

Not urgent: `cp_sortDate` only matters once `content` and `blogs` hold
documents, which is the production-import phase. The workflow should stay
dispatch-only until then.

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
