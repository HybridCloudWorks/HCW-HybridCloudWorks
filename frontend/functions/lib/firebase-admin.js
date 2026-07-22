const admin = require('firebase-admin');
const { initializeFirestore } = require('firebase-admin/firestore');

if (!admin.apps.length) {
  const app = admin.initializeApp();
  initializeFirestore(app, { preferRest: true });
} else {
  try {
    initializeFirestore(admin.app(), { preferRest: true });
  } catch {
    // Firestore may already be initialized in tests or reused module loads.
  }
}

module.exports = admin;
