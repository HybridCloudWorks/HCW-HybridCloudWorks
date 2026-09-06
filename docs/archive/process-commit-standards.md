# Git Commit Message Standards

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 12, 2026
**Status:** Active - Enforced via Husky + Commitlint
**Config:** [`.commitlintrc.json`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/.commitlintrc.json)

---

## Overview

This repository follows **Conventional Commits** specification with strict validation via
commitlint. All commit messages must adhere to the format below or the commit will be rejected.

---

## Format Structure

```
<type>(<scope>): <Subject>
<BLANK LINE>
<Body>
<BLANK LINE>
<Footer>
```

### Example

```
feat(auth): Add biometric authentication support

Implement fingerprint and Face ID authentication for mobile apps.
Add fallback to password for devices without biometric hardware.
Update security documentation with new auth flow.

Fixes #892
```

---

## Header (Required)

### Syntax

```
type(scope): Subject line here
```

### Rules

- **Type**: REQUIRED - Must be from allowed types list (see below)
- **Scope**: REQUIRED - Must be from allowed scopes list (see below)
- **Subject**: REQUIRED
  - **Sentence-case** (capitalize first letter only: "Update" not "update")
  - **NO trailing period**
  - **Must not be empty**
  - **Maximum 100 characters for entire header line**

### Validation

✅ `feat(frontend): Add new dashboard component`
❌ `feat(frontend): add new dashboard component` (lowercase)
❌ `feat(frontend): Add new dashboard component.` (trailing period)
❌ `feat: Add new dashboard component` (missing scope)

---

## Allowed Types

| Type       | Usage                                   | Example                                        |
| ---------- | --------------------------------------- | ---------------------------------------------- |
| `feat`     | New feature for the user                | `feat(auth): Add OAuth2 login`                 |
| `fix`      | Bug fix                                 | `fix(api): Resolve timeout on large queries`   |
| `docs`     | Documentation only changes              | `docs(readme): Update installation steps`      |
| `style`    | Code style/formatting (no logic change) | `style(frontend): Format with Prettier`        |
| `refactor` | Code refactor (no feature/fix)          | `refactor(database): Optimize query structure` |
| `test`     | Adding or updating tests                | `test(api): Add integration tests`             |
| `chore`    | Maintenance tasks, dependencies         | `chore(deps): Update React to v19`             |
| `ci`       | CI/CD pipeline changes                  | `ci(workflows): Add Docker build step`         |
| `perf`     | Performance improvements                | `perf(frontend): Lazy load images`             |
| `revert`   | Revert previous commit                  | `revert(api): Revert "Add caching layer"`      |
| `deploy`   | Deployment-related changes              | `deploy(firebase): Update hosting config`      |

---

## Allowed Scopes

### Frontend & UI

| Scope      | Usage                 |
| ---------- | --------------------- |
| `frontend` | React/Vite/UI changes |
| `docs`     | Documentation         |

### Backend & Services

| Scope      | Usage                        |
| ---------- | ---------------------------- |
| `backend`  | Python/API/services          |
| `python`   | Python code                  |
| `api`      | API endpoints/integration    |
| `database` | Database changes             |
| `auth`     | Authentication/authorization |

### Infrastructure & DevOps

| Scope            | Usage                                         |
| ---------------- | --------------------------------------------- |
| `infrastructure` | VPS/Kubernetes/Helm                           |
| `deployment`     | Deployment configs                            |
| `workflows`      | GitHub Actions                                |
| `ci`             | CI/CD pipelines (deprecated, use `workflows`) |
| `docker`         | Docker/containers                             |
| `secrets`        | Secrets management                            |

### Cloud Providers

| Scope      | Usage             |
| ---------- | ----------------- |
| `firebase` | Firebase services |
| `azure`    | Azure-specific    |
| `aws`      | AWS-specific      |
| `gcp`      | GCP-specific      |

### Platform Services

| Scope        | Usage                    |
| ------------ | ------------------------ |
| `vps`        | VPS-specific             |
| `n8n`        | n8n workflows            |
| `wikijs`     | Wiki.js content          |
| `traefik`    | Traefik proxy            |
| `monitoring` | Observability/monitoring |

### Tools & Frameworks

| Scope       | Usage           |
| ----------- | --------------- |
| `github`    | GitHub-specific |
| `terraform` | Terraform IaC   |
| `finops`    | FinOps-related  |

### Scope Formatting

- **Must be kebab-case** (lowercase with hyphens)
- ✅ `multi-word-scope`
- ❌ `multiWordScope`
- ❌ `Multi-Word-Scope`

---

## Body (Optional)

### Rules

- **Leading blank line REQUIRED** between header and body
- **Maximum 100 characters per line**
- Use for explaining:
  - What changed and why
  - Implementation details
  - Context for reviewers
  - Breaking changes (detailed)

### Formatting

- Use bullet points (`-`) for lists
- Use paragraphs for detailed explanations
- Keep lines under 100 characters

### Example

```
feat(auth): Add multi-factor authentication

Implement TOTP-based MFA using Google Authenticator protocol.
Add QR code generation for easy setup.
Store encrypted backup codes in user preferences.

Users can enable MFA in account settings.
Admins can enforce MFA for all users via security policy.
```

---

## Footer (Optional)

### Rules

- **Leading blank line REQUIRED** between body and footer
- Use for:
  - **Breaking changes**: `BREAKING CHANGE: Description`
  - **Issue references**: `Fixes #123`, `Closes #456`, `Resolves #789`
  - **Co-authors**: `Co-authored-by: Name <email>`
  - **Related issues**: `Related to #123`

