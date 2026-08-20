# CHECKLIST

Required input inventory for HCW-HybridCloudWorks — environment variables,
placeholder variables, secret references, API references, key references,
certificate references, required deployment inputs, and configuration
dependencies.

**Classification (Code Review SOP, CODE_REVIEW_PROMPT.md v1.0, Phase 10):** this
file records that an input is *required*, where it comes from, and who consumes
it.

> **This file must never contain actual values.**
> Expected formats use placeholder patterns only: `X` = letter, `0` = number,
> `!` = special character. Example: `XXXXX00000!!!!!XXXXX`
>
> No real tokens, keys, URLs, tenant IDs, subscription IDs, GUIDs, passwords,
> or connection strings. If a real value ever appears here, treat it as
> disclosed and rotate it.

**Validation Status** is one of: `Verified` (observed working in a deployed
environment) · `Unverified` (declared in code, never exercised) · `Missing`
(consumed by code but not yet provisioned) · `Placeholder` (provisioned, but
holding a stub value that cannot work — tracked separately from `Missing`
because it fails *differently*: an unset input usually produces a clear "not
supplied" error, a stubbed one produces an authentication or resolution failure
that reads like a permissions or networking problem) · `Retired` (no longer read
by any code, and listed so it is not reintroduced).

---

## Status

| | |
| --- | --- |
| Total entries | 64 |
| Critical config defects | 3 (§8 as a set, `VITE_AZURE_FUNCTIONS_URL`, `VITE_ENTRA_API_SCOPE`) |
| Verified | 0 |
| Unverified | 26 |
| Missing | 36 |
| Placeholder | 0 |
| Retired | 6 |
| Last updated | 2026-08-19 (third pass) — first real apply run. Azure OpenAI retired entirely (§4): AI moves to external provider APIs, so `infra/openai.tf` and `outputs-openai.tf` are deleted along with the account, its diagnostic setting and the `ai` resource group. Forced by two apply-time facts — zero gpt-4o TPM quota in every SKU, and no DALL-E model in southcentralus at all. Key Vault renamed `kv-site-prod-scus-01` (the unsuffixed name is held by an unrelated Azure customer). Same pass: HCP Terraform coordinates corrected against the live API: organization is `hcw` (not `HybridCloudWorks`), the declared workspace never existed, and a new empty `hcw-azure` workspace was created in the `Site` project. The federated credentials still carry the old subject and must be replaced by re-running the bootstrap. Earlier that day — GitHub variables remediated: `SUBSCRIPTION_ID` corrected to the application LZ, `RESOURCE_GROUP` and `FUNCTIONS_STORAGE_ACCOUNT` set to their deterministic values, the `CLIENT_ID`/`APP_HOSTNAME` stubs deleted (unset fails legibly; values exist only after the first apply). No `Placeholder` entries remain. 2026-08-18 (third pass) — live Azure reconciliation: four ALZ subscriptions observed, the earlier bootstrap's artifacts observed GONE (§8 superseded, run order inverted to bootstrap-first), `SUBSCRIPTION_ID` found pointing at Connectivity instead of the application LZ (reclassified `Placeholder`), `TENANT_ID` corroborated against the live directory. Second pass: `AZURE_FUNCTIONS_URL` renamed to `FUNCTIONS_URL` (§7), stale variable references corrected. First pass: §7 reconciled against live repository config and §7b added. Every `secrets.*`, `vars.*` and `environment:` reference in `.github/workflows/**` was enumerated and checked against the repository: 8 secrets absent (the repository has none at all), 7 variables absent, 2 environments absent. Five §7 variables previously recorded `Missing` are now set — three of them to one-character stubs, hence the new `Placeholder` status |

Nothing is `Verified` *from an engineering session*: no Azure control plane
has been reachable from any session to date (REVIEW.md §1.1–§1.2). Operator
evidence exists — the 2026-08-14 smoke run and the 2026-08-18 hardening
apply + cold-start check — but per this file's definition an entry flips to
`Verified` only when the specific input is observed working, not when the
system around it is.

---

## 1. Azure Functions — Identity and Authorization

