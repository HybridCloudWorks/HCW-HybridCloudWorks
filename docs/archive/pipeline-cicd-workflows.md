# CI/CD Workflows Reference

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Document Version:** 3.0 **Last Updated:** 2026-04-29 **Status:** Active **Audience:** Developers,
DevOps

---

## Overview

All CI/CD automation lives in `.github/workflows/`. Workflows are organized by **purpose** with a
consistent naming convention:

| Prefix    | Purpose            | Trigger                     |
| --------- | ------------------ | --------------------------- |
| `deploy-` | Ship to production | Push to `main`              |
| `check-`  | Quality gates      | PRs + on-demand             |
| `scan-`   | Security analysis  | PRs + scheduled + on-demand |
| `secret-` | Secrets management | On-demand / scheduled       |

### Design Philosophy

- **Deploys are fast.** The deploy workflow does one thing: build and ship. No linting, no tests, no
  Lighthouse. Target: **~2-3 minutes**.
- **Quality checks are separate.** Run on PRs to catch issues before merge, or trigger manually.
- **Lighthouse is decoupled from deploy.** It runs on PRs and on-demand only. This keeps deploy
  times under 3 minutes and avoids burning runner hours on every push.
- **Nothing blocks deploys.** If you push to `main`, it deploys. Period.
- **Concurrency groups on every PR workflow.** Stale runs are cancelled when a new commit pushes.

---

## Trigger Matrix: What runs when?

| Trigger            | Workflow(s)                                                             | Purpose                                         |
| :----------------- | :---------------------------------------------------------------------- | :---------------------------------------------- |
| **Push to `main`** | `Deploy Frontend`                                                       | **SHIPPING**: Fast-path to production.          |
| **Push to `main`** | `Secret Sync`                                                           | **SYNC**: Only if `.secrets.enc.yaml` changes.  |
| **Open/Update PR** | `Check Quality`<br>`Check E2E`<br>`Check Lighthouse`<br>`Scan Security` | **VALIDATION**: Quality gates before merging.   |
| **Weekly (Sun)**   | `Scan Security`                                                         | **AUDIT**: Ongoing vulnerability checking.      |
| **Monthly (1st)**  | `Secret Rotate`                                                         | **SECURITY**: Automated secret rotation.        |
| **Manual**         | _Any workflow_                                                          | **ON-DEMAND**: Manual trigger from Actions tab. |

---

## Workflow Map

```
Push to main ──► deploy-frontend.yml ──► Firebase Hosting (LIVE)
                     (~2-3 min)

Pull Request ──┬── check-quality.yml ──► ESLint + Prettier + Unit Tests + Rules
               ├── check-e2e.yml ──────► Playwright E2E Tests
               ├── check-lighthouse.yml ► Lighthouse Performance/A11y (9 URLs)
               ├── check-helm.yml ──────► Helm Chart Linting
               └── scan-security.yml ──► Trivy (deps + secrets + IaC) + SBOM

On-Demand ─────┬── secret-encrypt.yml ─► Notion → SOPS Encrypted File
               ├── secret-rotate.yml ──► Monthly Secret Rotation
               └── secret-sync.yml ────► SOPS → GitHub/Firebase Secrets
```

---

## Workflows

### `deploy-frontend.yml` — Deploy Frontend

**Purpose:** Build the React SPA and deploy to Firebase Hosting.

| Property       | Value                                            |
| -------------- | ------------------------------------------------ |
| **Trigger**    | Push to `main` (src/public/config paths), manual |
| **Jobs**       | 1 (`build-and-deploy`)                           |
| **Duration**   | ~2-3 minutes                                     |
| **Deploys to** | https://hybridcloudworks.com                     |

**What it does:**

1. `npm ci` — install dependencies
2. `npm run build` — Vite production build (injects all `VITE_FIREBASE_*` env vars)
3. `FirebaseExtended/action-hosting-deploy` — deploy `dist/` to Firebase Hosting live channel
4. Health check — curl the live site, verify HTTP 200

**Key Design Decision:** No lint, test, or Lighthouse steps. Those run on PRs via `check-*`
workflows. Lighthouse was decoupled in April 2026 when it was causing 20-minute deploy times (27
scans × 3 runs). Deploy now takes ~2-3 minutes.

---

### `check-quality.yml` — Check Quality

**Purpose:** Run code quality checks: linting, formatting, unit tests, and security rules.

