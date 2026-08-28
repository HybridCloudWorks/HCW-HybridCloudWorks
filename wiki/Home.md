# HybridCloudWorks Engineering Wiki

This Wiki contains the reviewed engineering record for the HybridCloudWorks
website: architecture decisions, Azure operations, deployment procedures,
security controls, and historical implementation notes.

The current product is an Azure-hosted website. The root [README](../README.md)
is the entry point for product features and local development. `TODO.md`,
`REVIEW.md`, and `CHANGELOG.md` remain the repository's concise execution and
release records; this Wiki holds the longer narrative.

## Current platform

- Azure Static Web Apps hosts the pre-rendered React/Vite frontend.
- Azure Functions provides the API and background jobs.
- Microsoft Entra ID and MSAL protect administration routes.
- Azure Cosmos DB stores content and operational data.
- Azure Blob Storage stores managed media.
- Azure Key Vault, managed identities, Cloudflare, and Application Insights
  provide secrets, identity, edge routing, and observability.
- GitHub-hosted runners perform CI and approved manual releases.

## Engineering references

- [Architecture decision records](Architecture-Decision-Records)
- [Architecture review 2026-08](Architecture-Review-2026-08) — the six-layer
  review of record: 62 findings with evidence, failure mode and
  recommendation, plus the areas that came back sound
- [Deployment runbook](Deployment-Runbook)
- [Alerting and support](Alerting-And-Support)
- [IaC repository standard](IaC-Repository-Standard)
- [Naming convention](Naming-Convention)
- [Variables and secrets](Variables-And-Secrets)
- [Resource validation report](Resource-Validation-Report)
- [Cost analysis](Cost-Analysis)

## Historical records

The migration and cutover pages are retained as historical evidence for how the
current Azure platform was built. They are not active runbooks for starting a
new migration. Current code, the root SOP documents, and the deployment runbook
take precedence when they differ.
