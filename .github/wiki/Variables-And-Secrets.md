# Variables and secrets — naming and placement

[Naming-Convention](Naming-Convention) names *resources*. This page names
*values* — the variables, secrets, workspace settings and app settings that
resources are configured with — and decides where each one is stored.

Two questions, in this order:

1. **Placement.** Which of the four stores holds this value? Placement is a
   disclosure-boundary decision: it fixes who can read the value, what has to
   happen to rotate it, and which logs it can leak into. Get it wrong and no
   amount of naming discipline helps.
2. **Naming.** What is it called in that store? Naming is a legibility
   decision, and it is cheap only at creation — a name already set in HCP
   Terraform, GitHub or an app setting cannot be changed without a coordinated
   change across every consumer.

`CHECKLIST.md` is the *inventory* — what exists, who consumes it, whether it is
provisioned. This page is the *rule* that decides where the next entry goes and
what it is called. The two are meant to be read together: CHECKLIST records the
fact, this page justifies it.

> **This page contains no values, and must not acquire any.** It uses
> CHECKLIST's placeholder format — `X` = letter, `0` = number, `!` = special
> character; GUIDs as `00000000-0000-0000-0000-000000000000`. That includes
> subscription, tenant and client IDs, which are identifiers rather than
> credentials but are still not published.

---

## The four stores

In precedence order. When more than one store could hold a value, the earlier
one wins.

| # | Store | Holds | Read by | Written by |
| --- | --- | --- | --- | --- |
| 1 | **Azure Key Vault** `kv-site-prod-scus` | Runtime application secrets | Function App managed identity, via `@Microsoft.KeyVault(SecretUri=…)` app settings or `src/lib/key-vault.js` | A human, out-of-band, during a seeding window |
| 2 | **HCP Terraform workspace** `hcw-azure` | What Terraform needs to authenticate and to plan | The run environment and the `azurerm` / `cloudflare` providers | An operator in the workspace UI |
| 3 | **GitHub Actions variables** | Non-sensitive CI/CD configuration | `${{ vars.* }}` in workflows | `gh variable set`, or the repository settings UI |
| 4 | **GitHub Actions secrets** | Last resort — credentials to systems that offer no federation | `${{ secrets.* }}` in workflows | `gh secret set` |

The order is not arbitrary. It runs from *narrowest reader set and strongest
authentication* to *widest and weakest*:

- Key Vault values are readable only by a managed identity that must reach the
  vault over the Functions integration subnet — `network_acls.default_action`
  is `Deny` and the only VNet rule is that subnet. There is no credential to
  steal and no static reader.
- HCP Terraform workspace values are readable by anything that can start a run
  in that workspace, which is a small, named group.
- GitHub variables are readable by anyone who can read the repository — this
  one is public — and by any workflow, including ones added in a future PR.
- GitHub secrets are readable by any workflow with the right trigger. Masking
  is best-effort log redaction, not access control: a workflow that can read a
  secret can print it anywhere GitHub is not looking.

### Three outcomes that are not stores

A value that lands on one of these is *correctly placed nowhere*, and the
record of that decision is the artefact.

| Outcome | Meaning | Examples in this repository |
| --- | --- | --- |
| **Derived** | Terraform computes it from a resource it already manages, or a workflow fetches it after OIDC login. Nobody types it anywhere | `COSMOS_ENDPOINT`, `KEY_VAULT_URI`, `STORAGE_BLOB_ENDPOINT`, `STORAGE_ACCOUNT_NAME`, `AZURE_OPENAI_ENDPOINT` — all set from resource attributes in `infra/main.tf` |
| **Deliberately absent** | The value must *not* exist. Provisioning it changes behaviour for the worse | `COSMOS_KEY`, `AZURE_OPENAI_KEY`, `STORAGE_ACCOUNT_KEY`, `STORAGE_CONNECTION_STRING`, `COSMOS_CONNECTION_STRING` |
| **Generated in place** | The value is created on the host that consumes it and never moves | `LABS_AGENT_CERT_PATH` — the agent's private key is generated on the VPS, root-owned, `0600`, and only the public certificate is uploaded |

"Deliberately absent" is a placement outcome, not a gap, and it needs to be
written down as firmly as a real placement — otherwise the next person to see
an unset name provisions it to silence a linter. `COSMOS_KEY` is the worked
example: `connectCosmos()` uses a key only when the value is non-empty and
otherwise falls through to `DefaultAzureCredential`. An unset GitHub secret
interpolates to the empty string, so the workflow already takes the Entra path.
Setting it would switch the client to key authentication against an account
where `cosmos_local_auth_disabled = true` — key auth is off, so the "fix"
converts a working path into a rejected one. Two of the retired names
(`STORAGE_ACCOUNT_KEY`, `STORAGE_CONNECTION_STRING`) are additionally defended
by a test asserting the module cannot read them again, which is what
"deliberately absent" looks like when you want it to survive contact with a
future contributor.