| Variable Name | Purpose | Required | Source | Consumer | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ENTRA_TENANT_ID` | Directory tenant the API validates tokens against | Yes | Entra ID directory | `functions/src/lib/auth/` | `00000000-0000-0000-0000-000000000000` | Unverified | Shape only; not a real GUID |
| `ENTRA_CLIENT_ID` | API app registration client id | Yes | Entra app registration | `functions/src/lib/auth/` | `00000000-0000-0000-0000-000000000000` | Unverified | |
| `ENTRA_API_AUDIENCE` | Expected `aud` claim; must match the SPA's requested scope | Yes | Entra app registration | `functions/src/lib/auth/` | `XXX!//00000000-0000-0000-0000-000000000000` | Unverified | **Highest-risk mismatch.** If this and `VITE_ENTRA_API_SCOPE` disagree, sign-in succeeds and every API call 401s |

## 2. Azure Functions — Data Plane

| Variable Name | Purpose | Required | Source | Consumer | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `COSMOS_ENDPOINT` | Cosmos DB account endpoint | Yes | Azure resource | `functions/src/lib/cosmos-client.js` | `XXXXX!//XXXXXXX.XXXXXX.XXXXX.XXX!` | Unverified | |
| `COSMOS_DATABASE` | Database name | Yes | Terraform variable | `functions/src/lib/cosmos-client.js` | `XXXXXXX` | Unverified | |
| `STORAGE_ACCOUNT_NAME` | Blob storage account, and the account name the user-delegation SAS signature needs | Yes | Azure resource (`infra/main.tf`) | `functions/src/lib/blob-storage.js` | `XXXXXXXXXXX` | Unverified | Derived from `STORAGE_BLOB_ENDPOINT` when absent |
| `STORAGE_BLOB_ENDPOINT` | Blob service endpoint the client is built against | **Yes** | Azure resource (`infra/main.tf`) | `functions/src/lib/blob-storage.js` | `XXXXX!//XXXXXXXXXXX.XXXX.XXXX.XXXXXXX.XXX/` | Unverified | Preferred over the account name because it carries the correct suffix for the account's cloud |
| `STORAGE_ACCOUNT_KEY` | Shared key for SAS generation | **Must not exist** | — | No longer read by any code | `XXXXX00000!!!!!XXXXX` | **Retired** | T-104 resolved: SAS tokens are user-delegation, signed via managed identity. A test asserts this name cannot return to the module |
| `STORAGE_CONNECTION_STRING` | Blob client connection | **Must not exist** | — | No longer read by any code | `XXXXXXXXX!XXXXX00000!!!!!` | **Retired** | T-104 resolved: the client is `DefaultAzureCredential` + `STORAGE_BLOB_ENDPOINT`. A test asserts this name cannot return to the module |
| `KEY_VAULT_URI` | Key Vault the app resolves secrets from | Yes | Azure resource | Functions host config | `XXXXX!//XXXXXXX.XXXX.XXXXX.XXX!` | Unverified | |

## 2b. Labs VPS Agent — Entra directory configuration

Provisioned by hand, not by this repository's Terraform: these are Entra
directory objects and Cosmos documents, not Azure resources. See
[REVIEW.md](REVIEW.md) §0.4.

**The agent holds no database credential.** If anything in this section ever
grows a `COSMOS_*` entry, something has gone wrong.

