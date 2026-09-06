# Frontend Routing Guide

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Status:** ✅ Refactored & Verified (February 16, 2026)
**Persona Lead:** CGOA (GitOps) + GDEF (Firebase)
**Last Updated:** February 16, 2026
**Last Verified:** February 16, 2026 - Standalone tools and Header refactor completed
**System State:** Production-Ready | Auth Disabled | Standalone Tools Active

---

## TABLE OF CONTENTS

1. [Current System Verification](#current-system-verification)
2. [Standalone Tools Section](#1-standalone-tools-section)
3. [Route Factory Implementation](#route-factory-implementation)
4. [Auth Removal & Cleanup](#3-auth-removal-cleanup)

---

## QUICK REFERENCE

| Item                   | Value                                                                           |
| ---------------------- | ------------------------------------------------------------------------------- |
| **Route Factory File** | `src/lib/routeFactory.ts` (TypeScript)                                          |
| **Header Component**   | `src/components/shared/Header.jsx`                                              |
| **Main Routing**       | `src/App.jsx`                                                                   |
| **Cloud Providers**    | AWS, Azure, GCP (7 pages each)                                                  |
| **Service Providers**  | GitHub, Terraform, FinOps                                                       |
| **Standalone Tools**   | `/tools/migration`, `/tools/comparison`, `/tools/resources`, `/tools/decisions` |
| **Auth Status**        | ❌ Disabled (Auth components deleted)                                           |
| **Dropdown Behavior**  | Click-to-Toggle (Stabilized)                                                    |

---

## CURRENT SYSTEM VERIFICATION

### System Status: ✅ ALL CHECKS PASSED

**Verification Date:** February 16, 2026
**Verified By:** AGENT (Antigravity)

### 1. Standalone Tools Section

The "Tools" pages have been moved from provider-specific sub-routes to a standalone `/tools/`
segment:

- ✅ `/tools/migration` (Migration Hub)
- ✅ `/tools/comparison` (Pillar Comparison)
- ✅ `/tools/resources` (Resource Comparison)
- ✅ `/tools/decisions` (Decision Matrix)

**Design Decision:**

- **Neutral Theme:** Tools now use a neutral baseline theme rather than inheriting provider colors
  (AWS orange, Azure blue, etc.).
- **Global Accessibility:** Tools are accessible via a dropdown in the header from any major
  provider page or the home page.

### 2. Header Navigation (Refactored)

The header has been significantly updated for stability and clarity:

- **Tools Dropdown:** Shifted from hover-to-open to **click-to-toggle**.
- **Click-Outside Listener:** Automatically closes the dropdown when clicking elsewhere.
- **Login Removal:** The login button and associated Firebase Auth logic have been removed from the
  UI.
- **Right Controls:** Re-centered theme toggle and mobile menu buttons.

### 3. Auth Removal & Cleanup

Following the decision to postpone private/admin management features:

- ✅ `src/components/Auth.jsx` deleted.
- ✅ `src/components/ProtectedRoute.jsx` deleted.
- ✅ `AuthProvider` removed from `main.jsx`.
- ✅ All instances of "Login" button removed from `Header.jsx`.
- ✅ `src/pages/unused/` directory purged of all deprecated pages.

---

## ROUTE FACTORY IMPLEMENTATION

**Route Factory:** `src/lib/routeFactory.ts`

### Static Routes

```typescript
export const staticRoutes = {
  home: '/',
  about: '/about',
  contact: '/contact',
  comparison: '/tools/comparison',
  migration: '/tools/migration',
  resources: '/tools/resources',
  decisions: '/tools/decisions',
} as const;
```

### Provider Routes

Routes are generated dynamically based on the current provider:

- `routes.blog('aws')` → `/aws/blog`
- `routes.rss('azure')` → `/azure/rss`

---

## MIGRATION CHECKLIST (COMPLETED)

- [x] Create standalone `/tools` routes in `App.jsx`
- [x] Refactor `Header.jsx` dropdown logic (Click-to-Toggle)
- [x] Remove Auth components and logic
- [x] Standardize `routeFactory.ts` with static routes
- [x] Clean up `App.jsx` imports and dead code
- [x] Delete `src/pages/unused` contents
- [x] Verify routing parity (AWS, Azure, GCP)

**Overall System Health:** ✅ **PRODUCTION-READY**
