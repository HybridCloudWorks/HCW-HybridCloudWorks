# REVIEW

This file contains only work that cannot be completed by an engineer working
from the repository alone: directory administration, owner decisions,
production approvals, credentials, external access, and live-environment
confirmation. Code changes and testable implementation work belong in
[TODO.md](TODO.md). Verified completion belongs in [CHANGELOG.md](CHANGELOG.md).

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
