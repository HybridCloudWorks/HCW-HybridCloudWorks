/**
 * verify-secrets-and-claims.js
 *
 * Verifies two pre-deploy prerequisites:
 *   1. GCP Secret Manager has PUBLER_API_KEY and PUBLER_WORKSPACE_ID
 *   2. saulpatinojr@gmail.com has the adminRole custom claim set
 *
 * Run from the functions/ directory (uses its installed packages):
 *   cd functions && node ../scripts/verify-secrets-and-claims.js
 *
 * Prerequisites:
 *   - Application Default Credentials:  gcloud auth application-default login
 *   - Or GOOGLE_APPLICATION_CREDENTIALS pointing to a service account key
 */

'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { GoogleAuth } = require('google-auth-library');

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'hybridcloudworks-61e8d';

// Init Firebase Admin via ADC — no serviceAccountKey.json required
initializeApp({ projectId: PROJECT_ID });

// ── 1. Check GCP Secret Manager via REST + google-auth-library ───────────────
async function checkSecretManager() {
  console.log('\n── Secret Manager Check ───────────────────────────────────────');

  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();

  const secretsToCheck = ['PUBLER_API_KEY', 'PUBLER_WORKSPACE_ID'];
  let allGood = true;

  for (const secretId of secretsToCheck) {
    const url =
      `https://secretmanager.googleapis.com/v1/` +
      `projects/${PROJECT_ID}/secrets/${secretId}/versions/latest:access`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 404) {
        console.error(`  ❌ ${secretId} — NOT FOUND in Secret Manager`);
        console.error(
          `     Run: firebase functions:secrets:set ${secretId} --project ${PROJECT_ID}`
        );
        allGood = false;
        continue;
      }

      if (!response.ok) {
        console.error(`  ❌ ${secretId} — HTTP ${response.status}: ${await response.text()}`);
        allGood = false;
        continue;
      }

      const data = await response.json();
      const payload = Buffer.from(data.payload.data, 'base64').toString('utf8');

      if (!payload || payload.trim().length === 0) {
        console.error(`  ❌ ${secretId} — exists but payload is empty`);
        allGood = false;
      } else {
        const preview = `${payload.trim().slice(0, 4)}****`;
        console.log(`  ✅ ${secretId} — present (${preview})`);
      }
    } catch (err) {
      console.error(`  ❌ ${secretId} — request failed: ${err.message}`);
      allGood = false;
    }
  }

  return allGood;
}

// ── 2. Check admin custom claims ─────────────────────────────────────────────
async function checkAdminClaims() {
  console.log('\n── Admin Custom Claims Check ──────────────────────────────────');

  const adminEmail = 'saulpatinojr@gmail.com';

  try {
    const user = await getAuth().getUserByEmail(adminEmail);
    const claims = user.customClaims || {};

    console.log(`  User UID:     ${user.uid}`);
    console.log(`  Email:        ${user.email}`);
    console.log(`  Raw claims:   ${JSON.stringify(claims)}`);

    const hasAdminRole =
      claims.adminRole !== null &&
      claims.adminRole !== undefined &&
      String(claims.adminRole).trim() !== '';
    const hasLegacyAdmin = claims.admin === true;
    const hasLegacyRole = claims.role === 'admin';
    const hasLegacyRoles = Array.isArray(claims.roles) && claims.roles.includes('admin');

    console.log('');
    if (hasAdminRole) {
      console.log(`  ✅ adminRole is set: "${claims.adminRole}"`);
      console.log(`     Release 3 bridge removal is SAFE for this account.`);
    } else {
      console.error(`  ❌ adminRole is NOT set`);
      console.error(`     Admin will be locked out after bridge removal (Release 3).`);
      console.error(`     Fix: call setAdminRole Cloud Function for uid=${user.uid}`);
    }

    const legacyFlags = [
      hasLegacyAdmin && 'admin:true',
      hasLegacyRole && 'role:"admin"',
      hasLegacyRoles && 'roles:[admin]',
    ].filter(Boolean);

    if (legacyFlags.length > 0) {
      console.warn(`\n  ⚠️  Legacy claims still present: ${legacyFlags.join(', ')}`);
      console.warn(`     These are handled by the bridge in admin-auth.js.`);
      console.warn(`     They will stop working in Release 3 when the bridge is removed.`);
      console.warn(`     Ensure adminRole is set (above) before proceeding.`);
    } else {
      console.log(`\n  ✅ No legacy claims — token is clean, no bridge dependency.`);
    }

    return hasAdminRole;
  } catch (err) {
    if (err.errorInfo?.code === 'auth/user-not-found') {
      console.error(`  ❌ User not found: ${adminEmail}`);
    } else {
      console.error(`  ❌ Error: ${err.message}`);
    }
    return false;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nPre-deploy verification — project: ${PROJECT_ID}`);
  console.log('='.repeat(60));

  const [secretsOk, claimsOk] = await Promise.all([checkSecretManager(), checkAdminClaims()]);

  console.log('\n── Summary ────────────────────────────────────────────────────');
  console.log(`  Secret Manager:  ${secretsOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Admin claims:    ${claimsOk ? '✅ PASS' : '❌ FAIL'}`);

  if (!secretsOk || !claimsOk) {
    console.log('\n  One or more checks failed. See details above.');
    process.exit(1);
  } else {
    console.log('\n  All checks passed. Safe to proceed with deployment.');
  }
})().catch((err) => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