| Variable Name | Purpose | Required | Source | Consumer | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `LABS_AGENT_API_BASE` | Functions API base, including the `api` route prefix | **Yes** | Deployment | `vps-agent/lib/api.js` | `XXXXX!//XXX-XXXXXXX.XXXXXXXXXXX.XXX/XXX` | **Missing** | Same value shape as `VITE_AZURE_FUNCTIONS_URL`, and subject to the same `/api` requirement |
| `LABS_AGENT_TENANT_ID` | Directory tenant for the agent credential | **Yes** | Entra directory | `vps-agent/lib/api.js` | `00000000-0000-0000-0000-000000000000` | **Missing** | |
| `LABS_AGENT_CLIENT_ID` | The agent's own app registration | **Yes** | Entra app registration | `vps-agent/lib/api.js` | `00000000-0000-0000-0000-000000000000` | **Missing** | **One registration per agent host**, so a compromised VPS is revoked alone rather than fleet-wide |
| `LABS_AGENT_CERT_PATH` | PEM holding the certificate and private key | **Yes** | Generated **on the VPS** | `vps-agent/lib/api.js` | `/XXX/XXX/XXXXX-XXXXX.XXX` | **Missing** | Generate the key on the host and upload only the public certificate. Root-owned, `0600`, outside the repository |
| `LABS_AGENT_API_SCOPE` | Scope requested for the API token | **Yes** | Entra app registration | `vps-agent/lib/api.js` | `XXX!//00000000-0000-0000-0000-000000000000/.XXXXXXX` | **Missing** | Audience must match `ENTRA_API_AUDIENCE`, exactly as `VITE_ENTRA_API_SCOPE` must |
| `LABS_AGENT_ID` | Which `lab_agents` document this host is | **Yes** | Operator | `vps-agent/index.js` | `XXX-XXXXXXXXX-00` | **Missing** | Defaults to the hostname. A wrong value fails closed — the server refuses it unless the registry document's `oid` matches this credential |

Not environment variables, but required for any of the above to work:

| Input | Purpose | Required | Source | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `LabAgent` App Role | Gate 1 of the agent guard | **Yes** | API app registration manifest | `XXXXXXXX` | **Missing** | Assigned to each agent registration's service principal. Deliberately distinct from `Admin` — the two guards are disjoint |
| `lab_agents/{agentId}` document | Gate 2 of the agent guard | **Yes** | Cosmos, written by an admin | `{oid, active, capabilities[]}` | **Missing** | `oid` is the agent service principal's object id. `capabilities` is what the agent may claim — the agent cannot set it. `active: false` revokes immediately |

## 3. Azure Functions — Anti-Abuse

| Variable Name | Purpose | Required | Source | Consumer | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `CF_ORIGIN_SECRET` | Shared secret proving a request came via Cloudflare | Yes | Operator-generated | `functions/src/lib/client-identity.js` | `XXXXX00000!!!!!XXXXX` | Missing | Anonymous submission path depends on it |
| `CLIENT_IP_SALT` | Salt for hashing client IPs into quota keys | Yes | Operator-generated | `functions/src/lib/client-identity.js` | `XXXXX00000!!!!!XXXXX` | Missing | Rotating it resets all live quota counters |

## 4. Azure Functions — AI Providers

**The Azure OpenAI path was retired 2026-08-19.** Model calls go to external
provider APIs, keyed by the `*_API_KEY` app settings that resolve from Key
Vault (§2 and `infra/main.tf`), so the four names below must stay unset — the
account they described no longer exists in the configuration.

The 17 AI RPCs remain unimplemented (see [TODO.md](TODO.md) T-207), and **16
of them have live frontend call sites that are 404ing in the admin UI today**.
That is unchanged by this: it was never these variables blocking them, and
whoever ports the RPCs writes them against the provider APIs rather than an
Azure endpoint.

Two facts drove the decision, both discovered at apply time: the subscription
holds **zero TPM quota for gpt-4o in every SKU**, and southcentralus offers no
DALL-E model at all. Requesting quota would have unblocked a path nothing
consumed.

| Variable Name | Purpose | Required | Source | Consumer | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource endpoint | **No — must not exist** | — | No consumer | `XXXXX!//XXXXXXX.XXXXXX.XXX!` | **Retired** | 2026-08-19: AI moved to external provider APIs, and `infra/openai.tf` was deleted with the account. Nothing derives this any more |
| `AZURE_OPENAI_KEY` | Azure OpenAI API key | **No — must not exist** | — | No consumer | `XXXXX00000!!!!!XXXXX` | **Retired** | Was already absent by design (the account was keyless); now moot — there is no account |
| `AZURE_OPENAI_GPT_DEPLOYMENT` | Text deployment name | **No — must not exist** | — | No consumer | `XXXXX-XXXXX` | **Retired** | gpt-4o had zero TPM quota in every SKU in this subscription, which is what surfaced the decision |
| `AZURE_OPENAI_DALLE_DEPLOYMENT` | Image deployment name | **No — must not exist** | — | No consumer | `XXXXX-XXXXX` | **Retired** | southcentralus offers no DALL-E model at all; image generation goes through the provider API |

