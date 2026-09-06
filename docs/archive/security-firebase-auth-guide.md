!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).

---# Firebase Authentication & Custom Domain Guide

**Version:** 1.1 **Maintainer:** Saul Patino Jr **Status:** Active 🟢

---

## Executive Summary

This guide documents the end-to-end production configuration for Hybrid Cloud Works authentication.
It covers enabling Google Sign-In, configuring GCP OAuth clients for custom domains, linking
Firebase Hosting, and the critical troubleshooting steps for "deleted_client" errors.

---

## 1) Baseline Authentication Setup (Firebase)

### Goal

Enable secure admin sign-in using Google accounts as the foundation for later custom-domain sign-in.

### What we configured

1. In Firebase Console → Authentication → Sign-in method: enabled **Google** provider.
2. Verified admin users exist and validated sign-in in development.
3. Implemented an `AdminAuthGuard` (`src/pages/admin/AdminAuthGuard.jsx`) that checks user
   allowlists and owner UID fallbacks before granting access.

### App-side controls

- Admin email allowlist and owner UID fallback to prevent accidental lockout.
- Normalized email comparisons (trim + lowercase) to avoid casing/alias mismatches.

---

## 2) Admin Authorization Hardening (app changes)

Implemented in code:

- Owner UID fallback and env-driven admin UID list.
- Robust redirect handling (popup-first with redirect fallback) and localStorage flagging to
  preserve redirect state across navigation.
- Browser-local persistence for Firebase Auth to survive tab/session differences.

Files of interest:

- `src/pages/admin/AdminAuthGuard.jsx` — popup-first / redirect fallback, localStorage
  `hcw_auth_redirect_in_progress` flag

---

## 3) Multi-Factor Authentication (SMS) + reCAPTCHA

### Goal

Support MFA-required accounts end-to-end.

### What we implemented

1. Detect `auth/multi-factor-auth-required` and run the multi-factor resolver.
2. Use `RecaptchaVerifier` (invisible) during the SMS challenge to satisfy anti-abuse checks.
3. Provide resend-code support and clear UI indicators that reCAPTCHA/MFA are active.

---

## 4) Creating and wiring a Google OAuth Web client (GCP)

### Why this is required

Firebase can use a Google OAuth client to handle consent and token issuance. If the GCP OAuth client
is deleted or not configured with your custom domain, sign-ins will fail (e.g., `deleted_client`,
`redirect_uri_mismatch`).

### Steps we performed

1. In Google Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth client ID →
   **Web application**.
2. Added Authorized JavaScript origins:

```
https://hybridcloudworks.com
https://www.hybridcloudworks.com
```

3. Added Authorized redirect URIs:

```
https://hybridcloudworks.com/__/auth/handler
https://www.hybridcloudworks.com/__/auth/handler
```

4. Created the client and copied the Client ID and Client Secret.
5. In Firebase Console → Authentication → Sign-in method → Google provider → Edit, pasted the Client
   ID and Secret.

Result: Firebase sign-in no longer returned `deleted_client` and OAuth redirects matched the domain.

---

## 5) Custom Domain Linking and the auth handler

### Goal

Serve `/__/auth/handler` from `https://hybridcloudworks.com` so redirect URIs match and users see
the branded domain during OAuth flows.

### Steps we performed

1. Firebase Console → Hosting → Add custom domain → follow verification steps (DNS TXT verification
   via Search Console).
2. Add the DNS records Firebase provided for the apex and subdomain.
3. Wait for SSL provisioning and confirm `https://hybridcloudworks.com` returns 200.
4. Deploy hosting from the same Firebase project that contains Authentication:

```bash
firebase deploy --only hosting
```

5. Confirm the handler:

```bash
curl -I https://hybridcloudworks.com/__/auth/handler
```

If you get HTTP 404, verify that the hosting site you deployed belongs to the same Firebase project
that owns the OAuth client and Authentication configuration.

---

## 6) UI / Branding changes (for brand verification)

To make the app clearly identifiable for Google's review we made these UI changes:

- Added a visible logo in the header (`src/components/shared/Header.jsx`) and a small logo tile in
  the homepage hero (`src/pages/shared/HomePage.jsx`).
- Moved the “About HybridCloudWorks” section closer to the footer (visible and public) and kept
  Privacy/Terms links prominently centered in the footer (`src/components/shared/Footer.jsx`).
- Added public `privacy-policy` and `terms-of-service` pages linked from the footer.

We also added a Playwright script to capture screenshots used for the brand verification evidence:
`scripts/capture-brand-screenshots.js`.

---

## 7) Google Brand Verification (Production readiness)

Follow Google's production readiness checklist and brand verification flow:

- Official guidance:
  https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification

Required evidence and checks we prepared:

1. Public homepage with clear branding and product description.
2. Public privacy policy link present on the homepage and matching the consent-screen privacy URL.
3. Screenshots of the homepage, privacy page, and OAuth consent screen (Playwright automated
   captures available).
