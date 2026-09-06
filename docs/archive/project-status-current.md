# Current Production Status - HCW Platform

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** June 12, 2026
**Build Status:** Production Ready
**Frontend:** Deployed and Live (Firebase Hosting direct deploy verified HTTP 200)
**Admin Portal:** Fully Functional
**Backend:** Cloud Functions Deployed (`deploy-functions` success on `a839471f`)
**Security:** Hardened (headers, rules, scanning)
**Performance:** Optimized (fonts, lazy-load, resource hints)

---

## What's Currently Working

### Frontend (React SPA)

- **Status:** Production-Ready
- **Deployment:** Firebase Hosting (automatic on frontend main-branch changes, ~2-3 min; direct CLI deploy used on 2026-06-12 to avoid workflow dispatch)
- **Build:** 48 pages across 7 cloud domains (100% complete)
- **Tech Stack:** React 19 + Vite + TailwindCSS + shadcn/ui
- **Features:**
  - Educational content platform for AWS, Azure, GCP, Terraform, GitHub, FinOps
  - Responsive mobile-first design
  - Dark mode support
  - Provider-specific color theming
  - Real-time data sync with Firestore

### Admin Portal (ContentForge)

- **Status:** Fully Functional
- **Route:** `/admin/*`
- **Authentication:** Firebase Auth (Google sign-in) + Custom Claims (`isAdmin()`)
- **Authorization:** Backend-enforced — Firestore rules use `isAdmin()` for all write paths

#### Admin Pages Available

1. **Dashboard** (`/admin`) — Pipeline overview, batch operations, recent activity
2. **Submit URLs** (`/admin/submit`) — 4-stage content submission workflow
3. **Queue** (`/admin/queue`) — Review submitted content with filter/bulk ops
4. **Review** (`/admin/queue/:id`) — Detailed item review with metadata editing
5. **Editor** (`/admin/editor/:id`) — Monaco-based markdown editor with live preview
6. **Published** (`/admin/published`) — Manage ready-to-publish and live content
7. **Calendar** (`/admin/calendar`) — Visual drag-and-drop scheduling
8. **Connections** (`/admin/connections`) — Integration health checks for Publer, Plaud, Sessionize, Linkie, Klaviyo, and placeholders
9. **Linkie Hub** (`/admin/linkie`) — Link-in-bio management through `linkieProxy`
10. **Mailing List** (`/admin/mailing-list`) — Klaviyo list/profile management and newsletter subscriber support

### Backend Services

- **Cloud Functions (Node.js 22 LTS)** — Content scraping, status workflows, audit logging, AI
- **Firestore** — Content collections, real-time listeners, persistent caching
- **Firebase Storage** — Image hosting, AI-generated cover art
- **Firebase Auth** — Google OAuth, custom admin claims

### AI Features

- **AI Content Extraction** — Scrapes URLs, extracts key information via Gemini
- **AI Cover Generation** — Replicate integration (optional per submission)
- **Reader Fallback** — `CONTENTFORGE_SCRAPE_FALLBACK_ENABLED=true` brings scrape success 62.5% →
  100% on benchmark set. Latency tradeoff ~3.3x acceptable since direct_html still handles fast
  paths.

---

## Security Posture (as of June 12, 2026)

### HTTP Security Headers (live via `firebase.json`)

| Header                      | Value                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| `X-Content-Type-Options`    | `nosniff`                                                          |
| `X-Frame-Options`           | `DENY`                                                             |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                  |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=()`                         |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload`                     |
| `Content-Security-Policy`   | default-src self; script/style/font-src scoped to approved origins |

### Firebase Rules

- **Firestore:** `wiki_pages`, `social_workspaces`, `social_posts`, `social_libraries`,
  `social_library_items`, `social_schedule_slots` all require `isAdmin()` for writes
- **Storage:** Catch-all rule is `allow read, write: if false` (deny-all default)

### CI Security Pipeline

- `scan-security.yml` exits non-zero on CRITICAL/HIGH CVEs (blocking)
- Trivy v0.70.0 (via `trivy-action` v0.36.0) scans npm, secrets, and IaC
- SBOM generated on every security scan run
- All GitHub Action refs pinned to SHA digests
- `ignore-unfixed: true` suppresses noise from CVEs with no upstream fix

---

## Performance Optimizations (as of April 29, 2026)

### `index.html` Resource Hints

- `<link rel="preconnect">` to Firestore, Identity Toolkit
- `<link rel="dns-prefetch">` to Cloud Functions, Firebase Storage
- `<link rel="preconnect">` to fonts.googleapis.com + fonts.gstatic.com (for Material Symbols)

### Fonts

- **IBM Plex Mono** — self-hosted via `@fontsource/ibm-plex-mono` (400, 500, 600 weights). No CDN
  call, Vite emits woff2 files into dist/assets at build time.
- **Material Symbols Outlined** — Google Fonts CDN (variable icon font, too complex to self-host)
- All `@font-face` declarations have `font-display: swap`

