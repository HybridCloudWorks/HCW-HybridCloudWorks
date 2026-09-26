# Required inputs

Every variable, secret and setting the workload needs, with live status.

> **Moved here from `REVIEW.md` on 2026-08-29**, when that file was retired and
> its open work folded into [TODO.md](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/TODO.md).
> `REVIEW.md` was the root document that held the owner-gated open work and, in
> its Part 4, this inventory; it no longer exists.
> REVIEW.md's own header explained why this inventory sat there rather than in
> the Wiki (now this docs site): the two procedures that write to it — a contributor recording a new
> required input ([CONTRIBUTING](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/.github/CONTRIBUTING.md)),
> an operator moving an entry from `SET` to `VERIFIED` after an apply
> ([Deployment-Runbook](../runbooks/deployment-runbook.md)) — are gated on owner-level access.
>
> That argument stopped holding once REVIEW.md went away, and it was always
> weaker than it looked: `docs/` (then `wiki/`) is reviewed through pull requests exactly as the
> repository root is, so nothing about the write path changes by moving here.
> What does change is that a 228-line reference inventory is no longer sitting
> inside a document people opened to find out what to do next.
>
> **Section numbers are unchanged** (§4.1 … §4.10), because roughly sixteen code
> comments cite them by number. A citation reading `REVIEW.md §4.5` now reads
> `Required-Inputs §4.5` and lands in the same place.

**Related:** [Variables and secrets](../standards/variables-and-secrets.md) carries the *rules* —
naming, which store a value belongs in, and why. This page carries the
*inventory* — what exists, who consumes it, and whether it is confirmed. The two
overlap in subject and not in purpose; where they disagree about a rule, that
page wins, and where they disagree about live status, this one does.

---

Every variable, secret and setting the workload needs, with live status.

This section is the **inventory**: what exists, who consumes it, whether it is
confirmed. It deliberately does not restate naming or placement rules — those
live in [Variables and secrets](variables-and-secrets.md), which
is the placement authority and holds no status. The two are read together: that
page decides where a value belongs, this one records whether it is there.

> **This section must never contain actual values.** Formats use placeholders
> only: `X` = letter, `0` = number, `!` = special. If a real value ever appears
> here, treat it as disclosed and rotate it.

> **Which is why the `az` sign-in details are not here.** The estate's tenant,
> its four subscriptions, the scoped device-code login and the ways
> signing in fails live in [Cutover-Runbook](../history/cutover-runbook.md) **Step 0**. They
> are operator procedure rather than inventory, and the rule above forbids the
> one thing that makes such a procedure usable — a command carrying its real
> values instead of a placeholder. Putting them here would have meant either
> breaking that rule or shipping a login command nobody can paste. Recorded as
> a pointer so the question is answered in the file where it gets asked.

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
| `ARM_TENANT_ID` | **SET** (sensitive) | Same value as the `entra_tenant_id` Terraform variable — see the exceptions table in [Variables and secrets](variables-and-secrets.md) |
| `ARM_SUBSCRIPTION_ID` | **SET** (sensitive) | Provider fallback only; every provider pins `subscription_id` in HCL, so it never decides where resources land |

**Terraform variables — required.** Eight of the configuration's 65 variables
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

**Terraform variables — defaulted.** The other 57 carry defaults and need no
workspace entry. The table below lists the nine that are posture switches
rather than settings — every one defaults to the estate as it stands or to the
safer value, so an apply never changes behaviour without a workspace edit
first — plus two defaulted inputs that are not switches:
`cloudflare_origin_secret`, which must match a Key Vault secret exactly, and
`arc_onboarding_principal_id`, which names an owner-created principal:

