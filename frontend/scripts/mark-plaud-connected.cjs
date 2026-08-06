#!/usr/bin/env node
const { initializeApp, getApps } = require('firebase-admin/app');
const { FieldValue } = require('firebase-admin/firestore');
const projectId = process.env.FIREBASE_PROJECT_ID || 'hybridcloudworks-61e8d';
if (!getApps().length) initializeApp({ projectId });
admin
  .firestore()
  .collection('mcp_servers')
  .doc('plaud')
  .set(
    { status: 'connected', lastConnectedAt: FieldValue.serverTimestamp() },
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