### The fifth store, named so it is not confused with the four

`azurerm_container_app_job.ci_runner` declares its own secrets
(`gh-app-private-key`, `dockerhub-token`), seeded out-of-band with
`az containerapp job secret set` and protected by `ignore_changes`. This is a
store, but it is not a *choice* — it is the only place a Container Apps job can
read a secret from when it has no managed identity. Container Apps secrets can
be Key Vault references, but that requires a managed identity on the job holding
`Key Vault Secrets User`, and `ci-runner.tf` deliberately gives the job no
identity at all (CI legs need zero Azure access, and granting the deploy
identity would give every CI step ambient rights to the estate). The vault's IP
rules could not admit it either: Container Apps consumption egress addresses are
shared and dynamic.

So the runner's GitHub App private key belongs in the job's own secrets, and
**not** in GitHub Actions secrets — where it would be a static credential
carrying `Administration: Read & write` on the repository, readable by any
workflow. The trigger that would move it into Key Vault (store 1) is the job
gaining a managed identity and a network path, which is the same change
`ci_runner_enabled = true` would have to justify anyway.

---

## Placement — the decision procedure

Ask these in order. The first question that answers `yes` decides the store;
stop there.

**Q1 — Should this value exist at all?**
If the platform offers an identity-based path to the same capability, the
credential must not be created. Cosmos with `local_auth_disabled`, Azure OpenAI
with `DefaultAzureCredential`, Storage with user-delegation SAS, and Cosmos
change-feed bindings with `__credential = "managedidentity"` all remove a secret
rather than store one.
→ **Deliberately absent.** Record the name, the reason, and what breaks if
someone provisions it.

**Q2 — Is the value generated on the machine that consumes it, and does it never
need to move?**
Private keys generated on their host are the case. Upload the public half only.
→ **Generated in place.** No store; record the file path and its permissions.

**Q3 — Can Terraform compute it from a resource it manages, or can a workflow
fetch it at run time after OIDC login?**
Endpoints, hostnames, vault URIs, account names, connection targets. A value
that can be derived must not be stored, because a stored copy is a second
source of truth that goes stale silently — and it goes stale precisely when the
resource is replaced, which is when you are least able to notice.
→ **Derived.** It appears as a resource attribute, a Terraform output, or an
`az` lookup in the workflow.

**Q4 — Is it read at run time by application code, and is it sensitive?**
→ **Store 1, Azure Key Vault.** The Function App gets it either as an app
setting holding a `@Microsoft.KeyVault(SecretUri=…)` reference (single-line
values) or by calling `getSecret()` at run time (multi-line values — see below).
Terraform creates the vault, the RBAC and the *reference*; a human seeds the
*value*.

**Q5 — Does Terraform need it to authenticate, or as a plan input?**
→ **Store 2, HCP Terraform workspace.** Authentication values are
**Environment** variables; configuration inputs are **Terraform** variables. The
distinction is mechanical, not stylistic: an Environment variable is exported
into the run's process environment where the provider's own credential chain
reads it; a Terraform variable is bound to a `variable` block by exact name and
is invisible to anything that is not that block.

**Q6 — Does a GitHub workflow need it, and is it non-sensitive?**
Identifiers, hostnames, resource group names, public URLs, feature flags, runner
selection.
→ **Store 3, GitHub Actions variables.**

**Q7 — Is it still here?**
Then it is a credential to a system that offers GitHub no federation path.
→ **Store 4, GitHub Actions secrets**, and the CHECKLIST entry must say which
system, why federation is unavailable, and what the rotation trigger is. An
entry without that justification is a defect, not an inventory item.

---

## The hard cases

### A value that is not secret but is needed at build time by the frontend

**Store 3, always. Never store 4.**

Vite inlines every `VITE_*` variable into the bundle at build time. The value
ships to the browser and is readable with view-source. Storing it as a GitHub
secret therefore buys exactly nothing in confidentiality, and costs two real
things:

- **Log legibility.** GitHub masks a secret's value everywhere it appears in
  workflow output. A masked API base URL turns build logs, npm error messages
  and failed-request diagnostics into `***`, which is precisely the information
  you need when the build is failing. If the value is a common substring, it
  mangles unrelated lines too.
- **A false expectation.** The next reader sees `secrets.` and concludes the
  value is confidential. It is in the bundle. Now there is a documented
  disagreement between the storage mechanism and the truth, and the mechanism
  usually wins the argument.

This was exactly the `AZURE_FUNCTIONS_URL` defect (CHECKLIST §7): a public API
base URL referenced as `${{ secrets.AZURE_FUNCTIONS_URL }}` and fed straight
into `VITE_AZURE_FUNCTIONS_URL`. Fixed 2026-08-18 while the value was still
unset everywhere: the workflow now reads `${{ vars.FUNCTIONS_URL }}` — a
repository variable alongside the `VITE_*` entries five lines below it, with
the provider prefix dropped per the naming rule.

