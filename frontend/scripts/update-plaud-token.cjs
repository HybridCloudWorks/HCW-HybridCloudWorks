#!/usr/bin/env node
/**
 * Pushes the local Plaud MCP OAuth token into Firestore mcp_servers/plaud.
 * Reads token from ~/.plaud/tokens-mcp.json.
 *
 * Usage:
 *   node scripts/update-plaud-token.cjs
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID || 'hybridcloudworks-61e8d';
const tokenPath = path.join(os.homedir(), '.plaud', 'tokens-mcp.json');

if (!fs.existsSync(tokenPath)) {
  console.error(`Token file not found: ${tokenPath}`);
  process.exit(1);
}

const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
if (!tokens.access_token) {
  console.error('No access_token in token file');
  process.exit(1);
}

if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

(async () => {
  const ref = db.collection('mcp_servers').doc('plaud');
  await ref.set(
    {
      oauthToken: tokens.access_token,
      oauthRefreshToken: tokens.refresh_token || null,
      oauthExpiresAt: tokens.expires_at || null,
      status: 'untested',
      lastTokenUpdate: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  console.log(`Updated mcp_servers/plaud (token length ${tokens.access_token.length})`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
