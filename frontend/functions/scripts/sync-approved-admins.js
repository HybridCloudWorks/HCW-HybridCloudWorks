#!/usr/bin/env node

/**
 * One-time sync script:
 * Mirrors active admins/{uid} registry entries into admins/approved.uids
 * so legacy Firestore rules keep working while custom-claims admin auth is
 * rolled out.
 *
 * Usage:
 *   node functions/scripts/sync-approved-admins.js
 *   node functions/scripts/sync-approved-admins.js --dry-run
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID || 'hybridcloudworks-61e8d';
const isDryRun = process.argv.includes('--dry-run');

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

async function main() {
  const db = admin.firestore();
  const now = new Date();

  const activeAdminsSnap = await db.collection('admins').where('active', '==', true).get();
  const activeAdminUids = uniqueSorted(activeAdminsSnap.docs.map((doc) => doc.id));

  const approvedRef = db.collection('admins').doc('approved');
  const approvedSnap = await approvedRef.get();
  const existingApprovedUids = uniqueSorted(
    Array.isArray(approvedSnap.data()?.uids) ? approvedSnap.data().uids : []
  );

  const uidsToAdd = activeAdminUids.filter((uid) => !existingApprovedUids.includes(uid));
  const uidsToRemove = existingApprovedUids.filter((uid) => !activeAdminUids.includes(uid));

  const payload = {
    uids: activeAdminUids,
    syncedFrom: 'admins_active_registry',
    syncedAt: now,
    syncedBy: 'sync-approved-admins-script',
    previousUids: existingApprovedUids,
  };

  console.log(`Project: ${projectId}`);
  console.log(`Active admins: ${activeAdminUids.length}`);
  console.log(`Current approved.uids: ${existingApprovedUids.length}`);
  console.log(`Will add: ${uidsToAdd.length}`);
  console.log(`Will remove: ${uidsToRemove.length}`);

  if (uidsToAdd.length > 0) {
    console.log(`Add list: ${uidsToAdd.join(', ')}`);
  }
  if (uidsToRemove.length > 0) {
    console.log(`Remove list: ${uidsToRemove.join(', ')}`);
  }

  if (isDryRun) {
    console.log('Dry run complete. No writes performed.');
    return;
  }

  await approvedRef.set(payload, { merge: true });
  console.log('Sync complete: admins/approved.uids now mirrors active admins registry.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Sync failed:', error?.message || error);
    process.exit(1);
  });