**The rule:** if the value ends up in a public artefact — a JS bundle, a
container image layer, an HTML page, a public DNS record — it is not a secret,
whatever it looks like.

### A value needed by both Terraform and a GitHub workflow

**One writer, and everything else derives.** Terraform owns the value; the
workflow obtains it. In order of preference:

1. **The workflow fetches it at run time** after `azure/login` with OIDC —
   `az functionapp show`, `az staticwebapp secrets list`, and so on. Nothing is
   stored, nothing goes stale.
2. **The Terraform output feeds a GitHub variable**, and the two names mirror
   each other exactly, per the IaC Repository Standard: output `app_hostname` →
   variable `APP_HOSTNAME`; output `client_id` → variable `CLIENT_ID`. The
   GitHub copy is a **cache**, not a source; when the resource is replaced, the
   cache is stale and the CHECKLIST entry is what tells the next person which
   side to trust.

What must not happen is the same value being typed independently into two
stores. `COSMOS_ENDPOINT` currently exists as a runtime app setting derived from
the resource *and* as a hand-set GitHub secret holding the same string. One of
those is authoritative and the other is a copy; the inventory has to say which.

### Subscription, tenant and client IDs

**Store 3, GitHub Actions variables** — which is what the repository already
does (`vars.CLIENT_ID`, `vars.TENANT_ID`, `vars.SUBSCRIPTION_ID`).

Under workload identity federation these are identifiers, not credentials.
Possession of a client ID grants nothing. The trust decision is made by the
federated identity credential, which pins **issuer + subject + audience** —
`https://token.actions.githubusercontent.com`, `repo:<org>/<repo>:ref:…` or
`repo:<org>/<repo>:environment:data-migration`, and
`api://AzureADTokenExchange`. A token that does not match all three is refused
with AADSTS70021 no matter who is holding the client ID.

Note the deliberate asymmetry with Terraform, where the same values are marked
`sensitive`:

| Mechanism | What it is | Why it is set the way it is |
| --- | --- | --- |
| Terraform `sensitive = true` | A log-hygiene flag — redacts the value from plan output and CI logs | Keeps subscription IDs out of run logs that get pasted into issues |
| GitHub `secrets` | A storage-and-masking mechanism with a different reader set from `vars` | Not warranted: nothing is protected, and masking a GUID that appears in error messages hurts diagnosis |

The two do not have to agree, and treating `sensitive` as a synonym for "must be
a GitHub secret" is how identifiers end up in the last-resort column.

### Why OIDC federation means zero long-lived cloud credentials in GitHub

Both cloud handshakes in this estate are federated, and neither has a secret:

| Handshake | Identity | Trust anchor | Created by |
| --- | --- | --- | --- |
| HCP Terraform → Azure | `id-hcw-terraform` | `TFC_AZURE_PROVIDER_AUTH=true` plus federated credentials `tfc-plan` / `tfc-apply`, issuer `https://app.terraform.io` | `scripts/bootstrap-terraform-oidc.ps1`, once, outside Terraform state |
| GitHub Actions → Azure | the `github_deploy` user-assigned identity | Federated credentials on issuer `https://token.actions.githubusercontent.com`, subject-pinned to the deploy ref and to the `data-migration` environment | `infra/oidc.tf` |

Neither mints anything longer-lived than a per-run token. So the **correct count
of Azure credentials in GitHub Actions secrets is zero**, and that is a
falsifiable property of the repository rather than an aspiration — any Azure
client secret, storage key, Cosmos key or deployment token appearing in store 4
is a defect by definition, because a federated path to the same capability
already exists and is already wired.

What that implies for store 4: it may only hold credentials to systems that are
**not Azure** and offer **no federation from GitHub**. Today that is HCP
Terraform, Docker Hub, and Firebase — three external systems, each with a named
reason. `AZURE_STATIC_WEB_APPS_API_TOKEN` fails this test on its first word.

### Secrets that must never transit Terraform state, and why Key Vault is seeded out-of-band

Terraform state is a **plaintext record of every value the configuration
touched**. `sensitive = true` redacts console output; it does not encrypt state.
Two consequences:

- **Never manage a secret value with `azurerm_key_vault_secret`.** The value
  would be written into state, and state lives in HCP Terraform — a third-party
  SaaS. That widens the disclosure boundary from "Azure RBAC on one vault" to
  "Azure RBAC + everyone who can read state + every plan diff + every run log".
- **Never read a secret back with `data.azurerm_key_vault_secret`.** The read
  value lands in state too, so using Key Vault as Terraform's secret source
  moves the secret *into* the place you were trying to keep it out of. This is
  why `cloudflare_api_token` is an HCP Terraform workspace variable rather than
  a vault lookup: as a provider argument it is never persisted to state, and a
  data-source read would be.