| Name | Default | What arming it does |
| --- | --- | --- |
| `schedulers_master_enabled` | `false` | Master switch for all 20 catalogued timers. Both this and a name in `enabled_timers` are required — TODO.md T-518 |
| `enabled_timers` | `[]` | Per-timer allow-list, armed one name at a time |
| `newsletter_sending_enabled` | `false` | Lets a publisher's approval send the weekly newsletter through Resend. Set it only after the postal address and reply-to are saved in Newsletter settings |
| `availability_test_enabled` | `false` | Standard web test and its alert. Stays `false`: Bot Fight Mode still 403s Azure's availability agents, and the reachability signal is served by the ADR 0024 Worker probe instead |
| `availability_probe_alert_enabled` | `false` in code, **set `true` in the workspace 2026-09-01 (T-519 closed)** | Arms `edge_probe_availability` (`alert-api-reachability-prod-cus`) on the Worker probe's `availabilityResults` rows. Armed only after a full 30-minute window held 6 healthy rows |
| `cosmos_export_enabled` | `false` | Arms the Cosmos exporter (`FEATURE_FLAG_COSMOS_EXPORT`) and creates `cosmos_export_daily_missing` and `cosmos_export_full_missing` (`alert-cosmos-export-daily-prod-cus`, `alert-cosmos-export-full-prod-cus`) together — ADR 0028. Arm only after the exporter is deployed and a `cosmosExportCompleted` event has been seen, and not on a Sunday after 03:00 UTC |
| `functions_scm_lock_enabled` | `false` in code, **set `true` in the workspace 2026-08-25** | Denies SCM/Kudu by default; `deploy-functions.yml` opens a per-run window. Proven under `Deny` by run 32902534458 |
| `functions_origin_lock_enabled` | `true` | Restricts the origin to Cloudflare ranges. Already on |
| `purge_protection_enabled` | `true` | Key Vault purge protection. On by owner decision 2026-09-14, and one-way. See [ADR 0031](../decisions/0031-security-scanner-owner-decisions.md). A workspace variable of this name set to `false` overrides it and must be deleted |
| `lab_hybrid_policy_enabled` | `false` | Creates the audit-only Linux security baseline policy assignment on `rg-lab-hybrid-prod-cus` (#663). **MISSING** until the owner has granted the run identity Resource Policy Contributor on that group; true before then fails the apply with `AuthorizationFailed`. [Labs host runbook](../runbooks/labs-host.md), step 3 |
| `cloudflare_origin_secret` | — (sensitive) | Must match Key Vault `CF-ORIGIN-SECRET` exactly; a mismatch throws on every anonymous request |
| `arc_onboarding_principal_id` | `null` | **MISSING.** Object id (not the appId) of the owner-created `sp-arc-onboarding-lab-hybrid-prod-cus`; set, it plans the principal's only grant, Azure Connected Machine Onboarding on `rg-lab-hybrid-prod-cus` (#663). Not sensitive. [Labs host runbook](../runbooks/labs-host.md), step 2 |

## 4.2 GitHub repository variables

Enumerated live 2026-08-25. Twenty were present then, and twenty was the whole
list — the three scratch variables that used to sit here were deleted the same
day (T-525). `READER_CLIENT_ID` was added to the table on 2026-08-29 (T-728) and
is **not yet set**, so a reader comparing this against `gh variable list` should
find exactly that one difference until the split is applied. Seeded from
Terraform outputs by `scripts/set-github-variables.ps1` — never written by
hand, with one exception: `COPILOT_REVIEW_APP_ID` identifies a GitHub App that
Terraform does not manage, so it is set by hand from the App page (runbook
step 4) and its row says so.

| Name | Status | Consumer |
| --- | --- | --- |
| `CLIENT_ID` | **VERIFIED** | OIDC login for the workflows that WRITE — `deploy-functions.yml` and `heal-computed-properties.yml`. Also arms the healer, which skips while it is unset |
| `COPILOT_REVIEW_CLIENT_ID` | **SET 2026-09-06** | OIDC login in `copilot-setup-steps.yml`, the job GitHub runs before Copilot code review and the Copilot cloud agent start. Identifies `github_copilot_review` (`infra/oidc.tf`): Reader on the four workload groups, nothing else. Seeded from the `copilot_review_client_id` output by `scripts/set-github-variables.ps1`; while unset the login fails closed and the Azure MCP server has no credential — see [Copilot code review MCP servers](../runbooks/copilot-code-review-mcp.md) |
| `COPILOT_REVIEW_APP_ID` | **SET 2026-09-06** | App ID of *HCW Copilot Review Reader*, the read-only GitHub App from which `copilot-setup-steps.yml` mints a one-hour installation token for the GitHub MCP server Copilot code review uses. An identifier, like `MANIFEST_APP_ID`; the key is the Agents secret in §4.3. Set by hand from the App page (runbook step 4) |
| `READER_CLIENT_ID` | **NOT SET** | OIDC login for the workflows that only read — `monitor-functions-registered.yml`, `verify-alert-state.yml`, `publish-content-manifest.yml` (T-728). All three are gated on it and **skip silently while it is unset**, so seed it in the same pass as the apply: an unset value looks like three workflows not running, not like a failure |
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
| ~~`AZURE_STATIC_WEB_APPS_API_TOKEN`~~ | **RETIRED 2026-08-30, DELETED 2026-08-31 (T-727)** | Nothing. `deploy-azure-frontend.yml` mints the deployment token from ARM under federated identity at deploy time, so no stored value is needed and there is nothing to rotate. The secret was removed from repository settings by the owner on 2026-08-31, after the role assignment applied |

**No stored Azure credential is in this repository's secrets.** The Qlty
coverage upload (#568) uses GitHub OIDC and stores no token. `GITHUB_TOKEN` is
contractual and injected per run; it is never stored.

The **Agents** store (Settings → Secrets and variables → Agents) is separate
from Actions secrets. Copilot's setup job and agent environment read it; a
name carrying the `COPILOT_MCP_` prefix is read by MCP servers only. It holds
the Copilot review identifiers and one key:

| Name | Status | Consumer |
| --- | --- | --- |
| `COPILOT_REVIEW_CLIENT_ID`, `COPILOT_REVIEW_TENANT_ID`, `COPILOT_REVIEW_SUBSCRIPTION_ID`, `COPILOT_REVIEW_APP_ID` | **SET 2026-09-06** — owner step 2b, [issue #381](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/381) | Copies of the four identifiers the repository variables also hold, because Copilot's own runner resolves no `vars.*` (seen on the first review session, PR #378, 2026-09-06) and reads only this store. `copilot-setup-steps.yml` prefers these and falls back to the variables, so a manual dispatch and a Copilot session both sign in. Rotate them with the variables: a changed client id or App ID has to land in both places. Holding identifiers in a secret store is the documented exception in [Variables and secrets](variables-and-secrets.md#subscription-tenant-and-client-ids) |
| `COPILOT_REVIEW_APP_PRIVATE_KEY` | **SET 2026-09-06** | PEM private key of *HCW Copilot Review Reader*, the GitHub App installed on this repository only with eight **read** permissions. `copilot-setup-steps.yml` mints a one-hour installation token from it for the `github-mcp-server` entry in `.github/copilot-mcp.json`; the App's read-only permissions are the ceiling for anything the key can mint. **No personal access token, classic or fine-grained, is used anywhere in the configuration.** Not `COPILOT_MCP_`-prefixed because the setup job, not an MCP server, reads it. Justified in [Variables and secrets](variables-and-secrets.md#store-4-github-actions-secrets-with-justification); procedure in [Copilot code review MCP servers](../runbooks/copilot-code-review-mcp.md) |

## 4.4 GitHub environments

Enumerated live 2026-08-25.

| Name | Status | Notes |
| --- | --- | --- |
| `production` | **CONFIRMED — no reviewers, by decision** (owner, 2026-08-29) | Both deploy workflows bind to it, so it records who deployed. **Required reviewers are deliberately NOT configured: this is a single-operator estate, and a required reviewer you approve yourself is not a control — it is a click that produces an audit trail implying oversight that did not happen.** What still matters here is the other half. GitHub auto-creates a missing environment with no protection rules, and the federated credential's subject is environment-scoped (`repo:HybridCloudWorks/HCW-HybridCloudWorks:environment:production`, declared in `infra/oidc.tf`), so it matches from any branch — an unprotected environment leaves `workflow_dispatch` able to ship an unreviewed ref past all 12 required contexts (T-705). A `main`-only **deployment-branch rule** closes that, costs a solo operator nothing, and is not self-approval theatre. ~~**Owner action, reduced to one thing:** Settings → Environments → `production` → Deployment branches → *Selected branches* → `main`.~~ **Done 2026-09-02:** the `main`-only deployment-branch rule is set. The guard step in both workflows stays as the repository-side backstop; belt and braces is correct here because the environment rule is configured outside the repository and nothing in a checkout can prove it is still set |
| `copilot` | **SET** | Copilot cloud agent and Copilot code review. `copilot-setup-steps.yml` declares it, so the OIDC subject is `repo:HybridCloudWorks/HCW-HybridCloudWorks:environment:copilot`, trusted (both forms) only by `github_copilot_review` — a Reader-only identity, so a deployment-branch rule here would gain nothing and would block Copilot's own branches |
| `data-migration` | **RETIRED** | Its only consumer, `migrate-data.yml`, was deleted in `59e471b`. The two federated credentials that still trusted it were removed on 2026-08-26 (T-524), so nothing in Azure trusts the subject either |

## 4.5 Function App settings — Terraform-managed

No operator action. Every setting on `func-site-prod-cus-01` is declared in
`infra/functionapp.tf`; changing one by hand is reverted by the next apply and is how
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
correct posture. The twenty-five names below are what the Terraform root module
in `infra/` references — the app-settings map that holds them is in
`infra/functionapp.tf`, and `functions/src/lib/secret-catalog.test.js` reads
every `.tf` file in that directory as one module rather than any one file, so a
reference is found wherever it is declared. Each name therefore has a named
consumer and a fixed spelling; presence is what is unconfirmed. [Accepted risks](../repo/todo.md#accepted-risks) records the vault as holding 18
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
| `GEMINI-API-KEY` | AI router; **Listen & Learn TTS** | Gemini TTS reads every Listen & Learn episode (owner rule 2026-09-09, ADR 0029 §2b); `LISTEN_AND_LEARN_TTS_PROVIDER = gemini` is Terraform-managed on the Function App and may name only `gemini` or `azure`. The model is the owner's Best/Economy choice on the Platform settings page, overridable per run; audio is billed against this key |
| `ELEVENLABS-API-KEY` | **Podcast TTS** | The podcast voice only — article and Plaud transcripts to RSS.com (ADR 0029 §2a, scoped by §2b); never Listen & Learn, and with no key the podcast saves a transcript-only draft rather than falling back to Gemini. **Free plan for testing from 2026-09-26** (§2a amended): 10,000 credits a month, one credit per character on Eleven v3, so one episode is nearly the month. Every render reads the account first and refuses a job the credits left cannot cover. Audio rendered on the free plan has no commercial licence and is never published to RSS.com: approval refuses it. **Create the key** at `https://elevenlabs.io/app/developers/api-keys` with *Restrict key* on and only two permissions: **Text to Speech → Access** (`text_to_speech`; ElevenLabs lists no separate Text to Dialogue permission, so this is the one expected to cover it) and **User → Read** (`user_read`, for the subscription read; without it every render fails closed and sends nothing). Everything else stays *No access*. ElevenLabs does not document which permission each endpoint checks, so the live check below is what confirms both. Set the key's **credit limit to 10,000**, the free month, so the key alone can never spend past it after an upgrade. **Seed it** at `https://hybridcloudworks.com/admin/integrations?tab=keys`. Then run the live check on the Audio tab of `https://hybridcloudworks.com/admin/platform?tab=audio`: success is both voices playing, 257 characters billed, and credits left 257 below the month. Versionless reference: a re-minted key needs an app restart to take effect |
| `ANTHROPIC-API-KEY` | AI router | First in the router's provider order |
| `OPENAI-API-KEY` | AI router | Second |
| `NVIDIA-API-KEY` | AI router, **content features only** | **MISSING** — the owner seeds it (#701). An `nvapi-` key created at `https://build.nvidia.com/settings/api-keys` for the NVIDIA API Catalog, a free trial tier at about 40 requests a minute under NVIDIA's trial terms; read those terms before seeding. Placed per feature: first for owner-triggered content (Forge drafting and grading, inspector, captions, Listen & Learn and podcast scripts), never for the anonymous public explain route, and paced at 36 requests a minute per instance (`NVIDIA_REQUESTS_PER_MINUTE` overrides). Seed it on `https://hybridcloudworks.com/admin/integrations?tab=keys` before the Terraform run that adds its reference, so `monitor-unresolved-secrets.yml` never sees it unresolved; unseeded, the router treats the reference as no key and the paid providers serve as before |
| `PERPLEXITY-API-KEY` | AI router | |
| `REPLICATE-API-KEY` | AI router | |
| `AZURE-SPEECH-KEY` | Listen & Learn fallback TTS | Inert until a Cognitive Services resource exists, which is a spend decision |
| `PLAUD-EMBEDDED-CLIENT-ID` | Recording Hub — upload transcription | Plaud Embedded Transcription API (#442), sent as `X-Client-Id`. A different credential from the Plaud MCP OAuth token pair, which lives on `mcp_servers/plaud` and never in the vault. Unseeded, the upload form answers 503 naming both settings |
| `PLAUD-EMBEDDED-API-KEY` | Recording Hub — upload transcription | Sent as `X-Client-Api-Key` beside the client id; issued in the Plaud Embedded portal (`docs.plaud.ai/plaud-embedded`) |
| `YOUTUBE-API-KEY` | Listen & Learn "watch next" links | Optional; without it episodes publish with an empty video list |
| `FIRECRAWL-API-KEY` | Content research | |
| `LINKIE-API-KEY` | Link tooling | |
| `PUBLER-API-KEY` | Social publishing | Owner-controlled; webhook changes need approval before activation |
| `PUBLER-WORKSPACE-ID` | Social publishing | |
| `RESEND-API-KEY` | Newsletter list and sending | ADR 0030. Created at `https://resend.com/api-keys` with **Full access** — a sending-access key cannot manage contacts or broadcasts, and the Integrations page's Resend test refuses it. Seed it before the Terraform run that adds its reference, so `monitor-unresolved-secrets.yml` never sees it unresolved |
| `RSSCOM-API-KEY` | Podcast publishing | Issued at `https://dashboard.rss.com/api-access/` on the Max plan (ADR 0029 §1b, #437). Unseeded, approving an episode leaves it on the manual upload path |
| `RSSCOM-PODCAST-ID` | Podcast publishing | The numeric `id` that `GET https://api.rss.com/v4/podcasts` returns for the show; an identifier, not a credential |
| `QLTY-API-TOKEN` | Health Hub Code and Security tab | #569. A personal access token from `https://qlty.sh/user/settings/tokens`, read-only use: the project's open issues and metrics. Seed it on the Integrations Keys tab before the Terraform run that adds its reference, so `monitor-unresolved-secrets.yml` never sees it unresolved. Unseeded, the tab says Qlty is not configured |
| `TELEGRAM-BOT-TOKEN` | Notifications | |
| `TELEGRAM-CHAT-ID` | Notifications | |

## 4.6b Custom role definitions — owner-created, once

Four custom roles are referenced by `infra/` and **not created by it**.
`azurerm_role_definition` needs `Microsoft.Authorization/roleDefinitions/write`,
and the HCP Terraform run identity is Contributor + Role Based Access Control
Administrator. Neither carries it: Contributor excludes
`Microsoft.Authorization/*/Write` outright, and RBAC Administrator grants
`roleAssignments/write` plus `*/read` and nothing more. The identity may assign
roles; it may not invent them, and that split is deliberate.

So Terraform reads each definition back with `data "azurerm_role_definition"`.
Until the owner has created it, the **plan** fails with "role definition not
found" — which reads like a permissions problem and is actually a missing step
here. Run these once, from an account with Owner or User Access Administrator on
the subscription:

```
az role definition create --role-definition @infra/roles/cosmos-container-writer.json
az role definition create --role-definition @infra/roles/keyvault-secret-writer.json
az role definition create --role-definition @infra/roles/function-config-refresh.json
az role definition create --role-definition @infra/roles/function-settings-reader.json
```

| Role | Grants | Consumer |
| --- | --- | --- |
| `HCW Cosmos Container Definition Writer` | Container definition read + write on the Cosmos account. No keys, no data plane, no account settings | `heal-computed-properties.yml` re-applying `cp_sortDate` |
| `HCW Key Vault Secret Writer` | `setSecret` and nothing else — no get, no list, no delete, no purge | The API Keys page, so a pasted credential cannot be read back out |
| `HCW Function Config Refresh` | `Microsoft.Web/sites/config/Write`, with `config/list/action` excluded | The API Keys page, so a seeded secret goes live in seconds rather than on App Service's 24-hour cache cycle |
| `HCW Function Settings Reader` | `Microsoft.Web/sites/config/list/action` and nothing else | `monitor-functions-registered.yml`, the one thing the `Reader` role cannot express — listing app settings is an action, not a read |

The first was created on 2026-08-21. The second and third were declared as
Terraform `resource` blocks when the API Keys page landed, which would have
failed the very apply that turns the page on. The fourth arrived with the
identity split (T-728). **The last three are all new and unapplied**, and the
Terraform plan errors with "role definition not found" until each exists —
which reads like a permissions problem and is actually this step.
`scripts/terraform-role-definitions.test.mjs` now fails CI on the `resource`
form, and on a `data` lookup naming a role no JSON here registers.

Editing a role's permissions later is `az role definition update` against the
same JSON; nothing in `infra/` moves. A **rename** is the one change that needs
both sides.

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

**Lab host inputs named by [ADR 0032](../decisions/0032-learner-labs-platform.md).**
Not observed: none of the stores below has been created, and the ADR is
Proposed. Each row is here so the name is fixed before anything consumes it,
and so a status can change in the pull request that provisions it. The
placement follows [Variables and secrets](variables-and-secrets.md): a
Terraform provider credential is a workspace variable, a value the Function
App reads is a Key Vault secret, and a credential Ansible uses once is a vault
entry that never reaches the repository.

| Name | Store | Status | Notes |
| --- | --- | --- | --- |
| `hostinger_api_token` | HCP Terraform workspace `hcw/hcw-lab`, Terraform variable, sensitive | **MISSING** | `hostinger/hostinger` provider credential. Issued in the Hostinger panel; this workspace only, never `hcw-azure` |
| `cloudflare_api_token` | HCP Terraform workspace `hcw/hcw-lab`, Terraform variable, sensitive | **MISSING** | Cloudflare provider, for the `lab` records. Same name as the §4.1 variable and a different token, with **Zone:Read + DNS:Edit** on the one zone and nothing else (the provider needs Zone:Read to resolve the zone, as `infra/variables.tf` records for the §4.1 token; the lab token omits the Transform Rules and Rulesets permissions that one carries), so it cannot touch origin rules or settings. Cloudflare scopes tokens to a zone, not a record, so this token can still edit any DNS record in `hybridcloudworks.com`; that is the accepted risk in ADR 0032, bounded by living only in HCP Terraform and by the `hcw-azure` plan check showing any production record it altered |
| Caddy `CLOUDFLARE_API_TOKEN` | Ansible Vault, written to `/etc/caddy/env` on the host (owner `root`, group `caddy`, mode `0640`; the non-root `caddy` unit reads it through `EnvironmentFile`) | **MISSING** | Runtime DNS-01 token for certificate renewals. Scoped to the dedicated lab zone that `_acme-challenge.lab.hybridcloudworks.com` is delegated to; until that zone exists it has DNS edit on the production zone, the interim ADR 0032 records. Rotate on every host rebuild |
| `cloudflare_zone_id` | HCP Terraform workspace `hcw/hcw-lab`, Terraform variable, not sensitive | **MISSING** | The `hybridcloudworks.com` zone identifier every `cloudflare_dns_record` needs (`infra/frontend.tf` uses `var.cloudflare_zone_id` for the same reason). Variables do not cross workspaces, so the same value is set here a second time. An identifier, not a credential; read it from the zone's Overview page in the Cloudflare dashboard |
| `hostinger_vps_id` | HCP Terraform workspace `hcw/hcw-lab`, Terraform variable, not sensitive | **MISSING** | The id of the VPS the owner **already has**, which `infra-lab/main.tf` adopts with an `import` block. Creating a `hostinger_vps` calls Hostinger's purchase endpoint, so this value is what keeps the first plan an import and not a second server. The `id` field of `GET /api/vps/v1/virtual-machines`, and the number in the server's hPanel URL (`infra-lab/README.md`, step 1) |
| `hostinger_plan` | HCP Terraform workspace `hcw/hcw-lab`, Terraform variable, not sensitive | **MISSING** | The `plan` field of the same response, copied exactly (for example `KVM 4`). ForceNew in the provider, so `infra-lab/main.tf` ignores changes to it and a postcondition fails the plan if it disagrees with the server rather than planning a cancel-and-purchase |
| `hostinger_data_center_id` | HCP Terraform workspace `hcw/hcw-lab`, Terraform variable, not sensitive | **MISSING** | The `data_center_id` field of the same response. Guarded the same way as `hostinger_plan` |
| `hostinger_template_id` | HCP Terraform workspace `hcw/hcw-lab`, Terraform variable, not sensitive | **MISSING** | The `template.id` field of the same response, the installed OS; `lab-host/bootstrap.sh` requires Ubuntu 26.04 LTS (and still accepts 24.04 LTS as a fallback). A change in the provider reinstalls the disk, so it is ignored and asserted like the two above; a reinstall is an hPanel decision, after which this is updated to match |
| `lab_hostname` | `infra-lab/variables.tf` default | **SET** by default (`lab.hybridcloudworks.com`) | The lab A record and the parent of the `*.lab`, `coder.lab` and `*.coder.lab` CNAMEs. No workspace entry needed |
| `ssh_public_key` | HCP Terraform workspace `hcw/hcw-lab`, Terraform variable, not sensitive | Optional, unset | The owner's SSH public key (`ssh-ed25519` or `ssh-rsa`; the provider refuses ECDSA). Set only if root has no key yet, as a second plan after the adoption (`infra-lab/README.md`, step 6): it registers the key in the Hostinger account and attaches it, which the `hardening` role then copies to `hcwadmin` |
| Arc onboarding service principal credential (`vault_arc_service_principal_id`, `vault_arc_service_principal_secret`) | Ansible Vault on the host, never in the repository; the `arc` role passes them to `azcmagent connect` in a root-only temporary `--config` file it deletes in the same run | **MISSING** | The application id and client secret of `sp-arc-onboarding-lab-hybrid-prod-cus`, which holds only *Azure Connected Machine Onboarding* on `rg-lab-hybrid-prod-cus` (`infra/lab-hybrid.tf`, granted through `arc_onboarding_principal_id` in §4.1). Used once. Once the host reads Connected, delete both keys from the vault and the secret from Entra ([Labs host runbook](../runbooks/labs-host.md), step 9); the role needs none of the four `vault_arc_*` keys on a Connected host. Re-onboarding mints a new secret |
| `vault_arc_tenant_id`, `vault_arc_subscription_id` | Ansible Vault on the host, beside the credential | **MISSING** | The Entra tenant id and the `sub-app-site-prod-cus` subscription id `azcmagent connect` targets. Identifiers, not secrets; kept in the vault because nothing else in the repository commits them, and removed with the credential |
| `arc_enabled`, `arc_agent_version`, `arc_apt_key_checksum`, `arc_resource_group`, `arc_location`, `arc_resource_name`, `arc_tags` | `lab-host/ansible/group_vars/all.yml` (not secrets) | **SET** (`arc_enabled: false`) | The `arc` role's switch, pins and target: agent `1.68.03532.1399`, Microsoft's signing key by SHA256, `rg-lab-hybrid-prod-cus` in `centralus`, machine name `arcs-lab-hybrid-prod-cus-01`. `arc_enabled` goes `true` in a pull request after the vault is seeded (runbook step 6) |
| `CODER_OAUTH2_GITHUB_ALLOWED_ORGS` | `lab-host/ansible/group_vars` (not a secret), rendered into Coder's Compose env file | **MISSING** | The GitHub organisations whose members may sign in to Coder. Required by ADR 0032 and **never empty while Coder runs**: an empty value removes the restriction and lets any GitHub account consume the VPS, so the Ansible role fails rather than render an empty list. Shutting learners out is an explicit action, not an emptied list: `CODER_OAUTH2_GITHUB_ALLOW_SIGNUPS=false` for new sign-ups, or stopping the `coder` Compose service for everyone. The owner names the organisation on #682 |
| Coder GitHub OAuth app client id and secret (`CODER_OAUTH2_GITHUB_CLIENT_ID`, `CODER_OAUTH2_GITHUB_CLIENT_SECRET`) | Ansible Vault as `vault_coder_oauth2_github_client_id` and `vault_coder_oauth2_github_client_secret`, written by the `coder` role to `/etc/hcw/coder/coder.env` on the host (root, 0600) | **MISSING** | Learner sign-in to Coder; nothing on the site reads it. Created by the owner in the GitHub organisation's OAuth apps (#682). Rotate on every host rebuild and whenever the app's callback URL changes; the env file is regenerated from Vault on each Ansible run and the `coder` container is recreated when it changes, so rotation is a Vault edit and a run |
| Coder PostgreSQL password (`POSTGRES_PASSWORD`, and inside `CODER_PG_CONNECTION_URL`) | Ansible Vault as `vault_coder_postgres_password`, written by the `coder` role to `/etc/hcw/coder/coder-postgres.env` (the database) and `/etc/hcw/coder/coder.env` (Coder), both root 0600 | **MISSING** | The `coder` database user's password on the Compose network; never reachable from outside the host. Generate with `openssl rand -hex 32`: the role refuses any character outside RFC 3986 unreserved because the value sits unescaped in the connection URL. The database stores it at first initialisation, so rotation is `ALTER USER` first and then the Vault edit and run (`lab-host/README.md`, "Rotating the PostgreSQL password") |
| `CODER-URL` | Key Vault `kv-site-prod-cus-01`; the Function App setting `CODER_URL` is a Key Vault reference to it | **MISSING** | Base URL of the Coder deployment the Function App's status proxy reads; an address, not a credential, kept in the vault so its reference follows the same path as the token beside it. Its value is known before the host exists: `https://coder.lab.hybridcloudworks.com`, so seed it as soon as the reference is applied. Vault names are hyphenated and app settings underscored, per the naming table in [Variables and secrets](variables-and-secrets.md) |
| `CODER-STATUS-TOKEN` | Key Vault `kv-site-prod-cus-01`; the Function App setting `CODER_STATUS_TOKEN` is a Key Vault reference to it | **MISSING** | Read-only Coder API token for the status proxy. Coder issues it, so it can only be seeded after Coder runs on the lab host (#661) and the owner creates it (#682). Until then it is an expected unresolved reference (`EXPECTED_UNRESOLVED` in `scripts/check-unresolved-secrets.mjs`): the monitor reports it every run but does not fail, and the labs page reads "not yet provisioned". Remove it from that list in the PR after it is seeded |
| `portainer_enabled`, `portainer_image`, `portainer_image_tag`, `portainer_image_digest` | `lab-host/ansible/group_vars/all.yml` (not secrets) | **SET** (`portainer_enabled: false`) | The `portainer` role's switch and pin: Portainer Business Edition 2.45.1 (LTS) by index digest, published on `127.0.0.1:9443` only (ADR 0032, amendment of 2026-09-26). `portainer_enabled` goes `true` in a pull request when the owner wants it |
| Portainer administrator password | The owner's password manager; Portainer keeps its own copy in the `portainer-data` volume on the host. Never in the repository or Ansible Vault | **MISSING** (created at the first sign-in) | Created by the owner in Portainer's setup screen through the SSH tunnel, with the one-time setup token Portainer prints in its log ([Labs host runbook](../runbooks/labs-host.md), "Portainer through an SSH tunnel"). At least 12 characters. A host rebuild wipes the volume, so a new one is created after every rebuild |
| Portainer Business Edition licence key | Entered in Portainer's UI and kept in its volume; the owner keeps the key as Portainer issued it. Never in the repository or Ansible Vault | **MISSING** on the host | Portainer's 3 Nodes Free licence: one server instance, up to three nodes, internal business use, renewed yearly at no cost. The key the pre-reinstall server used may be reused, since that server no longer runs it; https://www.portainer.io/take-3 issues a new one |
| `vault_enabled`, `vault_version`, `vault_checksum`, `vault_pgp_key_checksum` | `lab-host/ansible/group_vars/all.yml` (not secrets, and not Ansible Vault keys despite the prefix, which is the role's name) | **SET** (`vault_enabled: false`) | The `vault` role's switch and pins: HashiCorp Vault 2.1.1, the SHA256 of its linux amd64 archive from the signed SHA256SUMS, and the SHA256 of HashiCorp's signing key (ADR 0032, amendment of 2026-09-26). `vault_enabled` goes `true` in a pull request when the owner wants it |
| HashiCorp Vault unseal keys (five, three to unseal) and initial root token | The owner's password manager only. Never on the host, in the repository, in a log, in an issue or chat, or in Ansible Vault | **MISSING** (Vault not initialised) | Printed once by `vault operator init` over SSH ([Labs host runbook](../runbooks/labs-host.md), "HashiCorp Vault: initialising and unsealing"); Vault keeps no copy, and without three keys it stays sealed for good. Three are needed after every restart and reboot until auto-unseal (#726) exists. A host rebuild makes them useless: delete them then and initialise the new Vault. This Vault holds lab-host secrets only; production secrets stay in `kv-site-prod-cus-01` |

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

**Twenty-three, and they live in two files.** Nineteen in `infra/outputs.tf`
and four in `infra/oidc.tf`.

**This count has now been wrong three times, each in the same way**, so the
method matters more than the number. It said twenty-three when first written,
omitting `deploy_principal_id`, because it was built by reading `outputs.tf`
alone. It was corrected to twenty-four on 2026-08-25 against the apply's own
output block. It then stayed at twenty-four while `swa_token` was retired
(#296, in favour of a token minted per run) and `reader_client_id` was added
(T-728) — two changes in opposite directions that happened to leave the total
looking plausible. Found in review on 2026-09-01, alongside the
`cloudflare_plan` removal below.

**Count by reading the files, never by adjusting the previous number:**

```bash
grep -c '^output "' infra/outputs.tf infra/oidc.tf
```

It prints one line per file, not a total — which is what this section needs,
because it quotes both numbers:

```
infra/outputs.tf:19
infra/oidc.tf:4
```

The total is their sum. Said explicitly because "the command that produces the
count" implied a single number, and a command whose output does not look like
the thing it was described as producing is how a reader concludes they ran it
wrong.

From `infra/outputs.tf` (19): `api_base_url` · `app_principal_id` ·
`blob_endpoint` · `cosmos_database` · `cosmos_endpoint` ·
`cosmos_resource_group` · `function_app_name` · `function_hostname` ·
`function_url` · `functions_storage_account` · `insights_connection` ·
`storage_account` · `storage_resource_group` · `subnet_id` · `swa_hostname` ·
`vault_name` · `vault_uri` · `web_resource_group` · `workspace_id`

**`swa_token` is not among them.** It was retired in #296 (T-727): the Static
Web Apps deployment token is now read from ARM under the federated identity on
each run and lives for that run, rather than sitting in Terraform state and on
the HCP Terraform outputs page.

**`cloudflare_plan` was removed on 2026-09-01** and is not replaced. It read
`data.cloudflare_zone.current.plan`, which the Cloudflare provider deprecated in
v5 in favour of `/zones/{zone_id}/subscription` — reachable only through the
`cloudflare_zone_subscription` **resource**, which would put Terraform in charge
of the subscription and, in the provider's own words, "create/cancel associated
subscriptions". Not a trade worth making for a value nothing consumes.

The plan tier still matters — ADR 0024, the [availability probe runbook](../runbooks/availability-probe.md),
`infra/observability.tf` and `infra/variables.tf` all reason about "this
Cloudflare plan", because Bot Fight Mode, Origin Rules' Host Header override and
mTLS gate on it. Read it from the zone's Overview page in the Cloudflare
dashboard when a decision turns on it; it changes only when someone deliberately
changes it.

From `infra/oidc.tf` (4): `client_id` · `reader_client_id` ·
`deploy_principal_id` · `federated_subjects`

`reader_client_id` arrived with T-728, which split the read-only identity out
of the deploy identity — `monitor-functions-registered.yml`,
`monitor-unresolved-secrets.yml` and `verify-alert-state.yml` all authenticate
with it.

The four scratch outputs that fed §4.2's three now-deleted variables are gone
from `infra/outputs.tf`.
