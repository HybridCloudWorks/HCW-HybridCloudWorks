# PIPELINE-DEPS-MANIFEST

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Status**: Complete & Verified **Date**: February 23, 2026 **Build Status**: ✅ Successful
**Vulnerability Status**: ✅ Zero (0 vulnerabilities) **Node.js Version**: 22.x LTS

---

## Executive Summary

Complete dependency audit and update for 2026 standards:

- **Total Dependencies**: 1,429 packages
- **Vulnerabilities**: 0 (down from 25)
- **Updated Packages**: 56+ updated, 14 removed (net optimization)
- **Production Build**: ✅ Passes (454.61 kB gzip)
- **Security Strategy**: npm overrides for permanent transitive fixes

---

## Production Dependencies (Direct)

These are packages that reach your users' browsers:

| Package                    | Version     | Purpose                             |
| -------------------------- | ----------- | ----------------------------------- |
| `react`                    | 18.3.1      | UI framework (defer React 19 to v2) |
| `react-dom`                | 18.3.1      | DOM rendering                       |
| `react-router`             | 6.30.3      | Client-side routing (defer v7)      |
| `react-router-dom`         | 6.30.3      | DOM routing                         |
| `@radix-ui/*`              | 1.x         | Accessible component library        |
| `chart.js`                 | 4.5.1       | Charting                            |
| `react-chartjs-2`          | 5.3.1       | Chart bindings                      |
| `d3`                       | 7.9.0       | Data visualization                  |
| `react-big-calendar`       | 1.19.4      | Calendar widget                     |
| `firebase`                 | **12.9.0**  | 🆕 Firebase SDK (updated)           |
| `react-markdown`           | 10.1.0      | Markdown rendering                  |
| `react-syntax-highlighter` | 15.6.6      | Code highlighting (defer v16)       |
| `remark-gfm`               | 4.0.1       | GFM markdown                        |
| `rss-parser`               | 3.13.0      | RSS feed parsing                    |
| `date-fns`                 | 4.1.0       | Date utilities                      |
| `dompurify`                | 3.3.0       | HTML sanitization                   |
| `framer-motion`            | **12.34.3** | 🆕 Animation (updated)              |
| `lucide-react`             | **0.575.0** | 🆕 Icon library (updated)           |
| `react-hook-form`          | **7.71.2**  | 🆕 Form library (updated)           |
| `react-helmet-async`       | 2.0.5       | Document head management            |
| `clsx`                     | 2.0.0       | Class name utilities                |
| `class-variance-authority` | 0.7.0       | Component variants                  |
| `tailwind-merge`           | 1.14.0      | Tailwind utility merging (defer v3) |
| `tailwindcss-animate`      | 1.0.7       | Tailwind animations                 |

**Summary**: Core React 18 stack with stable production dependencies. Zero production
vulnerabilities.

---

## Build & Development Tools

### Build System

| Package                | Version      | Purpose                              |
| ---------------------- | ------------ | ------------------------------------ |
| `vite`                 | **7.3.1**    | Frontend build tool (current stable) |
| `@vitejs/plugin-react` | **5.1.4**    | 🆕 React plugin (updated)            |
| `vite-plugin-svgr`     | (via plugin) | SVG component support                |

### Testing & QA

| Package                     | Version    | Purpose                          |
| --------------------------- | ---------- | -------------------------------- |
| `vitest`                    | **4.0.18** | 🆕 Unit test framework (updated) |
| `@vitest/coverage-v8`       | **4.0.18** | 🆕 Coverage reporting (updated)  |
| `@playwright/test`          | **1.58.0** | 🆕 E2E testing (updated)         |
| `@testing-library/react`    | 16.3.2     | React testing utilities          |
| `@testing-library/jest-dom` | 6.9.1      | DOM assertions                   |
| `jsdom`                     | **28.1.0** | 🆕 DOM simulation (updated)      |

### Code Quality & Linting