The vault's network posture makes the same point independently. `network_acls`
is `default_action = "Deny"` with one VNet rule, for the Functions integration
subnet. HCP Terraform's runners are neither in that VNet nor a trusted Azure
service, so the `Key Vault Secrets Officer` assignment on the Terraform executor
**cannot actually write a secret from a run**. The seeding path is the one the
configuration is built for: populate `admin_ip_rules`, apply, run
`az keyvault secret set` as a human, empty `admin_ip_rules`, apply again. Empty
is the correct steady state.

The division of labour is therefore fixed: **Terraform owns the vault, the RBAC,
the network rules, and the `@Microsoft.KeyVault(…)` references. A human owns the
values.** Rotation is then an `az keyvault secret set` and does not require a
Terraform run at all.

### Multi-line and oversized secrets

Two values are deliberately *not* app settings even though they are Key Vault
secrets: the GCP service-account JSON (~2.3 KB, multi-line) and
`GITHUB-APP-PRIVATE-KEY` (an RSA PEM). App settings are visible in the portal
and in `az webapp config appsettings list`, and multi-line values survive that
round trip badly. Both are read at run time through
`functions/src/lib/key-vault.js` instead. The rule generalises: **single-line
secret → app setting holding a vault reference; multi-line or large secret →
`getSecret()` at run time.**

---

## Placement matrix — every value in CHECKLIST, classified

### Store 1 — Azure Key Vault

Seeded by hand; referenced from `infra/main.tf` app settings as
`@Microsoft.KeyVault(SecretUri=…)`.

| Value | CHECKLIST | Why store 1 |
| --- | --- | --- |
| `CF-ORIGIN-SECRET` | §3 | Runtime shared secret proving a request came via Cloudflare; the anonymous submission path depends on it |
| `CLIENT-IP-SALT` | §3 | Runtime salt for quota keys; rotating it resets live counters, so rotation must not need a Terraform run |
| `AWS-ACCESS-KEY-ID`, `AWS-SECRET-ACCESS-KEY` | not inventoried | Third-party static credentials — AWS offers the Function App no federation here. Scope the IAM policy to `pricing:GetProducts` only |
| `ANTHROPIC-API-KEY`, `OPENAI-API-KEY`, `PERPLEXITY-API-KEY`, `REPLICATE-API-KEY` | §4, partially | Third-party SaaS keys. Distinct from Azure OpenAI, which is keyless |
| `FIRECRAWL-API-KEY`, `LINKIE-API-KEY`, `YOUTUBE-API-KEY` | not inventoried | Third-party SaaS keys |
| `PUBLER-API-KEY`, `PUBLER-WORKSPACE-ID`, `KLAVIYO-PRIVATE-KEY`, `KLAVIYO-LIST-ID` | not inventoried | The two `*-ID` values are identifiers rather than credentials, but they travel with their key and splitting them across stores buys nothing |
| `TELEGRAM-BOT-TOKEN`, `TELEGRAM-CHAT-ID` | not inventoried | As above |
| `GITHUB-APP-INSTALLATION-ID`, `HOSTINGER-API-TOKEN` | not inventoried | Site rebuild trigger and VPS control |
| `GITHUB-APP-PRIVATE-KEY` | not inventoried | Multi-line PEM — read via `getSecret()`, never an app setting |
| GCP service-account JSON | not inventoried | Multi-line, ~2.3 KB — read via `getSecret()` |

`infra/main.tf` declares **20** `@Microsoft.KeyVault` references plus two
run-time reads. CHECKLIST §1–§8 inventories a handful of them. That gap is
recorded below rather than papered over.

### Store 2 — HCP Terraform workspace

**Environment** variables — how the run authenticates. All four names are
dictated by HashiCorp and Microsoft and are contractual.

| Value | CHECKLIST | Kind | Why store 2 |
| --- | --- | --- | --- |
| `TFC_AZURE_PROVIDER_AUTH` | §8 | Environment | Switches the workspace to dynamic provider credentials; absent, no OIDC token is minted at all |
| `TFC_AZURE_RUN_CLIENT_ID` | §8 | Environment | The identity HCP Terraform assumes. Distinct from §7 `CLIENT_ID`, which is the GitHub Actions identity |
| `ARM_TENANT_ID` | §8 | Environment | Read by the `azurerm` credential chain, not by a `variable` block |
| `ARM_SUBSCRIPTION_ID` | §8 | Environment | Provider fallback only — `providers.tf` sets `subscription_id` explicitly on all four provider blocks, and the explicit value wins |

**Terraform** variables — plan inputs, bound by exact name to
`infra/variables.tf`. These are the ones with no default:

