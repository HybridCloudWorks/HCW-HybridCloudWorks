#!/usr/bin/env node
/**
 * Generate static JSON snapshots of low-churn Firestore collections served
 * directly from public/data/ at runtime. Eliminates per-visitor Firestore
 * reads on the /about page (certifications) and the speaker widget
 * (speakerevents). See F4 in documentation/Firebase-GCP-Cost-Inventory.md.
 *
 * Auth: uses Application Default Credentials.
 *   - Local: `gcloud auth application-default login`
 *   - CI: GOOGLE_APPLICATION_CREDENTIALS pointed at the GCP_SA_KEY JSON
 *
 * Exit codes:
 *   0   wrote both files
 *   0   skipped — no credentials available (build still proceeds)
 *   1   credentials present but a Firestore read failed (build should fail)
 *
 * Output: data is written as { generatedAt, items: [...displaySafeDocs] }.
 * Consumers keep their existing client-side normalizers; only the read path
 * changes.
 */
const fs = require('node:fs');
const path = require('node:path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const COLLECTIONS = [
  {
    name: 'certifications',
    outFile: 'certifications.json',
    sanitize: sanitizeCertification,
  },
  {
    name: 'speakerevents',
    outFile: 'speakerevents.json',
    sanitize: sanitizeSpeakerEvent,
  },
];

const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  'hybridcloudworks-61e8d';

const OUT_DIR = path.join(__dirname, '..', 'public', 'data');

function hasCredentials() {
  // ADC resolves from these in order. The library doesn't expose a "can I
  // auth" probe, so we sniff the env. Local: GOOGLE_APPLICATION_CREDENTIALS
  // or a gcloud login. CI: GOOGLE_APPLICATION_CREDENTIALS via a key file
  // written by the deploy workflow.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  // gcloud ADC well-known location (best-effort sniff)
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    const adcPath = path.join(
      home,
      process.platform === 'win32' ? 'AppData/Roaming' : '.config',
      'gcloud',
      'application_default_credentials.json'
    );
    if (fs.existsSync(adcPath)) return true;
  }
  return false;
}

function serializeValue(value) {
  if (value === null || value === undefined) return value;
  // Firestore Timestamp → ISO string
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  // GeoPoint → { lat, lng }
  if (typeof value === 'object' && value.latitude !== undefined && value.longitude !== undefined) {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serializeValue(v);
    return out;
  }
  return value;
}

function getFirst(data, keys) {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) return data[key];
  }
  return undefined;
}

function isVisible(data) {
  const display = getFirst(data, ['display', 'Display']);
  return display === true;
}

function compactObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null)
  );
}

function sanitizeImageValue(value) {
  if (!value) return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(sanitizeImageValue).filter(Boolean);
  if (typeof value === 'object') {
    return compactObject({
      downloadURL: getFirst(value, ['downloadURL', 'downloadUrl']),
      url: value.url,
      src: value.src,
      link: value.link,
    });
  }
  return undefined;
}

function sanitizeCertification(doc) {
  if (!isVisible(doc)) return null;

  return compactObject({
    id: doc.id,
    name: getFirst(doc, ['name', 'Name']),
    Name: doc.Name,
    issuer: getFirst(doc, ['issuer', 'Issuer']),
    Issuer: doc.Issuer,
    issueDate: getFirst(doc, ['issueDate', 'issue_date', 'IssueDate']),
    expDate: getFirst(doc, ['expDate', 'exp_date', 'ExpDate']),
    certState: getFirst(doc, ['certState', 'isValid', 'is_valid', 'cert_state']),
    code: getFirst(doc, ['code', 'Code']),
    verifyUrl: getFirst(doc, ['verifyUrl', 'verify_url', 'VerifyUrl']),
    image: sanitizeImageValue(getFirst(doc, ['image', 'Image', 'badge', 'Badge'])),
    credentialImage: sanitizeImageValue(
      getFirst(doc, ['credentialImage', 'CredentialImage', 'imageUrl', 'ImageUrl', 'image_url'])
    ),
    displayOrder: getFirst(doc, ['displayOrder', 'display_order', 'DisplayOrder']),
    tags: getFirst(doc, ['tags', 'Tags']),
    display: true,
  });
}

function sanitizeSpeakerEvent(doc) {
  if (!isVisible(doc)) return null;

  return compactObject({
    id: doc.id,
    eventId: getFirst(doc, ['eventId', 'sessionizeId', 'SessionizeId', 'sessionize_id']),
    sessionizeId: getFirst(doc, ['sessionizeId', 'SessionizeId', 'sessionize_id']),
    eventName: getFirst(doc, ['eventName', 'name', 'Name']),
    name: doc.name,
    description: getFirst(doc, ['description', 'Description']),
    date: getFirst(doc, ['date', 'Date']),
    location: getFirst(doc, ['location', 'locationLabel']),
    locationLabel: doc.locationLabel,
    locationCoords: getFirst(doc, ['locationCoords', 'coords', 'coordinates']),
    eventUrl: doc.eventUrl,
    presentationUrl: doc.presentationUrl,
    images: sanitizeImageValue(getFirst(doc, ['images', 'Images'])),
    eventImageUrl: getFirst(doc, ['eventImageUrl', 'imageUrl', 'eventImageURL']),
    display: true,
  });
}

async function dumpCollection(db, { name, outFile, sanitize }) {
  const snap = await db.collection(name).get();
  const items = snap.docs
    .map((doc) => sanitize({ id: doc.id, ...serializeValue(doc.data()) }))
    .filter(Boolean);
  const payload = {
    generatedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
  const outPath = path.join(OUT_DIR, outFile);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  return { name, outFile, count: items.length, bytes: fs.statSync(outPath).size };
}

async function main() {
  if (!hasCredentials()) {
    console.log(
      '[generate-public-data] No GCP credentials available — skipping data dump.\n' +
        '  Local: run `gcloud auth application-default login` to enable.\n' +
        '  Existing public/data/*.json files (if any) will be used as-is.'
    );
    return 0;
  }

  initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore();

  const results = [];
  for (const col of COLLECTIONS) {
    try {
      const r = await dumpCollection(db, col);
      results.push(r);
      console.log(`[generate-public-data] ${r.outFile}: ${r.count} docs, ${r.bytes} bytes`);
    } catch (err) {
      console.error(`[generate-public-data] FAILED ${col.name}:`, err.message);
      throw err;
    }
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[generate-public-data] fatal:', err);
    process.exit(1);
  });
