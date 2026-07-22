#!/usr/bin/env node
/**
 * One-time fix: update Firestore certifications documents where imageUrl
 * ends with '/blob' (Credly CDN-blocked) → '/image.png' (accessible).
 *
 * After running this, the downloadCertBadgeImage Cloud Function will
 * automatically trigger and download the badge images.
 *
 * Usage (from project root):
 *   GOOGLE_APPLICATION_CREDENTIALS="infrastructure/secrets/credentials/serviceAccountKey.json" \
 *     node functions/fix-blob-urls.js
 */

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'hybridcloudworks-61e8d' });

async function fixBlobUrls() {
  const db = admin.firestore();
  const snap = await db.collection('certifications').get();

  let fixed = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const name = data.name || doc.id;
    const { imageUrl } = data;

    if (!imageUrl || typeof imageUrl !== 'string') {
      skipped++;
      continue;
    }

    if (!imageUrl.endsWith('/blob')) {
      skipped++;
      continue;
    }

    const newUrl = imageUrl.replace(/\/blob$/, '/image.png');
    process.stdout.write(`  Fixing "${name}"\n    ${imageUrl}\n    → ${newUrl}\n    ... `);

    await doc.ref.update({ imageUrl: newUrl });
    process.stdout.write('done\n');
    fixed++;
  }

  process.stdout.write(`\nDone. Fixed: ${fixed} | Skipped: ${skipped}\n`);
  process.stdout.write(
    '\nThe downloadCertBadgeImage Cloud Function will now auto-trigger for each fixed cert.\n'
  );
  process.exit(0);
}

fixBlobUrls().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