| Value | Why store 2 | `sensitive` |
| --- | --- | --- |
| `subscription_app`, `subscription_mgmt`, `subscription_conn` | Provider targets. No defaults on purpose: a wrong guess deploys the workload into a platform subscription, so an unset value must fail the plan. There is deliberately no `subscription_ident` — the Identity zone is empty, so an alias for it would be an unused declaration and one more value that has to be right before a plan can run | yes (log hygiene) |
| `entra_tenant_id` | Feeds the `ENTRA_TENANT_ID` app setting and JWT validation | yes (log hygiene) |
| `entra_api_audience` | Validated as the JWT `aud`. Empty silently disables audience validation, hence the non-empty validation block | no |
| `cloudflare_api_token` | A genuine credential, and the reason it is here rather than in Key Vault: as a provider argument it never enters state, whereas a vault data-source read would put it there | yes |
| `cloudflare_zone_id` | Identifier | no |
| `budget_alert_email` | Notification target | no |
| `admin_ip_rules`, `cosmos_admin_ip_rules`, `functions_storage_admin_ip_rules` | Populated only for a seeding or inspection window; empty is the steady state | no |

Everything else in `infra/variables.tf` has a default and needs no workspace
entry at all.

### Store 3 — GitHub Actions variables

| Value | CHECKLIST | Why store 3 |
| --- | --- | --- |
| `CI_RUNNER` | §7 | Runner selection. **Deliberately absent** ⇒ `ubuntu-latest`. The editor's "Context access might be invalid" warning on all 8 references is expected and must not be "fixed" by setting it |
| `CLIENT_ID` | §7 | Identifier under WIF; grants nothing without a matching federated subject |
| `TENANT_ID` | §7 | Identifier |
| `SUBSCRIPTION_ID` | §7 | Identifier |
| `APP_HOSTNAME` | §7 | Public DNS name. Mirrors the `function_hostname` output |
| `RESOURCE_GROUP` | §7 | Resource group name for the T-503 firewall window. Must equal the `resource_group_name` Terraform value |
| `FUNCTIONS_STORAGE_ACCOUNT` | §7 | An account name, not a key. Three words to break the collision with the content storage account, which the standard permits |
| `VITE_ENTRA_CLIENT_ID`, `VITE_ENTRA_TENANT_ID` | §6, §7 | Public-client registration values that ship in the bundle |
| `VITE_SOCIAL_X_URL`, `VITE_SOCIAL_LINKEDIN_URL`, `VITE_SOCIAL_GITHUB_URL` | §6, §7 | Public URLs |
| `VITE_TRANSLATIONS`, `VITE_DEFAULT_LANGUAGE`, `VITE_NEWS_ENABLE_INSIGHTS` | §6 | Feature flags in a public bundle |

### Store 4 — GitHub Actions secrets, with justification

Every entry states which system it authenticates to and why federation is not
available. An entry that cannot answer both belongs in store 3 or nowhere.

| Value | CHECKLIST | Target system | Justification | Verdict |
| --- | --- | --- | --- | --- |
| `GITHUB_TOKEN` | — | GitHub | Injected per-run by GitHub, scoped by `permissions:`, expires with the job. Not stored by us at all | Correct, and contractual |
| `TF_API_TOKEN` | §7 | HCP Terraform | Authenticates GitHub → *Terraform*, the reverse direction from §8. The HCP Terraform CLI credential has no inbound GitHub OIDC path. Use a **team** token, not a user token, so it survives the user leaving | Justified |
| `DOCKERHUB_TOKEN` | §7 | Docker Hub | Registry push credential. A scoped access token, never an account password | Justified only while Docker Hub is a publish target — see below |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | §7 | Google Cloud | Source-side credential for the one-shot Firestore export, for a system being decommissioned. Must be scoped read-only, and deleted the day the migration completes | Justified, with an expiry |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | §7 | **Azure** | None available — see below | **Wrong store** |
| `AZURE_FUNCTIONS_URL` | §7 | — | A public API base URL | **Resolved 2026-08-18** — now `vars.FUNCTIONS_URL`, store 3 |
| `COSMOS_ENDPOINT` (GitHub-side) | §7 | — | A public hostname; with `local_auth_disabled = true` it grants nothing | **Wrong store** |
| `DOCKERHUB_USERNAME` | §7 | — | An account name, published as part of every image tag | **Wrong store** |
| `COSMOS_KEY` | §7 | — | Must stay unset | Correctly absent |

### Not in any store

