# Documentation Index

Central documentation hub for Hybrid Cloud Works. All filenames follow the convention
`<domain>-<topic>[-<detail>].md`, lowercase kebab-case.

The docs here are the current living references for the active site, admin tooling, Firebase
architecture, security, testing, and platform roadmap. Older or superseded material is archived
under `../archive/docs/` *(historical target unavailable)*.

## Getting Started

- [Project Status (Current)](../archive/project-status-current.md) - latest project status.
- [Admin Portal Guide](../archive/admin-portal-guide.md) - admin CMS guide.
- [Admin Portal Upgrade](../archive/admin-portal-upgrade.md) - May 2026 sidebar/AI Engine/Plaud/Publer upgrade
  notes.
- [Admin API Patterns](../archive/admin-api-patterns.md) - API decision matrix for admin mutations.
- [Admin Operations Runbook](../archive/admin-operations-runbook.md) - production gates, deploy and smoke
  steps.
- [Admin Verification Workflows](../archive/admin-verification-workflows.md) - verification tiers for admin
  changes.

## Frontend & Design

- [Frontend Firebase Architecture](../archive/frontend-firebase-architecture.md) - React + Firebase overview.
- [Frontend Pages Guide](../archive/frontend-pages-guide.md) - provider page matrix + Firestore-driven
  architecture.
- [Frontend Component Library](../archive/frontend-component-library.md) - animation, accessibility, and
  performance components.
- [Frontend Theming Guide](../archive/frontend-theming-guide.md) - light/dark contract, contrast, CSS vars.
- [Frontend Routing Guide](../archive/frontend-routing-guide.md) - routing factory + standalone tools.
- [Frontend UI/UX Reference](../archive/frontend-uiux-reference.md) - UI/UX patterns by provider.
- [Frontend News System](../archive/frontend-news-system.md) - RSS curation, scoring algorithm, live timeline.
- [Design Typography System](../archive/design-typography-system.md) - fonts and provider brands.
- [Design Visual Validation](../archive/design-visual-validation.md) - pre-deployment visual QA checklist.
- [Mobile First Guide](../archive/mobile-first-guide.md) - responsive redesign guide.
- [Performance Optimization](../archive/performance-frontend-optimization.md) - frontend optimization notes.

## Architecture & Backend

- [System Overview](../archive/architecture-system-overview.md) - system diagram + component hierarchy.
- [Folder Structure](../archive/architecture-folder-structure.md) - top-level folder + root-file reference map.
- [Infrastructure Complete](../archive/architecture-infrastructure-complete.md) - frontend + serverless
  blueprint.
- [API Mapping](../archive/architecture-api-mapping.md) - active API integration journal.
- [AI Abstraction](../archive/architecture-ai-abstraction.md) - provider-agnostic AI router.
- [Agents Architecture](../archive/agents-architecture-reference.md) - agents reference.
- [Labs Platform Guide](../archive/labs-platform-guide.md) - Hostinger VPS labs backend and pull-based runner.

## Database & Storage

- [Firestore Collections](../archive/database-firestore-collections.md) - schema reference + Rowy/BuildShip UI
  config.
- [Firestore Population](../archive/database-firestore-population.md) - initial data seeding.
- [Model Roadmap](../archive/database-model-roadmap.md) - P3 roadmap to converge `content`.
- [Rollback Checklist](../archive/database-rollback-checklist.md) - fast rollback sequence and schema-lock
  contract.

## AI & Automation

- [AI Stack Report](../archive/ai-stack-report.md) - cost-first AI stack baseline.
- [AI Integration Inventory](../archive/ai-integration-inventory.md) - reference catalog of all AI call sites.
- [AI Recommendations](../archive/ai-recommendations.md) - Stage 6 recommendations.
- [Firebase & GCP Cost Inventory](../archive/firebase-gcp-cost-inventory.md) - Firebase cost audit.
- [ContentForge Capability](../archive/contentforge-capability-complete.md) - capability assessment.
- [Streamlined Content Creator](../archive/pipeline-streamlined-contentcreator.md) - Gemini 2.0 + Imagen-4
  article pipeline.
- [Curated Article Fallback Strategy](../archive/curated-article-fallback-strategy.md) - og:image-first cover
  strategy.
