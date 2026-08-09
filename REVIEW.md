# REVIEW — human blockers

**Blockers only a human can resolve.**

**Classification (Code Review SOP, CODE_REVIEW_PROMPT.md v1.0, Phase 10):** this
file holds missing approvals, missing requirements, missing access, missing
credential ownership, and business, architecture, vendor, legal, or compliance
decisions. *If an engineer can resolve it without human input, it does not
belong here* — it belongs in [TODO.md](TODO.md).

Required inputs and configuration inventory are in [CHECKLIST.md](CHECKLIST.md).
Completed work is in [CHANGELOG.md](CHANGELOG.md).

Last updated 2026-08-09, against `main` @ `e4873b8`.

> **Reclassification notice.** This file predates the SOP and previously mixed
> human blockers with engineering work. Sections describing code to be written
> have moved to [TODO.md](TODO.md) as items T-001 through T-005. Section 5.0,
> which described the frontend as "still a Firebase client — this is the
> Go-Live blocker", is **obsolete**: the decoupling completed in PRs #61–#66 and
> the file counts it cited are now zero. It is retained below, struck through,
> until the next review confirms removal.

---

## 0. Decisions required by the 2026-08-09 code review

Raised by the SOP review run. Each blocks engineering work that cannot proceed
without a human decision. Tracked engineering work is in [TODO.md](TODO.md).

### 0.1 Deployment topology — same-origin or cross-origin?

TODO.md T-101 (API base URL) and T-102 (CORS) have **different correct answers**
depending on this, so it must be settled first.

- **Same-origin:** serve the API through the Static Web App via a linked backend
  or a `staticwebapp.config.json` `/api/*` rewrite. CORS becomes unnecessary and
  the API base becomes a relative path.
- **Cross-origin:** keep `api-azure.hybridcloudworks.com` separate and wire CORS
  across all 58 routes.

The decision is recorded nowhere. `infra/main.tf:530-544` removed the platform
CORS block on the reasoning that CORS lives in code, which implies cross-origin —
but no `azurerm_static_web_app_function_app_registration` exists either.

**Unblocked by:** an architecture decision.

### 0.2 Was a Cosmos key ever deployed? (rotation decision)

`frontend/.env.example:16-18` instructs operators to set `VITE_COSMOS_ENDPOINT`,
`VITE_COSMOS_READ_KEY` and `VITE_COSMOS_DATABASE`. Anything `VITE_`-prefixed is
compiled into the public browser bundle, and the SWA CSP still permits
`https://*.documents.azure.com` — so a populated value would be a published,
account-scoped read key over all 71 containers, including `admins`,
`admin_audit_logs`, `mcp_servers` (oauthToken) and every unpublished draft.

No file in `frontend/src` reads these variables, so this is a latent instruction
rather than an active leak. Removing the lines is engineering work (TODO.md
T-403/T-404). **The decision is whether rotation is required**, which depends on
whether the value was ever set in a real `.env`, in CI, or in Static Web App
application settings.

**Unblocked by:** someone with portal/CI access checking. If it was ever set:
rotate the Cosmos account keys and set `local_authentication_disabled = true`.

### 0.3 Authorize inspection of live container contents

Three findings cannot be closed from source and need one query each against the
deployed data:

| Question | Bears on |
| --- | --- |
| Document count in `content` and `blogs` | TODO.md T-206 — whether the 1000-row window is already truncating |
| `SELECT DISTINCT VALUE c.contentStatus FROM c WHERE STARTSWITH(c.contentStatus, 'published')` | Whether the four-value public allowlist hides legacy documents the old prefix match admitted |
| Contents of `podcasts`, `rss_cache`, `ai_insights`, `_snapshots` | TODO.md T-201/T-202 — the actual exposure of the unfiltered anonymous reads |

**Unblocked by:** read access to the deployed Cosmos account.

### 0.4 Credential model for the VPS agent

