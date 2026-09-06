# Scripts Directory

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


This directory contains utility scripts used for verification, smoke tests, seeding, and misc ops
tasks.

For production admin operations, prefer the runbooks in `documentation/`:

- `documentation/admin-verification-workflows.md`
- `documentation/admin-operations-runbook.md`

## Common Tasks

### Verification Gates

```bash
npm run verify:required
npm run test:rules
npm run test:e2e
```

### Live Handler Proof (Deployed Functions)

```powershell
$env:SMOKE_ID_TOKEN = "Bearer <paste token here>"
npm run smoke:admin:hardened:token
```

If Google sign-in blocks an automated browser with “This browser or app may not be secure”, use a
normal browser session and copy a fresh `Authorization: Bearer ...` token from DevTools (steps are
in `documentation/admin-operations-runbook.md`).

### AI Readiness (Deployed Functions, Auto Token)

```powershell
npm run readiness:remote:auto
```

This restores admin auth from the stored smoke browser state when available, or falls back to the
dedicated Edge smoke profile and fetches a fresh Firebase ID token before calling the deployed
`aiStackReadiness` function.

If the stored state does not exist yet, capture it once first:

```powershell
npm run smoke:auth:capture
```

### Post-Deploy Smoke

Run quick URL-level checks against hosting and key admin functions after deploy:

```bash
npm run smoke:firebase:postdeploy
```

Optional overrides:

- `FIREBASE_PROJECT_ID` to target a different project
- `SMOKE_BASE_URL` to target a custom hosting URL
- `SMOKE_FUNCTIONS` as comma-separated function names

### Seeding / Data Helpers

- `populate-firestore.cjs`
- `seed-admin-approved.cjs`
