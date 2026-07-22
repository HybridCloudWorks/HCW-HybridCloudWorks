#!/usr/bin/env node
const admin = require('firebase-admin');
const projectId = process.env.FIREBASE_PROJECT_ID || 'hybridcloudworks-61e8d';
if (!admin.apps.length) admin.initializeApp({ projectId });
admin
  .firestore()
  .collection('mcp_servers')
  .doc('plaud')
  .set(
    { status: 'connected', lastConnectedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  )
  .then(() => {
    console.log('plaud status=connected');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