## 5. Azure Functions — Runtime and Feature Flags

| Variable Name | Purpose | Required | Source | Consumer | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `FEATURE_FLAG_SCHEDULERS` | Gates all four timer triggers together | Yes | App setting | `functions/src/functions/schedulers.js` | `XXXXX` | Unverified | **Must stay `false`.** One flag arms four timers, one of which deletes blobs with an unimplemented body — see [TODO.md](TODO.md) T-301, T-302 |
| `NODE_ENV` | Runtime mode | No | Host | Functions runtime | `XXXXXXXXXX` | Unverified | |
| `REGION_NAME` | Azure region, used in logging | No | Host | Functions runtime | `XXXXXX` | Unverified | Host-provided |
| `WEBSITE_SITE_NAME` | Function App name | No | Host | Functions runtime | `XXX-XXXXXXX-XXXX` | Unverified | Host-provided |

## 6. Frontend — Build-Time (Vite)

Vite inlines `VITE_*` at build time. **Everything here ships to the browser and
is publicly readable — no secret may ever be added to this section.**

| Variable Name | Purpose | Required | Source | Consumer | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `VITE_AZURE_FUNCTIONS_URL` | The one API base URL the browser needs | **Yes** | Deployment | `frontend/src/lib/functionsBase.js` — the only module that reads it, enforced by test | Cross-origin `XXXXX!//XXX-XXXXXXX.XXXXXXXXXXX.XXX/XXX`; same-origin `/XXX` | **Missing** | **Must end in the Functions route prefix `/api`** — routes are registered relative to it, so a base without it 404s uniformly. `/api` selects same-origin, an absolute origin selects cross-origin ([REVIEW.md](REVIEW.md) §0.1). Must agree with the CSP `connect-src`. A deploy build without it now fails (`REQUIRE_API_BASE=true`) |
| `VITE_ENTRA_CLIENT_ID` | SPA app registration client id | Yes | Entra app registration | `frontend/src/lib/msalConfig.js` | `00000000-0000-0000-0000-000000000000` | Unverified | Distinct from the API's `ENTRA_CLIENT_ID` |
| `VITE_ENTRA_TENANT_ID` | Directory tenant for the SPA authority | Yes | Entra directory | `frontend/src/lib/msalConfig.js` | `00000000-0000-0000-0000-000000000000` | Unverified | Falls back to `common` if unset — set it explicitly |
| `VITE_ENTRA_API_SCOPE` | Scope requested so the token audience matches the API | Yes | Entra app registration | `frontend/src/lib/msalConfig.js` | `XXX!//00000000-0000-0000-0000-000000000000/XXXXXX_XX_XXXXX` | Unverified | **Must correspond to `ENTRA_API_AUDIENCE`.** Empty or wrong ⇒ sign-in works, all API calls 401 |
| `VITE_TRANSLATIONS` | Enables translation features | No | Deployment | frontend i18n | `XXXXX` | Unverified | |
| `VITE_DEFAULT_LANGUAGE` | Default UI language | No | Deployment | frontend i18n | `XX` | Unverified | |
| `VITE_NEWS_ENABLE_INSIGHTS` | Toggles AI insights on news pages | No | Deployment | `frontend/src/hooks/useNewsData.js` | `XXXXX` | Unverified | |
| `VITE_SOCIAL_GITHUB_URL` | Footer social link | No | Deployment | frontend layout | `XXXXX!//XXXXXX.XXX/XXXXXXX` | Unverified | Public URL, not a secret |
| `VITE_SOCIAL_LINKEDIN_URL` | Footer social link | No | Deployment | frontend layout | `XXXXX!//XXX.XXXXXXXX.XXX/XX/XXXXXXX` | Unverified | Public URL, not a secret |
| `VITE_SOCIAL_X_URL` | Footer social link | No | Deployment | frontend layout | `XXXXX!//X.XXX/XXXXXXX` | Unverified | Public URL, not a secret |

## 7. CI / Deployment Inputs

Names follow the variable naming standard (Wiki: IaC-Repository-Standard):
UPPER_SNAKE_CASE, max 2 words (3 only to break a collision), no provider
prefixes. Contractual names (`VITE_*`, `GITHUB_TOKEN`) are exempt.

