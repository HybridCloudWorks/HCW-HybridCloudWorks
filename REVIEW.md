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
| Dormant migration-era Azure resources | Confirm retention requirements, backup/evidence retention, and approve removal of the legacy declarations in `infra/scratch.tf`, `infra/oidc.tf`, and `migration_writer_enabled` | The retired migration workflow is removed; Terraform cleanup is intentionally not automatic because these declarations may correspond to state-backed identities or resources |
| Key Vault | Provide only the secrets needed by enabled features through the approved vault procedure; never put values in GitHub variables or Vite config | Code reads secrets server-side and degrades optional integrations when absent |
| GCP pricing integration | If live GCP pricing is still required, provide a valid service-account JSON through Key Vault and approve its scope; otherwise approve retiring that optional feature | No GCP credential is stored in the repository |
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
- Confirm whether the migration-era scratch estate and its federated identity
  credentials still exist before removing `infra/scratch.tf` and `infra/oidc.tf`.
- Confirm any third-party webhook or scheduled integration after its owner has
  approved a real external mutation test.
- Apply the Terraform change that creates the `listenandlearn` blob container.
  Until it runs, Listen & Learn generation saves episodes and their transcripts
  but the audio upload has nowhere to land. The same apply declares the fallback
  `AZURE_SPEECH_*` settings, which stay unresolved and inert.

## Handling rules

- Never paste secret values, private keys, access tokens, or personal data into
  this file, issues, logs, or the Wiki.
- A missing credential is not an engineering task. Record its name, owner, and
  approved storage location only.
- Historical migration pages and the two archived plans are evidence, not
  current instructions for restoring Firebase services.
