/**
 * Labs Platform Functions
 *
 * Backend for the pull-based VPS lab execution platform:
 * - enqueueLabJob: admin (editor) submits a job into the lab_jobs queue
 * - getLabsSnapshot: admin (viewer) dashboard snapshot (agents + jobs + queue depth)
 * - cancelLabJob: admin (editor) cancels a job that is still queued
 *
 * The VPS agent (labs/vps-agent/) authenticates with its own scoped service
 * account and claims jobs directly via the Admin SDK — no inbound ports on the
 * VPS, no client writes to these collections (see firestore.rules).
 *
 * Import and re-export these from index.js.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('./lib/firebase-admin');
const { requireAdminClaims } = require('./lib/admin-auth');

// ── CORS (same policy as cms-functions.js) ───────────────────────────────────

const ADMIN_ALLOWED_ORIGINS = (process.env.CMS_ADMIN_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://hybridcloudworks.com',
  'https://www.hybridcloudworks.com',
  ...ADMIN_ALLOWED_ORIGINS,
];

function applyCors(req, res, allowedMethods = 'POST, OPTIONS') {
  const { origin } = req.headers;
  if (origin) {
    const normalizedOrigin = String(origin).trim().replace(/\/$/, '');
    const allowOrigin =
      ALLOWED_ORIGINS.includes(normalizedOrigin) ||
      /^https:\/\/(www|admin)\.hybridcloudworks\.com$/.test(normalizedOrigin) ||
      /^http:\/\/localhost(?::\d+)?$/i.test(normalizedOrigin);

    if (!allowOrigin) {
      res.status(403).json({ error: 'Origin not allowed' });
      return false;
    }
    res.set('Access-Control-Allow-Origin', normalizedOrigin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', allowedMethods);
  res.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept, Origin'
  );
  res.set('Access-Control-Max-Age', '3600');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return false;
  }
  return true;
}

// ── Server-side job-type allowlist ────────────────────────────────────────────
// Must stay in sync with labs/vps-agent capability config. The payload is
// passed to the agent, which only ever substitutes it into allowlisted
// command templates — raw user strings are NEVER executed.

const LAB_JOB_TYPES = Object.freeze({
  'shell-echo': {
    description: 'Smoke test — echoes the payload back from the sandbox.',
    maxPayloadBytes: 4 * 1024,
  },
  'terraform-validate': {
    description: 'Runs `terraform init -backend=false && terraform validate` on the payload HCL.',
    maxPayloadBytes: 64 * 1024,
  },
  'ansible-check': {
    description: 'Runs `ansible-playbook --syntax-check` on the payload playbook YAML.',
    maxPayloadBytes: 64 * 1024,
  },
});

const JOB_STATUSES = [
  'queued',
  'claimed',
  'running',
  'succeeded',
  'failed',
  'timeout',
  'cancelled',
];

// ── enqueueLabJob (editor) ────────────────────────────────────────────────────

exports.enqueueLabJob = onRequest(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const actor = await requireAdminClaims(req, res, 'editor');
    if (!actor) return;

    const { type, payload = '' } = req.body || {};
    const spec = LAB_JOB_TYPES[type];
    if (!spec) {
      return res.status(400).json({
        error: `Unknown job type. Allowed: ${Object.keys(LAB_JOB_TYPES).join(', ')}`,
      });
    }
    if (typeof payload !== 'string') {
      return res.status(400).json({ error: 'payload must be a string' });
    }
    const payloadBytes = Buffer.byteLength(payload, 'utf8');
    if (payloadBytes > spec.maxPayloadBytes) {
      return res.status(413).json({
        error: `Payload too large (${payloadBytes} bytes; max ${spec.maxPayloadBytes} for ${type})`,
      });
    }

    const db = admin.firestore();
    const docRef = await db.collection('lab_jobs').add({
      type,
      payload,
      status: 'queued',
      requestedBy: actor.uid,
      requestedByEmail: actor.email || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      claimedAt: null,
      finishedAt: null,
      agentId: null,
      exitCode: null,
      output: null,
    });

    logger.info('enqueueLabJob', { jobId: docRef.id, type, by: actor.uid });
    return res.json({ jobId: docRef.id, type, status: 'queued' });
  }
);

// ── getLabsSnapshot (viewer) ──────────────────────────────────────────────────

exports.getLabsSnapshot = onRequest(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (req, res) => {
    if (!applyCors(req, res, 'GET, POST, OPTIONS')) return;

    const actor = await requireAdminClaims(req, res, 'viewer');
    if (!actor) return;

    const db = admin.firestore();
    const STALE_AFTER_MS = 90 * 1000; // 3 missed 30s heartbeats
    const now = Date.now();

    const [agentsSnap, recentJobsSnap, queuedSnap] = await Promise.all([
      db.collection('lab_agents').get(),
      db.collection('lab_jobs').orderBy('createdAt', 'desc').limit(25).get(),
      db.collection('lab_jobs').where('status', '==', 'queued').count().get(),
    ]);

    const agents = agentsSnap.docs.map((d) => {
      const data = d.data();
      const lastSeenMs = data.lastSeenAt?.toMillis ? data.lastSeenAt.toMillis() : 0;
      return {
        agentId: d.id,
        hostname: data.hostname || null,
        version: data.version || null,
        capabilities: data.capabilities || [],
        status: data.status || 'unknown',
        lastSeenAt: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
        online: lastSeenMs > 0 && now - lastSeenMs < STALE_AFTER_MS,
      };
    });

    const jobs = recentJobsSnap.docs.map((d) => {
      const data = d.data();
      const toIso = (ts) => (ts?.toDate ? ts.toDate().toISOString() : null);
      return {
        id: d.id,
        type: data.type,
        status: data.status,
        requestedByEmail: data.requestedByEmail || null,
        agentId: data.agentId || null,
        exitCode: data.exitCode ?? null,
        createdAt: toIso(data.createdAt),
        claimedAt: toIso(data.claimedAt),
        finishedAt: toIso(data.finishedAt),
      };
    });

    return res.json({
      agents,
      jobs,
      queueDepth: queuedSnap.data().count,
      jobTypes: Object.entries(LAB_JOB_TYPES).map(([type, spec]) => ({
        type,
        description: spec.description,
        maxPayloadBytes: spec.maxPayloadBytes,
      })),
      statuses: JOB_STATUSES,
      generatedAt: new Date().toISOString(),
    });
  }
);

// ── cancelLabJob (editor) ─────────────────────────────────────────────────────

exports.cancelLabJob = onRequest(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const actor = await requireAdminClaims(req, res, 'editor');
    if (!actor) return;

    const jobId = String(req.body?.jobId || '').trim();
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });

    const db = admin.firestore();
    const jobRef = db.collection('lab_jobs').doc(jobId);

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(jobRef);
        if (!snap.exists) throw new Error('NOT_FOUND');
        if (snap.data().status !== 'queued') throw new Error('NOT_QUEUED');
        tx.update(jobRef, {
          status: 'cancelled',
          finishedAt: admin.firestore.FieldValue.serverTimestamp(),
          cancelledBy: actor.uid,
        });
      });
    } catch (err) {
      if (err.message === 'NOT_FOUND') return res.status(404).json({ error: 'Job not found' });
      if (err.message === 'NOT_QUEUED') {
        return res.status(409).json({ error: 'Job is no longer queued and cannot be cancelled' });
      }
      logger.error('cancelLabJob failed', { jobId, error: err.message });
      return res.status(500).json({ error: 'Cancel failed' });
    }

    logger.info('cancelLabJob', { jobId, by: actor.uid });
    return res.json({ jobId, status: 'cancelled' });
  }
);