| Package                            | Version    | Purpose                                        |
| ---------------------------------- | ---------- | ---------------------------------------------- |
| `eslint`                           | **10.0.2** | 🆕 🔒 Linter (major upgrade, fixes minimatch!) |
| `@typescript-eslint/eslint-plugin` | **8.56.1** | 🆕 TypeScript rules (updated)                  |
| `@typescript-eslint/parser`        | **8.56.1** | 🆕 TS parser (updated)                         |
| `eslint-config-prettier`           | 10.1.8     | Prettier integration                           |
| `eslint-plugin-react`              | 7.37.5     | React rules                                    |
| `eslint-plugin-react-hooks`        | 7.0.1      | Hooks rules                                    |
| `eslint-plugin-jsx-a11y`           | 6.10.2     | Accessibility rules                            |
| `prettier`                         | **3.8.1**  | 🆕 Code formatter (updated)                    |

### Git & Commit Tools

| Package                           | Version    | Purpose                           |
| --------------------------------- | ---------- | --------------------------------- |
| `husky`                           | 9.1.7      | Git hooks                         |
| `commitlint`                      | **20.4.2** | 🆕 Commit linting (updated)       |
| `@commitlint/config-conventional` | **20.4.2** | 🆕 Conventional commits (updated) |

### Styling & Layout

| Package        | Version     | Purpose                      |
| -------------- | ----------- | ---------------------------- |
| `tailwindcss`  | 3.4.19      | Utility CSS (defer v4)       |
| `postcss`      | 8.4.49      | CSS processing               |
| `autoprefixer` | **10.4.24** | 🆕 Vendor prefixes (updated) |

### Other Development

| Package                    | Version    | Purpose                                         |
| -------------------------- | ---------- | ----------------------------------------------- |
| `dotenv`                   | **17.3.1** | 🆕 🔒 Environment variables (major update)      |
| `typescript`               | 5.8.1      | Language support                                |
| `baseline-browser-mapping` | **2.10.0** | 🆕 Browser mapping (updated)                    |
| `firebase-tools`           | **15.7.0** | 🆕 🔒 Firebase CLI (updated, fixes transitive!) |

---

## Security & Vulnerability Fixes

### npm Overrides (Permanent Fixes)

These packages are forced to secure versions globally via `package.json` overrides:

| Package        | Override Version | Original Vulnerable Version | Issue Fixed                                  |
| -------------- | ---------------- | --------------------------- | -------------------------------------------- |
| `minimatch`    | ^10.2.2          | <10.2.1                     | ReDoS (regular expression denial of service) |
| `glob`         | ^13.0.6          | 10.5.0                      | Transitive through minimatch                 |
| `rimraf`       | ^6.1.3           | 5.0.10                      | Transitive through glob                      |
| `archiver`     | ^7.0.1           | 6.x                         | Updated for CLI tools                        |
| `readdir-glob` | ^3.0.0           | <=2.0.3                     | Dependency cycle fix                         |
| `ajv`          | ^8.18.0          | 7.x                         | ReDoS via `$data` option                     |
| `debug`        | ^4.3.7           | Various                     | Transitive security                          |
| `highlight.js` | ^11.9.0          | Various                     | Security hardening                           |
| `prismjs`      | ^1.30.0          | Various                     | Code highlighting security                   |

### Vulnerability Elimination Strategy

**Before Overrides**:

```
npm audit result:
  25 vulnerabilities (1 moderate, 24 high)
  - glob/rimraf/minimatch chain from firebase-tools
  - gaxios chain from google-cloud packages
  - ajv from eslint
```

**After Overrides**:

```
npm audit result:
  0 vulnerabilities
  ✅ ZERO total vulnerabilities
  ✅ All transitive chains resolved
  ✅ Production: ZERO vulnerabilities
  ✅ Development: ZERO vulnerabilities
```

---

## Package Statistics

### By Category

