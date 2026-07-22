#!/usr/bin/env node
/**
 * One-time backfill script: download speaker event images for all existing
 * Firestore documents that already have `eventImageUrl` set but no `images` field.
 *
 * Runs the exact same logic as the Cloud Function locally via Application Default Credentials.
 *
 * Usage (from project root):
 *   node functions/backfill-speaker-images.js
 *
 * Prerequisites:
 *   - firebase-admin installed in functions/ (already done)
 *   - Authenticated locally:
 *       gcloud auth application-default login
 *     OR set GOOGLE_APPLICATION_CREDENTIALS to a service account key JSON path
 */

const admin = require('firebase-admin');
const https = require('https');
const http = require('http');

// CLI output helpers (avoid console lint warnings)
const println = (...args) => process.stdout.write(`${args.join(' ')}\n`);
const errln = (...args) => process.stderr.write(`${args.join(' ')}\n`);

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
          return fetchImage(headers.location, redirectsLeft - 1)
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
    req.setTimeout(20000, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
  });
}

/**
 * Resolves the actual URL string from a Rowy image field value.
 * Rowy stores images as either:
 *   - A plain string URL
 *   - An object: { downloadURL, name, ... }
 *   - An array: [{ downloadURL, name, ... }]
 */
function resolveUrl(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0]?.downloadURL || raw[0]?.url || null;
  if (typeof raw === 'object') return raw.downloadURL || raw.url || null;
  return null;
}

/** Guess a file extension from a Firebase Storage URL filename segment. */
function guessExtFromUrl(url) {
  try {
    // Firebase Storage URLs encode the path — decode it to get the filename
    const match = url.match(/[^/\\&?#]+\.(png|jpe?g|gif|webp|svg|ico|avif)/i);
    if (match) return match[0].split('.').pop().toLowerCase().replace('jpeg', 'jpg');
  } catch {
    /* ignore */
  }
  return 'png';
}

async function processEvent(doc) {
  const data = doc.data();
  const eventId = doc.id;
  const eventImageUrl = resolveUrl(data.eventImageUrl);

  // Skip if no URL at all
  if (!eventImageUrl) return { skipped: 'no eventImageUrl' };

  // Skip if images field is already populated
  const existing = data.images;
  if (Array.isArray(existing) && existing.length > 0 && existing[0]?.downloadURL) {
    return { skipped: 'images already set', url: existing[0].downloadURL };
  }

  const isStorageUrl =
    eventImageUrl.includes('firebasestorage.googleapis.com') ||
    eventImageUrl.includes('storage.googleapis.com');

  if (isStorageUrl) {
    // Already in Firebase Storage — just copy the URL into the images field
    // so the frontend can use the primary images field going forward.
    const ext = guessExtFromUrl(eventImageUrl);
    let imageType;
    if (ext === 'jpg') {
      imageType = 'image/jpeg';
    } else if (ext === 'svg') {
      imageType = 'image/svg+xml';
    } else {
      imageType = `image/${ext}`;
    }
    const imagesField = [
      {
        downloadURL: eventImageUrl,
        name: `event-image.${ext}`,
        type: imageType,
        ref: data.eventImageUrl?.[0]?.ref || data.eventImageUrl?.ref || '',
      },
    ];
    await admin
      .firestore()
      .collection('speakerevents')
      .doc(eventId)
      .update({ images: imagesField });
    return { ok: true, action: 'copied', url: eventImageUrl };
  }

  // External URL — download and store to Firebase Storage
  const { buffer, contentType } = await fetchImage(eventImageUrl);
  const ext = MIME_TO_EXT[contentType] ?? 'png';
  const filename = `event-image.${ext}`;
  const storagePath = `speakerevents/${eventId}/images/${filename}`;

  const file = admin.storage().bucket(BUCKET).file(storagePath);
  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: { sourceUrl: eventImageUrl },
    },
  });

  const encodedPath = encodeURIComponent(storagePath);
  const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media`;

  const imagesField = [
    {
      downloadURL,
      name: filename,
      type: contentType,
      size: buffer.length,
      ref: storagePath,
    },
  ];

  await admin.firestore().collection('speakerevents').doc(eventId).update({ images: imagesField });

  return { ok: true, action: 'downloaded', url: downloadURL, contentType };
}

async function main() {
  println('Fetching speakerevents documents...\n');
  const snap = await admin.firestore().collection('speakerevents').get();
  const { docs } = snap;
  println(`Found ${docs.length} documents.\n`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    const data = doc.data();
    const name = data.name || doc.id;
    const url = resolveUrl(data.eventImageUrl) || '(none)';

    process.stdout.write(`  [${doc.id}] "${name}" — ${url}\n    → `);

    try {
      const result = await processEvent(doc);
      if (result.skipped) {
        println(`skipped (${result.skipped})`);
        skipped++;
      } else {
        const action = result.action === 'copied' ? 'copied existing →' : 'downloaded →';
        println(`✔ ${action} ${result.url}`);
        processed++;
      }
    } catch (err) {
      println(`✗ FAILED: ${err.message}`);
      failed++;
    }
  }

  println(`\nDone. Processed: ${processed} | Skipped: ${skipped} | Failed: ${failed}`);
  process.exit(0);
}

main().catch((err) => {
  errln('Fatal:', err);
  process.exit(1);
});
