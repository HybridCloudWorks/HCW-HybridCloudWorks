# Repository Folder Structure

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


Reference map of every top-level folder and root file in the Hybrid Cloud Works repository. Use this
as the canonical answer to "where does X live?". Last reviewed: May 27, 2026.

## Top-level layout

```
.
├── src/              # React + Vite application source
├── public/           # Static assets served verbatim by Vite/Firebase Hosting
├── index.html        # Vite entry HTML
├── functions/        # Firebase Cloud Functions (Gen2, Node 22) source + build
├── platform/         # Cross-cutting platform IaC (Terraform / Ansible / Firebase)
├── infrastructure/   # Sensitive infra material (gitignored secrets folder)
├── scripts/          # Operational, smoke, and maintenance Node/PowerShell scripts
├── e2e/              # Playwright end-to-end specs and fixtures
├── documentation/    # Living documentation hub (see documentation/README.md)
├── reports/          # Local-only generated reports (gitignored)
├── dist/             # Vite production build output (gitignored)
└── node_modules/     # Installed npm packages (gitignored)
```

Hidden/dotfile directories:

```
.github/         # GitHub Actions workflows, issue templates, CODEOWNERS
.husky/          # Git hooks (commitlint, lint-staged, pre-commit)
.vscode/         # Shared editor settings and recommended extensions
.devcontainer/   # Codespaces / VS Code dev container definition
.firebase/       # Firebase CLI deploy cache (gitignored)
.claude/         # Local Claude/agent settings (gitignored)
.copilot/        # Copilot configuration
.git/            # Git metadata
```

## Folder responsibilities

### `src/` — frontend application

React 19 + Vite 8 + Tailwind 4 SPA. Subfolders:

| Folder        | Purpose                                                  |
| ------------- | -------------------------------------------------------- |
| `assets/`     | Images, fonts, static bundled media                      |
| `components/` | Reusable UI components                                   |
| `config/`     | App configuration, feature flags, Firebase client config |
| `context/`    | React context providers (theme, auth, etc.)              |
| `data/`       | Static data fixtures + curated datasets                  |
| `features/`   | Feature-scoped modules (admin, news, blogs, etc.)        |
| `hooks/`      | Custom React hooks                                       |
| `lib/`        | Framework-agnostic helpers and Firebase client wrappers  |
| `pages/`      | Route page components                                    |

See [Frontend Firebase Architecture](../archive/frontend-firebase-architecture.md) and
[Frontend Pages Guide](../archive/frontend-pages-guide.md) for details.

### `public/` — static assets

Files copied verbatim to the deployed Hosting bucket (favicons, robots.txt, manifest, og images).

### `functions/` — Firebase Cloud Functions

Gen2 callable + HTTP functions in Node 22. `lib/` is the TypeScript build output, `scripts/` holds
function-local helpers, `node_modules/` is install state. Deployed via the deployment runbook in
[Pipeline Deployment Guide](../archive/pipeline-deployment-guide.md).

### `platform/` — platform IaC

| Subfolder    | Purpose                                                         |
| ------------ | --------------------------------------------------------------- |
| `terraform/` | Terraform modules for GCP, secrets, infrastructure provisioning |
| `firebase/`  | Firebase project-level config (rules, indexes, emulator config) |
| `ansible/`   | Ansible playbooks for VM / agent host provisioning              |

See [Terraform Cloud Setup](../archive/terraform-cloud-setup.md) and
[Architecture Infrastructure Complete](../archive/architecture-infrastructure-complete.md).

### `infrastructure/` — sensitive material

Contains `secrets/` which is `.gitignore`d. Never commit anything here. Authoritative secret flow is
documented in [Security Secrets Guide](../archive/security-secrets-guide.md).

### `scripts/` — operational scripts

~45 Node and PowerShell scripts for smoke tests, data migrations, content seeding, deploys, and
maintenance. Generated outputs (`*-output.json`) and local-only files (`temp-check.yaml`) are
gitignored. See [Admin Operations Runbook](../archive/admin-operations-runbook.md) and
[Pipeline CI/CD Workflows](../archive/pipeline-cicd-workflows.md) for usage.

### `e2e/` — end-to-end tests

Playwright specs, fixtures, and helpers. Browser test outputs land in `playwright-report/` and
`test-results/` (both gitignored). Config in `playwright.config.js` at repo root.

### `documentation/` — documentation hub

Single source of truth for engineering documentation. Index at
[`documentation/README.md`](../archive/index.md). Naming convention: lowercase kebab-case
`<domain>-<topic>[-<detail>].md`. Subfolders:

- `content/` — long-form content references
- `live-smoke-tests/` — production smoke-test playbooks + signoffs
- `reports/` — committed audit reports (e.g. axe theme scan)

### `reports/` — local-only generated artifacts

**Entirely gitignored.** Holds locally generated smoke artifacts, visual diffs, deploy logs. Safe to
delete at any time. Committed audit reports live in `documentation/reports/` *(historical target unavailable)* instead.

### `dist/` and `node_modules/`

Build output and dependency cache. Both gitignored. Recreate with `npm run build` and `npm install`
respectively.

## Root files

| File                                   | Purpose                                    |
| -------------------------------------- | ------------------------------------------ |
| `README.md`                            | Project overview + quick start             |
| `CHANGELOG.md`                         | Chronological change log                   |
| `TODO.md`                              | Active backlog                             |
| `package.json` / `package-lock.json`   | npm manifest + lockfile                    |
| `tsconfig.json`                        | TypeScript compiler config                 |
| `vite.config.js`                       | Vite bundler config                        |
| `vitest.config.js`                     | Vitest unit-test config                    |
| `playwright.config.js`                 | Playwright e2e config                      |
| `eslint.config.js`                     | Flat ESLint config                         |
| `postcss.config.js`                    | PostCSS / Tailwind pipeline                |
| `firebase.json` / `.firebaserc`        | Firebase Hosting + Functions deploy config |
| `index.html`                           | Vite entry HTML                            |
| `.gitignore`                           | Git ignore rules                           |
| `.prettierrc.json` / `.prettierignore` | Prettier formatting config                 |
| `.commitlintrc.json`                   | Commit-message lint rules                  |
| `.pre-commit-config.yaml`              | pre-commit hook config                     |
| `.lighthouserc.json`                   | Lighthouse CI thresholds                   |
| `.nvmrc`                               | Node version pin                           |
| `.sops.yaml`                           | SOPS encryption rules for secrets          |

Allowed root markdown is limited to `README.md`, `CHANGELOG.md`, and `TODO.md`. Anything else that
lands at root is a cleanup target — see [Repo Cleanup Policy](../archive/process-repo-cleanup.md).