`vps-agent/index.js:16` uses a Cosmos **account primary key** — full read/write
on all 71 containers — deployed to a third-party VPS. Options: a resource token
scoped to `lab_jobs`/`lab_agents` brokered by an authenticated Functions
endpoint, or a workload identity with a scoped role assignment.

**Do not deploy the agent until this is decided.** Engineering work in TODO.md
T-401.

**Unblocked by:** an architecture/security decision.

---

## 1. Blocked by this environment

These cannot be done from an agent session regardless of scope or approval.

### 1.1 Terraform `validate`, `plan` and `apply` — never run

No Terraform binary is available in this environment, and no Terraform Cloud credentials.
**Every infrastructure change in this repository has been reasoned from configuration and checked
only for structure** — brace balance, resource references, argument names against provider docs.

This matters more than it normally would. Commit `7338db9` established that `terraform validate`
passes on a Function App configuration that can never apply, because validate checks schema, not
provider/API compatibility. A passing validate would not have been evidence either. **The only
meaningful check is `terraform plan` against the real provider**, and it has never been run against
this configuration.

Treat all infra work here as unverified until someone runs a plan.

**Unblocked by:** running `terraform plan` from Terraform Cloud, or locally with credentials.

### 1.2 Azure, Cloudflare and GCP control planes — no access

No credentials for any cloud account. Nothing has been provisioned, no secret has been written to
Key Vault, no DNS record inspected, no Firestore data read.

**Unblocked by:** an operator with Azure Owner / GitHub Owner performing the steps, using runbooks
prepared here.

### 1.3 The Wiki — outside the authorized repository set

`HCW-HybridCloudWorks.wiki` is not in this session's repository scope, so pushes are refused by the
git proxy. Two consequences:

- The merged Implementation TODO from #37 is **prepared but unpushed**. It rewrites
  `Implementation-TODO.md`, deletes `Implementation-Plan.md`, and updates `Home.md` and `_Sidebar.md`.
- The **Phase 4 data-migration write-up does not exist anywhere.** `35d3076` removed it from the
  repository "per the documentation policy", but it was never created in the Wiki. `README.md` and
  `Migration_Plan.md` both cite it as authoritative for the migration's findings and runbook.

**Unblocked by:** granting the session wiki access, or a manual paste.

### 1.4 `pwsh` unavailable — repository policy checked by hand

`scripts/validate-repository-structure.ps1` is the only gate that runs on every PR, and it cannot be
executed locally. Its constraints have been checked by reading the script and comparing by hand. CI
runs it for real on every PR, so this is low risk, but local checks are not equivalent.

### 1.5 MCP connectors not authorized

`Firecrawl_Search` and `Notion` require OAuth, which cannot be completed from a non-interactive
session. Notion is no longer relevant — it was retired as a secret source in #35. Firecrawl is
declared in `functions/package.json` and used by the scrape path; no work here depended on it.

**Unblocked by:** authorizing them in claude.ai connector settings.

---

## 2. Blocked on a decision, not on capability

### 2.1 Dependabot #17 — eslint 9 → 10

**Upstream blocked. Nothing to do on our side.**

eslint 10 crashes `eslint-plugin-react`:

```
TypeError: contextOrFilename.getFilename is not a function
  at resolveBasedir (eslint-plugin-react/lib/util/version.js:31)
```

`npm run lint` goes from working to exit 2. Both `eslint-plugin-react` (peer `≤9.7`) and
`eslint-plugin-jsx-a11y` (peer `≤9`) cap below 10.

**Unblocked by:** both plugins shipping eslint-10 peer support. Then the bump and both plugin
upgrades land together. Monitor only.

### 2.2 react-router — 2 HIGH advisories, deliberately not fixed

GHSA-qwww-vcr4-c8h2, "RSC Mode CSRF Bypass". **Assessed as not applicable**: the advisory is specific
to React Server Components mode, and this is a plain Vite SPA using only `useNavigate` / `Link` /
`useLocation` with no RSC entry points.