Seeding is scripted: `scripts/set-github-variables.ps1` sets `TENANT_ID` and
`SUBSCRIPTION_ID` immediately (the two values that are inputs *to* Terraform),
and on a re-run after the first apply pulls `CLIENT_ID`, `APP_HOSTNAME`,
`FUNCTIONS_URL`, `RESOURCE_GROUP`, `FUNCTIONS_STORAGE_ACCOUNT` and
`COSMOS_ENDPOINT` from the workspace's Terraform state outputs — applied
reality, not a hardcoded copy that drifts. Re-run it after any apply that
changes an output. What it deliberately does not set is listed in its header
(the SWA token is fetched at deploy time, `COSMOS_KEY` stays unset,
`VITE_ENTRA_*` come from the manual Entra registrations).


| Variable Name | Purpose | Required | Source | Consumer | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `CI_RUNNER` | Repository variable selecting the CI runner | No | GitHub repo variable | 7 workflows: `ci`, `codeql`, `deploy-infra`, `iac-validate`, `repository-policy`, `sync-wiki`, `validate-deployed` | `!"XXXX-XXXXXX"!` | Unverified | JSON array string; **deliberately absent** ⇒ `ubuntu-latest`, which is normal operation. Absence is the reason the Actions extension reports "Context access might be invalid" on all 8 references; that warning is expected here and must not be "fixed" by setting the variable |
| `DOCKERHUB_USERNAME` | Registry account for the runner image | Yes (runner build) | GitHub secret | `build-runner-image.yml` (3 references) | `XXXXXXXXX` | Missing | Confirmed absent 2026-08-18 |
| `DOCKERHUB_TOKEN` | Registry push credential | Yes (runner build) | GitHub secret | `build-runner-image.yml` | `XXXXX00000!!!!!XXXXX` | Missing | Confirmed absent 2026-08-18 |
| GitHub App id / private key | Runner JIT registration | Yes (runner) | GitHub App | `infra/runner-image/entrypoint.sh` | `000000` / `XXXXX00000!!!!!XXXXX` | Missing | Needs Administration: Read & write |
| `CLIENT_ID` | Deploy identity client id for OIDC login | **Yes** | Terraform output `client_id` | `heal-computed-properties.yml`, `deploy-functions.yml` | `00000000-0000-0000-0000-000000000000` | **Missing** | One-character stub deleted 2026-08-19: unset fails with a clear "not supplied", the stub failed like a permissions problem. Deliberately absent until the first apply produces the `client_id` output. While unset, the healer's schedule job self-skips (its `if:` guard). Renamed from AZURE_CLIENT_ID before ever being set, per the variable naming standard |
| `TENANT_ID` | Entra tenant for OIDC login | **Yes** | Entra directory | same workflows | `00000000-0000-0000-0000-000000000000` | **Unverified** | Set, GUID-shaped, and confirmed to match the directory holding the four ALZ subscriptions (observed 2026-08-18 via `az account show`). Never exercised by a successful run, so not `Verified` |
| `SUBSCRIPTION_ID` | Target subscription for OIDC login | **Yes** | Azure subscription | same workflows | `00000000-0000-0000-0000-000000000000` | **Unverified** | Corrected 2026-08-19: was the id of `sub-plat-conn-prod-scus` — the wrong subscription, which would have failed as an authorization error after login — now `sub-app-site-prod-scus`'s id, the landing zone the consumers deploy into. Never exercised by a successful run, so not `Verified` |
| `APP_HOSTNAME` | Function App default hostname for the post-deploy health check | Yes (functions deploy) | Azure resource | `.github/workflows/deploy-functions.yml` | `XXX-XXXXXXXXX-XXXX.XXXXXXXXXXXXX.XXX` | **Missing** | One-character stub deleted 2026-08-19 — the value is the `function_hostname` Terraform output and cannot exist before the first apply. Renamed from FUNCTION_APP_HOSTNAME per the naming standard |
| `RESOURCE_GROUP` | Resource group for the T-503 storage firewall window | Yes (functions deploy) | Terraform output `web_resource_group` | `.github/workflows/deploy-functions.yml` | `XX-XXX-XXXX-XXXX-XXXX` | **Unverified** | Was a one-character stub; set 2026-08-19 to the Function App's group. Authoritative source is the `web_resource_group` output — `set-github-variables.ps1` wave 2 re-copies it from applied state, so the value cannot drift from code. Not `Verified` until a deploy exercises it |
| `FUNCTIONS_STORAGE_ACCOUNT` | Host storage account for the T-503 firewall window | Yes (functions deploy) | Terraform output `functions_storage_account` | `.github/workflows/deploy-functions.yml` | `XXXXXXXXXXXXXXXX` | **Unverified** | Set 2026-08-19. Authoritative source is the `functions_storage_account` output — `set-github-variables.ps1` wave 2 re-copies it from applied state. Paired with `RESOURCE_GROUP` by construction: that output reads the group off this account's own attribute. Not `Verified` until a deploy exercises it |
| `TF_API_TOKEN` | HCP Terraform API token the gated infra workflow authenticates its run with | Yes (infra delivery) | HCP Terraform user/team token | `deploy-infra.yml` | `XXXXX00000!!!!!XXXXX` | Missing | Confirmed absent 2026-08-18. Distinct from everything in §8: §8 is how Terraform reaches *Azure*, this is how the workflow reaches *Terraform* |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Deployment token for the Static Web App | Yes (frontend deploy) | Azure Static Web App resource | `deploy-azure-frontend.yml` | `XXXXX00000!!!!!XXXXX` | Missing | Confirmed absent 2026-08-18 |
| `FUNCTIONS_URL` | API base URL injected into the frontend build | Yes (frontend deploy) | Azure Function App | `deploy-azure-frontend.yml` (2 references) | `XXXXX!//XXX-XXXXXXXXX-XXXX.XXXXXXXXXXXXX.XXX/XXX` | Missing | Confirmed absent 2026-08-18. Repository **variable**, not a secret — a public API base URL is not sensitive. Renamed 2026-08-18 from `AZURE_FUNCTIONS_URL` (provider prefix, 3 words) per the variable naming standard, before ever being provisioned. Feeds `VITE_AZURE_FUNCTIONS_URL` (§6) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Source-side credential for the Firestore export | Yes (data migration) | Firebase service account | `migrate-data.yml` | `!XXXXX! XXXXX!!!!!XXXXX!` | Missing | Confirmed absent 2026-08-18. Whole-JSON credential; the migration workflow is `if: false` and must stay so until this is provisioned and scoped read-only |
| `COSMOS_ENDPOINT` (secret) | Target account endpoint for migration and healing | Yes (migration, healing) | Azure resource | `migrate-data.yml`, `heal-computed-properties.yml` | `XXXXX!//XXXXXXX.XXXXXX.XXXXX.XXX!` | Missing | Confirmed absent 2026-08-18. Same value as the §2 runtime `COSMOS_ENDPOINT`, but a separate GitHub-side reference |
| `COSMOS_KEY` | Optional account key for the migration import | **No — must stay unset** | Azure resource (scratch accounts only) | `migrate-data.yml` → `scripts/lib/cli.mjs` | `XXXXX00000!!!!!XXXXX` | Missing (correctly) | Confirmed absent 2026-08-18, which is the required state. `connectCosmos()` uses a key only when this is non-empty and otherwise falls through to `DefaultAzureCredential`; an unset secret interpolates to the empty string, so the workflow already takes the Entra path. **Do not provision it to silence the linter**: `cosmos_local_auth_disabled` defaults `true`, so key auth is off on the real account and setting this would switch the client to a key path that the account rejects. It exists for the throwaway-account rehearsal in Migration_Plan §5 |
| `VITE_ENTRA_CLIENT_ID` | SPA app registration client id, build-time | Yes (frontend deploy) | Entra app registration | `deploy-azure-frontend.yml` | `00000000-0000-0000-0000-000000000000` | Missing | Confirmed absent 2026-08-18. Repository **variable**, not a secret |
| `VITE_ENTRA_TENANT_ID` | Directory tenant for the SPA, build-time | Yes (frontend deploy) | Entra directory | `deploy-azure-frontend.yml` | `00000000-0000-0000-0000-000000000000` | Missing | Confirmed absent 2026-08-18. Repository **variable**, not a secret |
| `VITE_SOCIAL_X_URL` | Footer social link | No | Editorial | `deploy-azure-frontend.yml` | `XXXXX!//XXX.X.XXX/XXXXXXX` | Missing | Confirmed absent 2026-08-18. Cosmetic; absence renders an empty link target |
| `VITE_SOCIAL_LINKEDIN_URL` | Footer social link | No | Editorial | `deploy-azure-frontend.yml` | `XXXXX!//XXX.XXXXXXXX.XXX/XX/XXXXXXX` | Missing | Confirmed absent 2026-08-18. Cosmetic |
| `VITE_SOCIAL_GITHUB_URL` | Footer social link | No | Editorial | `deploy-azure-frontend.yml` | `XXXXX!//XXXXXX.XXX/XXXXXXX` | Missing | Confirmed absent 2026-08-18. Cosmetic |