4. Domain ownership verified in Search Console and domain present in Authorized domains for the
   OAuth consent screen.

After submitting the request, monitor the Google Cloud Console for follow-ups and respond with
additional screenshots or clarifications as requested.

---

## 8) Environment and build notes

- The app reads `VITE_FIREBASE_AUTH_DOMAIN` at build-time (`infrastructure/secrets/env/.env` and
  `.env.example`).
- Ensure your production builds are created with the correct
  `VITE_FIREBASE_AUTH_DOMAIN=hybridcloudworks.com` so the runtime Firebase config is set correctly.
- Rebuild and deploy after updating env values:

```bash
npm run build
firebase deploy --only hosting
```

Note: the Firebase SDK obtains the authDomain from the app options provided to `initializeApp` at
runtime; ensure the deployed bundle receives the intended authDomain.

---

## 9) Lessons Learned & Critical Fixes

During the final production push, we identified and resolved several high-impact configuration
issues:

### A) The Web App ID Mismatch

- **Issue**: The application was initially using credentials for a companion app (`rowyApp`) instead
  of the `main` production web app.
- **Fix**: Retrieved the SDK configuration for the correct app using `firebase apps:sdkconfig web`
  and updated the `VITE_FIREBASE_APP_ID` and `VITE_FIREBASE_API_KEY`.

### B) The `deleted_client` Root Cause

- **Issue**: Even after updating the App ID, the `deleted_client` error persisted because the
  internal Firebase Auth provider was still sending an old/deleted Client ID to Google.
- **Fix**: Identified the mismatch by comparing the Client ID in the error URL with the active one
  in GCP. Synchronized the **Web Client ID** and **Web Client Secret** in the Firebase Console
  (Authentication > Settings > Google > Web SDK configuration).

### C) Environment Relocation

- **Issue**: Environment variables were loosely managed in the root directory.
- **Fix**: Centralized production secrets in `infrastructure/secrets/env/.env` and updated
  `vite.config.js` to load from this secure path.

---

## 10) Technical Documentation Resources

We have established a series of refined technical blog posts for future reference:

1.  **Foundation**:
    Enabling Google Sign-In in Firebase *(historical target unavailable)*
2.  **Credentials**:
    Creating a Google OAuth Web Client *(historical target unavailable)*
3.  **Domain**:
    Linking a Custom Domain to Firebase Hosting *(historical target unavailable)*
4.  **Production**:
    Google Brand Verification & Readiness *(historical target unavailable)*

---

## 11) Final Production Checklist (updated)

Before you submit for brand verification or go to production, confirm:

- [ ] OAuth client created in GCP and configured as **Web application**.
- [ ] Authorized JavaScript origins include your custom domain(s) (`https://hybridcloudworks.com`,
      `https://www.hybridcloudworks.com`).
- [ ] Redirect URIs include `https://hybridcloudworks.com/__/auth/handler` (and `www` variant as
      needed).
- [ ] Firebase Auth Google provider is wired to the new Client ID/Secret.
- [ ] Custom domain verified in Search Console and added to Firebase Hosting (same project as Auth).
- [ ] Production `VITE_FIREBASE_AUTH_DOMAIN` is set to your custom domain and used during
      build/deploy.
- [ ] Homepage, privacy policy, and terms pages are public and linked from your consent screen
      fields.
- [ ] Playwright screenshot evidence captured and packaged for the Google review
      (`scripts/capture-brand-screenshots.js`).
- [ ] Test sign-in flows: popup flow, redirect flow, MFA scenarios, and cleared-cookie edge cases.

---

## 10) Troubleshooting (common issues)

1. `deleted_client` — Recreate or sync the OAuth client in GCP and precisely paste the client
   ID/secret into the **Firebase Console Web SDK configuration** (Sign-in method → Google).
2. `redirect_uri_mismatch` — ensure the OAuth client redirect URIs exactly match the domain that
   serves `/__/auth/handler`.
3. 404 from `/__/auth/handler` — hosting is not linked to the same Firebase project; re-deploy
   hosting from the project that owns Auth.
4. Missing `state` after redirect — ensure you persist redirect state (we set
   `hcw_auth_redirect_in_progress` in localStorage and used browser-local persistence for Firebase
   Auth).
5. "Firebase not configured" build error — Ensure the build environment has access to the `.env`
   file in the `infrastructure/secrets/env/` path.

---

## 11) Recommended follow-ups

- Automate periodic smoke tests for sign-in and rotate OAuth client secrets on a schedule.
- Keep a runbook with links to GCP OAuth client, Firebase project settings, and domain DNS records.
- When moving to production, consider enabling Identity Platform for enterprise-grade features if
  needed.

---

## 12) Current Live Public URLs (for review evidence)

- Homepage: `https://hybridcloudworks.com/`
- Privacy Policy: `https://hybridcloudworks.com/privacy-policy`
- Terms of Service: `https://hybridcloudworks.com/terms-of-service`
