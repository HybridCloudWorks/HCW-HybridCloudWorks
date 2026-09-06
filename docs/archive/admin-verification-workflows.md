# Admin Verification Workflows

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


## Purpose

This repo uses three verification tiers for Admin hardening work so routine changes stay cheap to
validate and high-risk changes can opt into deeper checks without turning every deploy into an ops
exercise.

There is no “maintenance mode” switch in this repo. When “maintenance” is mentioned, it means: keep
the required gate fast and always-on, and only opt into the heavier gates when the change justifies
it.

## Required Workflow

Use this for normal admin/frontend/backend changes.

```bash
npm run verify:required
```

What it runs:

- `npm run build`
- `npm run test:admin`

What it covers:

- admin snapshot rendering
- queue/dashboard/ops page regressions
- backend snapshot helper logic
- image ordering logic used by publish/review flows

Why this is the default:

- no emulator startup
- no deploy requirement
- low maintenance
- fast enough to use on every change

## Optional Security Workflow

Use this only when changing:

- `platform/firebase/firestore.rules`
- auth/admin access patterns
- direct Firestore data-access behavior

Current command:

```bash
npm run verify:optional:security
```

What it runs:

- `npm run test:rules` (Firestore emulator-backed rules tests)

What it covers:

- rules enforcement for admin-owned collections
- admin registry allowlist behavior (`admins/approved`)
- confirms `admin_audit_logs` is backend-write-only and client writes are blocked

Notes:

- This workflow starts the Firestore emulator and requires Java.
- This is wired as a PR gate via GitHub Actions so rules/auth changes can’t slip through silently.

## Optional Release Workflow

Use this before larger admin pipeline releases or when changing publish/review UX substantially.

```bash
npm run verify:optional:release
```

What it runs:

- Playwright E2E suite

Use this for:

- release candidate checks
- major workflow changes
- navigation/auth smoke verification

## Live Handler Proof (Deployed Functions)

Use this when you need to prove the deployed Cloud Function handlers accept/deny correctly with a
real Firebase ID token.

```bash
npm run smoke:admin:hardened:token
```

See `documentation/admin-operations-runbook.md` for the exact “copy token from DevTools” steps and
what a `204` preflight means.

## Recommended Usage

For most changes:

```bash
npm run verify:required
```

For security-sensitive changes:

1. Run `npm run verify:required`
2. Decide whether the change justifies emulator-backed rules work
3. If yes, treat that as an explicit follow-up task instead of silently expanding the default
   workflow

For release-oriented changes:

1. Run `npm run verify:required`
2. Run `npm run verify:optional:release`

## Notes

- `npm run test:admin` is the current best signal-to-cost check for Admin hardening.
- The optional security workflow is intentionally not pretending to be implemented.
- The optional release workflow is heavier and should not block normal local iteration.