- [Scraping Upgrade](../archive/pipeline-scraping-upgrade.md) - scraping fallback envelope, telemetry, optional
  headless.
- [Stage 1 Features](../archive/pipeline-stage1-features.md) - publishedDate extraction, cloudProvider
  override, skipImageGeneration.

## Security & Secrets

- [Security Secrets Guide](../archive/security-secrets-guide.md) - 3-tier secrets architecture.
- [Security Backend Audit](../archive/security-backend-audit.md) - backend PII security audit.
- [Security Pipeline Audit](../archive/security-pipeline-audit.md) - pipeline PII security audit.
- [Security Firebase Auth Guide](../archive/security-firebase-auth-guide.md) - Firebase Auth + custom domain
  setup.
- [Terraform Notion Secrets Audit](../archive/terraform-notion-secrets-audit.md) - Terraform vs Notion audit.
- [Notion SOPS](../archive/notion-sops.md) - Notion-to-SOPS sync tool.

## Pipelines & DevOps

- [CI/CD Workflows](../archive/pipeline-cicd-workflows.md) - workflows reference.
- [Deployment Guide](../archive/pipeline-deployment-guide.md) - two-tier strategy + GitOps.
- [Handover Guide](../archive/process-handover-guide.md) - handover steps and Firebase deployment steps.
- [AI Deployment](../archive/pipeline-ai-deployment.md) - AI deployment runbook.
- [Dependencies Manifest](../archive/pipeline-deps-manifest.md) - dependency audit.
- [Dependency Notes](../archive/dependency-notes.md) - npm overrides, CVE rationale, vulnerabilities.
- [Terraform Cloud Setup](../archive/terraform-cloud-setup.md) - Terraform Cloud workspace config.

## Testing & Quality

- [Quality Guide](../archive/testing-quality-guide.md) - ContentForge + frontend testing.
- [Accessibility Compliance Audit](../archive/accessibility-compliance-audit.md) - WCAG 2.1 AA audit.
- [Verification Content Creator](../archive/testing-verification-content-creator.md) - editor/blog/architecture
  verification.
- [Lighthouse Guide](../archive/run-lighthouse-locally.md) - local Lighthouse audit setup.

## Planning & Process

- [Content Architecture](../archive/planning-content-architecture.md) - client-side data fetching architecture.
- [Ownership Matrix](../archive/planning-ownership-matrix.md) - P0-P3 ownership map.
- [Personas Reference](../archive/planning-personas-reference.md) - AI persona definitions.
- [Commit Standards](../archive/process-commit-standards.md) - Conventional Commits via commitlint.
- [Documentation Standards](../archive/process-documentation-standards.md) - KCS v6 standards.
- [Issues Tracking](../archive/process-issues-tracking.md) - issue template collection.
- [Issue Templates](../archive/issue-templates.md) - combined issue templates reference.
- [Repo Cleanup](../archive/process-repo-cleanup.md) - cleanup policy + protected docs.

## Integrations

- [External Data Sources](../archive/integration-external-datasources.md) - Sessionize, Nominatim.
- [BuildShip Firestore](../archive/integration-buildship-firestore.md) - Buildship low-code setup.
- [Vendor News Feeds](../archive/integration-vendor-news-feeds.md) - RSS + Firecrawl + AI enrichment.
- [Speaking Events Workflow](../archive/buildship-speaking-events-workflow.md) - BuildShip event-image workflow.
- [Stitch Integration](../archive/frontend-stitch-integration.md) - design-to-code mapping.
- [Bulk Processing](../archive/bulk-processing-workflow.md) - cost-optimized bulk URL processing.
- [Notion MCP Setup](../archive/notion-mcp-setup.md) - Notion MCP server setup.

## Live Smoke Tests

- [`live-smoke-tests/`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/tree/main/frontend/documentation/live-smoke-tests) - `SMOKE-TEST.md` + `SMOKE-TEST-SIGNOFF.md`.

## Reports

- `reports/` *(historical target unavailable)* - generated reports.

## Archive

Files no longer current are moved to `../archive/docs/` *(historical target unavailable)*. See
[`CHANGELOG.md`](../archive/legacy-frontend-changelog.md) for the full list and rationale.

---

_Last updated: June 12, 2026. Naming convention: lowercase kebab-case
`<domain>-<topic>[-<detail>].md`._
