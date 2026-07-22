/**
 * HCW Labs VPS Agent
 *
 * Pull-based job executor. No inbound ports — the agent dials out to
 * Firestore, listens for queued lab_jobs matching its capabilities,
 * claims them atomically, runs them in sandboxed Docker containers
 * (see lib/docker-runner.js), and writes results back.
 *
 * Configuration via environment (see .env.example).
 */

const os = require('os');
const admin = require('firebase-admin');
const { CAPABILITIES } = require('./lib/capabilities');
const { runInDocker, OUTPUT_CAP_BYTES } = require('./lib/docker-runner');

const AGENT_VERSION = require('./package.json').version;

// ── Config ────────────────────────────────────────────────────────────────────

const config = {
  serviceAccountPath: process.env.LABS_AGENT_SERVICE_ACCOUNT,
  agentId: process.env.LABS_AGENT_ID || os.hostname(),
  heartbeatIntervalMs: 30 * 1000,
  pollFallbackIntervalMs: Number(process.env.LABS_AGENT_POLL_MS || 15000),
  maxConcurrentJobs: Number(process.env.LABS_AGENT_MAX_CONCURRENT || 1),
  limits: {
    memory: process.env.LABS_AGENT_JOB_MEMORY || '256m',
    cpus: process.env.LABS_AGENT_JOB_CPUS || '0.5',
    pidsLimit: Number(process.env.LABS_AGENT_JOB_PIDS || 128),
  },
  // Comma-separated subset of CAPABILITIES this host advertises; default all.
  capabilities: (process.env.LABS_AGENT_CAPABILITIES || Object.keys(CAPABILITIES).join(','))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && CAPABILITIES[s]),
};

if (!config.serviceAccountPath) {
  console.error('LABS_AGENT_SERVICE_ACCOUNT is required (path to service account JSON).');
  process.exit(1);
}
if (config.capabilities.length === 0) {
  console.error('No valid capabilities configured. Check LABS_AGENT_CAPABILITIES.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(require('path').resolve(config.serviceAccountPath))),
});
const db = admin.firestore();

const log = (...args) => console.log(new Date().toISOString(), `[${config.agentId}]`, ...args);

// ── Heartbeat ─────────────────────────────────────────────────────────────────

let activeJobs = 0;
let shuttingDown = false;

async function sendHeartbeat(status = 'idle') {
  try {
    await db.collection('lab_agents').doc(config.agentId).set(
      {
        agentId: config.agentId,
        hostname: os.hostname(),
        version: AGENT_VERSION,
        capabilities: config.capabilities,
        status: activeJobs > 0 ? 'busy' : status,
        activeJobs,
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    log('heartbeat failed:', err.message);
  }
}

// ── Job claiming + execution ──────────────────────────────────────────────────

/** Atomically claim a queued job. Returns job data or null if lost the race. */
async function claimJob(jobRef) {
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      if (!snap.exists || snap.data().status !== 'queued') return null;
      tx.update(jobRef, {
        status: 'claimed',
        agentId: config.agentId,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { id: snap.id, ...snap.data() };
    });
  } catch (err) {
    log('claim transaction failed:', err.message);
    return null;
  }
}

async function executeJob(job) {
  const jobRef = db.collection('lab_jobs').doc(job.id);
  const capability = CAPABILITIES[job.type];
  activeJobs += 1;
  log(`running job ${job.id} (${job.type})`);

  try {
    await jobRef.update({ status: 'running' });

    const payload = typeof job.payload === 'string' ? job.payload : '';
    const result = await runInDocker(capability, payload, config.limits);

    const finalStatus = result.timedOut ? 'timeout' : result.exitCode === 0 ? 'succeeded' : 'failed';
    await jobRef.update({
      status: finalStatus,
      exitCode: result.exitCode,
      output: String(result.output || '').slice(0, OUTPUT_CAP_BYTES),
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    log(`job ${job.id} -> ${finalStatus} (exit ${result.exitCode})`);
  } catch (err) {
    log(`job ${job.id} errored:`, err.message);
    await jobRef
      .update({
        status: 'failed',
        exitCode: -1,
        output: `agent error: ${err.message}`.slice(0, OUTPUT_CAP_BYTES),
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      .catch(() => {});
  } finally {
    activeJobs -= 1;
    sendHeartbeat();
  }
}

async function tryPickupJobs(docs) {
  for (const doc of docs) {
    if (shuttingDown || activeJobs >= config.maxConcurrentJobs) return;
    const data = doc.data();
    if (data.status !== 'queued') continue;
    if (!config.capabilities.includes(data.type)) continue; // not ours
    if (!CAPABILITIES[data.type]) continue; // defense in depth: allowlist only

    const claimed = await claimJob(doc.ref);
    if (claimed) executeJob(claimed); // intentionally not awaited (concurrency)
  }
}

// ── Main loop: realtime listener + polling fallback ──────────────────────────

function start() {
  log(`agent v${AGENT_VERSION} starting; capabilities: ${config.capabilities.join(', ')}`);

  const queuedQuery = db
    .collection('lab_jobs')
    .where('status', '==', 'queued')
    .where('type', 'in', config.capabilities.slice(0, 10)) // Firestore 'in' limit
    .orderBy('createdAt', 'asc')
    .limit(10);

  // Realtime listener — primary pickup path.
  queuedQuery.onSnapshot(
    (snap) => tryPickupJobs(snap.docs),
    (err) => log('listener error (polling fallback continues):', err.message)
  );

  // Polling fallback in case the listener stalls.
  setInterval(async () => {
    if (shuttingDown || activeJobs >= config.maxConcurrentJobs) return;
    try {
      const snap = await queuedQuery.get();
      await tryPickupJobs(snap.docs);
    } catch (err) {
      log('poll failed:', err.message);
    }
  }, config.pollFallbackIntervalMs);

  sendHeartbeat('idle');
  setInterval(() => sendHeartbeat(), config.heartbeatIntervalMs);
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received; finishing active jobs (${activeJobs})...`);
  await sendHeartbeat('stopping');
  const deadline = Date.now() + 60_000;
  while (activeJobs > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  await db
    .collection('lab_agents')
    .doc(config.agentId)
    .set({ status: 'offline', lastSeenAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    .catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
