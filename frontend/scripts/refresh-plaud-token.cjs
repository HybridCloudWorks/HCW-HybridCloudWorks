#!/usr/bin/env node
/**
 * Refreshes the Plaud OAuth token using the refresh_token stored in Firestore
 * mcp_servers/plaud, and writes the new pair back. Mirrors the logic in the
 * scheduled refreshPlaudToken Cloud Function. Useful for one-shot rotation
 * before the schedule fires for the first time.
 */
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const projectId = process.env.FIREBASE_PROJECT_ID || 'hybridcloudworks-61e8d';
const URL = 'https://platform.plaud.ai/developer/api/oauth/third-party/access-token/refresh';

if (!getApps().length) initializeApp({ projectId });

(async () => {
  const ref = getFirestore().collection('mcp_servers').doc('plaud');
  const snap = await ref.get();
  const data = snap.data() || {};
  const rt = data.oauthRefreshToken;
  if (!rt) {
    console.error('No oauthRefreshToken in Firestore.');
    process.exit(1);
  }
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ refresh_token: rt }).toString(),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error('Refresh failed', res.status, body);
    process.exit(1);
  }
  const parsed = JSON.parse(body);
  const expiresInSec = Number(parsed.expires_in) || 86400;
  await ref.set(
    {
      oauthToken: parsed.access_token,
      oauthRefreshToken: parsed.refresh_token || rt,
      oauthExpiresAt: Date.now() + expiresInSec * 1000,
      status: 'connected',
      lastTokenRefresh: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  console.log(
    `Refreshed. access_token len=${parsed.access_token.length} expires_in=${expiresInSec}s`
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