### Code Splitting

- `FrameworkRadar` (vendor-charts, 159KB) is lazy-loaded via `React.lazy()` + `Suspense` in both
  `FrameworkDetailTemplate` and `FrameworkReviewBoard`
- Monaco editor chunk loads on demand (admin editor route only)

---

## CI/CD Pipeline (as of June 12, 2026)

See `documentation/pipeline-cicd-workflows.md` for the full reference.

### Active Workflows

| Workflow               | Trigger          | Duration  | Purpose                             |
| ---------------------- | ---------------- | --------- | ----------------------------------- |
| `deploy-frontend.yml`  | Push to `main`   | ~2-3 min  | Build + Firebase deploy             |
| `check-quality.yml`    | PRs to `main`    | ~3-4 min  | ESLint, Prettier, unit tests, rules |
| `check-e2e.yml`        | PRs to `main`    | ~5-7 min  | Playwright E2E                      |
| `check-lighthouse.yml` | PRs to `main`    | ~7-10 min | Lighthouse audit (9 URLs)           |
| `check-helm.yml`       | PRs to `main`    | ~1 min    | Helm chart lint                     |
| `scan-security.yml`    | PRs + weekly     | ~3-5 min  | Trivy + SBOM                        |
| `secret-encrypt.yml`   | Manual           | ~2-3 min  | Notion → SOPS                       |
| `secret-rotate.yml`    | Monthly          | ~2-3 min  | Secret rotation                     |
| `secret-sync.yml`      | Auto on enc file | ~2-3 min  | SOPS → GitHub/Firebase secrets      |
| `secrets-resync.yml`   | Manual           | ~4-6 min  | Notion → SOPS → secret-sync → Terraform Cloud |

**Deleted:** `check-comprehensive.yml` (was redundant with check-quality + check-e2e).

### Latest Production Verification

- **Secrets:** `secrets-resync` and child `secret-sync` completed successfully on 2026-06-12.
- **Firebase Secret Manager:** `LINKIE_API_KEY`, `KLAVIYO_PRIVATE_KEY`, and `KLAVIYO_LIST_ID` were set successfully.
- **Backend:** `deploy-functions` completed successfully for commit `a839471f`.
- **Frontend:** Firebase Hosting was deployed directly with Firebase CLI on 2026-06-12; `https://hybridcloudworks.com` returned HTTP 200 after release.

---

## Dependency State (as of June 12, 2026)

Recent Dependabot PR cleanup and dependency-alert remediation completed on June 12, 2026. Root and
Functions audits were validated locally with zero reported vulnerabilities during the remediation
pass.

### Documented Overrides

All npm `overrides` in `package.json` are annotated with CVE justifications in
[`documentation/dependency-notes.md`](../archive/dependency-notes.md).

---

## Admin Portal Configuration

### Authentication & Authorization

```
// Frontend allowlist is UX-only (not a security boundary)
VITE_ADMIN_EMAIL removed from deploy workflow (no longer needed)

// Backend and Firestore rules are authoritative
isAdmin() => request.auth.uid in get(/databases/$(database)/documents/admins/approved).data.uids
```

**How to Add Admin Users:** Add the user's UID to the `admins/approved` Firestore document.

### Content Status Workflow

```
ingested → inspected → editing → published_blog
                    ↘            ↗
                      rejected (with restore option)
```

### API Patterns

See `documentation/admin-api-patterns.md` for endpoint details.

---

## Deployment

### Frontend

- **Platform:** Firebase Hosting
- **CDN:** Firebase global CDN
- **Trigger:** Automatic on every push to `main`
- **Build Time:** ~2-3 minutes
- **Domain:** `https://hybridcloudworks.com`

### Cloud Functions

- **Runtime:** Node.js 22 LTS
- **Deploy:** `firebase deploy --only functions`

### Secrets Management

- **Source of truth:** Notion Database
- **Distribution:** GitHub Actions secrets via `secret-sync.yml`
- **Runtime:** Firebase Secret Manager (Cloud Functions)
- **Rotation:** Monthly via `secret-rotate.yml`
- **Integration secrets verified:** Linkie and Klaviyo are provisioned through Notion → SOPS →
  Firebase Secret Manager.

---

## Monitoring & Debugging

### Check Admin Access

1. Navigate to `https://hybridcloudworks.com/admin`
2. Sign in with Google
3. Backend `isAdmin()` check governs access

### Cloud Functions Logs

Firebase Console → Functions → Logs

### Firestore Data

Firebase Console → Firestore Database → `content` collection

---

## Next Steps / Known Gaps

- **Issue #171** — 15-item checklist to restore `lighthouse:recommended` preset (images, contrast,
  SEO meta-description, console errors, source maps, heading order)
- **Stage 3 backend** — Assessments service, FinOps engine, GitOps deployment path (see `TODO.md`)

---

**Questions?** Check the `documentation/` folder for detailed guides on specific features.