---

## 7b. GitHub Environments

Two workflows declare a job `environment:`. Neither environment exists — only
`copilot` does (observed 2026-08-18 via the repository environments API) — which
is what the Actions extension reports as `Value 'production-infra' is not valid`
and `Value 'data-migration' is not valid`. Both jobs are `if: ${{ false }}`, so
nothing fails today.

These are not cosmetic. An environment is where required reviewers and
branch/tag restrictions live, and `deploy-infra.yml` is the workflow that applies
production infrastructure — the environment *is* the human-review gate that
workflow documents. Creating them without protection rules would satisfy the
linter while removing the gate, which is worse than the current state.

`data-migration` carries a second constraint: `infra/oidc.tf` pins a federated
credential to the subject `repo:<org>/<repo>:environment:data-migration`. The
environment name is therefore load-bearing in two places, and renaming it breaks
OIDC login with AADSTS70021.

| Environment | Purpose | Required | Consumer | Protection expected | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `production-infra` | Human-review gate for production Terraform applies | Yes (before enabling infra delivery) | `deploy-infra.yml` | Required reviewers; restrict to the deploy ref | Missing | Create with reviewers *before* flipping `if: false`, not after |
| `data-migration` | Gate for the one-shot Firestore → Cosmos migration | Yes (before enabling migration) | `migrate-data.yml` | Required reviewers | Missing | Name is also the OIDC subject in `infra/oidc.tf`; must match exactly |

