/* eslint-disable */
// Stage 7 alt-text validation: create a synthetic content doc with images and
// inspectTrigger:true, wait for inspectAndPopulateContent to process, then read
// back imageAltTexts. Requires CONTENTFORGE_ALT_TEXT_ENABLED=true on the
// production function (toggled via `gcloud run services update`).
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
initializeApp({ projectId: 'hybridcloudworks-61e8d' });
const db = getFirestore();

const id = `stage7-alttext-test-${Date.now()}`;
const articleUrl = 'https://aws.amazon.com/blogs/aws/category/artificial-intelligence/';

(async () => {
  console.log('creating', id);
  await db.collection('content').doc(id).set({
    sourceUrl: articleUrl,
    inspectTrigger: true,
    createdAt: FieldValue.serverTimestamp(),
    contentType: 'article',
    title: 'Stage 7 alt-text test',
  });

  console.log('waiting up to 180s for inspection to complete...');
  let last = null;
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const snap = await db.collection('content').doc(id).get();
    last = snap.data();
    if (last && last.inspectTrigger === false) {
      console.log(`  inspected after ~${(i + 1) * 5}s`);
      break;
    }
  }

  if (!last) return console.error('no doc');
  console.log({
    inspectTrigger: last.inspectTrigger,
    hasImageAltTexts: !!last.imageAltTexts,
    altTextKeys: last.imageAltTexts ? Object.keys(last.imageAltTexts).length : 0,
    sampleAlt: last.imageAltTexts ? Object.entries(last.imageAltTexts).slice(0, 2) : null,
    imageCount: Array.isArray(last.images) ? last.images.length : 0,
  });
  console.log('docId:', id);
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
