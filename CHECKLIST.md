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
(consumed by code but not yet provisioned) · `Retired` (no longer read by any
code, and listed so it is not reintroduced).

---

## Status

| | |
| --- | --- |
| Total entries | 30 |
| Critical config defects | 2 (`VITE_AZURE_FUNCTIONS_URL`, `VITE_ENTRA_API_SCOPE`) — both unset, both required |
| Verified | 0 |
| Unverified | 21 |
| Missing | 8 |
| Retired | 2 |
| Last updated | 2026-08-09 |

Nothing is `Verified`: no Azure control plane, Terraform apply, or deployed
environment has been reachable from any session to date (see
[REVIEW.md](REVIEW.md) §1.1–§1.2).

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
| `COSMOS_CONNECTION_STRING` | Change-feed trigger binding only (not the SDK client) | No | App setting | `functions/src/functions/cosmos-triggers.js` | `XXXXXXXXX!XXXXX00000!!!!!` | Missing | Carries the account **primary key** and blocks `local_authentication_disabled`, for two empty trigger handlers — see [TODO.md](TODO.md) T-315 |
| `STORAGE_ACCOUNT_NAME` | Blob storage account, and the account name the user-delegation SAS signature needs | Yes | Azure resource (`infra/main.tf`) | `functions/src/lib/blob-storage.js` | `XXXXXXXXXXX` | Unverified | Derived from `STORAGE_BLOB_ENDPOINT` when absent |
| `STORAGE_BLOB_ENDPOINT` | Blob service endpoint the client is built against | **Yes** | Azure resource (`infra/main.tf`) | `functions/src/lib/blob-storage.js` | `XXXXX!//XXXXXXXXXXX.XXXX.XXXX.XXXXXXX.XXX/` | Unverified | Preferred over the account name because it carries the correct suffix for the account's cloud |
| `STORAGE_ACCOUNT_KEY` | Shared key for SAS generation | **Must not exist** | — | No longer read by any code | `XXXXX00000!!!!!XXXXX` | **Retired** | T-104 resolved: SAS tokens are user-delegation, signed via managed identity. A test asserts this name cannot return to the module |
| `STORAGE_CONNECTION_STRING` | Blob client connection | **Must not exist** | — | No longer read by any code | `XXXXXXXXX!XXXXX00000!!!!!` | **Retired** | T-104 resolved: the client is `DefaultAzureCredential` + `STORAGE_BLOB_ENDPOINT`. A test asserts this name cannot return to the module |
| `KEY_VAULT_URI` | Key Vault the app resolves secrets from | Yes | Azure resource | Functions host config | `XXXXX!//XXXXXXX.XXXX.XXXXX.XXX!` | Unverified | |

## 3. Azure Functions — Anti-Abuse

| Variable Name | Purpose | Required | Source | Consumer | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `CF_ORIGIN_SECRET` | Shared secret proving a request came via Cloudflare | Yes | Operator-generated | `functions/src/lib/client-identity.js` | `XXXXX00000!!!!!XXXXX` | Missing | Anonymous submission path depends on it |
| `CLIENT_IP_SALT` | Salt for hashing client IPs into quota keys | Yes | Operator-generated | `functions/src/lib/client-identity.js` | `XXXXX00000!!!!!XXXXX` | Missing | Rotating it resets all live quota counters |

## 4. Azure Functions — AI Providers

Consumed by the 17 unimplemented AI RPCs (see [TODO.md](TODO.md) T-207). All
`Missing`; the RPCs cannot be ported until these exist. **16 of those RPCs have
live frontend call sites and are 404ing in the admin UI today.**

| Variable Name | Purpose | Required | Source | Consumer | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource endpoint | Yes | Azure resource | AI RPC set | `XXXXX!//XXXXXXX.XXXXXX.XXX!` | Missing | |
| `AZURE_OPENAI_KEY` | Azure OpenAI API key | Yes | Key Vault | AI RPC set | `XXXXX00000!!!!!XXXXX` | Missing | |
| `AZURE_OPENAI_GPT_DEPLOYMENT` | Text deployment name | Yes | Azure OpenAI | AI RPC set | `XXXXX-XXXXX` | Missing | |
| `AZURE_OPENAI_DALLE_DEPLOYMENT` | Image deployment name | Yes | Azure OpenAI | AI RPC set | `XXXXX-XXXXX` | Missing | |

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

| Variable Name | Purpose | Required | Source | Consumer | Expected Format | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `CI_RUNNER` | Repository variable selecting the CI runner | No | GitHub repo variable | `.github/workflows/ci.yml` | `!"XXXX-XXXXXX"!` | Unverified | JSON array string; absent ⇒ `ubuntu-latest` |
| `DOCKERHUB_USERNAME` | Registry account for the runner image | Yes (runner build) | GitHub secret | runner image workflow | `XXXXXXXXX` | Missing | |
| `DOCKERHUB_TOKEN` | Registry push credential | Yes (runner build) | GitHub secret | runner image workflow | `XXXXX00000!!!!!XXXXX` | Missing | |
| GitHub App id / private key | Runner JIT registration | Yes (runner) | GitHub App | `infra/runner-image/entrypoint.sh` | `000000` / `XXXXX00000!!!!!XXXXX` | Missing | Needs Administration: Read & write |

---

## Related

- Seeding procedure: [REVIEW.md](REVIEW.md) §4.2 (Key Vault), §4.4 (runner), §4.5 (MSAL SPA)
- Terraform variables without defaults: [REVIEW.md](REVIEW.md) §4.1
- Narrative variable documentation: [Variables.md](Variables.md)