| Value | CHECKLIST | Outcome |
| --- | --- | --- |
| `COSMOS_ENDPOINT`, `COSMOS_DATABASE`, `STORAGE_ACCOUNT_NAME`, `STORAGE_BLOB_ENDPOINT`, `STORAGE_QUEUE_ENDPOINT`, `KEY_VAULT_URI`, `AZURE_OPENAI_ENDPOINT` (app settings) | §2, §4 | Derived — set from resource attributes in `infra/main.tf` |
| `NODE_ENV`, `REGION_NAME`, `WEBSITE_SITE_NAME` | §5 | Host-provided, or a literal in `main.tf` |
| `FEATURE_FLAG_SCHEDULERS` and the per-timer flags | §5 | Literal app settings; the master flag stays `"false"` |
| `ENTRA_TENANT_ID`, `ENTRA_API_AUDIENCE` (app settings) | §1 | Derived from store 2 Terraform variables |
| `STORAGE_ACCOUNT_KEY`, `STORAGE_CONNECTION_STRING`, `COSMOS_CONNECTION_STRING` | §2 | Deliberately absent; two are test-enforced |
| `COSMOS_KEY` | §7 | Deliberately absent |
| `AZURE_OPENAI_KEY` | §4 | Deliberately absent — see below |
| `LABS_AGENT_CERT_PATH` | §2b | Generated in place on the VPS |
| `LABS_AGENT_*` (the rest), the `LabAgent` app role, `lab_agents/{agentId}` | §2b | Host-local configuration and Entra/Cosmos objects, outside all four stores. The agent holds no database credential by design |
| `gh-app-private-key`, `dockerhub-token` (runner) | §7 | Container Apps job secrets, seeded out-of-band |
| `production-infra`, `data-migration` | §7b | GitHub Environments — protection gates, not values. `data-migration` is additionally the OIDC subject in `infra/oidc.tf` and cannot be renamed without breaking login with AADSTS70021 |

---

## Placement errors in the current configuration

Five, ranked by how much they mislead a reader.

**1. `AZURE_STATIC_WEB_APPS_API_TOKEN` is a long-lived Azure credential in
store 4.** By the zero-credentials rule this cannot be right: it is an Azure
deployment key, statically stored, with no expiry and no subject pinning, in the
store with the widest reader set. The workflow already authenticates to Azure
with OIDC elsewhere. Correct placement is **derived** — fetch the token at
deploy time with `az staticwebapp secrets list` after `azure/login`, and store
nothing. Two notes on the current state: the pinned
`Azure/static-web-apps-deploy` action takes only a deployment token as input, so
the fetch-then-pass shape is what removes the stored copy; and `infra/outputs.tf`
exposes the same token as the `swa_token` output, which means the value is also
in Terraform state — if the run-time fetch lands, that output has no remaining
consumer and should go with it.

**2. `AZURE_FUNCTIONS_URL` was a public URL in store 4 — resolved 2026-08-18.**
It fed `VITE_AZURE_FUNCTIONS_URL`, which is inlined into the public bundle, so
nothing was being protected — and masking it made every build-time API failure
read as `***`. The workflow now reads `${{ vars.FUNCTIONS_URL }}` (store 3,
provider prefix dropped per the naming rule). The rename was safe-now: the
value was unset everywhere when it happened. The variable itself remains to be
provisioned (CHECKLIST §7).

**3. `COSMOS_ENDPOINT` is in store 4 on the GitHub side.** An account endpoint
is a public hostname, derivable from the account name, and with
`cosmos_local_auth_disabled = true` it grants nothing to whoever reads it.
Correct placement is **derived** — `heal-computed-properties.yml` and
`migrate-data.yml` both run after `azure/login`, so
`az cosmosdb show --query documentEndpoint` removes the entry entirely. Store 3
is the acceptable fallback if a lookup is judged too slow.

**4. `DOCKERHUB_USERNAME` is in store 4.** It is an account name, and
`build-runner-image.yml` interpolates it directly into the image tags it pushes
to a public registry. Masking it means the pushed tag prints as `***` in the
build summary — the one line you want to read. Correct store: **3**. The larger
question is whether the entry should exist at all: the same workflow already
logs in to GHCR with `GITHUB_TOKEN`, so publishing the runner image only to GHCR
would eliminate `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` together and take
store 4 down to three entries. The trigger not to is the authenticated-pull-limit
reason in `ci-runner.tf`, which applies to *pulls* from the Container Apps job,
not to *pushes* from CI.

**5. `AZURE_OPENAI_KEY` is inventoried in CHECKLIST §4 as `Required: Yes`,
source Key Vault.** `infra/main.tf` decided the opposite under T-506: Azure
OpenAI is keyless, only `AZURE_OPENAI_ENDPOINT` is set, and
`lib/openai-client.js` must authenticate with `DefaultAzureCredential`. The
correct placement is **deliberately absent**, in the same category as
`COSMOS_KEY`. As written, the inventory instructs a future operator to create a
credential the architecture removed.

Two record-keeping gaps, which are not misplacements but do make the inventory
unusable as a seeding checklist:

- **The Key Vault contents are under-inventoried.** `main.tf` declares 20
  `@Microsoft.KeyVault` references plus `GITHUB-APP-PRIVATE-KEY` and the GCP
  service-account JSON read at run time; CHECKLIST §1–§8 lists only a few of
  them. Every one of those resolves to empty until seeded, and an unseeded
  reference fails at *first invocation in production*, not at deploy — the
  failure mode the vault seeding runbook exists to prevent.
- **`functions/src/lib/key-vault.js` has exactly one call site**, and it is
  narrow: `functions/src/lib/cloud-tools/pricing/gcp.js` imports `getSecret`
  for the GCP service-account JSON. Every other secret reaches the app through
  an `@Microsoft.KeyVault(...)` app setting resolved by the host, not through
  this module. That matters for the seeding runbook: an app-setting reference
  fails the whole app at startup, whereas this one path fails only GCP pricing
  and only when that tool is invoked — so a missing value here is invisible
  until a specific feature is used.

Nothing in this section renames a value that is currently set. `CLIENT_ID`,
`TENANT_ID`, `SUBSCRIPTION_ID`, `APP_HOSTNAME` and `RESOURCE_GROUP` are set and
keep their names; everything proposed for a move is `Missing` today.

---

## Naming

### The core rules

Carried from the [IaC Repository Standard](IaC-Repository-Standard), and
unchanged by this page:

| Rule | Example |
| --- | --- |
| **Max 2 words.** A third only to break a real collision | `CLIENT_ID`, `TENANT_ID`, `APP_HOSTNAME`; `FUNCTIONS_STORAGE_ACCOUNT` vs the content account |
| **Casing follows the store; the word count does not** | `CLIENT_ID` (GitHub) ↔ `client_id` (Terraform output) |
| **No provider prefixes.** One platform, so say what the value *is* | `client_id`, not `azure_deploy_client_id` |
| **A name that crosses stores mirrors itself** | output `app_hostname` → variable `APP_HOSTNAME` |
| **Apply at creation.** Renaming a set value is a coordinated one-PR change across the setting and every consumer | — |

One rule this page adds: **name the value, not its plumbing.** `COSMOS_ENDPOINT`
describes what it is; `MIGRATION_COSMOS_TARGET_ENDPOINT_SECRET` describes how it
got there, and stops being true the moment the plumbing changes.

### Per store

| Store | Casing | Separator | Example | Platform limits that bite |
| --- | --- | --- | --- | --- |
| Terraform variable / output | `lower_snake_case` | `_` | `client_id`, `entra_api_audience` | Must be a valid HCL identifier |
| HCP Terraform, **Terraform** kind | Identical to the `variable` block name | `_` | `subscription_app` | A key that matches no `variable` block is **silently ignored** — no error, just an unset variable and a confusing plan |
| HCP Terraform, **Environment** kind | `UPPER_SNAKE_CASE` | `_` | `ARM_TENANT_ID` | Must match exactly what the tool reads; all four are contractual |
| Azure Key Vault secret | `UPPER-KEBAB-CASE` | `-` | `CF-ORIGIN-SECRET` | 1–127 characters, **alphanumerics and hyphens only** — no underscores, ever |
| Function App app setting | `UPPER_SNAKE_CASE`, matching `process.env.X` | `_` | `CF_ORIGIN_SECRET` | `__` is a **reserved hierarchy separator** (`COSMOS_CONNECTION__accountEndpoint`) — never use it for word separation |
| GitHub Actions variable | `UPPER_SNAKE_CASE` | `_` | `APP_HOSTNAME` | Alphanumerics and `_` only; must not start with a number; must not start with `GITHUB_`; names are case-insensitive |
| GitHub Actions secret | `UPPER_SNAKE_CASE` | `_` | `TF_API_TOKEN` | Same restrictions as variables, and a secret and a variable must not share a name |
| Container Apps job secret | `lower-kebab-case` | `-` | `gh-app-private-key` | Lowercase alphanumerics and `-`; must start and end alphanumeric |
| GitHub Environment | `lower-kebab-case` | `-` | `data-migration` | Not a value, but load-bearing: it appears in the OIDC subject in `infra/oidc.tf` and is immutable in practice |

### The Key Vault ↔ app setting transform

Key Vault secret names cannot contain underscores. Application code reads
`process.env.CF_ORIGIN_SECRET`. Both constraints are fixed, so the mapping is
mechanical and there is no per-secret decision to make:

```
app setting name    CF_ORIGIN_SECRET
                    │  uppercase; underscores → hyphens
                    ▼
Key Vault secret    CF-ORIGIN-SECRET
                    │
                    ▼
app setting value   @Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/CF-ORIGIN-SECRET)
```

State it once and every future secret names itself. The alternative — deciding
per secret — produces `CF_ORIGIN_SECRET` next to `cfOriginSecret` next to
`cf-origin-secret` in the same vault, and a `getSecret()` call that 404s in
production while every test passes.