---
## 8. HCP Terraform workspace — environment variables

How Terraform itself authenticates to Azure. These are set in the
`hcw-azure` workspace as **environment** variables, not in
GitHub and not as Terraform variables. Without them no run can reach Azure at
all, which makes every other `Missing` entry in this file unreachable rather
than merely unset — this is the first thing to provision, not the last.

All four names are dictated by HashiCorp and Microsoft and are therefore
**contractual**: exempt from the 2-word rule, never renamed.

| Variable Name | Purpose | Required | Source | Consumer | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `TFC_AZURE_PROVIDER_AUTH` | Switches the workspace to dynamic provider credentials | **Yes** | HCP Terraform workspace | HCP Terraform run environment | `true` | **Missing** | Absent ⇒ HCP Terraform never mints an OIDC token and the provider finds no credential |
| `TFC_AZURE_RUN_CLIENT_ID` | Client id of `id-plat-terraform-prod-cus-01`, the identity HCP Terraform assumes | **Yes** | `scripts/bootstrap-terraform-oidc.ps1` output | HCP Terraform run environment | `00000000-0000-0000-0000-000000000000` | **Missing** | Distinct from §7 `CLIENT_ID`, which is the GitHub Actions identity created by `infra/oidc.tf` |
| `ARM_TENANT_ID` | Entra tenant for the token exchange | **Yes** | Entra directory | `azurerm` provider | `00000000-0000-0000-0000-000000000000` | **Missing** | Same value as the `entra_tenant_id` Terraform variable |
| `ARM_SUBSCRIPTION_ID` | Target subscription | **Yes** | Azure subscription | `azurerm` provider | `00000000-0000-0000-0000-000000000000` | **Missing** | Same value as the `subscription_app` Terraform variable. Fallback only: every provider pins `subscription_id` in HCL (`infra/providers.tf`), so this never decides where resources land |

