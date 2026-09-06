# Admin Operations Runbook

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


This runbook documents the operational habits for running the `/admin/*` portal safely in production
(Firebase Hosting + Cloud Functions + Firestore).

## Definitions

- **Required gate**: fast, always-run local verification.
- **Security gate**: emulator-backed Firestore rules verification.
- **Live handler proof**: hits the deployed Cloud Functions with a real Firebase ID token.

There is no “maintenance mode” toggle in this repo. When we say “maintenance”, we mean: doing the
required gate on every change and only running the heavier gates when the change warrants it.

## Production Checklist (Normal Change)

1. Run the required gate:

```bash
npm run verify:required
```

2. Deploy backend hardening pieces together (when backend/rules changed):

```bash
firebase deploy --only "functions,firestore:rules"
```

3. Smoke the real admin paths against deployed functions (manual UI):

- Editor save
- Unpublish from Published page
- Unpublish from Editor
- Image prompt set save/delete
- Page assignment save
- Audit log creation through backend actions only

## When To Run The Security Gate

Run this when you changed any of the following:

- Firestore rules (`platform/firebase/firestore.rules`)
- Admin authorization patterns (UID allowlist, claims, handler auth checks)
- Any data-access behavior where rules enforcement is critical

Command:

```bash
npm run test:rules
```

Notes:

- This uses the Firestore emulator and requires Java.
- This proves rules enforcement; the required gate proves handler logic and admin UI behavior.

## Live Handler Proof (Deployed Functions)

Use this when you need to prove the deployed handlers accept/deny correctly with a real token.

1. In the browser (on `https://hybridcloudworks.com/admin`), open DevTools → Network.
2. Trigger any admin action that calls a function (Dashboard load is enough).
3. Click the request (for example `getAdminDashboardSnapshot`) and copy the `Authorization` header
   value (the full `Bearer ...` token).
4. In PowerShell:

```powershell
$env:SMOKE_ID_TOKEN = "Bearer <paste token here>"
npm run smoke:admin:hardened:token
```

Expected outcome:

- All calls return `200`.
- If you are not authorized, you should see `403` (this is a good thing when testing lock-down).

### Common Confusions

- **`204` response**: this is the browser’s CORS preflight (`OPTIONS`). It is expected.
- **`[CS] initialized` logs**: these are almost always from a browser extension content-script, not
  the site.
- **`Cross-Origin-Opener-Policy policy would block the window.close call`**: common Firebase Auth
  popup behavior; usually non-fatal.

## Admin Authorization Source Of Truth

Production admin authorization is enforced server-side.

- **Source of truth**: Firestore doc `admins/approved` with field `uids: string[]`.
- Frontend env vars (`VITE_OWNER_ADMIN_EMAIL`, `VITE_OWNER_ADMIN_UID`) are UX-only and must never be
  treated as security. They exist to enable/disable admin access in local/dev builds.

If a deployed admin call returns `403`:

1. Confirm you are signed in with the expected account.
2. Confirm your Firebase Auth `uid` exists in `admins/approved.uids`.
3. Retry with a fresh token (tokens expire).

## Audit Logging

Audit logs must be backend-only:

- Backend handlers create audit events.
- Firestore rules block direct client writes to the audit log collection.
- The UI only reads and displays audit events.
