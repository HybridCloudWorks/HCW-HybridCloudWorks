# HybridCloudWorks Engineering

The reviewed engineering record for the HybridCloudWorks website: architecture
decisions, Azure operations, deployment procedures, security controls, and
historical implementation notes. The source is the `docs/` folder of the
repository, reviewed through pull requests and published here on every merge.

The current product is an Azure-hosted website. The root [README](repo/readme.md)
is the entry point for product features and local development. [TODO.md](repo/todo.md)
and [CHANGELOG.md](repo/changelog.md) remain the repository's concise execution and
release records; this site holds the longer narrative.

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

- [Architecture decision records](decisions/index.md)
- [Architecture review 2026-08](architecture/architecture-review-2026-08.md) — the six-layer
  review of record: 62 findings with evidence, failure mode and
  recommendation, plus the areas that came back sound
- [Deployment runbook](runbooks/deployment-runbook.md)
- [Admin sign-in rollback](runbooks/admin-signin-rollback.md) — what to do when
  nobody can sign in to `/admin`, and how to tell a configuration problem from
  the other things that look like one
- [Alerting and support](runbooks/alerting-and-support.md)
- [Copilot code review MCP servers](runbooks/copilot-code-review-mcp.md)
- [IaC repository standard](standards/iac-repository-standard.md)
- [Naming convention](standards/naming-convention.md)
- [Variables and secrets](standards/variables-and-secrets.md)
- [Resource validation report](architecture/resource-validation-report.md)
- [Cost analysis](architecture/cost-analysis.md)

## Start here if you are not the owner

Most of this site is an operating record for one estate. Four pages are written
for a reader who has never seen it, use generic resource names throughout, and
are the best place to start:

- [A production Azure platform for $150 a month](content/blog-how-to-01-infrastructure.md)
  — every resource, why it was chosen over the alternative, and the order to
  deploy it in
- [Deploying an app with no credentials anywhere](content/blog-how-to-02-application.md)
  — locking an API origin to a CDN, and GitHub Actions by OIDC
- [The region that took three tries](content/blog-build-log-01-infrastructure.md)
  and [I locked the door and left the keys inside](content/blog-build-log-02-application.md)
  — what actually went wrong building the two above
- [Naming convention](standards/naming-convention.md) — a complete CAF scheme
  for an Azure Landing Zone, including the constraints that override it

The [runbooks](runbooks/deployment-runbook.md) name this estate's real
resources, because an operator cannot use them otherwise. They are published
for the same reason everything else here is — the reasoning is the point — but
the procedures are specific to one tenant, not a template.

## Historical records

The migration and cutover pages are retained as historical evidence for how the
current Azure platform was built. They are not active runbooks for starting a
new migration. Current code, the root SOP documents, and the deployment runbook
take precedence when they differ.