There is also no fixed version *above* the current one — the advisory range is 7.12.0 – 8.2.0 and
npm's only proposed remedy is a **downgrade** to 7.11.0, losing seven minor versions to mitigate a
code path the app does not execute.

The "not reachable" conclusion rests on a source scan for RSC entry points. **If RSC adoption is ever
planned, this flips.**

**Unblocked by:** an upstream fix above 8.2.0, or a decision to adopt RSC (which would make it real).

### 2.3 GCP Secret Manager stack — 8 unreferenced secrets

`frontend/platform/terraform/gcp-secrets/` still defines `cloudflare-dns-api-token`,
`postgres-db-password`, `n8n-encryption-key`, `n8n-admin-password`, `grafana-admin-password`,
`openai-api-key`, `perplexity-api-key`, `anthropic-api-key`. Nothing active references the stack.

Left alone deliberately: the README requires **explicit approval for GCP decommissioning**, and if
that state is still live those secrets exist in GCP.

**Unblocked by:** a decommissioning decision.

### 2.4 Six pre-existing test failures — gate covers a subset

CI runs `test:admin` (5 files, green). The full `vitest run` has **6 failing tests across 3 files**
on `main`, including `App.routes.test.jsx` timeouts. Confirmed pre-existing by baselining with and
without changes — identical both ways.

The CI gate therefore validates a subset. Widening it to the full suite requires fixing those six
first — the same "clear it, then enforce it" sequence used for lint and format in #35.

**Unblocked by:** a decision to spend time on them.

### 2.5 Thirteen non-executing workflows in `frontend/.github/`

GitHub only runs workflows from the repository root. `frontend/.github/workflows/` holds 13 that
never execute, including five Notion secret workflows that now reference **scripts deleted in #35**.

A shadow CI directory that looks real and is not. Not touched because deleting 13 files is a wider
change than any request so far covered.

**Unblocked by:** a decision to delete or relocate them.

### 2.6 ~~Genuinely removing the `frontend/scripts` package boundary~~ — MOVED to TODO.md

> **Moved to [TODO.md](TODO.md).** Engineer-resolvable refactoring.

`frontend/scripts/package.json` has no dependencies and no scripts, but **is load-bearing**: with no
`"type"` field it marks that directory CommonJS inside an ESM parent, and nine `.js` helpers there
use `require()`. Deleting it breaks them:

```
ReferenceError: require is not defined in ES module scope
    at frontend/scripts/validate-routes.js:1:12
```

#36 removed it from Dependabot and the CI matrix but kept the file. Removing it properly is a real
refactor: convert nine files to ESM or rename to `.cjs`, and update every reference.

**Unblocked by:** a decision that the refactor is worth it.

---

## 3. Carried forward from the pricing / Flex Consumption work

Recorded by the author of `#38`, still open.

### 3.1 `ip_restriction` to Cloudflare ranges

Explicitly deferred: *"still needs the current range list and is not in this commit."* Until it
lands, `CF_ORIGIN_SECRET` is the only thing establishing that a request arrived through Cloudflare
rather than directly at the origin.

**Unblocked by:** pulling the current Cloudflare IP range list and deciding on a refresh mechanism —
the list changes, so a hardcoded copy goes stale silently.

### 3.2 `COSMOS_CONNECTION_STRING` carries the account primary key

Retained only because the Cosmos change-feed trigger binding requires it today. Should become the
identity-based form (`COSMOS_CONNECTION__accountEndpoint` + `__credential=managedidentity`) once
`azurerm_cosmosdb_sql_role_assignment.func_cosmos` is confirmed working — after which
`local_authentication_disabled` can be enabled on the account.

**Unblocked by:** a deployed environment in which the role assignment can be confirmed.

### 3.3 Two unconvertible pricing unit mismatches

`compute-serverless` and `database-nosql` baselines measure different meters than their live paths:

| Service | Baseline unit | Live unit |
| --- | --- | --- |
| `compute-serverless` | million invocations | normalized request workload |
| `database-nosql` | hour (provisioned) | million operations (on-demand) |

Recorded in `KNOWN_UNIT_MISMATCHES` with a test that fails if a third appears. Choosing replacement
baselines is a pricing-catalog decision, not a refactor.

**Unblocked by:** someone picking the replacement figures.

---

## 4. Deployment prerequisites — configuration that does not exist yet

Not blocked work so much as **things an operator must do**, recorded so nothing is discovered at
cutover.

### 4.1 Required Terraform variables with no default

Apply fails without all six. Three are sensitive and belong in Terraform Cloud workspace variables.

| Variable | Sensitive |
| --- | --- |
| `azure_subscription_id` | yes |
| `entra_tenant_id` | yes |
| `cloudflare_api_token` | yes |
| `entra_api_audience` | no — but validated non-empty |
| `cloudflare_zone_id` | no |
| `budget_alert_email` | no |

`entra_api_audience` needs a **second Entra app registration** (the API, exposing `api://<guid>`),
separate from the SPA. `verify-token.js` refuses to start without it — deliberately, because
`jsonwebtoken` *skips* audience validation when the audience is unset rather than failing, which
would accept any Microsoft-signed token in the tenant.

### 4.2 Key Vault seeding runbook

**Twenty-one secrets**, seeded **by hand as Azure Owner**. Deliberately not managed by Terraform: the
values would otherwise live in both Terraform Cloud and Terraform state, and several of them (an AWS
secret key, a GCP service-account JSON, a GitHub App RSA key) do not warrant that blast radius.

_Was five. The other sixteen are Firebase `defineSecret` bindings that Site-Main's `functions/`
declares and this repository had no home for: it declares 18, and before this change exactly two —
the AWS pair — existed here. A handler reaching for an unbound secret deploys green and dies on
first invocation in production, and no test reproduces it because no test binds secrets._

**Platform secrets** — needed before the Function App is useful at all:

| Secret | Consumed by |
| --- | --- |
| `AWS-ACCESS-KEY-ID` | AWS pricing, via app-setting Key Vault reference |
| `AWS-SECRET-ACCESS-KEY` | same — scope the IAM policy to `pricing:GetProducts` only |
| `CF-ORIGIN-SECRET` | `client-identity.js`, fails closed in production without it |
| `CLIENT-IP-SALT` | `client-identity.js`, rate-limit key derivation |
| `GCP-SERVICE-ACCOUNT-JSON` | `gcp.js`, read at runtime via `getSecret()` |

**Ported CMS secrets** — needed before `FEATURE_FLAG_SCHEDULERS` goes true or any CMS handler is
ported. All reach the app as app-setting Key Vault references except the last, which is read at
runtime:

| Secret | Consumed by |
| --- | --- |
| `ANTHROPIC-API-KEY` | AI drafting, WAF scoring, architecture generation |
| `OPENAI-API-KEY` | AI generation fallback |
| `PERPLEXITY-API-KEY` | research/enrichment |
| `REPLICATE-API-KEY` | image generation |
| `FIRECRAWL-API-KEY` | URL ingestion and scraping |
| `LINKIE-API-KEY` | Linkie proxy |
| `YOUTUBE-API-KEY` | `youtubeChannelStats` |
| `PUBLER-API-KEY` | social scheduling proxy and calendar sync |
| `PUBLER-WORKSPACE-ID` | same — identifier, travels with the key |
| `KLAVIYO-PRIVATE-KEY` | newsletter subscribe, weekly digest |
| `KLAVIYO-LIST-ID` | same — identifier, travels with the key |
| `TELEGRAM-BOT-TOKEN` | notifications; webhook secret derives as `sha256(token)` |
| `TELEGRAM-CHAT-ID` | same |
| `GITHUB-APP-INSTALLATION-ID` | site-rebuild trigger |
| `HOSTINGER-API-TOKEN` | VPS control |
| `GITHUB-APP-PRIVATE-KEY` | **runtime read only** — multi-line RSA PEM signed into a JWT, so it is kept out of app settings for the same reason as the GCP JSON |

