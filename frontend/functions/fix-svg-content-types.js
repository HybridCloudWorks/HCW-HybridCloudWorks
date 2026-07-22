#!/usr/bin/env node
/**
 * One-time fix: update Firebase Storage Content-Type metadata for SVG cert badge files
 * that were uploaded by Rowy with incorrect 'application/octet-stream' MIME type.
 *
 * Scans database/certifications/** and certifications/** for files with .svg extension
 * and wrong Content-Type, then updates them to image/svg+xml.
 *
 * Usage (from project root):
 *   node functions/fix-svg-content-types.js
 *
 * Prerequisites:
 *   - GOOGLE_APPLICATION_CREDENTIALS set to a service account key JSON path
 *     OR run: gcloud auth application-default login
 */

const admin = require('firebase-admin');

// CLI output helpers (avoid console lint warnings)
const println = (...args) => process.stdout.write(`${args.join(' ')}\n`);
const errln = (...args) => process.stderr.write(`${args.join(' ')}\n`);

admin.initializeApp({ projectId: 'hybridcloudworks-61e8d' });

const BUCKET = 'hybridcloudworks-61e8d.appspot.com';
const PATHS_TO_SCAN = ['database/certifications/', 'certifications/'];

const SVG_MIME = 'image/svg+xml';

async function fixSvgContentTypes() {
  const bucket = admin.storage().bucket(BUCKET);
  let fixed = 0;
  let alreadyCorrect = 0;
  let skipped = 0;

  for (const prefix of PATHS_TO_SCAN) {
    println(`\nScanning: ${prefix}`);
    const [files] = await bucket.getFiles({ prefix });

    if (files.length === 0) {
      println('  (no files found)');
      continue;
    }

    for (const file of files) {
      const { name } = file;
      const isSvg = name.toLowerCase().endsWith('.svg');

      if (!isSvg) {
        skipped++;
        continue;
      }

      const [meta] = await file.getMetadata();
      const currentType = meta.contentType || '';

      if (currentType === SVG_MIME) {
        println(`  ✓ already correct: ${name}`);
        alreadyCorrect++;
        continue;
      }

      process.stdout.write(`  Fixing: ${name}\n    ${currentType} → ${SVG_MIME} ... `);
      await file.setMetadata({ contentType: SVG_MIME });
      println('done');
      fixed++;
    }
  }

  println(
    `\nDone. Fixed: ${fixed} | Already correct: ${alreadyCorrect} | Non-SVG skipped: ${skipped}`
  );
  process.exit(0);
}

fixSvgContentTypes().catch((err) => {
  errln('Fatal:', err);
  process.exit(1);
});
