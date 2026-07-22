const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function firstNonEmpty(data, keys, defaultValue = null) {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return defaultValue;
}

function parseArgs(argv) {
  const parsed = {
    apply: false,
    limit: 500,
    all: false,
    startAfter: '',
  };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--apply') {
      parsed.apply = true;
      continue;
    }

    if (current === '--all') {
      parsed.all = true;
      continue;
    }

    if (current === '--limit' && argv[index + 1]) {
      const parsedLimit = Number(argv[index + 1]);
      if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
        parsed.limit = Math.floor(parsedLimit);
      }
      index += 1;
      continue;
    }

    if (current === '--start-after' && argv[index + 1]) {
      parsed.startAfter = String(argv[index + 1]).trim();
      index += 1;
    }
  }

  return parsed;
}

function buildPatch(data) {
  const title = firstNonEmpty(data, ['Title', 'title'], 'Untitled');
  const summary = firstNonEmpty(data, ['Summary', 'summary'], '');
  const slug = firstNonEmpty(data, ['slug', 'Slug'], slugify(title));
  const cloudProvider = firstNonEmpty(data, ['cloudProvider', 'Cloud Provider'], 'Multi');
  const contentStatus = firstNonEmpty(data, ['contentStatus'], 'ingested');
  const publishTarget = firstNonEmpty(data, ['publishTarget'], 'blog');

  const patch = {};

  if (!data.Title) patch.Title = title;
  if (!data.title) patch.title = title;
  if (!data.Summary && summary) patch.Summary = summary;
  if (!data.summary && summary) patch.summary = summary;
  if (!data.slug && slug) patch.slug = slug;
  if (!data.Slug && slug) patch.Slug = slug;
  if (!data.cloudProvider && cloudProvider) patch.cloudProvider = cloudProvider;
  if (!data['Cloud Provider'] && cloudProvider) patch['Cloud Provider'] = cloudProvider;
  if (!data.contentStatus) patch.contentStatus = contentStatus;
  if (!data.publishTarget) patch.publishTarget = publishTarget;
  if (!data.storageCollection) patch.storageCollection = 'content';
  if (data.Live === undefined) patch.Live = false;

  return patch;
}

function collectUpdates(snapshot) {
  const updates = [];

  for (const documentSnapshot of snapshot.docs) {
    const data = documentSnapshot.data();
    const patch = buildPatch(data);

    if (Object.keys(patch).length > 0) {
      updates.push({ id: documentSnapshot.id, patch });
    }
  }

  return updates;
}

async function applyUpdates(db, updates) {
  const batchSize = 200;
  for (let offset = 0; offset < updates.length; offset += batchSize) {
    const chunk = updates.slice(offset, offset + batchSize);
    const batch = db.batch();

    for (const update of chunk) {
      const documentRef = db.collection('content').doc(update.id);
      batch.update(documentRef, update.patch);
    }

    await batch.commit();
  }
}

async function run() {
  const options = parseArgs(process.argv);
  const db = admin.firestore();
  const pageSize = 400;

  const updates = [];
  const targetLimit = options.all ? Number.MAX_SAFE_INTEGER : options.limit;
  let scanned = 0;
  let lastScannedId = options.startAfter || null;
  let cursor = null;

  while (scanned < targetLimit) {
    const remaining = targetLimit - scanned;
    const currentPageSize = Math.min(pageSize, remaining);

    let query = db
      .collection('content')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(currentPageSize);

    if (cursor) {
      query = query.startAfter(cursor);
    } else if (options.startAfter) {
      query = query.startAfter(options.startAfter);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      break;
    }

    scanned += snapshot.size;
    updates.push(...collectUpdates(snapshot));
    cursor = snapshot.docs[snapshot.docs.length - 1];
    lastScannedId = cursor.id;

    if (snapshot.size < currentPageSize) {
      break;
    }
  }

  if (scanned === 0) {
    console.warn('No content documents found.');
    return;
  }

  console.warn(`Scanned: ${scanned}`);
  console.warn(`Documents needing update: ${updates.length}`);
  if (lastScannedId) {
    console.warn(`Last scanned document ID: ${lastScannedId}`);
  }

  if (!options.apply) {
    console.warn('Dry run only. Re-run with --apply to persist changes.');
    return;
  }

  await applyUpdates(db, updates);

  console.warn(`Applied updates to ${updates.length} documents.`);
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
