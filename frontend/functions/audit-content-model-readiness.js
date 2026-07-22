const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

function getFieldValue(documentData, candidates) {
  for (const key of candidates) {
    const value = documentData[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

async function run() {
  const db = admin.firestore();
  const pageSize = 400;

  let cursor = null;
  let scanned = 0;

  const requiredChecks = {
    slug: ['slug', 'Slug'],
    provider: ['cloudProvider', 'Cloud Provider'],
    title: ['Title', 'title'],
    summary: ['Summary', 'summary'],
    body: ['postContent', 'content', 'Content'],
    publishTarget: ['publishTarget'],
    contentStatus: ['contentStatus'],
  };

  const missing = Object.keys(requiredChecks).reduce((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {});

  while (true) {
    let query = db
      .collection('content')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize);
    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const documentSnapshot of snapshot.docs) {
      scanned += 1;
      const data = documentSnapshot.data();

      for (const [fieldName, fieldCandidates] of Object.entries(requiredChecks)) {
        const value = getFieldValue(data, fieldCandidates);
        if (!value) {
          missing[fieldName] += 1;
        }
      }
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < pageSize) break;
  }

  console.warn(JSON.stringify({ scanned, missing }, null, 2));
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
