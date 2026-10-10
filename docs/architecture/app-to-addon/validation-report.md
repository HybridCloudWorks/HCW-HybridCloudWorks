# Phase 6 — Integration, security and deployment validation report

Date: 2026-10-10. Branch everywhere: `work/fervent-gauss-kbdr3h`. Every row names the command run and where; "CI only"
means the check exists in the repository's workflows but could not run in this session (no Docker daemon, no `az`, no
`terraform`, no lab host).

## 1. Integration validation

| Check | Repository | Evidence | Result |
|---|---|---|---|
| Health envelope flat and complete | AzMigrate AddOn | `api.test.ts` health test (26 tests pass, 30f1f8f) | PASS |
| Health envelope flat and complete | Cloud Assessor AddOn | `tests/contract/test_health.py` (151 pass, 7ec55eb) | PASS |
| Health envelope flat and complete | NetworkEyes AddOn | `tests/contract` (OpenAPI two-way + every error code; 223 tests pass, 98.08% coverage, 14f454b) | PASS |
| Pane protocol: transitions only, four states, navigate | AzMigrate AddOn | e2e `lab.spec.ts` message sequence (CI, green on PR #4) | PASS (CI) |
| Pane protocol | Cloud Assessor AddOn | Playwright `tests/e2e` (4 specs; CI) | CI only |
| Pane protocol | NetworkEyes AddOn | Playwright `tests/e2e` (4 specs, passed locally with the scratchpad chromium) | PASS (local) |
| Website catalogue ↔ registry parity | Website | `frontend/src/data/addons/catalogue.test.js` (frontend suite: 315 files, 4,510 tests pass at ba54eee) | PASS |
| Website CSP frame-src = available AddOn origins | Website | `csp.test.js` learns `addonOrigins()` | PASS |
| Status proxy projection allow-list, 5 s, cache, https-only, three complete shapes | Website | `functions/src/lib/addons/status.test.js` (36 tests; functions suite 259 files, 5,480 tests pass) | PASS |
| Route inventory / API surface / prerender complete | Website | `route-inventory.test.js`, `routes-are-complete.test.js`; `npm run build` pre-renders the three `/tools/*` pages | PASS |
| Pane page: sandbox, message filter, watchdog, navigate allow-list, unavailable sentence, coming rows | Website | `AddOnPanePage.test.jsx` | PASS |
| No vendor names in public copy | Website + AddOns | `public-copy.test.js` (ROOTS += `data/addons`); AddOn e2e "no partner names" | PASS |

## 2. Security validation

| Check | Repository | Evidence | Result |
|---|---|---|---|
| Lab edition cannot construct an Azure provider | AzMigrate AddOn | `tests/security/edition-boundary.test.mjs` (4 tests) | PASS |
| Lab edition refuses Azure SDK / identity env | Cloud Assessor AddOn | `tests/security/test_edition_boundary.py` | PASS |
| Lab edition refuses Azure SDK / identity env | NetworkEyes AddOn | `tests/security/test_edition_boundary.py`; `IDENTITY_ENDPOINT=… import network_assessment.app` exits 1; Dockerfile/compose carry no `network_mode`/host mounts (Arc endpoint row) | PASS |
| `import azure` fails inside the image | all three | CI image job | CI only |
| Verification fail-closed (503 before body read) | AzMigrate AddOn | `api.test.ts` | PASS |
| Verification fail-closed | Cloud Assessor AddOn | `tests/unit/test_api.py` | PASS |
| Rate limit + concurrency bound | all | unit tests (`429 rate_limited`, `503 overloaded`); numeric settings bounded to 1,000,000,000 in all three | PASS |
| Security headers set (6 headers) | all | unit tests in each repository | PASS |
| No secrets in tree | all | gitleaks (CI: secret-scan green on #4) + `.gitleasksignore` single fingerprint | PASS |
| CodeQL | AzMigrate AddOn, Apps | green on heads | PASS |
| Dependency review | AzMigrate AddOn, Apps | green | PASS |
| Trivy image scan | all | CI only (publish gated) | CI only |
| App repositories untouched except REFACTOR_APP.md | three Apps | `git diff --stat origin/main..HEAD` shows one file each | PASS |

## 3. Deployment validation

| Check | Evidence | Result |
|---|---|---|
| Dockerfiles build | CI (`build-test` / `image` jobs) | CI only (AzMigrate green on #4) |
| Images publish to Docker Hub by OIDC | `publish-images.yml`, gated on `DOCKERHUB_ENABLED` | Blocked: owner creates the connection |
| Ansible `addons` role: lint, argument-spec defaults, syntax | `ansible-lint --profile production` clean; `check-argument-spec-defaults.py` 14 roles agree; `ansible-playbook --syntax-check site.yml` ok | PASS (local) |
| Caddy per-host redirect | `roles/caddy/tests/caddy-adapt.test.sh` (8 checks: vars snippet → vars route → redir order after `caddy adapt`, Caddy binary pinned by version and SHA-512), also a CI step | PASS (local; CI on #1043) |
| Terraform `ADDON_MIGRATION_URL` | `terraform fmt -check` (tool absent here); `generated-terraform`/plan jobs on #1043 | CI only |
| Rollback by digest | runbook section below | documented |

## 4. Compatibility matrix

| Website | AzMigrate AddOn | AzMigrate App core | Cloud Assessor AddOn | NetworkEyes AddOn | Pane protocol | Health envelope |
|---|---|---|---|---|---|---|
| #1043 (ba54eee) | 0.3.0 (`APP_REF` v0.2.x interim shims) | v0.2.x (v0.3.0 planned: 5 props, `AddOnHealth`) | 0.1.0 | 0.1.0 | `hcw-addon` v1 (states `loading|ready|working|unavailable`) | flat v1 |

Editions: `demo` (migration), `lab` (cloud-assessment, network-assessment). Node floor 26 (AzMigrate AddOn), Python 3.14.6+
(both Python AddOns). Base images pinned by digest `[VERIFY]`.

## 5. Rollback procedures

**AddOn on the lab host** (PowerShell, from the website repository checkout):
```powershell
# 1. put the previous digest back in lab-host/ansible/group_vars/all.yml under addons[].digest, then:
ansible-playbook -i lab-host/ansible/inventory.yml lab-host/ansible/site.yml --tags addons
```
Success looks like: the role's health wait passes and `https://hybridcloudworks.com/api/public/addons/migration/status`
reports the previous `version` within one minute.

**Website**: revert the Phase 6 PR; the catalogue rows, routes and CSP entry disappear; no data to migrate. The Function App
setting `ADDON_MIGRATION_URL` may stay; the proxy answers `{configured:false}` once the registry entry is gone.

**App**: no change was made; nothing to roll back.

## 6. Blockers carried

1. No `main` in `HCW-CloudAssessor_AddOn` and `HCW-NetworkEyes_AddOn` → PRs cannot be opened.
2. Docker Hub OIDC connection and variables not yet created → images unpublished → `coming` rows stay `coming`.
3. Turnstile widgets and vault keys → uploads fail closed until configured.
4. No Docker daemon / terraform / ansible in this session → those checks are CI-only or owner-run.
