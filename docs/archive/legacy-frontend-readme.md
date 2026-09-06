# Hybrid Cloud Works (HCW)

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


Production React + Firebase platform for cloud architecture education, ContentForge operations,
and live labs.

Last updated: June 12, 2026 (v1.5.0 "Platform 2.0")

## Current State

Hybrid Cloud Works is in active production use with three primary surfaces:

- Public knowledge platform across eight provider domains: AWS, Azure, GCP, VMware, Terraform,
  Ansible, GitHub, and FinOps
- ContentForge admin portal for curation, publishing, AI-assisted workflows, and operations
- Interactive labs backend on a Hostinger VPS with a pull-based job runner

Current implementation includes:

- React 19 + Vite 8 frontend with lazy-loaded route surfaces and provider dispatchers
- Firebase Hosting + Firestore + Storage + Cloud Functions on Node.js 22
- Hyoga-style dark-luxe UI with provider color themes preserved
- Admin verification gates (`verify:required`) and optional security/release checks
- AI-enabled content operations for classification, extraction, cover generation, and readiness
  checks
- Living documentation under `documentation/` plus root trackers for active work

## Core Capabilities

### Public Platform

- Multi-provider educational content by domain and content type
- Shared article/news/routing patterns via provider dispatchers and shared landing templates
- Public Coder Corner pages per provider (`/:provider/coder-corner`)
- Tools section for migration, comparison, resources, and decision support
- Firestore-driven content rendering with markdown/module-aware templates
- Newsletter signup (Klaviyo) in the footer and on blog posts
- Labs-ready public pages and roadmap hooks for future interactive experiences

### ContentForge Admin Portal

- Protected admin route surface under `/admin/*`
- Queue review, editor, publishing, live pages, and calendar workflows with a persistent pipeline
  stepper, pre-publish validation checklist, and calendar time/timezone scheduling
- Connections page for Publer, Plaud, Sessionize, Credly, YouTube, Linkie, and Klaviyo
- Image prompts/gallery, social hub with auto-post-to-social at publish, recordings, AI engine,
  and ops health pages
- Audit-focused helper tooling, verification helpers, and smoke scripts for production validation
- Labs dashboard and publishing utilities for content operations

### AI and Automation

- Function-level AI readiness checks
- Scraping fallback paths with benchmark tooling
- Cover-generation and enrichment pipeline helpers
- Optional post-deploy smoke and token-assisted hardened admin checks
- Cost and safety guardrails for content and admin workflows

## Tech Stack

- Frontend: React 19, Vite 8, React Router 7, Tailwind CSS 4, Radix UI
- Backend: Firebase Cloud Functions (Node.js 22)
- Data: Cloud Firestore + Firebase Storage
- Auth: Firebase Authentication
- Testing: Vitest, Playwright, Firestore Rules Emulator tests
- Quality: ESLint, Prettier, commitlint, husky, lint-staged
- CI/CD: GitHub Actions workflows for quality, security, deploy, and secrets

## Repository Layout

```text
.
├── src/                    # Frontend app (routes, pages, UI, hooks, lib)
├── functions/              # Firebase Cloud Functions codebase
├── scripts/                # Verification, smoke, data, and ops scripts
├── documentation/          # Living documentation, runbooks, and reports
├── labs/                   # Hostinger VPS labs runner agent (vps-agent/)
├── platform/               # Firebase rules/indexes and platform assets
├── infrastructure/         # Infra assets and supporting configuration
├── e2e/                    # Playwright end-to-end tests
├── reports/                # Generated analysis/audit outputs
├── public/                 # Static assets
├── TODO.md                 # Active work tracker
└── CHANGELOG.md            # Completed work log
```

## Prerequisites

- Node.js 22+
- npm 10+
- Firebase CLI (`npm install -g firebase-tools`)

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create local env file:

```bash
cp .env.example .env
```

On PowerShell, use:

```powershell
Copy-Item .env.example .env
```

3. Update required values in `.env`:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_OWNER_ADMIN_EMAIL`
- `VITE_OWNER_ADMIN_UID`

Optional but commonly used:

- `VITE_GCP_FUNCTIONS_URL`
- Social URL vars (`VITE_SOCIAL_*`)

Note: `VITE_PUBLER_*` variables were removed in v1.5.0. Publer calls go through the
`publerProxy` Cloud Function; never add `VITE_`-prefixed secrets.

4. Start local dev server:

```bash
npm run dev
```

## Build, Test, and Verification

### Build and Preview

```bash
npm run build
npm run preview
```

### Quality Gates

```bash
npm run lint
npm run format:check
npm run code:quality
```

### Required Local Verification

```bash
npm run verify:required
```

This runs:

- `npm run build`
- `npm run test:admin`

### Optional Verification Suites

```bash
npm run verify:optional:security   # Firestore rules emulator suite
npm run verify:optional:release    # Playwright E2E suite
npm run smoke:firebase:postdeploy  # URL/function post-deploy smoke
```

## Deployment

### Hosting

```bash
npm run build
firebase deploy --only hosting
```

### Functions

```bash
firebase deploy --only functions
```

### Selected CI/CD Workflows

- `.github/workflows/check-quality.yml`
- `.github/workflows/check-lighthouse.yml`
- `.github/workflows/check-e2e.yml`
- `.github/workflows/deploy-frontend.yml`
- `.github/workflows/deploy-functions.yml`
- `.github/workflows/scan-security.yml`
- `.github/workflows/secret-sync.yml`
- `.github/workflows/secret-rotate.yml`

## Functions Workspace Notes

The `functions/` directory has its own package context and readiness tooling.

Useful commands:

```bash
cd functions
npm run readiness:local
npm run readiness:remote
npm run scrape:benchmark
```

## Documentation

Start with the documentation index:

- `documentation/README.md`

Common entry points:

- `documentation/project-status-current.md`
- `documentation/admin-portal-guide.md`
- `documentation/admin-operations-runbook.md`
- `documentation/admin-verification-workflows.md`
- `documentation/frontend-firebase-architecture.md`
- `documentation/pipeline-cicd-workflows.md`
- `documentation/security-secrets-guide.md`
- `documentation/labs-platform-guide.md`

Additional useful references:

- `documentation/architecture-system-overview.md`
- `documentation/database-model-roadmap.md`
- `documentation/process-handover-guide.md`
- `documentation/testing-quality-guide.md`

## Active Roadmap Signals

Open root TODO items currently emphasize:

- Security validation follow-up for deploy environment wiring
- Firestore model convergence and `blogs` deprecation planning
- Scraping fallback benchmark and rollout gate definition
- Admin portal UX surfacing for roadmap readiness
- Remaining platform roadmap items tracked in `TODO2.0.md`

See:

- `TODO.md`
- `TODO2.0.md`

## Contributing

- Use Conventional Commits (commitlint is enforced)
- Run `npm run verify:required` before opening a PR
- Follow documentation standards in `documentation/process-documentation-standards.md`

## Project Links

- Website: https://hybridcloudworks.com
- Repository: https://github.com/saulpatinojr/Personal-Site_HCW
- Firebase Project: https://console.firebase.google.com/project/hybridcloudworks-61e8d

## License

Proprietary and confidential.
