# REVIEW

This file holds two things. Most of it is work that cannot be completed by an
engineer working from the repository alone: directory administration, owner
decisions, production approvals, credentials, external access, and
live-environment confirmation. Code changes and testable implementation work
belong in [TODO.md](TODO.md). Verified completion belongs in
[CHANGELOG.md](CHANGELOG.md).

**This file carries open work only.** An item is removed once the corresponding
entry is in `CHANGELOG.md` — the same rule `TODO.md` states in its own footer,
and the reason neither file accumulates a history of finished work. The two
archived plans ([Architecture_Plan.md](Architecture_Plan.md),
[Migration_Plan.md](Migration_Plan.md)) do the opposite on purpose: they keep
every entry and strike the completed ones through, because their value is the
reasoning behind each decision rather than the state of a queue.

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
| Timers and the availability test | Decide whether to arm the 18 schedulers (`schedulers_master_enabled`, then `enabled_timers` one name at a time) and the `/api/health` availability test (`availability_test_enabled`). All three are workspace edits in `hcw-azure` | Every one defaults to the safe value, so the repository state is "nothing armed" and stays that way without a decision. Arming the availability test needs a Cloudflare change first: Bot Fight Mode answers Azure's availability agents with a 403, and a WAF skip rule against it was built, applied and confirmed inert |
| Recovery objectives | State the RTO and RPO the platform is held to, so backup and recovery settings are measured against a number instead of chosen (S6). Tracked as **[issue #231](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/231)** since 2026-08-26, with the design, cost model and acceptance criteria | Cosmos carries continuous backup on the free 7-day tier and both storage accounts carry versioning and soft delete — but both are `LRS`, and every mechanism sits inside the subscription it protects, so none of it survives account loss. None of it is justified against a stated objective, and nothing here has ever been recovery-tested |
| Key Vault | Provide only the secrets needed by enabled features; never put values in GitHub variables or Vite config. **The approved procedure changed on 2026-08-29**: seeding is now **Admin → Platform → API Keys**, and the desktop script is break-glass rather than the default path | Code reads secrets server-side and degrades optional integrations when absent |
| Function App vault write (decided 2026-08-29) | **Approved.** The app may create new secret versions, through a CUSTOM role holding only `Microsoft.KeyVault/vaults/secrets/setSecret/action` — not `Key Vault Secrets Officer`, which would also grant get, list, delete and purge. It may also refresh its own Key Vault references (`Microsoft.Web/sites/config/Write`, scoped to the one site, with `config/list/action` excluded so it cannot read its settings back). Weighed against what it replaces: the previous procedure opened the production vault's firewall to a human IP on every rotation, and left it open once | The app cannot read a secret back out of the vault, cannot delete one, and cannot enumerate its own app settings through ARM. `/api/cms/secrets` is `super_admin` on both verbs and returns no value in any response — asserted by scanning the whole serialised body, not by trusting a field list |
| GCP pricing integration | Seed `GCP-BILLING-API-KEY` if the GCP column in the public pricing tool is wanted, or leave it unseeded and that column stays absent. Get it from the GCP console: enable the Cloud Billing API, create an API key, restrict it to that API. **This is not a billing credential** — the Cloud Billing Catalog API serves the public price list, and it is read for the site's comparison tools, not for anything this estate is charged for | No GCP credential is stored in the repository. The service-account JSON this row used to ask for is retired (2026-08-29): the API key is what Google documents for this API, and it removed a vault SDK client, an OAuth library and a bespoke seeding script |
| AI providers | Decide which external providers should be enabled and provide their keys through Key Vault | The AI router only enables a provider when its server-side key is present |
| Third-party integrations | Provide owner-controlled Publer, Klaviyo, YouTube, Telegram, Hostinger, or other credentials and approve webhook changes before activation | Integration secrets are server-side and optional paths remain gated |
| Listen & Learn speech | Nothing to provide: it synthesises with Gemini TTS on the existing `GEMINI-API-KEY`. Audio is billed against that key at roughly $0.17 an episode / $0.87 a certification on the default model; every run is logged to the AI Engine usage tab under "Breakdown by Feature", so the spend is checkable there rather than estimated. Azure AI Speech is a written, tested fallback for the day the preview Gemini TTS models are retired; using it means creating a Cognitive Services resource, which is a spend decision and is not assumed | Provider is chosen by key presence, Gemini first. With no key at all the feature still publishes each episode's transcript, takeaways and videos and records `audioError` instead of failing |
| Listen & Learn video links | Seed `YOUTUBE-API-KEY` if the curated "watch next" links are wanted. One certification costs ~505 of the default 10,000 daily quota units | Optional. Without it, episodes generate and publish with an empty video list |
| VPS Labs agent | Provide the host operator, Entra client/certificate, API scope, and deployment approval for the Hostinger agent | `vps-agent/` uses the API and holds no database credential |

## Live confirmation still requiring an authorized operator

- Verify the Entra role claim and API audience in a newly issued access token.
- Verify the admin registry record and the resulting `getCurrentAdminStatus`
  response in the deployed environment.
- Confirm the public API and Static Web App custom domain after any DNS or edge
  change.
- **Observe an alert actually being delivered.** `az monitor action-group
  test-notifications` against `ag-ops-prod-cus`, then set `ops_sms_receiver` so
  there is a second channel independent of email. The optional SMS receiver is
  merged and inert until the variable is set; delivery through *either* channel
  has never been observed, which means the alerting fabric is unproven end to
  end no matter how many rules are enabled ([TODO.md](TODO.md), from T-709).
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
| **The Static Web Apps deployment token is a Terraform output** (`swa_token`), which `outputs.tf`'s own header otherwise says does not exist. Raised as T-722, 2026-08-28 | Recorded 2026-08-28; owner decision outstanding on retiring it (T-727) | The token is in state via `azurerm_static_web_app.hcw.api_key` whether or not the output exists, so deleting the output would hide it rather than retire it. `sensitive` keeps it out of logs and plan output; it is still visible on the HCP Terraform Outputs tab to anyone with state read. It is the estate's **last long-lived credential** — everything else a workflow uses is federated OIDC. Compensating control, 2026-08-28: `deploy-azure-frontend.yml` now isolates it in a job that installs nothing, so a compromised build dependency cannot reach it (T-727). Retiring it means moving the SWA deploy to OIDC, or at minimum making this an environment secret on a *protected* `production`; both need owner access. The `outputs.tf` header now names the exception instead of contradicting it |
| **`cloudflare_origin_secret` is a real shared-secret value in Terraform state.** Raised as T-723, 2026-08-28 | Recorded 2026-08-28 | Unavoidable rather than chosen: Terraform configures the Cloudflare end of the origin handshake, so the value has to pass through it. It was simply never written down, which is the part that is fixed here. **Rotation consequence, which is the reason this needs a record:** the value must change in three places in one window — the HCP Terraform workspace variable, Key Vault `CF-ORIGIN-SECRET`, and the Cloudflare transform rule Terraform writes — and a mismatch throws on *every anonymous request*, so a partial rotation is a full outage of the public API rather than a degradation. The companion exposure — the azapi read-back exporting the whole live app-settings map into state — is not accepted but *bounded*: it is safe only while every secret-shaped setting is a Key Vault reference, and `functions/src/functions/app-settings-secrets.test.js` now fails CI if one is not |

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
| `functions_scm_lock_enabled` | `false` in code, **set `true` in the workspace 2026-08-25** | Denies SCM/Kudu by default; `deploy-functions.yml` opens a per-run window. Proven under `Deny` by run 32902534458 |
| `functions_origin_lock_enabled` | `true` | Restricts the origin to Cloudflare ranges. Already on |
| `purge_protection_enabled` | `false` | Key Vault purge protection. Off as an accepted risk — see [Accepted risks](#accepted-risks) |
| `cloudflare_origin_secret` | — (sensitive) | Must match Key Vault `CF-ORIGIN-SECRET` exactly; a mismatch throws on every anonymous request |

## 4.2 GitHub repository variables

Enumerated live 2026-08-25. Twenty present, and twenty is the whole list — the
three scratch variables that used to sit here were deleted the same day (T-525),
so a reader comparing this table against `gh variable list` should find no
difference. Seeded from Terraform outputs by `scripts/set-github-variables.ps1`
— never written by hand.

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
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | **SET** | Workload identity federation for the one-shot Firestore migration. **Read by no workflow in the repository today** — the description here previously said "GCP pricing integration", which was never true: pricing runs in the Function App and now uses an API key. Inert; delete both when the migration record is closed |
| `GCP_SERVICE_ACCOUNT` | **SET** | As above — the federated principal's email, not a downloaded key |
| `VITE_ENTRA_CLIENT_ID` | **VERIFIED** | Frontend build — SPA registration |
| `VITE_ENTRA_TENANT_ID` | **VERIFIED** | Frontend build |
| `VITE_ENTRA_API_SCOPE` | **VERIFIED** | Frontend build — token audience |
| `VITE_SOCIAL_GITHUB_URL` | **SET** | Frontend build — footer links |
| `VITE_SOCIAL_LINKEDIN_URL` | **SET** | Frontend build |
| `VITE_SOCIAL_X_URL` | **SET** | Frontend build |

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
| `production` | **CONFIRMED — no reviewers, by decision** (owner, 2026-08-29) | Both deploy workflows bind to it, so it records who deployed. **Required reviewers are deliberately NOT configured: this is a single-operator estate, and a required reviewer you approve yourself is not a control — it is a click that produces an audit trail implying oversight that did not happen.** What still matters here is the other half. GitHub auto-creates a missing environment with no protection rules, and the federated credential's subject is environment-scoped (`repo:…:environment:production`), so it matches from any branch — an unprotected environment leaves `workflow_dispatch` able to ship an unreviewed ref past all 12 required contexts (T-705). A `main`-only **deployment-branch rule** closes that, costs a solo operator nothing, and is not self-approval theatre. **Owner action, reduced to one thing:** Settings → Environments → `production` → Deployment branches → *Selected branches* → `main`. The guard step in both workflows stays as the repository-side backstop; belt and braces is correct here because the environment rule is configured outside the repository and nothing in a checkout can prove it is still set |
| `copilot` | **SET** | Copilot code review agent |
| `data-migration` | **RETIRED** | Its only consumer, `migrate-data.yml`, was deleted in `59e471b`. The two federated credentials that still trusted it were removed on 2026-08-26 (T-524), so nothing in Azure trusts the subject either |

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

**Twenty-four, and they live in two files.** Twenty-one in `infra/outputs.tf`
and three in `infra/oidc.tf` — `client_id`, `deploy_principal_id` and
`federated_subjects`. This section listed twenty-three when it was first
written, omitting `deploy_principal_id`, because it was built by reading
`outputs.tf` alone. Corrected 2026-08-25 against the apply's own output block,
which is the only listing guaranteed to be complete.

From `infra/outputs.tf`: `api_base_url` · `app_principal_id` · `blob_endpoint` ·
`cloudflare_plan` · `cosmos_database` · `cosmos_endpoint` ·
`cosmos_resource_group` · `function_app_name` · `function_hostname` ·
`function_url` · `functions_storage_account` · `insights_connection` ·
`storage_account` · `storage_resource_group` · `subnet_id` · `swa_hostname` ·
`swa_token` · `vault_name` · `vault_uri` · `web_resource_group` ·
`workspace_id`

From `infra/oidc.tf`: `client_id` · `deploy_principal_id` ·
`federated_subjects`

The four scratch outputs that fed §4.2's three now-deleted variables are gone
from `infra/outputs.tf`.