| Property     | Value                                                                                |
| ------------ | ------------------------------------------------------------------------------------ |
| **Trigger**  | PRs to `main` (src/scripts/functions paths), manual                                  |
| **Jobs**     | 5 (parallel: `lint`, `format`, `verify-required`, `verify-security`, then `summary`) |
| **Duration** | ~3-5 minutes                                                                         |

**Jobs breakdown:**

| Job               | What it checks                    | Fails on              |
| ----------------- | --------------------------------- | --------------------- |
| `lint`            | ESLint with `--max-warnings=0`    | Any ESLint error/warn |
| `format`          | Prettier formatting               | Unformatted files     |
| `verify-required` | `npm run test:admin` (unit tests) | Test failures         |
| `verify-security` | Firestore rules tests (emulator)  | Rules test failures   |
| `summary`         | Aggregates all results            | Any job failure       |

**Note:** `verify-required` runs `npm run test:admin` only (not `npm run verify:required` which also
builds). The build is redundant since `check-e2e` builds separately. This saves ~2 minutes per PR.

**Concurrency:** Stale runs cancelled when a new commit is pushed to the same PR.

---

### `check-e2e.yml` — Check E2E

**Purpose:** Run Playwright end-to-end tests against a production build.

| Property     | Value                                              |
| ------------ | -------------------------------------------------- |
| **Trigger**  | PRs to `main` (src/tests/playwright paths), manual |
| **Jobs**     | 1 (`e2e`)                                          |
| **Duration** | ~5-7 minutes                                       |

**What it does:**

1. `npm run build` — full production build (with Firebase env vars)
2. `npx playwright install --with-deps chromium` — install browser
3. `npx vite preview` — start local preview server on port 5173
4. `npx playwright test --project=chromium` — run E2E tests
5. Upload `playwright-report/` as artifact (3-day retention)

**Concurrency:** Stale runs cancelled when a new commit is pushed to the same PR.

---

### `check-lighthouse.yml` — Check Lighthouse

**Purpose:** Run Lighthouse CI audit for performance, accessibility, best practices, and SEO.

| Property     | Value                                           |
| ------------ | ----------------------------------------------- |
| **Trigger**  | PRs to `main` (src/public/config paths), manual |
| **Jobs**     | 1 (`lighthouse`)                                |
| **Duration** | ~7-10 minutes                                   |

**What it does:**

1. Build production bundle
2. Start Vite preview server
3. Run `lhci autorun` with `.lighthouserc.json` config
4. Upload HTML reports as artifacts (3-day retention)
5. Comment PR with results link

**Configuration (`.lighthouserc.json`):**

- **URLs audited:** 9 routes (homepage, AWS/Azure/GCP/Terraform frameworks, AWS blog, architecture,
  audio, education)
