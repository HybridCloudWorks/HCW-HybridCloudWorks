# Required inputs

Every variable, secret and setting the workload needs, with live status.

> **Moved here from `TODO.md` on 2026-08-29**, when that file was retired and
> its open work folded into [TODO.md](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/TODO.md).
> TODO.md's own header explained why this inventory sat there rather than in
> the Wiki (now this docs site): the two procedures that write to it — a contributor recording a new
> required input ([CONTRIBUTING](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/.github/CONTRIBUTING.md)),
> an operator moving an entry from `SET` to `VERIFIED` after an apply
> ([Deployment-Runbook](../runbooks/deployment-runbook.md)) — are gated on owner-level access.
>
> That argument stopped holding once TODO.md went away, and it was always
> weaker than it looked: `docs/` (then `wiki/`) is reviewed through pull requests exactly as the
> repository root is, so nothing about the write path changes by moving here.
> What does change is that a 228-line reference inventory is no longer sitting
> inside a document people opened to find out what to do next.
>
> **Section numbers are unchanged** (§4.1 … §4.10), because roughly sixteen code
> comments cite them by number. A citation reading `Required-Inputs §4.5` now reads
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
| `availability_test_enabled` | `false` | Standard web test and its alert. Stays `false`: Bot Fight Mode still 403s Azure's availability agents, and the reachability signal is served by the ADR 0024 Worker probe instead |
| `availability_probe_alert_enabled` | `false` in code, **set `true` in the workspace 2026-09-01 (T-519 closed)** | Arms `edge_probe_availability` (`alert-api-reachability-prod-cus`) on the Worker probe's `availabilityResults` rows. Armed only after a full 30-minute window held 6 healthy rows |
| `functions_scm_lock_enabled` | `false` in code, **set `true` in the workspace 2026-08-25** | Denies SCM/Kudu by default; `deploy-functions.yml` opens a per-run window. Proven under `Deny` by run 32902534458 |
| `functions_origin_lock_enabled` | `true` | Restricts the origin to Cloudflare ranges. Already on |
| `purge_protection_enabled` | `false` | Key Vault purge protection. Off as an accepted risk — see [Accepted risks](../repo/todo.md#accepted-risks) |
| `cloudflare_origin_secret` | — (sensitive) | Must match Key Vault `CF-ORIGIN-SECRET` exactly; a mismatch throws on every anonymous request |

## 4.2 GitHub repository variables

Enumerated live 2026-08-25. Twenty were present then, and twenty was the whole
list — the three scratch variables that used to sit here were deleted the same
day (T-525). `READER_CLIENT_ID` was added to the table on 2026-08-29 (T-728) and
is **not yet set**, so a reader comparing this against `gh variable list` should
find exactly that one difference until the split is applied. Seeded from
Terraform outputs by `scripts/set-github-variables.ps1` — never written by hand.

| Name | Status | Consumer |
| --- | --- | --- |
| `CLIENT_ID` | **VERIFIED** | OIDC login for the workflows that WRITE — `deploy-functions.yml` and `heal-computed-properties.yml`. Also arms the healer, which skips while it is unset |
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

**No stored, non-expiring credential remains in this repository's secrets.**
`GITHUB_TOKEN` is contractual and injected per run; it is never stored.

## 4.4 GitHub environments

Enumerated live 2026-08-25.

| Name | Status | Notes |
| --- | --- | --- |
| `production` | **CONFIRMED — no reviewers, by decision** (owner, 2026-08-29) | Both deploy workflows bind to it, so it records who deployed. **Required reviewers are deliberately NOT configured: this is a single-operator estate, and a required reviewer you approve yourself is not a control — it is a click that produces an audit trail implying oversight that did not happen.** What still matters here is the other half. GitHub auto-creates a missing environment with no protection rules, and the federated credential's subject is environment-scoped (`repo:HybridCloudWorks/HCW-HybridCloudWorks:environment:production`, declared in `infra/oidc.tf`), so it matches from any branch — an unprotected environment leaves `workflow_dispatch` able to ship an unreviewed ref past all 12 required contexts (T-705). A `main`-only **deployment-branch rule** closes that, costs a solo operator nothing, and is not self-approval theatre. ~~**Owner action, reduced to one thing:** Settings → Environments → `production` → Deployment branches → *Selected branches* → `main`.~~ **Done 2026-09-02:** the `main`-only deployment-branch rule is set. The guard step in both workflows stays as the repository-side backstop; belt and braces is correct here because the environment rule is configured outside the repository and nothing in a checkout can prove it is still set |
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
unconfirmed. [Accepted risks](../repo/todo.md#accepted-risks) records the vault as holding 18
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
