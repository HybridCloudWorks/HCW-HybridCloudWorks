# HCW HybridCloudWorks

HybridCloudWorks is migrating from Firebase/GCP to a cost-conscious Azure platform. This repository
is the application, infrastructure, migration, and delivery source of truth. The approved architecture
is a baseline for implementation; it does not authorize an Azure deployment, DNS cutover, external
mutation, GCP decommission, or archival of the old repository.

## Current status

- Architecture plan: approved
- Environment model: one production workload state
- Monthly design ceiling: USD 150
- Administrator identity: Microsoft Entra ID
- Infrastructure implementation: not started from the approved plan
- Production deployment: not authorized
- Dependency audit: across seven npm package boundaries, 10 of 12 findings remediated; zero moderate
  findings remain. The two residual highs are the react-router RSC-mode advisory
  (GHSA-qwww-vcr4-c8h2), assessed as not applicable to this Vite SPA and with no fixed version above
  the current one
- Dependency automation: root Dependabot coverage for all npm packages and GitHub Actions
- Repository history: re-rooted after credential rotation; replace clones made before 2026-07-22

## Engineering Wiki

All human-facing documentation is maintained in the
[GitHub Wiki](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki).

- [Implementation TODO](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki/Implementation-TODO)
- [Approved architecture](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki/Architecture)
- [Architecture decisions](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki/Architecture-Decision-Records)
- [Well-Architected assessment](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki/Well-Architected-Assessment)
- [Migration runbook](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki/Migration-Runbook)
- [Phase 4 data migration](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki/Phase-4-Data-Migration)
- [Cost analysis](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki/Cost-Analysis)

The root README must be updated whenever repository structure, documentation authority, architecture
status, or delivery status changes. Markdown consumed by GitHub or development tooling may remain next
to that tooling; general documentation belongs only in the Wiki.

## Repository layout

| Path | Purpose | Current posture |
| --- | --- | --- |
| `.azure/` | Machine-readable architecture plan and discovery output | Approved plan; not deployment code |
| `.github/` | Repository-level GitHub Actions workflows | Prototype delivery jobs are disabled pending baseline hardening |
| `frontend/` | Imported React application and source-system compatibility code | Requires reconciliation with the old repository |
| `functions/` | Azure Functions application scaffold | Prototype; must be aligned to approved boundaries |
| `infra/` | Terraform Azure infrastructure | Prototype; do not apply as the approved architecture |
| `scripts/` | Data and media migration tooling | Firestore data migration prepared against Site-Main and not yet executed; read-only preflight, dry-run and reconciliation implemented. Media migration still incomplete |
| `vps-agent/` | Azure-oriented labs agent scaffold | Incomplete; source agent contract still requires migration |

Temporary duplicate implementation paths under `frontend/` are retained until Phase 1 reconciliation
proves which source is authoritative. Their presence is tracked in the Wiki TODO and is not an
endorsement of the final layout.

## Delivery guardrails

- Use GitHub OIDC and managed identities; do not commit static cloud credentials.
- Use reviewed, version-pinned Azure Verified Modules for the approved Terraform implementation.
- Keep Terraform state, saved plans, local settings, generated output, and secrets out of Git.
- Require explicit approval for production applies, destructive changes, DNS cutover, credential
  revocation, Firebase/GCP decommissioning, and repository archival.