### Examples

**Breaking Change:**

```
BREAKING CHANGE: API endpoints now require authentication.
All unauthenticated requests will return 401 Unauthorized.
```

**Issue References:**

```
Fixes #892
Closes #901
```

**Co-authoring:**

```
Co-authored-by: Jane Doe <jane@example.com>
```

---

## Complete Examples

### Minimal (Header Only)

```
chore(frontend): Update typography and add provider palettes
```

### With Body

```
fix(api): Resolve race condition in payment processing

The payment webhook handler was processing duplicate events.
Add idempotency key validation to prevent double charges.
Implement transaction locking for concurrent requests.
```

### With Body and Footer

```
feat(database): Add soft delete functionality

Implement soft delete pattern for user accounts.
Add `deleted_at` timestamp column to users table.
Update queries to filter out soft-deleted records.
Add admin endpoint to permanently delete accounts.

Closes #567
```

### Breaking Change

```
refactor(api): Migrate to REST API v2

Update all endpoints to follow RESTful conventions.
Remove deprecated `/api/v1` endpoints.
Add comprehensive OpenAPI documentation.
Update error responses to use RFC 7807 Problem Details.

BREAKING CHANGE: All API endpoints moved from `/api/v1/*` to
`/api/v2/*`. Previous v1 endpoints are no longer supported.
Clients must update their base URL and error handling.

Fixes #1234
```

### Multiple Components

```
feat(auth): Add OAuth2 and session management

Implement OAuth2 authorization code flow with PKCE.
Add refresh token rotation for enhanced security.
Implement session management with Redis backend.
Add device tracking and management UI.

Users can now log in with Google, GitHub, or Microsoft.
Session tokens expire after 7 days of inactivity.
Users can revoke access from settings page.

Closes #445
Closes #446
Related to #447
```

---

## Common Mistakes to Avoid

### ❌ Incorrect: Lowercase subject

```
chore(frontend): update typography system
```

**Error:** `subject must be sentence-case`

### ❌ Incorrect: Trailing period

```
chore(frontend): Update typography system.
```

**Error:** `subject-full-stop`

### ❌ Incorrect: Missing scope

```
chore: Update typography system
```

**Error:** `scope-empty`

### ❌ Incorrect: Invalid scope

```
chore(front-end): Update typography system
```

**Error:** `scope must be one of [frontend, backend, ...]`

### ❌ Incorrect: Body without blank line

```
chore(frontend): Update typography system
Remove deprecated fonts.
```

**Error:** `body-leading-blank`

### ❌ Incorrect: Line too long (>100 chars)

```
chore(frontend): Update typography system

Remove deprecated fonts (Genos, Aptos) and replace with professional alternatives including Inter and Segoe UI Semibold.
```

**Error:** `body-max-line-length`

### ❌ Incorrect: Footer without blank line

```
feat(auth): Add OAuth2 support

Implement OAuth2 protocol.
Fixes #123
```

**Error:** `footer-leading-blank`

---

## Validation

### Automated Enforcement

Commits are validated automatically via:

- **Husky**: Git hooks (pre-commit, commit-msg)
- **Commitlint**: Conventional commit validation
- **Configuration**: [`.commitlintrc.json`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/.commitlintrc.json)

### If Validation Fails

You'll see an error like:

```
✖   subject must be sentence-case [subject-case]
✖   found 1 problems, 1 warnings

husky - commit-msg script failed (code 1)
```

**To fix:**

1. Check the error message for specific rule violations
2. Amend your commit message: `git commit --amend`
3. Follow the format rules exactly
4. Try again

---

## Quick Reference Template

Copy this template for quick commits:

```bash
# Simple commit
git commit -m "type(scope): Subject in sentence-case"

# With body
git commit -m "type(scope): Subject in sentence-case

Detailed explanation of what changed.
Why the change was needed.
How it impacts the system.

Fixes #123"
```

---

## Configuration Reference

### `.commitlintrc.json`

```json
{
  "extends": ["@commitlint/config-conventional"],
  "rules": {
    "type-enum": [2, "always", [...]],
    "scope-enum": [2, "always", [...]],
    "scope-case": [2, "always", "kebab-case"],
    "subject-case": [2, "always", "sentence-case"],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 100],
    "body-leading-blank": [1, "always"],
    "body-max-line-length": [2, "always", 100],
    "footer-leading-blank": [1, "always"]
  }
}
```

### Rule Severity Levels

- `0` = disabled
- `1` = warning (allows commit)
- `2` = error (blocks commit)

---

## Best Practices

### DO ✅

- Write clear, descriptive subjects
- Explain "why" in the body, not just "what"
- Reference issues when fixing bugs
- Use imperative mood ("Add feature" not "Added feature")
- Keep commits focused and atomic
- Use breaking change footer when introducing breaking changes

### DON'T ❌

- Write vague subjects like "fix bug" or "update code"
- Exceed character limits
- Mix multiple unrelated changes in one commit
- Skip the scope (it's required)
- Use emojis in commit messages
- Capitalize every word in subject

---

## Related Documentation

- [process-documentation-standards.md](../archive/process-documentation-standards.md)
- [process-handover-guide.md](../archive/process-handover-guide.md)
- review-workflow-audit.md *(historical target unavailable)*
- [Conventional Commits Specification](https://www.conventionalcommits.org/)
- [Commitlint Documentation](https://commitlint.js.org/)

---

**Last validated:** February 12, 2026
**Enforcement:** Active via Husky + Commitlint
**Questions:** Check [readme.md](../archive/legacy-frontend-readme.md) for project guidance
