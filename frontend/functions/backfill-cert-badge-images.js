#!/usr/bin/env node
/**
 * One-time backfill script: download cert badge images for all existing
 * Firestore certifications documents that have a plain external URL in
 * `imageUrl` but no stored Firebase Storage image in the `image` field yet.
 *
 * Downloads the image → uploads to Firebase Storage →
 * writes `image` field in Rowy array format (priority A in resolveImageUrl).
 *
 * Notes on Credly URLs:
 *   /image.png URLs → downloadable (HTTP 200)
 *   /blob URLs     → blocked by Credly CDN (HTTP 403) — change to /image.png in Firestore
 *
 * Usage (from project root):
 *   GOOGLE_APPLICATION_CREDENTIALS="infrastructure/secrets/credentials/serviceAccountKey.json" \
 *     node functions/backfill-cert-badge-images.js
 */

const admin = require('firebase-admin');
const https = require('https');
const http = require('http');

// CLI output helper (avoid console lint warnings)
const println = (...args) => process.stdout.write(`${args.join(' ')}\n`);

admin.initializeApp({ projectId: 'hybridcloudworks-61e8d' });

const BUCKET = 'hybridcloudworks-61e8d.appspot.com';

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/avif': 'avif',
};

function fetchImage(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0 HybridCloudWorks-Bot/1.0' } },
      (res) => {
        const { statusCode, headers } = res;

        if ([301, 302, 307, 308].includes(statusCode) && headers.location && redirectsLeft > 0) {
          res.resume();
          const nextUrl = headers.location.startsWith('http')
            ? headers.location
            : new URL(headers.location, url).href;
          return fetchImage(nextUrl, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode} fetching ${url}`));
        }

        const rawType = headers['content-type'] || '';
        const contentType = rawType.split(';')[0].trim() || 'image/png';
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error(`Timeout fetching ${url}`)));
  });
}

/** True if val is a plain external URL (not Firebase/GCS Storage). */
function isExternalUrlString(val) {
  if (!val || typeof val !== 'string') return false;
  if (!val.startsWith('http')) return false;
  if (val.includes('firebasestorage.googleapis.com') || val.includes('storage.googleapis.com'))
    return false;
  return true;
}

/** True if the `image` field already has a Firebase Storage URL stored. */
function hasStoredImage(imageField) {
  if (!imageField) return false;
  const entry = Array.isArray(imageField) ? imageField[0] : imageField;
  if (!entry) return false;
  const url = typeof entry === 'object' ? entry.downloadURL || entry.url : entry;
  if (!url || typeof url !== 'string') return false;
  return url.includes('firebasestorage.googleapis.com') || url.includes('storage.googleapis.com');
}

async function processCert(doc) {
  const data = doc.data();
  const certId = doc.id;

  const imageUrl = data.imageUrl || data.ImageUrl || data.image_url;

  if (!imageUrl) return { skipped: 'no imageUrl' };
  if (!isExternalUrlString(imageUrl))
    return { skipped: 'imageUrl is already Storage URL', url: imageUrl };

  // Skip if image field already has a Firebase Storage URL
  if (hasStoredImage(data.image || data.Image)) {
    return {
      skipped: 'image field already set',
      url: (data.image || data.Image)?.[0]?.downloadURL,
    };
  }

  const { buffer, contentType } = await fetchImage(imageUrl);
  const ext = MIME_TO_EXT[contentType] ?? 'png';
  const filename = `badge-image.${ext}`;
  const storagePath = `certifications/${certId}/images/${filename}`;

  const file = admin.storage().bucket(BUCKET).file(storagePath);
  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: { sourceUrl: imageUrl },
    },
  });

  const encodedPath = encodeURIComponent(storagePath);
  const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media`;
  const rowyField = [
    { downloadURL, name: filename, type: contentType, size: buffer.length, ref: storagePath },
  ];

  await admin.firestore().collection('certifications').doc(certId).update({ image: rowyField });

  return { ok: true, url: downloadURL, contentType };
}

async function main() {
  println('Fetching certifications documents...\n');
  const snap = await admin.firestore().collection('certifications').get();
  println(`Found ${snap.docs.length} documents.\n`);

  let processed = 0,
    skipped = 0,
    failed = 0;
  const failedList = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const name = data.name || doc.id;
    const imageUrl = data.imageUrl || data.ImageUrl || data.image_url || '(none)';

    process.stdout.write(`  "${name}"\n    → `);

    try {
      const result = await processCert(doc);
      if (result.skipped) {
        println(`skipped (${result.skipped})`);
        skipped++;
      } else {
        println(`✔ downloaded (${result.contentType}) → ${result.url}`);
        processed++;
      }
    } catch (err) {
      println(`✗ FAILED: ${err.message}`);
      failedList.push({ name, url: imageUrl, error: err.message });
      failed++;
    }
  }

  println(`\nDone. Downloaded: ${processed} | Skipped: ${skipped} | Failed: ${failed}`);

  if (failedList.length > 0) {
    println('\nFailed certs (fix by changing /blob → /image.png in Firestore imageUrl field):');
    failedList.forEach((f) => println(`  "${f.name}"\n    url: ${f.url}\n    error: ${f.error}`));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