The vault denies by default and Terraform Cloud runners cannot reach it, so seeding needs a
temporary network opening:

1. Set `admin_ip_rules = ["<your.public.ip>"]` in the Terraform Cloud workspace and apply.
2. Seed each secret. Note the names use hyphens — Key Vault secret names cannot contain underscores:

   ```bash
   V=hcw-keyvault-prod

   # Platform
   az keyvault secret set --vault-name $V --name AWS-ACCESS-KEY-ID        --value '...'
   az keyvault secret set --vault-name $V --name AWS-SECRET-ACCESS-KEY    --value '...'
   az keyvault secret set --vault-name $V --name CF-ORIGIN-SECRET         --value "$(openssl rand -hex 32)"
   az keyvault secret set --vault-name $V --name CLIENT-IP-SALT           --value "$(openssl rand -hex 32)"
   az keyvault secret set --vault-name $V --name GCP-SERVICE-ACCOUNT-JSON --file ./gcp-sa.json

   # Ported CMS secrets
   az keyvault secret set --vault-name $V --name ANTHROPIC-API-KEY          --value '...'
   az keyvault secret set --vault-name $V --name OPENAI-API-KEY             --value '...'
   az keyvault secret set --vault-name $V --name PERPLEXITY-API-KEY         --value '...'
   az keyvault secret set --vault-name $V --name REPLICATE-API-KEY          --value '...'
   az keyvault secret set --vault-name $V --name FIRECRAWL-API-KEY          --value '...'
   az keyvault secret set --vault-name $V --name LINKIE-API-KEY             --value '...'
   az keyvault secret set --vault-name $V --name YOUTUBE-API-KEY            --value '...'
   az keyvault secret set --vault-name $V --name PUBLER-API-KEY             --value '...'
   az keyvault secret set --vault-name $V --name PUBLER-WORKSPACE-ID        --value '...'
   az keyvault secret set --vault-name $V --name KLAVIYO-PRIVATE-KEY        --value '...'
   az keyvault secret set --vault-name $V --name KLAVIYO-LIST-ID            --value '...'
   az keyvault secret set --vault-name $V --name TELEGRAM-BOT-TOKEN         --value '...'
   az keyvault secret set --vault-name $V --name TELEGRAM-CHAT-ID           --value '...'
   az keyvault secret set --vault-name $V --name GITHUB-APP-INSTALLATION-ID --value '...'
   az keyvault secret set --vault-name $V --name HOSTINGER-API-TOKEN        --value '...'
   # Multi-line PEM — use --file, not --value.
   az keyvault secret set --vault-name $V --name GITHUB-APP-PRIVATE-KEY     --file ./github-app.pem
   ```

3. Confirm the app can read them — `KEY_VAULT_URI` resolves and `getSecret` returns a value.
4. Reset `admin_ip_rules = []` and apply again. Steady state is: reachable only by the Function App
   over its subnet.

**This only works because the subnet now carries the `Microsoft.KeyVault` service endpoint.** Without
it the VNet rule is inert and the vault denies the Function App too — see §6.

`secret-sync-keyvault.yml` was removed rather than finished. It was disabled, its mapping was a
literal `TODO`, it held the last static `AZURE_CREDENTIALS` reference, and pushing GitHub secrets
into Key Vault would duplicate every value into a second store. This runbook replaces it.

### 4.3 All four deployment workflows are disabled

`deploy-azure-frontend`, `deploy-functions`, `deploy-infra`, `migrate-data` are each guarded by
`if: ${{ false }}`. `secret-sync-keyvault` is disabled **and** unimplemented — its mapping is a
literal `TODO`.

Enabling them is a deliberate act, not a side effect. `migrate-data` in particular reads the whole
production Firestore database.

### 4.4 Self-hosted CI runner — operator setup and failover runbook