- **Runs:** 1 per URL (reduced from 3 to save runner hours)
- **Thresholds:** Performance ≥ 0.40, Accessibility ≥ 0.85, Best Practices ≥ 0.90, SEO ≥ 0.90
- **Preset:** Custom (not `lighthouse:recommended` — see issue #171 for restoration checklist)

**Why not `lighthouse:recommended`:** The preset enforces 50+ individual audits at ≥90%. Current
blockers include unoptimized images, no meta-description on most pages, and console errors from
Firebase SDK. Issue #171 tracks the 15-item resolution list.

**Concurrency:** Stale runs cancelled when a new commit is pushed to the same PR.

---

### `check-helm.yml` — Check Helm

**Purpose:** Lint Kubernetes Helm charts.

| Property     | Value                                                   |
| ------------ | ------------------------------------------------------- |
| **Trigger**  | PRs to `main` (infrastructure/kubernetes paths), manual |
| **Jobs**     | 1 (`helm-lint`)                                         |
| **Duration** | ~1 minute                                               |

Checks if `infrastructure/kubernetes/charts/` exists; runs `helm lint` on each chart directory.
Skips gracefully if no charts found.

---

### `scan-security.yml` — Scan Security

**Purpose:** Comprehensive security scanning using Trivy. Blocking on CRITICAL/HIGH.

| Property     | Value                                                                             |
| ------------ | --------------------------------------------------------------------------------- |
| **Trigger**  | PRs to `main` (src/functions/platform/package paths), weekly (Sunday), manual     |
| **Jobs**     | 5 (parallel: `dependencies`, `secrets`, `infrastructure`, `sbom`, then `summary`) |
| **Duration** | ~3-5 minutes                                                                      |

**Scan coverage:**

| Job              | What it scans              | Severity               | Exit code     | Output                       |
| ---------------- | -------------------------- | ---------------------- | ------------- | ---------------------------- |
| `dependencies`   | npm + Python packages      | CRITICAL, HIGH         | 1 (blocking)  | SARIF → GitHub Security tab  |
| `secrets`        | Git history + config files | All                    | 1 (blocking)  | SARIF → GitHub Security tab  |
| `infrastructure` | Dockerfiles, IaC configs   | CRITICAL, HIGH, MEDIUM | 0 (warn-only) | SARIF → GitHub Security tab  |
| `sbom`           | Frontend npm tree          | —                      | —             | SPDX JSON artifact (90 days) |

**`ignore-unfixed: true`** suppresses CVEs with no available fix to reduce noise.

**Concurrency:** Stale PR runs cancelled; scheduled weekly runs are never cancelled.

---

### `secret-encrypt.yml` — Secret Encrypt

**Purpose:** Fetch secrets from Notion database and encrypt them with SOPS.

| Property     | Value                |
| ------------ | -------------------- |
| **Trigger**  | Manual only          |
| **Jobs**     | 1 (`notion-to-sops`) |
| **Duration** | ~2-3 minutes         |

**Process:**

```
Notion Database ──► notion-to-yaml.js ──► secrets.yaml ──► SOPS encrypt ──► .secrets.enc.yaml
                                                                                    │
                                                                          git commit + push
                                                                                    │
                                                                          triggers secret-sync.yml
```

---

### `secret-rotate.yml` — Secret Rotate

**Purpose:** Automatically rotate internally-managed secrets on a schedule.

| Property     | Value                          |
| ------------ | ------------------------------ |
| **Trigger**  | Monthly (1st of month), manual |
| **Jobs**     | 1 (`rotate`)                   |
| **Duration** | ~2-3 minutes                   |

Rotates DB passwords, message queue passwords, application secrets, and admin passwords. After
rotation, triggers `secret-encrypt.yml` → `secret-sync.yml`.

---

### `secret-sync.yml` — Secret Sync

**Purpose:** Distribute decrypted secrets to GitHub Actions and Firebase Secret Manager.

| Property     | Value                                     |
| ------------ | ----------------------------------------- |
| **Trigger**  | Push to `main` (enc file changes), manual |
| **Jobs**     | 1 (`sync`)                                |
| **Duration** | ~2-3 minutes                              |

---

## Runner Hour Efficiency

### Estimated cost per PR (post-April-2026 hygiene)

| Workflow         | Duration       | Notes                                         |
| ---------------- | -------------- | --------------------------------------------- |
| check-quality    | ~3-5 min       | Concurrency cancels stale runs                |
| check-e2e        | ~5-7 min       | Concurrency cancels stale runs                |
| check-lighthouse | ~7-10 min      | 1 run × 9 URLs (was 3×9=27)                   |
| scan-security    | ~3-5 min       | Path-filtered, only fires on relevant changes |
| **Total per PR** | **~18-27 min** | (was ~45-55 min before hygiene)               |

### What was removed / changed (April 2026)

- **Deleted `check-comprehensive.yml`** — was fully redundant with check-quality (unit tests) +
  check-e2e (Playwright + build). Saved ~12-15 min per PR.
- **Lighthouse decoupled from deploy** — removed 20-min Lighthouse gate from `deploy-frontend.yml`.
  Deploy now runs alone in ~2-3 min.
- **Concurrency groups** — added to all PR check workflows. Pushes to a PR cancel the previous
  in-progress runs.
- **check-quality: removed redundant build** — `npm run verify:required` (build + test) →
  `npm run test:admin` only. Saves ~2 min per PR.
- **scan-security: path filtering** — only fires when src/, functions/, platform/, or package files
  change. Saves runs on docs-only PRs.
- **Artifact retention reduced** — 7 days → 3 days for check-e2e and check-lighthouse artifacts.
  Reduces storage usage.
- **Lighthouse runs reduced** — `numberOfRuns: 3` → `numberOfRuns: 1`. Saves ~15 min per Lighthouse
  run.

---

## Quick Reference

### Running Workflows Manually

All workflows support `workflow_dispatch`:

1. Go to **Actions** tab in GitHub
2. Select the workflow from the left sidebar
3. Click **"Run workflow"**
4. Select branch and fill in any inputs

### Common Scenarios

| I want to...                          | Run this workflow                                             |
| ------------------------------------- | ------------------------------------------------------------- |
| Deploy latest code to production      | Push to `main` (auto) or run **Deploy Frontend** manually     |
| Check if my PR passes quality         | Open a PR — **Check Quality** runs automatically              |
| Run E2E tests on my branch            | Run **Check E2E** manually on your branch                     |
| Audit performance/accessibility       | Run **Check Lighthouse** manually                             |
| Update production secrets from Notion | Run **Secret Encrypt** → wait → **Secret Sync** auto-triggers |
| Force-rotate all secrets              | Run **Secret Rotate** with `force_rotation: true`             |
| Check for security vulnerabilities    | Run **Scan Security** manually (also runs weekly)             |

### File → Workflow Mapping

```
.github/workflows/
├── deploy-frontend.yml       # Deploy Frontend
├── check-quality.yml         # Check Quality
├── check-e2e.yml             # Check E2E
├── check-lighthouse.yml      # Check Lighthouse
├── check-helm.yml            # Check Helm
├── scan-security.yml         # Scan Security
├── secret-encrypt.yml        # Secret Encrypt
├── secret-rotate.yml         # Secret Rotate
└── secret-sync.yml           # Secret Sync
```

Note: `check-comprehensive.yml` was deleted in April 2026 (redundant).

---

## Environment Variables

### Build-Time Variables (Vite)

| Variable                            | Source        | Used by                    |
| ----------------------------------- | ------------- | -------------------------- |
| `VITE_FIREBASE_API_KEY`             | GitHub Secret | Firebase SDK init          |
| `VITE_FIREBASE_AUTH_DOMAIN`         | GitHub Secret | Firebase Auth              |
| `VITE_FIREBASE_PROJECT_ID`          | GitHub Secret | Firebase project targeting |
| `VITE_FIREBASE_STORAGE_BUCKET`      | GitHub Secret | Cloud Storage              |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | GitHub Secret | FCM                        |
| `VITE_FIREBASE_APP_ID`              | GitHub Secret | Firebase Analytics         |
| `VITE_FIREBASE_MEASUREMENT_ID`      | GitHub Secret | Google Analytics           |
| `VITE_GCP_FUNCTIONS_URL`            | GitHub Secret | Cloud Functions endpoint   |

Note: `VITE_ADMIN_EMAIL` was removed from deploy-frontend.yml in April 2026 — the v2 admin model
uses Custom Claims only and this variable is no longer read by the frontend.

### Local Development

For local development, create `infrastructure/secrets/env/.env`:

```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123:web:abc
VITE_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
VITE_GCP_FUNCTIONS_URL=https://us-central1-your-project.cloudfunctions.net
```

---

## Troubleshooting

### Deploy is slow or overlapping

Deploys should take ~2-3 minutes. If overlapping:

- Multiple pushes in quick succession → the second deploy will run after the first completes
- `deploy-frontend.yml` has no concurrency group (we want all deploys to complete, not cancel
  in-progress ones)

### Firebase "No Firebase App" error in production

**Cause:** `VITE_FIREBASE_*` env vars weren't injected during build.

**Fix:** Check the "Build production bundle" step logs in the deploy workflow — the env vars should
be listed.

### Lighthouse scores are low

Current thresholds are deliberately conservative (Performance ≥ 0.40). See issue #171 for the full
checklist to restore `lighthouse:recommended`. Known causes: Firebase SDK bundle size, unoptimized
images, missing meta-description tags.

### Secrets not syncing

1. Run **Secret Encrypt** manually
2. Check the commit — `.secrets.enc.yaml` should be updated
3. **Secret Sync** should trigger automatically
4. Verify in GitHub Settings → Secrets → Actions

### E2E tests failing

1. Run **Check E2E** manually to reproduce
2. Download the `playwright-report` artifact from the workflow run
3. Open the HTML report locally for detailed failure screenshots

---

## Migration Notes

### Feb 2026 — Initial workflow rename

| Old File                             | New File               |
| ------------------------------------ | ---------------------- |
| `frontend-deploy.yml`                | `deploy-frontend.yml`  |
| `code-quality.yml`                   | `check-quality.yml`    |
| `lighthouse-audit.yml`               | `check-lighthouse.yml` |
| `ci-helm-lint.yml`                   | `check-helm.yml`       |
| `security-scan.yml`                  | `scan-security.yml`    |
| `secrets-rotate-and-sync-notion.yml` | `secret-rotate.yml`    |

### April 2026 — Hygiene pass

- `check-comprehensive.yml` **deleted** (redundant)
- Lighthouse decoupled from deploy
- Concurrency groups added to all PR workflows
- check-quality: build step removed from test job
- scan-security: path filtering added + concurrency group
- Lighthouse: numberOfRuns 3 → 1, URLs 5 → 9
- SBOM job added to scan-security
- All GitHub Action refs pinned to SHA digests (security hardening)
