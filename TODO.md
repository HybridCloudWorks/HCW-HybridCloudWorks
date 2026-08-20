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
| Open items | 7 |
| Critical | 0 |
| High | 0 |
| Medium | 5 |
| Low | 2 |

**The next move is a function deploy.** The Function App holds zero deployed
functions, and a single deploy run settles three unknowns at once — whether the
rebuilt identity authenticates, whether the smoke test passes through
Cloudflare, and whether the origin-secret handshake works end to end. Nothing
below is a prerequisite for it.

---

## MEDIUM

### T-321 — Finish the post-rebuild re-pointing
**Files:** `infra/`, HCP Terraform workspace, Entra directory

The centralus rebuild, the CAF renaming, the bootstrap-identity swap, the Key
Vault re-seed, the origin lock and the client re-pointing are all **done** — see
CHANGELOG and REVIEW.md Part 1. What remains:

- **Two runtime-read Key Vault secrets are missing**: `GCP-SERVICE-ACCOUNT-JSON`
  and `GITHUB-APP-PRIVATE-KEY`. Both are multi-line blobs resolved by
  `getSecret()` at execution time rather than through an app-setting reference,
  which is exactly why the diff that verified the other 19 did not catch them —
  it compared against `@Microsoft.KeyVault(...)` references, and these have
  none. Procedure in REVIEW.md §3.1; seed with `--file`, not `--value`.
- **Prove the deploy end to end from `main`.** The first dispatch (2026-08-20)
  got as far as Azure Login and failed with `AADSTS700213` — which exposed a
  real defect, now fixed: GitHub composes the OIDC subject with numeric org and
  repository IDs embedded
  (`repo:HybridCloudWorks@312844660/HCW-HybridCloudWorks@1268997852:...`), not
  the documented `repo:<org>/<repo>:...`. The identity trusted only the
  documented form, so **every deploy would have failed at login, including from
  `main`** — invisible until now because all four deploy workflows were
  disabled. Both subject forms are trusted as of 2026-08-20.

  Still unproven: deploys are gated to `refs/heads/main`
  (`github_deploy_ref`), so a dispatch from a feature branch cannot
  authenticate by design. Merge, then dispatch `deploy-functions.yml` from
  `main`. If it still fails at login, compare the presented subject in the
  error against the `federated_subjects` output — that output exists for
  exactly this comparison.
- **The origin-secret handshake is unproven end to end.** The IP half is
  demonstrated (origin 403s, Cloudflare path reaches the app); the header half
  is structurally verified only, because there is no deployed code to observe
  it. If anonymous rate-limited endpoints throw after the first deploy, the
  secret is mismatched — rollback is `functions_origin_lock_enabled = false`.

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

### T-318 — Route image rendering through `resolveMediaUrl()`
**Files:** ~30 components rendering `imageUrl` / `heroImageUrl` / `aiImageUrls`

**Now unblocked.** This was conditional on the same-origin/cross-origin
decision. That decision is settled: the origin lock restricts the Function App
to Cloudflare IP ranges, so the API is reachable only at
`https://api-azure.hybridcloudworks.com/api` and the topology is **cross-origin
by construction**, not by preference.

Uploaded-image URLs are stored site-relative (`/api/public/media/...`) so a
topology change cannot invalidate rows already in Cosmos. Components render them
straight into `<img src>`, which is correct only in the same-origin shape. Every
render site must now call `resolveMediaUrl()` from
`frontend/src/lib/functionsBase.js`; the helper and its tests already exist.

Watch for the legacy case the original note flagged: some documents hold
absolute source-system URLs. `resolveMediaUrl()` must pass those through
untouched rather than prefixing them.

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
| Unit | `resolveMediaUrl()` on a site-relative path and a legacy absolute URL | prefixes the first, passes the second through untouched | T-318 |

One test worth adding as soon as code is deployed: an anonymous request through
Cloudflare succeeds while the same request to the `azurewebsites.net` origin
returns 403. That is the only assertion proving the origin lock end to end, and
it cannot be written until there is a route to call.
