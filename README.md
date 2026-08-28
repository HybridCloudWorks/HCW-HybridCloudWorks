# HybridCloudWorks Website

HybridCloudWorks is a cloud engineering website and operations portal covering
Azure, AWS, Google Cloud, GitHub, Terraform, FinOps, VMware, and Ansible. It
publishes technical articles, architecture guidance, frameworks, certification
content, provider tools, RSS/news views, speaking events, and submission forms.

The repository is the current website, Azure backend, infrastructure, and
delivery source of truth. The earlier Firebase-to-Azure migration is complete
and retained only in the archived plans and historical Wiki pages.

## Features

- Provider landing pages with blog/news, architecture, frameworks, education,
  code, tools, and audio content where available.
- Pre-rendered public pages for search-friendly delivery, with client-side
  hydration for interactive views.
- Entra ID/MSAL-protected administration with role-aware content workflows,
  publishing, calendars, image management, AI Engine configuration, MCP server
  configuration, social integrations, operations health, and Labs controls.
- Azure Functions APIs for public reads, CMS actions, background jobs, media,
  integrations, and the pull-based VPS Labs agent.
- Accessibility, route, provider-content, API-contract, and deployment smoke
  checks in the repository and CI.

## Platform breakdown

| Area | Implementation |
| --- | --- |
| Public web | React 19, Vite, TypeScript/JavaScript, Tailwind CSS, React Router |
| Rendering and hosting | Vite build plus route pre-rendering on Azure Static Web Apps |
| Authentication | Microsoft Entra ID with `@azure/msal-browser`; API tokens are validated by Azure Functions |
| API and jobs | Azure Functions Flex Consumption, managed identity, Storage Queue, and change-feed/timer handlers |
| Data | Azure Cosmos DB with Entra data-plane access |
| Media and secrets | Azure Blob Storage and Azure Key Vault |
| Edge and telemetry | Cloudflare DNS/proxy and Azure Application Insights/Log Analytics |
| Delivery | GitHub-hosted Actions runners for CI and approved manual releases |

## Repository layout

| Path | Purpose |
| --- | --- |
| `frontend/` | Public React website and Entra-protected admin portal |
| `functions/` | Azure Functions API, workers, timers, triggers, and tests |
| `vps-agent/` | API-authenticated pull-based Labs job executor |
| `infra/` | Terraform root module for Azure and Cloudflare resources |
| `scripts/` | Container-spec generation, content-manifest tooling, smoke checks, and operator utilities |
| `.github/workflows/` | CI, validation, Wiki sync, scheduled maintenance, and manual release workflows |
| `wiki/` | Wiki-as-code source for reviewed runbooks and engineering records |
| `Architecture_Plan.md` | Archived architecture planning record |
| `Migration_Plan.md` | Archived migration planning record |
| `TODO.md` | Current engineering work that does not require owner-only access |
| `REVIEW.md` | Human-only decisions, approvals, credentials, and external access |
| `CHANGELOG.md` | Verified completed work |

## Local development

Requirements: Node.js 22+, npm 10+, Git, and the relevant Azure Functions or
Terraform CLI when working on those components.

```powershell
cd frontend
npm ci
npm run dev
```

Useful checks:

```powershell
cd frontend
npm run lint
npm run format:check
npm run build
npm run test

cd ..\functions
npm ci
npm test

cd ..\scripts
npm ci
npm run lint
npm test
```

The frontend needs `VITE_AZURE_FUNCTIONS_URL`, `VITE_ENTRA_CLIENT_ID`,
`VITE_ENTRA_TENANT_ID`, and `VITE_ENTRA_API_SCOPE` for a fully connected local
session. Copy `frontend/.env.example` to a local `.env`; never place secrets,
Cosmos keys, or integration credentials in Vite variables.

## Delivery and documentation

Every pull request runs the frontend, Functions, operational-script, and VPS
agent checks, plus repository, dependency, CodeQL, and infrastructure policy
validation as applicable. Azure releases are explicit GitHub Actions dispatches
and infrastructure changes are reviewed through HCP Terraform. All repository
workflows use GitHub-hosted runners.

The [Engineering Wiki](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki)
contains runbooks, ADRs, naming, cost, and operational guidance. The reviewed
Wiki source is under [`wiki/`](wiki/). Read [CONTRIBUTING](.github/CONTRIBUTING.md)
before changing repository structure, deployment, or documentation.

Current work and human-only dependencies are intentionally separated:

- [TODO.md](TODO.md) — engineer-resolvable pending work.
- [REVIEW.md](REVIEW.md) — owner decisions, approvals, access, and credentials.
- [CHANGELOG.md](CHANGELOG.md) — verified completed work.