Omitting the version from the `SecretUri` is deliberate: the app picks up a
rotated value without a Terraform run, which is what makes rotation an
`az keyvault secret set` rather than a deployment.

### Contractual names — exempt, and never renamed

A name is contractual when **something outside this repository decides it**.
Renaming it does not produce a differently-named working system; it produces a
broken one, usually silently.

| Name | Dictated by | What breaks if renamed |
| --- | --- | --- |
| `TFC_AZURE_PROVIDER_AUTH`, `TFC_AZURE_RUN_CLIENT_ID` | HashiCorp | HCP Terraform never mints an OIDC token; the provider finds no credential |
| `ARM_TENANT_ID`, `ARM_SUBSCRIPTION_ID` | Microsoft / `azurerm` | The provider credential chain does not see them |
| `ARM_CLIENT_ID`, `ARM_OIDC_TOKEN`, `ARM_USE_OIDC` | Microsoft / HashiCorp | Injected into the run environment automatically — never set these by hand |
| `VITE_*` prefix | Vite | Without the prefix the value is not inlined; the bundle reads `undefined` and the build still looks fine |
| `GITHUB_TOKEN` | GitHub | Injected per-run; the name is reserved and cannot be created as a secret anyway |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | The AWS SDK | The SDK reads these exact names from the environment |
| `NODE_ENV`, `WEBSITE_SITE_NAME`, `REGION_NAME` | Node / the Functions host | Host-provided |
| Any app setting read as `process.env.X` by shipped code | This repository's own code | The read returns `undefined`, which most code treats as "feature off" rather than as an error |
| `GatewaySubnet`, `AzureFirewallSubnet`, `AzureBastionSubnet` and the other reserved subnet names | Azure | Covered in [Naming-Convention](Naming-Convention); listed here so nobody applies the 2-word rule to them |

Note what is **not** contractual, because that is where the mistakes are made:

- `AZURE_STATIC_WEB_APPS_API_TOKEN` — the *action input* is
  `azure_static_web_apps_api_token`; the secret name feeding it is ours, and
  five words long. Unset today, so it is a safe rename if it survives at all.
- `FUNCTIONS_URL` — ours. Renamed 2026-08-18 from `AZURE_FUNCTIONS_URL`
  (three words, provider prefix) while unset everywhere — the safe-now case
  below, exercised.
- `FIREBASE_SERVICE_ACCOUNT_JSON` — ours, four words, and the `_JSON` suffix
  encodes an encoding rather than a meaning.
- `VITE_AZURE_FUNCTIONS_URL` — the `VITE_` prefix is contractual, the rest is
  ours. But `frontend/src/lib/functionsBase.js` reads it and a test enforces
  that it is the only reader, so this one is *coordinated*, not safe-now.

### Which bucket a rename falls into

Every name sorts into exactly one:

| Bucket | Meaning | Currently |
| --- | --- | --- |
| **Safe now** | Unset everywhere, or read only by code changed in the same PR | `AZURE_STATIC_WEB_APPS_API_TOKEN`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `DOCKERHUB_USERNAME` — all `Missing`. (`AZURE_FUNCTIONS_URL` → `FUNCTIONS_URL` already exercised this path, 2026-08-18) |
| **Coordinated** | Already set in HCP Terraform or GitHub, or already read by shipped code. Report it; never rename silently | `CLIENT_ID`, `TENANT_ID`, `SUBSCRIPTION_ID`, `APP_HOSTNAME`, `RESOURCE_GROUP`, `VITE_AZURE_FUNCTIONS_URL` |
| **Contractual** | Never touched | The table above |

---

## Adding a new value — the short version

1. Run Q1–Q7. Write the answer into CHECKLIST with the store and the reason.
2. Name it for the store it landed in: 2 words, no provider prefix.
3. If it is a Key Vault secret, apply the underscore→hyphen transform and add
   the `@Microsoft.KeyVault` reference to `app_settings` in `infra/main.tf` —
   the reference, never the value.
4. If it landed in store 4, the CHECKLIST entry must name the external system
   and say why federation is unavailable.
5. If the answer was "deliberately absent", record it anyway, with what breaks
   if someone provisions it. An absent value with no record gets provisioned.

---

## Related

- [IaC Repository Standard](IaC-Repository-Standard) — the variable naming rule
  and the credential-free principle this page implements
- [Naming Convention](Naming-Convention) — resource names, and the platform
  limits that override them
- [Deployment Runbook](Deployment-Runbook) — §0 bootstrap, where the store 2
  environment variables are first entered
- `CHECKLIST.md` — the inventory: what exists, who consumes it, whether it is
  provisioned
- `infra/variables.tf` — the store 2 Terraform variables and their validations
- `infra/main.tf` — the Key Vault, its network ACLs and RBAC, and the app
  settings that reference it
