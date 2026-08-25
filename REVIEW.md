# REVIEW

This file holds two things. Most of it is work that cannot be completed by an
engineer working from the repository alone: directory administration, owner
decisions, production approvals, credentials, external access, and
live-environment confirmation. Code changes and testable implementation work
belong in [TODO.md](TODO.md). Verified completion belongs in
[CHANGELOG.md](CHANGELOG.md).

The second is [PART 4 — REQUIRED INPUTS](#part-4--required-inputs), the
inventory of every variable, secret and setting the workload needs, with live
status. It sits here rather than in the Wiki because the two procedures that
write to it — a contributor recording a new required input
([CONTRIBUTING](.github/CONTRIBUTING.md)), an operator moving an entry from
`SET` to `VERIFIED` after an apply
([Deployment-Runbook](wiki/Deployment-Runbook.md)) — are both gated on the kind
of access this file is already about.

## Immediate: restore admin access

The current `403` from `POST /api/bootstrapCurrentUserAdmin` is an authorization
configuration issue, not an MSAL cache issue. The API requires both gates:

1. Assign the Microsoft Entra **Admin** app role for the API application to
   `spatino@hybridcloudworks.com` or to the approved administrator group.
2. Sign out and sign in again so MSAL obtains a token containing the new role.
3. If the account is the first administrator, approve the bootstrap request and
   confirm that the corresponding `admins/{Entra object id}` record exists in
   Cosmos DB. The API deliberately refuses non-Admin tokens even when a registry
   record exists.

Only a tenant administrator or an owner with Cosmos data access can perform and
verify these actions. Do not weaken the API guard or add a browser-side bypass.

## Owner decisions and external access

| Item | Human action required | Safe repository-side state |
| --- | --- | --- |
| Entra application | Confirm SPA client ID, tenant ID, API audience/scope, redirect URIs, consent, and the `Admin` app role assignment | `frontend/.env.example` documents names; no client secret is committed |
| Frontend release | Approve whether releases remain manual or become push-triggered; provide/rotate the Static Web App deployment credential through the approved Azure/GitHub path | `deploy-azure-frontend.yml` stays dispatch-only |
| Production infrastructure | Approve HCP Terraform plan/apply and any DNS, custom-domain, or Cloudflare changes | Terraform remains the infrastructure source of truth |
| Migration-era Azure resources | **Decided 2026-08-24** — the rehearsal is finished; revoking the three production-write grants and tearing down the rehearsal estate are both authorised. See [Authorised: the migration-era teardown](#authorised-the-migration-era-teardown-2026-08-24) below for what that destroys. What remains is approving the plan that carries it out | The declarations are deleted from `infra/scratch.tf`, `infra/oidc.tf` and `infra/variables.tf`, each leaving a removal record naming what an apply removes. Nothing is applied yet |
| Apex DNS cutover | Repoint `hybridcloudworks.com` from Firebase Hosting to the Static Web App and complete custom-domain validation (B1). In flight as of 2026-08-24 | The apex is the only host still served by Firebase; `www` and the SWA default hostname already serve the Azure site. Nothing in the repository can move it — the record lives at Cloudflare and the domain binding at Azure |
| Timers and the availability test | Decide whether to arm the 18 schedulers (`schedulers_master_enabled`, then `enabled_timers` one name at a time) and the `/api/health` availability test (`availability_test_enabled`). All three are workspace edits in `hcw-azure` | Every one defaults to the safe value, so the repository state is "nothing armed" and stays that way without a decision. Arming the availability test needs a Cloudflare change first: Bot Fight Mode answers Azure's availability agents with a 403, and a WAF skip rule against it was built, applied and confirmed inert |
| Migration-era identity trust | Decide whether to retire the two `data-migration` federated credentials in `infra/oidc.tf`. No workflow references `environment: data-migration` | With the production-write grants revoked, a `data-migration` token inherits the same reduced role set as a branch token. Retiring a trust relationship is an identity change and was deliberately not folded into a Terraform cleanup |
| GitHub repository administration | Make both `iac-validate.yml` jobs required to merge on the `main` ruleset (S8), and delete the three orphaned repository variables `COSMOS_SCRATCH_ENDPOINT`, `STORAGE_SCRATCH_ACCOUNT`, `SCRATCH_RESOURCE_GROUP` | CI runs `fmt`, `validate`, `tflint` and Trivy on every `infra/**` change; nothing requires them to pass before a merge. The three variables have no reader left — the Terraform outputs that fed them are deleted |
| Recovery objectives | State the RTO and RPO the platform is held to, so backup and recovery settings are measured against a number instead of chosen (S6) | Cosmos carries continuous backup on the free 7-day tier and both storage accounts now carry versioning and soft delete. None of it is justified against a stated objective, so nothing says whether it is enough |
| Key Vault | Provide only the secrets needed by enabled features through the approved vault procedure; never put values in GitHub variables or Vite config | Code reads secrets server-side and degrades optional integrations when absent |
| GCP pricing integration | If live GCP pricing is still required, provide a valid service-account JSON through Key Vault and approve its scope; otherwise approve retiring that optional feature | No GCP credential is stored in the repository |
| AI providers | Decide which external providers should be enabled and provide their keys through Key Vault | The AI router only enables a provider when its server-side key is present |
| Third-party integrations | Provide owner-controlled Publer, Klaviyo, YouTube, Telegram, Hostinger, or other credentials and approve webhook changes before activation | Integration secrets are server-side and optional paths remain gated |
| Listen & Learn speech | Nothing to provide: it synthesises with Gemini TTS on the existing `GEMINI-API-KEY`. Audio is billed against that key at roughly $0.17 an episode / $0.87 a certification on the default model; every run is logged to the AI Engine usage tab under "Breakdown by Feature", so the spend is checkable there rather than estimated. Azure AI Speech is a written, tested fallback for the day the preview Gemini TTS models are retired; using it means creating a Cognitive Services resource, which is a spend decision and is not assumed | Provider is chosen by key presence, Gemini first. With no key at all the feature still publishes each episode's transcript, takeaways and videos and records `audioError` instead of failing |
| Listen & Learn video links | Seed `YOUTUBE-API-KEY` if the curated "watch next" links are wanted. One certification costs ~505 of the default 10,000 daily quota units | Optional. Without it, episodes generate and publish with an empty video list |
| VPS Labs agent | Provide the host operator, Entra client/certificate, API scope, and deployment approval for the Hostinger agent | `vps-agent/` uses the API and holds no database credential |

## Authorised: the migration-era teardown (2026-08-24)

This section exists because the confirmation behind an **irreversible** destroy
was asserted only in Terraform comments. A code comment is not where this
repository keeps owner decisions ([CONTRIBUTING](.github/CONTRIBUTING.md)), and
"the owner confirmed" written next to the resource being deleted is a claim the
reader has no way to check. This is the record.

**Confirmed to exist.** The readiness review read the live tenant on 2026-08-24.
`rg-db-site-sbx-cus` holds `cosmos-site-sbx-cus` — 73 containers, a measured
**77,763 documents** — and `stsitesbxcus01` with 6 blob containers. That is 87
Terraform resources in all: the resource group, the Cosmos account, its `hcw`
database, 73 containers, the storage account, 6 blob containers and 4 role
assignments. The three `migration_writer_enabled` grants were also live on the
CI deploy identity: Cosmos Data Contributor at database scope `dbs/hcw`, Storage
Blob Data Contributor and Storage Account Contributor on the production content
account. `terraform state list` then confirmed all 90
addresses are managed, so an apply removes them rather than leaving them
orphaned in Azure — the question that had to be settled before the plan was the
one thing the plan itself could not be trusted to answer.

**Authorised.** The migration rehearsal is finished. The owner authorised, on
2026-08-24, both the revocation of the three production-write grants (B6) and
the teardown of the rehearsal estate (B7).

**What that destroys, and why it cannot be undone.** Everything above, at once.
Nothing in `infra/scratch.tf` ever carried `prevent_destroy` — deliberately, it
was built to be thrown away — so there is no lifecycle guard to trip and no
confirmation step beyond reading the plan. The account's `Continuous7Days`
backup does not help: a continuous backup belongs to its account and dies with
it, so after the apply the only route back to that data is a fresh copy from
production. The sandbox measured 77,763 documents against 69,979 in production;
that gap is unexplained and is not treated as a reason to keep the copy, because
both imports reconciled at 8,023/8,023 with zero field mismatches
([Phase-4-Data-Migration](wiki/Phase-4-Data-Migration.md), P2 and P4).

**What is authorised is the removal, not the mechanism.** The apply still needs
an owner approval in HCP Terraform like any other. Expected shape is **17 to
add, 5 to change, 92 to destroy** — 90 real destroys plus the 2 azapi resources
that are replaced on every apply.

The add count moved twice after the figure of 13 was first recorded, which is
why it is reconciled here rather than restated: `eec36ce` gated the availability
alert on its web test, removing one add, and `e2f502a` added two user-assigned
identities and three role assignments for the log alert rules, adding five.
13 − 1 + 5 = 17. Changes and destroys are untouched by both, because none of
those resources exists yet, so giving a rule an identity is another create
rather than a modification. Approve it against the resource **addresses**,
not the count: a near-miss number reads as close enough while meaning something
entirely different happened.

**Consequence, recorded so it is not rediscovered at cutover.** With the grants
gone the deploy identity has no write path into the production Cosmos database
or the content storage account, which is what a delta import needed. The delta
import is retired; the [Cutover Runbook](wiki/Cutover-Runbook.md) step 4 records
what that costs.

## Live confirmation still requiring an authorized operator

- Verify the Entra role claim and API audience in a newly issued access token.
- Verify the admin registry record and the resulting `getCurrentAdminStatus`
  response in the deployed environment.
- Confirm the public API and Static Web App custom domain after any DNS or edge
  change.
- **Closed 2026-08-24 — the migration-era scratch estate and the three
  production-write grants.** Both were confirmed live and Terraform-managed, and
  their removal is authorised above. The two `data-migration` federated
  credentials in `infra/oidc.tf` are the part still open; they are a decision,
  not a confirmation, and now sit in the table above.
- Confirm any third-party webhook or scheduled integration after its owner has
  approved a real external mutation test.
- Apply the Terraform change that creates the `listenandlearn` blob container.
  Until it runs, Listen & Learn generation saves episodes and their transcripts
  but the audio upload has nowhere to land. The same apply declares the fallback
  `AZURE_SPEECH_*` settings, which stay unresolved and inert.

## Accepted risks

A decision to live with a finding rather than fix it. An accepted risk with no
record is indistinguishable from an unfixed one: the next reviewer re-raises it,
or someone "fixes" it without knowing it was a choice.

| Risk | Accepted | Reasoning, and what compensates |
| --- | --- | --- |
| **Key Vault purge protection is off** on `kv-site-prod-cus-01`, which holds 18 live secrets. Raised as Go-Live blocker B2 on 2026-08-24 | Owner, 2026-08-24 | Enabling it is a **one-way** switch: once on it cannot be turned off, a deleted vault can no longer be purged, and its name stays reserved for the retention period — which removes the teardown-and-recreate path a single-environment estate depends on. The secrets are seeded and resolving, so the exposure is not "unprotected during setup". Compensating control: soft delete at 90 days, which still makes an accidental delete recoverable. What is given up is protection against a *deliberate* purge by someone already holding the rights to perform one. Recorded in the same terms in `infra/variables.tf` and `infra/README.md` |

## Handling rules

- Never paste secret values, private keys, access tokens, or personal data into
  this file, issues, logs, or the Wiki.
- A missing credential is not an engineering task. Record its name, owner, and
  approved storage location only.
- Historical migration pages and the two archived plans are evidence, not
  current instructions for restoring Firebase services.

# PART 4 — REQUIRED INPUTS

Every variable, secret and setting the workload needs, with live status.

This section is the **inventory**: what exists, who consumes it, whether it is
confirmed. It deliberately does not restate naming or placement rules — those
live in [wiki/Variables-And-Secrets.md](wiki/Variables-And-Secrets.md), which
is the placement authority and holds no status. The two are read together: that
page decides where a value belongs, this one records whether it is there.

> **This section must never contain actual values.** Formats use placeholders
> only: `X` = letter, `0` = number, `!` = special. If a real value ever appears
> here, treat it as disclosed and rotate it.

**Status vocabulary:** `SET` (present and confirmed) · `VERIFIED` (observed
working in the deployed system) · `MISSING` (consumed by code, not
provisioned) · `RETIRED` (no longer read by anything; listed so it is not
reintroduced).

**How each status below was established, because it is not uniform.** GitHub
variables, secrets and environments were enumerated live on 2026-08-25 with
`gh`, so their presence is observed. Key Vault was **not** readable in that
pass — the caller holds no data-plane role and `secret list` returned
`ForbiddenByRbac` — so §4.6 lists what the configuration *references*, which
establishes the consumer and the name but not the presence. HCP Terraform
workspace variables were likewise not read. Where a row carries a status with
no observation behind it, the section says so.

## 4.1 HCP Terraform workspace — `hcw/hcw-azure`, project `Site`

Not readable in this pass (no workspace token). The names and categories below
come from the configuration and from the contract each tool imposes; the
statuses were last confirmed 2026-08-20 and are carried forward.

**Environment variables** — how Terraform authenticates to Azure. These names
are dictated by HashiCorp and Microsoft, so they are contractual: exempt from
the repository's 2-word variable rule, never renamed. Category matters — set as
*Terraform* variables instead of *environment* variables they are silently
ignored and the run fails claiming no credentials were supplied.

| Name | Status | Notes |
| --- | --- | --- |
| `TFC_AZURE_PROVIDER_AUTH` | **SET** (`true`) | Absent ⇒ no OIDC token is minted and the provider finds no credential |
| `TFC_AZURE_RUN_CLIENT_ID` | **SET** | Client id of `id-plat-terraform-prod-cus-01`. Distinct from §4.2's `CLIENT_ID`, which is the GitHub Actions identity |
| `ARM_TENANT_ID` | **SET** (sensitive) | Same value as the `entra_tenant_id` Terraform variable — see the exceptions table in the Wiki |
| `ARM_SUBSCRIPTION_ID` | **SET** (sensitive) | Provider fallback only; every provider pins `subscription_id` in HCL, so it never decides where resources land |

**Terraform variables — required.** Eight of the configuration's 58 variables
have no default, so an unset one fails the plan rather than picking something.
That is deliberate for the subscriptions in particular: a wrong guess would
silently deploy the workload into a platform landing zone.

| Name | Sensitive | Consumer |
| --- | --- | --- |
| `subscription_app` | yes | Application landing zone — the workload |
| `subscription_mgmt` | yes | Platform Management — Log Analytics, action groups |
| `subscription_conn` | yes | Platform Connectivity — hub network |
| `entra_tenant_id` | yes | Entra tenant for admin sign-in and API audience |
| `entra_api_audience` | no | API scope the SPA requests |
| `cloudflare_api_token` | yes | Cloudflare provider — DNS and the origin transform rule |
| `cloudflare_zone_id` | no | Cloudflare zone the rules attach to |
| `budget_alert_email` | no | Budget alert action group |

**Terraform variables — defaulted.** The other 50 carry defaults and need no
workspace entry. Seven are posture switches rather than settings, and every one
defaults to the estate as it stands or to the safer value, so an apply never
changes behaviour without a workspace edit first:

| Name | Default | What arming it does |
| --- | --- | --- |
| `schedulers_master_enabled` | `false` | Master switch for all 18 timers. Both this and a name in `enabled_timers` are required — TODO.md T-518 |
| `enabled_timers` | `[]` | Per-timer allow-list, armed one name at a time |
| `availability_test_enabled` | `false` | Standard web test and its alert. Blocked on a Cloudflare change first — TODO.md T-519 |
| `functions_scm_lock_enabled` | `false` | Denies SCM/Kudu by default. Requires the per-run window in `deploy-functions.yml` — TODO.md T-520 |
| `functions_origin_lock_enabled` | `true` | Restricts the origin to Cloudflare ranges. Already on |
| `purge_protection_enabled` | `false` | Key Vault purge protection. Off as an accepted risk — see [Accepted risks](#accepted-risks) |
| `cloudflare_origin_secret` | — (sensitive) | Must match Key Vault `CF-ORIGIN-SECRET` exactly; a mismatch throws on every anonymous request |

## 4.2 GitHub repository variables

Enumerated live 2026-08-25. Twenty-three present. Seeded from Terraform outputs
by `scripts/set-github-variables.ps1` — never written by hand.

| Name | Status | Consumer |
| --- | --- | --- |
| `CLIENT_ID` | **VERIFIED** | OIDC login in every deploy workflow. Also arms `heal-computed-properties.yml`, which skips while it is unset |
| `TENANT_ID` | **VERIFIED** | OIDC login |
| `SUBSCRIPTION_ID` | **VERIFIED** | OIDC login, `az rest` calls |
| `RESOURCE_GROUP` | **VERIFIED** | Function App deploy and firewall windows |
| `FUNCTION_APP_NAME` | **VERIFIED** | Deploy target, SyncTriggers, access restrictions |
| `FUNCTIONS_STORAGE_ACCOUNT` | **VERIFIED** | Storage firewall window during deploy |
| `FUNCTIONS_URL` | **VERIFIED** | Smoke test's non-allowlisted probe |
| `APP_HOSTNAME` | **VERIFIED** | Origin health probe through the temporary window |
| `COSMOS_ENDPOINT` | **VERIFIED** | Computed-property healer. A variable, not a secret — it is a public endpoint, and the earlier secret placement was corrected 2026-08-20 |
| `COSMOS_RESOURCE_GROUP` | **SET** | Healer scope |
| `STORAGE_ACCOUNT` | **SET** | Content manifest publisher |
| `STORAGE_RESOURCE_GROUP` | **SET** | Content manifest publisher |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | **SET** | Optional GCP pricing integration; inert while unused |
| `GCP_SERVICE_ACCOUNT` | **SET** | As above |
| `VITE_ENTRA_CLIENT_ID` | **VERIFIED** | Frontend build — SPA registration |
| `VITE_ENTRA_TENANT_ID` | **VERIFIED** | Frontend build |
| `VITE_ENTRA_API_SCOPE` | **VERIFIED** | Frontend build — token audience |
| `VITE_SOCIAL_GITHUB_URL` | **SET** | Frontend build — footer links |
| `VITE_SOCIAL_LINKEDIN_URL` | **SET** | Frontend build |
| `VITE_SOCIAL_X_URL` | **SET** | Frontend build |
| `COSMOS_SCRATCH_ENDPOINT` | **RETIRED** | No reader. The Terraform outputs that fed it are deleted; delete the variable — TODO.md T-525 |
| `STORAGE_SCRATCH_ACCOUNT` | **RETIRED** | As above |
| `SCRATCH_RESOURCE_GROUP` | **RETIRED** | As above |

## 4.3 GitHub repository secrets

Enumerated live 2026-08-25. **One**, which is the intended state: everything
else a workflow needs is either a non-sensitive variable or reached by OIDC.

| Name | Status | Consumer |
| --- | --- | --- |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | **SET** | `deploy-azure-frontend.yml`. Rotating it is an owner action — see the *Frontend release* row above |

`GITHUB_TOKEN` is contractual and injected per run; it is never stored.

## 4.4 GitHub environments

Enumerated live 2026-08-25.

| Name | Status | Notes |
| --- | --- | --- |
| `production` | **VERIFIED** | Gates production deploys (`de99aa0`) |
| `copilot` | **SET** | Copilot code review agent |
| `data-migration` | **RETIRED** | Its only consumer, `migrate-data.yml`, was deleted in `59e471b`. The two federated credentials still trusting it are an owner decision — see *Migration-era identity trust* above and TODO.md T-524 |

## 4.5 Function App settings — Terraform-managed

No operator action. Every setting on `func-site-prod-cus-01` is declared in
`infra/main.tf`; changing one by hand is reverted by the next apply and is how
configuration drift starts. Three properties are worth knowing rather than
listing every key:

- Settings whose value is a credential are **not** stored here. They are
  `@Microsoft.KeyVault(SecretUri=…)` references resolved by the app's managed
  identity at runtime — the inventory of those is §4.6.
- The vault reference maps `UPPER_SNAKE_CASE` app setting → `UPPER-KEBAB-CASE`
  secret, exactly. Key Vault forbids underscores, which is the whole reason for
  two spellings. Get it wrong and the reference resolves to nothing: the app
  deploys clean and a missing credential presents as missing *data*.
- An unseeded reference resolves to the literal `@Microsoft.KeyVault(…)`
  string, and the code treats that as "no key" rather than as a key. That is
  what keeps optional integrations inert instead of failing.

`AzureWebJobsStorage` must **not** be present. It is stripped inside the apply
(T-511) and `deploy-functions.yml` asserts its absence rather than repairing
it, because a repair would hide a regression in that fix.

## 4.6 Key Vault secrets — `kv-site-prod-cus-01`

**Not observed in this pass.** `az keyvault secret list` returned
`ForbiddenByRbac` — the caller holds no data-plane role, which is itself the
correct posture. The nineteen names below are what `infra/main.tf` references,
so each has a named consumer and a fixed spelling; presence is what is
unconfirmed. [Accepted risks](#accepted-risks) records the vault as holding 18
live secrets as of 2026-08-24.

Seeding one is an owner action through the approved vault procedure, and the
rule is worth restating: **do not seed a placeholder to quiet a linter.** An
unset input fails with a clear "not supplied"; a stubbed one fails as an
authentication or resolution error that reads like a permissions or networking
problem. The two cost very different amounts to diagnose.

| Secret | Consumer | Notes |
| --- | --- | --- |
| `CF-ORIGIN-SECRET` | Origin lock | Must match the `cloudflare_origin_secret` workspace variable exactly |
| `CLIENT-IP-SALT` | Request hashing | |
| `AWS-ACCESS-KEY-ID` | AWS pricing | |
| `AWS-SECRET-ACCESS-KEY` | AWS pricing | |
| `GEMINI-API-KEY` | AI router; **Listen & Learn TTS** | Provider chosen by key presence, Gemini first. Episode audio is billed against this key |
| `ANTHROPIC-API-KEY` | AI router | First in the router's provider order |
| `OPENAI-API-KEY` | AI router | Second |
| `PERPLEXITY-API-KEY` | AI router | |
| `REPLICATE-API-KEY` | AI router | |
| `AZURE-SPEECH-KEY` | Listen & Learn fallback TTS | Inert until a Cognitive Services resource exists, which is a spend decision |
| `YOUTUBE-API-KEY` | Listen & Learn "watch next" links | Optional; without it episodes publish with an empty video list |
| `FIRECRAWL-API-KEY` | Content research | |
| `LINKIE-API-KEY` | Link tooling | |
| `PUBLER-API-KEY` | Social publishing | Owner-controlled; webhook changes need approval before activation |
| `PUBLER-WORKSPACE-ID` | Social publishing | |
| `KLAVIYO-PRIVATE-KEY` | Email | |
| `KLAVIYO-LIST-ID` | Email | |
| `TELEGRAM-BOT-TOKEN` | Notifications | |
| `TELEGRAM-CHAT-ID` | Notifications | |

## 4.7 VPS agent (Hostinger) — `.env`, never committed

Names from `vps-agent/.env.example`. The agent holds no database credential; it
reaches the API with a certificate-backed Entra client. Provisioning the
identity and approving deployment are owner actions — see the *VPS Labs agent*
row above.

`LABS_AGENT_API_BASE` · `LABS_AGENT_API_SCOPE` · `LABS_AGENT_CLIENT_ID` ·
`LABS_AGENT_TENANT_ID` · `LABS_AGENT_CERT_PATH` · `LABS_AGENT_ID` ·
`LABS_AGENT_MAX_CONCURRENT` · `LABS_AGENT_POLL_MS` · `LABS_AGENT_JOB_CPUS` ·
`LABS_AGENT_JOB_MEMORY` · `LABS_AGENT_JOB_PIDS`

Status: **MISSING** as a set — no agent host is provisioned. The last four are
resource limits with working defaults.

## 4.8 Frontend build-time variables

`VITE_*` is contractual to Vite and never renamed. These are **build-time
substitutions, not runtime configuration**: whatever value is present when the
Static Web App is built is baked into the bundle, so nothing sensitive may ever
be one. All are non-sensitive by construction — client IDs and public URLs.

Six of the seven are repository variables (§4.2). The exception:

| Name | Status | Notes |
| --- | --- | --- |
| `VITE_AZURE_FUNCTIONS_URL` | **RETIRED** as a repository variable | Present in `frontend/.env.example` for local development. The deployed frontend resolves the API through its own origin, so no repository variable feeds it |

## 4.9 Local development

No secrets are required to run the frontend or the functions locally.

```
az login
```

`DefaultAzureCredential` picks that session up. **No `COSMOS_KEY` is needed and
none works** — `cosmos_local_auth_disabled` means the account refuses key auth
outright. Setting one switches the client to a key path the account rejects,
and the failure reads as a connectivity problem rather than a configuration
one.

## 4.10 Terraform outputs

Their role in this inventory is that they are the *source* of §4.2 rather than
a thing to be provisioned. `scripts/set-github-variables.ps1` reads them and
writes the repository variables; nothing there is set by hand.

`api_base_url` · `app_principal_id` · `blob_endpoint` · `client_id` ·
`cloudflare_plan` · `cosmos_database` · `cosmos_endpoint` ·
`cosmos_resource_group` · `federated_subjects` · `function_app_name` ·
`function_hostname` · `function_url` · `functions_storage_account` ·
`insights_connection` · `storage_account` · `storage_resource_group` ·
`subnet_id` · `swa_hostname` · `swa_token` · `vault_name` · `vault_uri` ·
`web_resource_group` · `workspace_id`

The four scratch outputs that fed §4.2's three `RETIRED` variables are already
deleted from `infra/outputs.tf`.
