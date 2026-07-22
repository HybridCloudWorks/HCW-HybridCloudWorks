const admin = require('firebase-admin');
const path = require('path');

// CLI output helpers (avoid console lint warnings)
const println = (...args) => process.stdout.write(`${args.join(' ')}\n`);

const serviceAccount = require(
  path.join(__dirname, '../infrastructure/secrets/credentials/serviceAccountKey.json')
);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

async function listCollections() {
  const db = admin.firestore();
  const collections = await db.listCollections();
  println('Available Firestore collections:\n');
  for (const col of collections) {
    const snapshot = await col.limit(3).get();
    println(`📁 ${col.id} (${snapshot.size} sample docs)`);

    snapshot.forEach((doc) => {
      const data = doc.data();
      const title = data.title || data.Title || data.name || data.Name || doc.id;
      println(`   - ${doc.id}: ${title}`);
    });
    println('');
  }
  process.exit(0);
}

listCollections().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
