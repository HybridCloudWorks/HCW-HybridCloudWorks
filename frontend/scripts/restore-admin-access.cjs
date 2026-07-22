/**
 * Emergency script: restores admin access for the site owner.
 *
 * This is needed when Firebase custom claims are cleared/lost while the
 * Firestore admins document still exists (or vice versa), leaving the
 * owner locked out via the "Bootstrap" button (chicken-and-egg problem).
 *
 * What it does:
 *   1. Writes/merges the admins/{uid} Firestore document (marks active: true)
 *   2. Sets the Firebase custom claims { adminRole, permissions } on the token
 *
 * Run once with:
 *   node scripts/restore-admin-access.cjs
 *
 * Requires firebase-service-account.json in the project root.
 * Never commit that file.
 *
 * After running, sign out and sign back in on the site so Firebase issues a
 * fresh ID token containing the restored custom claims.
 */

const admin = require('firebase-admin');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const OWNER_UID = 'b9yX4cPkQCVxm5X4yAbvoeVVBS13'; // saulpatinojr@gmail.com
const OWNER_EMAIL = 'saulpatinojr@gmail.com';
const ROLE = 'super_admin';

const PERMISSIONS = [
  'read:content',
  'read:dashboard',
  'write:content',
  'review:content',
  'publish:content',
  'manage:admins',
  'manage:settings',
];
// ───────────────────────────────────────────────────────────────────────────

const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  path.join(__dirname, '../firebase-service-account.json');

try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  console.log('✓ Firebase Admin initialized');
} catch (err) {
  console.error('❌ Error initializing Firebase Admin:', err.message);
  console.log('\nEnsure firebase-service-account.json exists in the project root.');
  process.exit(1);
}

async function run() {
  const db = admin.firestore();
  const auth = admin.auth();

  // Verify the user exists in Firebase Auth
  let userRecord;
  try {
    userRecord = await auth.getUser(OWNER_UID);
    console.log(`✓ Found user: ${userRecord.email} (${userRecord.uid})`);
  } catch (err) {
    console.error(`❌ User not found in Firebase Auth: ${err.message}`);
    process.exit(1);
  }

  const now = new Date();
  const existingClaims = userRecord.customClaims || {};

  // 1. Update Firestore admins/{uid} document
  const docRef = db.collection('admins').doc(OWNER_UID);
  await docRef.set(
    {
      uid: OWNER_UID,
      email: OWNER_EMAIL,
      role: ROLE,
      permissions: PERMISSIONS,
      active: true,
      updatedAt: now,
      updatedBy: 'restore-admin-access-script',
      updateReason: 'Emergency restore: admin access lost, claims re-synced via script',
      customClaims: {
        adminRole: ROLE,
        permissions: PERMISSIONS,
        syncedAt: now,
      },
    },
    { merge: true }
  );
  console.log(`✓ Firestore admins/${OWNER_UID} updated (active: true, role: ${ROLE})`);

  // 2. Set Firebase custom claims
  const nextClaims = {
    ...existingClaims,
    adminRole: ROLE,
    permissions: PERMISSIONS,
  };
  await auth.setCustomUserClaims(OWNER_UID, nextClaims);
  console.log(
    '✓ Firebase custom claims set:',
    JSON.stringify({ adminRole: ROLE, permissions: PERMISSIONS })
  );

  console.log('\n✅ Admin access restored for', OWNER_EMAIL);
  console.log('\nNext steps:');
  console.log('  1. Open the site and sign out completely.');
  console.log('  2. Sign back in with saulpatinojr@gmail.com.');
  console.log('  3. Firebase will issue a fresh ID token with the restored claims.');
  console.log('  4. The admin portal icon should appear in the header.');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
