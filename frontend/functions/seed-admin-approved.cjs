/**
 * One-time seed script: creates the /admins/approved document in Firestore.
 * This document is read by the isAdmin() function in firestore.rules to
 * restrict write/delete access on all public content collections.
 *
 * Run once from the functions/ directory with:
 *   node seed-admin-approved.cjs
 *
 * Requires firebase-service-account.json in the project root.
 * Never commit that file.
 */

const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  path.join(__dirname, '../firebase-service-account.json');

try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  console.log('✓ Firebase Admin initialized');
} catch (error) {
  console.error('❌ Error initializing Firebase Admin:', error.message);
  console.log('\nEnsure firebase-service-account.json exists in the project root.');
  process.exit(1);
}

const ADMIN_UIDS = [
  'b9yX4cPkQCVxm5X4yAbvoeVVBS13', // saulpatinojr@gmail.com
];

async function run() {
  const db = admin.firestore();
  const ref = db.collection('admins').doc('approved');

  const existing = await ref.get();
  if (existing.exists) {
    console.log('ℹ️  /admins/approved already exists — merging UIDs.');
    const current = existing.data().uids || [];
    const merged = Array.from(new Set([...current, ...ADMIN_UIDS]));
    await ref.update({ uids: merged });
    console.log('✓ UIDs after merge:', merged);
  } else {
    await ref.set({ uids: ADMIN_UIDS });
    console.log('✓ Created /admins/approved with UIDs:', ADMIN_UIDS);
  }

  console.log('\nDone. Firestore rules isAdmin() check is now active.');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