`infra/ci-runner.tf` defines an Azure Container Apps event-driven Job running ephemeral GitHub
runners (KEDA `github-runner` scaler, scale-to-zero — idle days cost $0, active days ≈ $10/mo for
this repo's CI volume). It is a **fallback** for GitHub-hosted runner outages, selected per-run by
the `CI_RUNNER` repository variable. Everything below is operator work this environment cannot do.

**One-time setup, in order:**

1. **GitHub App** (org settings → Developer settings → GitHub Apps → New): no webhook, repository
   permission **Administration: Read & write** (self-hosted runner registration) only. Install it
   on `HCW-HybridCloudWorks` only. Record: App ID, Installation ID, and a generated private key
   (PEM). A GitHub App is used instead of a PAT so tokens are short-lived and not person-bound.
2. **Docker Hub**: create repository `hcw-runner` and a **read/write access token scoped to that
   repository** (Captain/Pro account — authenticated pulls are unlimited, which is what sidesteps
   the per-IP anonymous rate limit on Azure's shared NAT egress). Add `DOCKERHUB_USERNAME` /
   `DOCKERHUB_TOKEN` as repository secrets, then run the `Build runner image` workflow once
   (`workflow_dispatch`) to publish the image (it Scout-gates critical/high CVEs before push and
   pushes a GHCR mirror tag as break-glass).
3. **Terraform**: `terraform apply` picks up `ci-runner.tf` (environment + job). Placeholders ship
   in state, never real secrets.
4. **Seed the job's secrets and config** (the values Terraform deliberately does not manage —
   `lifecycle.ignore_changes` protects everything set here):

   ```bash
   RG=<resource-group> JOB=hcw-ci-runner
   az containerapp job secret set -g $RG --name $JOB \
     --secrets gh-app-private-key="$(cat app-key.pem)" dockerhub-token='<token>'
   az containerapp job registry set -g $RG --name $JOB \
     --server docker.io --username '<dockerhub-user>' --password-secret-ref dockerhub-token
   az containerapp job update -g $RG --name $JOB \
     --set-env-vars GH_APP_ID=<app-id> GH_APP_INSTALLATION_ID=<installation-id> \
       GH_REPO_OWNER=HybridCloudWorks GH_REPO_NAME=HCW-HybridCloudWorks
   # Scaler metadata (applicationID/installationID) — az CLI cannot patch scale-rule
   # metadata in place; re-run `az containerapp job update` with
   # --scale-rule-name github-runner --scale-rule-type github-runner \
   # --scale-rule-metadata owner=HybridCloudWorks repos=HCW-HybridCloudWorks \
   #   runnerScope=repo labels=aca targetWorkflowQueueLength=1 \
   #   applicationID=<app-id> installationID=<installation-id> \
   # --scale-rule-auth appKey=gh-app-private-key
   ```

5. **Smoke test**: set the repo variable and start any workflow run —
   `gh variable set CI_RUNNER --body '["self-hosted","aca"]'` — watch a job execution appear in the
   Container Apps job, then flip back.

**Failover runbook (during a GitHub-hosted runner outage):**

```bash
gh variable set CI_RUNNER --body '["self-hosted","aca"]'   # fail over
gh variable delete CI_RUNNER                                # restore hosted runners
```

Applies to runs created after the change; already-queued runs keep their original target. Caveat
recorded from the 2026-08-06 outage: its second phase stalled workflow-run **creation** itself —
no runner, self-hosted or otherwise, helps when the control plane is down. This fallback covers
hosted-runner-capacity outages (phase one, jobs queued with no runner).

**Deliberate security posture** (do not "improve" these without reading `infra/ci-runner.tf`'s
header): no managed identity on the runner job, no VNet, JIT ephemeral runners via
`generate-jitconfig`, secrets out-of-band of Terraform state, `runner-image` rebuilt weekly on
GitHub-hosted runners so a broken runner image cannot brick its own rebuild.

### 4.5 Frontend auth swap (MSAL) — SPA app registration runbook

The admin frontend now authenticates with Entra ID via MSAL (`lib/entraAuth.js`); firebase/auth is
gone from the admin surface. Before an admin can sign in, an operator must create the SPA side of
the single-registration model:

1. **Expose an API scope on the API app registration** (the one whose id/URI is
   `ENTRA_API_AUDIENCE` on the Function App): *Expose an API → Add a scope*, e.g.
   `access_as_admin`. Full scope value: `api://<api-app-client-id>/access_as_admin`.
2. **SPA app registration** (or a SPA platform on the same registration): *Authentication → Add
   platform → Single-page application*, redirect URIs = the site origin(s) (prod + `http://localhost:5173`
   for dev). Grant it delegated permission to the scope from step 1 (+ openid/profile/email) and
   admin-consent it.
3. **Static Web App build env vars**: `VITE_ENTRA_CLIENT_ID` (SPA registration client id),
   `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_API_SCOPE` (the full scope value from step 1). Without
   `VITE_ENTRA_API_SCOPE` the SPA requests a token the backend rejects on audience.
4. **App Roles + assignment**: the API registration carries the `Admin` app role (guard gate 1) —
   assign it to each admin user in *Enterprise applications → Users and groups*. Gate 2 is the
   `admins/{oid}` registry, seeded via the bootstrap flow (allowlist env vars on the Function App:
   `CMS_BOOTSTRAP_ALLOWED_UIDS` = Entra object ids, or `CMS_BOOTSTRAP_ALLOWED_EMAILS`).
5. **MFA** is an Entra Conditional Access policy, not app code — the Firebase phone-MFA/reCAPTCHA
   flow was deleted with nothing to configure in the SPA.

Not yet swapped (still Firebase): the PUBLIC site's sign-in (`submitPublicLabJob` / LabRunner) and
the 34 files reading Firestore directly — those are the frontend rewiring phase.

---

## 5. Not started — the remaining migration itself

### 5.0 ~~The frontend is still a Firebase client — this is the Go-Live blocker~~ — RESOLVED 2026-08-09

> **RESOLVED in PRs #61–#66.** Every count in this section is now zero and the
> production bundle contains no Firebase chunk. `useFirestore.js`,
> `firebaseConfig.js` and `firebaseStorage.js` are deleted. Firebase *can* now be
> decommissioned at Go-Live, contradicting the conclusion below. Retained for
> historical context only; delete at the next review.

Measured against `Site-Main` @ `4560130` and `main` @ `a10ee9d`. **Porting the backend handlers alone
does not produce a working Azure site**, because the browser does not call the backend for most
content — it talks to Firestore directly.

| Coupling | Count |
| --- | --- |
| Frontend files importing `firebase/firestore` | **34** |
| Frontend files importing `firebase/auth` | 5 |
| Frontend files importing `firebase/storage` | 4 |
| Direct Firestore data calls in `frontend/src` | ~115 (`getDocs` 26, `collection` 39, `getDoc` 13, `onSnapshot` 7, `setDoc` 8, `addDoc` 8, `updateDoc` 7, `deleteDoc` 7) |
| Frontend files referencing the Azure backend | **1** (`azureConfig.js`, 24 lines, two helpers) |

The coupling is not confined to admin screens. **Public pages read Firestore in the browser**:
`pages/{aws,azure,gcp,finops,vmware}/ArchitecturePage.jsx`, `pages/shared/AboutPage.jsx`, the blog /
architecture / framework detail templates, and all four `pages/submissions/*` forms.

The static-projection path that would avoid this — `publicData.js` reading `build:data` output —
currently covers **two collections** (`certifications`, `speakerevents`) consumed by **two files**.

`azureConfig.js` states the constraint plainly: *"The browser must not instantiate a Cosmos DB
data-plane client or receive a Cosmos access key."* So every one of those 34 files needs an API
endpoint to call instead. That makes the backend port a **prerequisite** for the frontend port, not
an alternative to it.

**Consequence for cutover:** pointing DNS at an Azure-hosted frontend today yields a site that either
still depends on Firebase, or breaks. Firebase cannot be decommissioned at Go Live; it has to stay
warm until the frontend is ported.

**Unblocked by:** nothing external. This is scope, and it is much larger than the TODO count in §5.1
suggests — the TODOs mark where the backend logic goes, not the frontend rewiring that has to follow.

### 5.1 ~~Fourteen TODOs across four handler files~~ — MOVED to TODO.md

> **Moved to [TODO.md](TODO.md) T-001, T-002, T-003.** This is engineering work,
> not a human blocker. The count is also stale: 6 TODOs remain, not 14 —
> `labs-http.js` was completed and the `cms-http.js` match is prose.

The Azure Functions scaffold exposes routes whose bodies are stubs:

| File | TODOs |
| --- | --- |
| `functions/src/functions/cms-http.js` | 6 |
| `functions/src/functions/schedulers.js` | 4 |
| `functions/src/functions/cosmos-triggers.js` | 2 |
| `functions/src/functions/labs-http.js` | 2 |

Each says *"Port the business logic from Personal-Site_HCW/..."*. That source is now
`hybridcloudworks/Main-Site` in this org, so this is **no longer blocked** — it is simply large, and
is the next phase of active work rather than a deferred item.

### 5.2 ~~`vps-agent` — Azure scaffold incomplete~~ — MOVED to TODO.md

> **Moved to [TODO.md](TODO.md) T-004.** Engineering work, not a human blocker.

Three TODOs: port the original logic, implement the change-feed listener or polling loop, start the
heartbeat interval. The README already marks it *"Incomplete; source agent contract still requires
migration"*.

---

## 6. Corrections to earlier claims in this work

Recorded because a stale assessment is worse than no assessment.

- **`claude/site-main-migration-prep-5fka2q` was reported as safe to delete. It was not.** It carried
  1,337 lines of unmerged feature work, pushed after the earlier check. Verified before acting; the
  branch was preserved and became #38.
- **A CI matrix simulation was reported as passing when the environment was contaminated.** The
  `frontend` leg passed locally only because `frontend/functions/node_modules` was present from an
  earlier step. A clean checkout failed. Fixed in #35, and every simulation since deletes every
  `node_modules` in the repository first.
- **`frontend/scripts/package.json` was described as an empty, vestigial package.** Its contents are
  empty; its function is not. See §2.6.

---

## 7. Fixed since this file was written

Kept rather than deleted, so the reasoning survives.

### 7.1 Key Vault was unreachable by everyone, including the app

The vault set `default_action = "Deny"` and allowed the Functions subnet — but that subnet carried
**no `Microsoft.KeyVault` service endpoint**, and a Key Vault VNet rule is inert without one. So the
app's own `@Microsoft.KeyVault(...)` references and `getSecret()` calls would have been denied.

Silent by construction: the app deploys clean, then a missing credential presents as missing data.
Nothing in CI could catch it, and `terraform validate` would have passed.

Fixed by adding the service endpoint, plus `admin_ip_rules` for the seeding path in §4.2.

### 7.2 Deploys used a static service principal against the repo's own guardrail

`deploy-functions.yml` authenticated with `secrets.AZURE_CREDENTIALS` — a long-lived
service-principal JSON — while the README requires OIDC and forbids committed static cloud
credentials.

Replaced with a **user-assigned managed identity** and federated credentials, deliberately rather
than the usual Entra app registration: app registrations need Entra directory permissions, which
Azure **Owner** does not confer. A UAMI is an ordinary Azure resource, so the whole thing is
creatable with the permissions this deployment actually runs under.

`github_org` and `github_repo` were stale (`saulpatinojr`) and consumed by nothing. They now compose
the federated `subject`, so the drift would have surfaced as an opaque `AADSTS70021` at first deploy.