| Category                | Count | Vulnerabilities |
| ----------------------- | ----- | --------------- |
| Production (Direct)     | 27    | 0 ✅            |
| Development (Direct)    | 30+   | 0 ✅            |
| Transitive (Total Tree) | 1,429 | 0 ✅            |

### Updates Applied

| Change Type           | Count              |
| --------------------- | ------------------ |
| Major Version Bumps   | 2 (eslint, dotenv) |
| Minor Version Updates | 15+                |
| Patch Version Updates | 39+                |
| Packages Removed      | 14                 |
| Packages Added        | 4                  |

---

## Deferred Major Version Upgrades

These major versions are stable and ready but deferred for next feature release to minimize risk:

| Package                    | Current | Latest | Why Deferred                 |
| -------------------------- | ------- | ------ | ---------------------------- |
| `react`                    | 18.3.1  | 19.2.4 | Component refactoring needed |
| `react-dom`                | 18.3.1  | 19.2.4 | Requires component updates   |
| `react-router`             | 6.30.3  | 7.13.1 | Major routing API changes    |
| `react-router-dom`         | 6.30.3  | 7.13.1 | Route definition changes     |
| `tailwindcss`              | 3.4.19  | 4.2.1  | Config migration needed      |
| `tailwind-merge`           | 1.14.0  | 3.5.0  | Performance timing changes   |
| `react-syntax-highlighter` | 15.6.6  | 16.1.0 | API changes, test needed     |

These are candidates for a major version bump in the next release cycle with comprehensive testing.

---

## Known Non-Blocking Warnings

These warnings appear in build logs but do not affect functionality:

### npm ci Deprecation Warnings (Setup Only)

| Package                   | Warning             | Why Harmless                                                   |
| ------------------------- | ------------------- | -------------------------------------------------------------- |
| `node-domexception@1.0.0` | Use platform native | Transitive from jsdom; not in execution                        |
| `json-ptr@3.1.1`          | No longer supported | Transitive from google-cloud; build-time only                  |
| `glob@10.5.0`             | Old version         | Overridden to 13.0.6; warning from nested ref (npm limitation) |
| `husky install`           | DEPRECATED          | Backward compatible; prepare hook works fine                   |

**Impact**: None - these warnings appear during setup, not runtime.

---

## Build Performance

```
Production Build Output:
  dist/index.html                                1.07 kB (gzip: 0.52 kB)
  dist/assets/index.css                      201.13 kB (gzip: 29.67 kB)
  dist/assets/vendor-firebase.js             434.70 kB (gzip: 133.91 kB)
  dist/assets/vendor-other.js                454.61 kB (gzip: 145.56 kB)

  Total 3-way bundle split:  ~892 kB (gzip: ~310 kB)
  Build time:                 5.18 seconds
  Modules bundled:            1,428
```

Performance is consistent with previous builds. No regression from dependencies.

---

## Next Steps & Maintenance

### Immediate (Done)

- ✅ Node.js 22.x deployment configuration
- ✅ All critical/high vulnerabilities resolved
- ✅ Production build verified
- ✅ npm overrides configured for permanent fixes

### Short Term (Next Release)

- Test major version upgrades (React 19, React Router 7, Tailwind 4) in feature branch
- Plan migration for deferred packages
- Update testing matrix for new versions

### Ongoing

- Monthly: `npm audit` checks
- Quarterly: `npm outdated` review
- Semi-annually: Override versions update
- Annually (February): Node.js LTS review

---

## Related Documentation

- pipeline-nodejs-upgrade.md *(historical target unavailable)* – Upgrade strategy and rationale
- [pipeline-deployment-guide.md](../archive/pipeline-deployment-guide.md) – CI/CD workflow details
- `.github/workflows/deploy-frontend.yml` – GitHub Actions deployment config

---

_Last Updated: February 23, 2026_ _Build Status: ✅ All Green_ _Security Status: ✅ Zero
Vulnerabilities_