Bootstrap procedure — including the two federated credentials on
`id-plat-terraform-prod-cus-01` that these variables depend on — is section 0 of the
[Deployment Runbook](.github/wiki/Deployment-Runbook.md).

**The 2026-08-18 bootstrap run is SUPERSEDED — its artifacts no longer
exist.** That run provisioned `rg-hcw-bootstrap` and `id-hcw-terraform` in
the subscription then named "Azure subscription 1". Observed later the same
day: that subscription is now `sub-plat-conn-prod-scus` (renamed during the
ALZ re-shape), and **all four ALZ subscriptions hold zero resource groups** —
the bootstrap resource group, the identity, its federated credentials and its
role assignments are gone. There is currently no Terraform identity at all.

Consequently the run order INVERTS from the earlier plan — bootstrap must run
FIRST, because `set-tfc-variables.ps1` requires the client id that only
bootstrap produces:

1. `bootstrap-terraform-oidc.ps1` with `-IdentitySubscriptionId` =
   `sub-plat-mgmt-prod-scus` (the identity is platform automation and belongs
   in Management, per the script's own doc) and `-TargetSubscriptionIds` =
   app + mgmt + conn. A target absent from that list is a subscription
   Terraform cannot deploy into.
2. `set-tfc-variables.ps1`, which discovers the client id off that identity
   and compares the federated credential subjects against the live
   organization, project and workspace, warning if they disagree.
3. Speculative `terraform plan` (the human-review gate), then apply.

All four variables above remain `Missing`, because none has been entered in
the HCP Terraform workspace yet.

**The topology is settled: four ALZ subscriptions exist** (observed
2026-08-19 via `az account list`): `sub-app-site-prod-scus`,
`sub-plat-conn-prod-scus`, `sub-plat-ident-prod-scus`,
`sub-plat-mgmt-prod-scus`. All four match the Naming-Convention page exactly
— the application subscription was renamed 2026-08-19 from
`sub-app-hcwsite-prod-scus`, which embedded the org token the scheme drops.
The configuration's three no-default subscription variables
(`subscription_app/mgmt/conn`) map to the first, second and fourth; Identity
deliberately has no variable, and the bootstrap script correctly leaves it
out of the preselected deployment targets.

**The HCP Terraform coordinates were wrong in every segment until 2026-08-19,
and the federated credentials still carry the old ones.** Verified against the
HCP Terraform API that day: the organization is `hcw`, not `HybridCloudWorks`;
the workspace `hybridcloudworks-azure` never existed. A new empty workspace
`hcw-azure` was created in the `Site` project for this configuration, and
`backend.tf` now names all three.

The one pre-existing workspace, `hcw/HCW`, must never be this configuration's
target: it holds 85 GCP/Firebase/VPS resources driven by the
`saulpatinojr/Personal-Site_HCW` repository, so a plan from `infra/` would
propose destroying all of them.

The federated credentials created by the earlier bootstrap run still read
`organization:HybridCloudWorks:project:Default Project:workspace:hybridcloudworks-azure`
— wrong in all three segments, which fails every run with AADSTS70021.
Re-running `bootstrap-terraform-oidc.ps1` replaces a drifted subject and is
safe and idempotent; `set-tfc-variables.ps1` now detects the mismatch and
prints the exact command rather than leaving it to a failed plan.

Related, and deliberately NOT fixed here:
`frontend/platform/terraform/backend.tf` names the same non-existent
organization and a workspace `Personal-Site_HCW` (the live one is `HCW`).
That stack's authoritative configuration lives in another repository, so this
copy may be stale — repointing it at a live 85-resource workspace without
first confirming the two match would risk a destructive plan.

---

## Related

- Bootstrap procedure: [Deployment Runbook](.github/wiki/Deployment-Runbook.md) §0
- Seeding procedure: [REVIEW.md](REVIEW.md) §4.2 (Key Vault), §4.4 (runner), §4.5 (MSAL SPA)
- Terraform variables without defaults: [REVIEW.md](REVIEW.md) §4.1
- Narrative variable documentation: [Variables.md](Variables.md)
