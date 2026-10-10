/**
 * The lab canary (#1009, item 2): one real job, run end to end, and never a
 * job left behind.
 *
 * The load-bearing assertions: it passes only when an agent claimed the job,
 * ran it and echoed the exact payload; it enqueues nothing when no agent could
 * run it; a job still queued at the deadline is cancelled and deleted under
 * its ETag, and one claimed is left to finish and cleaned up by a later run;
 * every write after a read is guarded; and its log lines carry no id.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  CANARY_ABANDON_GRACE_MS,
  CANARY_JOB_TYPE,
  CANARY_POLL_MS,
  CANARY_WAIT_MS,
  LAB_CANARY_DOC_ID,
  canaryJob,
  canaryPayload,
  createLabCanary,
  judgeJob,
} from './canary.js';
import { CLAIM_LEASE_MS } from '../lab-agent.js';
import { LAB_JOB_TYPES } from '../labs.js';

const START = Date.parse('2026-10-10T12:20:00.000Z');
const JOB_ID = '11111111-2222-4333-8444-555555555555';
const ONLINE = {
  id: 'vps-hostinger-01',
  active: true,
  capabilities: ['shell-echo', 'terraform-validate'],
  status: 'idle',
  lastSeenAt: new Date(START - 10_000).toISOString(),
};

/** A Cosmos double with ETags, by container. */
function store({ agents = [ONLINE], canary = null, jobs = [] } = {}) {
  let etag = 0;
  const tag = () => `"e${(etag += 1)}"`;
  const data = {
    admin_config: new Map(canary ? [[LAB_CANARY_DOC_ID, { ...canary, _etag: tag() }]] : []),
    lab_jobs: new Map(jobs.map((job) => [job.id, { ...job, _etag: tag() }])),
  };
  const s = {
    data,
    readDoc: vi.fn(async (container, id) => {
      const doc = data[container]?.get(id);
      return doc ? { ...doc } : null;
    }),
    createDoc: vi.fn(async (container, doc) => {
      if (data[container].has(doc.id)) throw Object.assign(new Error('exists'), { code: 409 });
      data[container].set(doc.id, { ...doc, _etag: tag() });
      return { ...data[container].get(doc.id) };
    }),
    replaceDocIfMatch: vi.fn(async (container, doc) => {
      const current = data[container].get(doc.id);
      if (!current) throw Object.assign(new Error('gone'), { code: 404 });
      if (current._etag !== doc._etag) throw Object.assign(new Error('changed'), { code: 412 });
      data[container].set(doc.id, { ...doc, _etag: tag() });
      return { ...data[container].get(doc.id) };
    }),
    deleteDocIfMatch: vi.fn(async (container, id, etagRead) => {
      const current = data[container].get(id);
      if (!current) throw Object.assign(new Error('gone'), { code: 404 });
      if (current._etag !== etagRead) throw Object.assign(new Error('changed'), { code: 412 });
      data[container].delete(id);
    }),
    queryDocs: vi.fn(async () => agents),
    /** What an agent does to a job: claim it, then report it. */
    agentWrites(id, fields) {
      const current = data.lab_jobs.get(id);
      data.lab_jobs.set(id, { ...current, ...fields, _etag: tag() });
    },
  };
  return s;
}

/** A clock the sleeps advance, and an agent that acts on the job at given sleeps. */
function harness({ s, script = [] }) {
  let nowMs = START;
  let sleeps = 0;
  const sleep = vi.fn(async (ms) => {
    nowMs += ms;
    sleeps += 1;
    for (const step of script) if (step.at === sleeps) step.act(s);
  });
  const log = { warn: vi.fn(), log: vi.fn() };
  const touchCoderStatus = vi.fn(async () => ({ configured: true }));
  const canary = createLabCanary({
    store: s,
    now: () => new Date(nowMs),
    sleep,
    uuid: () => JOB_ID,
    log,
    touchCoderStatus,
  });
  return { canary, log, sleep, touchCoderStatus, advance: (ms) => (nowMs += ms) };
}

const at = (ms) => new Date(START + ms).toISOString();
const claim = (afterMs) => (s) => s.agentWrites(JOB_ID, { status: 'claimed', agentId: 'vps-hostinger-01', claimedAt: at(afterMs) });
const finish = (afterMs, fields) => (s) => s.agentWrites(JOB_ID, { finishedAt: at(afterMs), ...fields });

describe('the job it runs', () => {
  it('is a shell-echo job the enqueue allowlist accepts, with a tiny fixed payload naming itself', () => {
    expect(CANARY_JOB_TYPE).toBe('shell-echo');
    const job = canaryJob(JOB_ID, at(0));
    expect(LAB_JOB_TYPES[job.type].payloadEncodings).toContain(job.payloadEncoding);
    expect(Buffer.byteLength(job.payload)).toBeLessThan(LAB_JOB_TYPES[job.type].maxPayloadBytes);
    expect(job).toMatchObject({
      id: JOB_ID,
      status: 'queued',
      payload: `hcw-canary ${JOB_ID}`,
      requestedBy: 'lab-canary',
      requestedByEmail: null,
      createdAt: at(0),
      canary: true,
    });
  });

  it('judges a job by its status and its echo, with the claim and run times', () => {
    const base = { createdAt: at(0), claimedAt: at(12_000), finishedAt: at(15_500) };
    const payload = canaryPayload(JOB_ID);
    expect(judgeJob({ ...base, status: 'succeeded', output: `${payload}\n` }, payload)).toEqual({
      ok: true,
      outcome: 'succeeded',
      timings: { claimMs: 12_000, runMs: 3_500 },
      reason: 'the agent ran it and echoed the payload',
    });
    expect(judgeJob({ ...base, status: 'succeeded', output: 'something else' }, payload).outcome).toBe('mismatch');
    expect(judgeJob({ ...base, status: 'failed', exitCode: 125 }, payload)).toMatchObject({
      ok: false,
      outcome: 'failed',
      reason: 'the agent reported failed with exit 125',
    });
    expect(judgeJob({ ...base, status: 'timeout', exitCode: -1 }, payload).outcome).toBe('timeout');
  });
});

describe('a run', () => {
  it('passes when the agent claims, runs and echoes it, then deletes the job and records the timings', async () => {
    const s = store();
    const h = harness({
      s,
      script: [
        { at: 2, act: claim(10_000) },
        { at: 3, act: finish(13_000, { status: 'succeeded', exitCode: 0, output: `hcw-canary ${JOB_ID}\n` }) },
      ],
    });
    const summary = await h.canary.run();

    expect(summary).toEqual({ ok: true, outcome: 'succeeded', claimSeconds: 10, runSeconds: 3, jobLeftInFlight: false });
    expect(s.data.lab_jobs.size).toBe(0);
    expect(s.deleteDocIfMatch).toHaveBeenCalledWith('lab_jobs', JOB_ID, expect.stringMatching(/^"e\d+"$/), JOB_ID);
    expect(s.data.admin_config.get(LAB_CANARY_DOC_ID)).toMatchObject({
      configScope: 'admin_config',
      docType: 'lab_canary',
      jobType: 'shell-echo',
      lastRunAt: at(0),
      lastSuccessAt: at(0),
      lastFailureAt: null,
      consecutiveFailures: 0,
      pendingJobId: null,
      lastResult: { ok: true, outcome: 'succeeded', jobStatus: 'succeeded', timings: { claimMs: 10_000, runMs: 3_000 } },
    });
    expect(h.sleep).toHaveBeenCalledWith(CANARY_POLL_MS);
    expect(h.log.warn).not.toHaveBeenCalled();
    expect(h.touchCoderStatus).toHaveBeenCalledTimes(1);
  });

  it('fails a job that ran and failed, still deleting it, and counts the streak', async () => {
    const s = store({ canary: { id: LAB_CANARY_DOC_ID, consecutiveFailures: 2, lastSuccessAt: at(-3_600_000) } });
    const h = harness({
      s,
      script: [
        { at: 1, act: claim(5_000) },
        { at: 2, act: finish(8_000, { status: 'failed', exitCode: 125, output: 'docker: permission denied' }) },
      ],
    });
    const summary = await h.canary.run();
    expect(summary).toMatchObject({ ok: false, outcome: 'failed' });
    expect(s.data.lab_jobs.size).toBe(0);
    const doc = s.data.admin_config.get(LAB_CANARY_DOC_ID);
    expect(doc).toMatchObject({ consecutiveFailures: 3, lastSuccessAt: at(-3_600_000), lastFailureAt: at(0) });
    // The ETag of the document it read, not a blind upsert.
    expect(s.replaceDocIfMatch).toHaveBeenCalledWith(
      'admin_config',
      expect.objectContaining({ id: LAB_CANARY_DOC_ID, _etag: expect.any(String) }),
      { partitionKey: 'admin_config' }
    );
    expect(h.log.warn).toHaveBeenCalledWith(
      '[labCanary] the end-to-end lab job did not pass (failed); 3 run(s) in a row'
    );
    for (const [line] of h.log.warn.mock.calls) {
      expect(line).not.toContain(JOB_ID);
      expect(line).not.toContain('vps-hostinger-01');
      expect(line).not.toContain('hcw-canary');
    }
  });

  it('cancels and deletes a job nobody claimed by the deadline, each under its ETag', async () => {
    const s = store();
    const h = harness({ s });
    const summary = await h.canary.run();
    expect(summary).toMatchObject({ ok: false, outcome: 'not-claimed', jobLeftInFlight: false });
    expect(s.data.lab_jobs.size).toBe(0);
    const cancel = s.replaceDocIfMatch.mock.calls.find(([container]) => container === 'lab_jobs');
    expect(cancel[1]).toMatchObject({ id: JOB_ID, status: 'cancelled', cancelledBy: 'lab-canary' });
    expect(cancel[2]).toEqual({ partitionKey: JOB_ID });
    expect(h.sleep.mock.calls.length).toBe(CANARY_WAIT_MS / CANARY_POLL_MS);
  });

  it('leaves a job an agent claimed at the last moment to finish, and remembers it', async () => {
    const s = store();
    // The claim lands between the deadline read and the cancel: the cancel's
    // ETag no longer matches, so the job is the agent's.
    s.replaceDocIfMatch.mockImplementationOnce(async () => {
      throw Object.assign(new Error('changed'), { code: 412 });
    });
    const h = harness({ s });
    const summary = await h.canary.run();
    expect(summary).toMatchObject({ ok: false, outcome: 'not-completed', jobLeftInFlight: true });
    expect(s.data.lab_jobs.has(JOB_ID)).toBe(true);
    expect(s.data.admin_config.get(LAB_CANARY_DOC_ID).pendingJobId).toBe(JOB_ID);
  });

  it('leaves a claimed job that did not finish in time, and remembers it', async () => {
    const s = store();
    const h = harness({ s, script: [{ at: 1, act: claim(5_000) }] });
    const summary = await h.canary.run();
    expect(summary).toMatchObject({ outcome: 'not-completed', jobLeftInFlight: true });
    expect(s.data.lab_jobs.get(JOB_ID).status).toBe('claimed');
    expect(s.data.admin_config.get(LAB_CANARY_DOC_ID).pendingJobId).toBe(JOB_ID);
  });

  it('enqueues nothing when no active agent is registered for shell-echo', async () => {
    const s = store({ agents: [{ ...ONLINE, capabilities: ['terraform-validate'] }, { ...ONLINE, id: 'old', active: false }] });
    const h = harness({ s });
    expect(await h.canary.run()).toMatchObject({ ok: false, outcome: 'no-capability' });
    expect(s.createDoc).not.toHaveBeenCalledWith('lab_jobs', expect.anything());
    expect(s.data.lab_jobs.size).toBe(0);
  });

  it('enqueues nothing when the agent that could run it is offline', async () => {
    const s = store({ agents: [{ ...ONLINE, lastSeenAt: at(-10 * 60_000) }] });
    const h = harness({ s });
    expect(await h.canary.run()).toMatchObject({ ok: false, outcome: 'no-agent' });
    expect(s.data.lab_jobs.size).toBe(0);
    expect(h.touchCoderStatus).toHaveBeenCalledTimes(1);
  });
});

describe('a job it cannot follow', () => {
  it('keeps the id of a job it created when reading it fails, and the next run settles that job first', async () => {
    const s = store();
    const realRead = s.readDoc.getMockImplementation();
    // The canary record reads fine; the job read after the create does not.
    s.readDoc.mockImplementation(async (container, id) => {
      if (container === 'lab_jobs') throw Object.assign(new Error(`read ${id} failed`), { code: 503 });
      return realRead(container, id);
    });
    const first = harness({ s });
    expect(await first.canary.run()).toMatchObject({ ok: false, outcome: 'error', jobLeftInFlight: true });
    expect(s.data.lab_jobs.get(JOB_ID).status).toBe('queued');
    expect(s.data.admin_config.get(LAB_CANARY_DOC_ID).pendingJobId).toBe(JOB_ID);
    expect(first.log.warn).toHaveBeenCalledWith(
      '[labCanary] the canary job could not be followed after it was created (503); the next run settles it'
    );
    for (const [line] of first.log.warn.mock.calls) expect(line).not.toContain(JOB_ID);

    // Reads work again: the queued leftover is cancelled and deleted before
    // anything new is enqueued (the harness reuses the id, so a second create
    // while it existed would be a 409).
    s.readDoc.mockImplementation(realRead);
    const second = harness({ s });
    await second.canary.run();
    expect(s.createDoc.mock.calls.filter(([container]) => container === 'lab_jobs')).toHaveLength(2);
    expect(s.data.admin_config.get(LAB_CANARY_DOC_ID).lastResult.outcome).toBe('not-claimed');
    expect(s.data.lab_jobs.size).toBe(0);
  });
});

describe('a run that dies after the job exists', () => {
  it('reserves the id first, so the next run settles the job even when the record could not be written', async () => {
    const s = store();
    const realReplace = s.replaceDocIfMatch.getMockImplementation();
    // The reservation is the record's first write (a create); the run's last
    // write, a replace of the record, fails.
    s.replaceDocIfMatch.mockImplementation(async (container, doc, options) => {
      if (container === 'admin_config') throw Object.assign(new Error('Cosmos is down'), { code: 503 });
      return realReplace(container, doc, options);
    });
    const first = harness({ s, script: [{ at: 1, act: claim(5_000) }] });
    await expect(first.canary.run()).rejects.toMatchObject({ code: 503 });
    // The reservation went in with create, before the job did.
    const order = s.createDoc.mock.calls.map(([container]) => container);
    expect(order).toEqual(['admin_config', 'lab_jobs']);
    expect(s.data.admin_config.get(LAB_CANARY_DOC_ID).pendingJobId).toBe(JOB_ID);
    expect(s.data.lab_jobs.get(JOB_ID).status).toBe('claimed');

    // The agent finishes it; the next run, with the store back, deletes it
    // before anything new is enqueued.
    s.agentWrites(JOB_ID, { status: 'succeeded', exitCode: 0, output: `hcw-canary ${JOB_ID}`, finishedAt: at(9_000) });
    s.replaceDocIfMatch.mockImplementation(realReplace);
    const second = harness({ s });
    await second.canary.run();
    expect(s.data.lab_jobs.size).toBe(0);
    expect(s.data.admin_config.get(LAB_CANARY_DOC_ID).pendingJobId).toBeNull();
  });

  it('enqueues nothing when the reservation cannot be written', async () => {
    const s = store({ canary: { id: LAB_CANARY_DOC_ID, consecutiveFailures: 0 } });
    s.replaceDocIfMatch.mockRejectedValueOnce(Object.assign(new Error('changed'), { code: 412 }));
    const h = harness({ s });
    await expect(h.canary.run()).rejects.toMatchObject({ code: 412 });
    expect(s.createDoc).not.toHaveBeenCalledWith('lab_jobs', expect.anything());
  });

  it('reads a reservation for a job that was never created as gone', async () => {
    const s = store({ canary: { id: LAB_CANARY_DOC_ID, pendingJobId: 'never-created' } });
    const h = harness({ s });
    expect((await h.canary.run()).outcome).toBe('not-claimed');
    expect(s.data.admin_config.get(LAB_CANARY_DOC_ID).pendingJobId).toBeNull();
  });
});

describe('what an earlier run left', () => {
  const leftover = (fields) => ({ id: JOB_ID, type: 'shell-echo', createdAt: at(-3_600_000), ...fields });

  it('deletes it once it has finished, then runs as usual', async () => {
    const s = store({
      canary: { id: LAB_CANARY_DOC_ID, pendingJobId: JOB_ID },
      jobs: [leftover({ status: 'succeeded', claimedAt: at(-3_590_000), finishedAt: at(-3_580_000) })],
    });
    const h = harness({ s });
    // The new run's uuid is the same in this harness, so it can only be
    // enqueued once the leftover is gone.
    const summary = await h.canary.run();
    expect(summary.outcome).toBe('not-claimed');
    expect(s.data.lab_jobs.size).toBe(0);
    expect(s.data.admin_config.get(LAB_CANARY_DOC_ID).pendingJobId).toBeNull();
  });

  it('enqueues nothing while it is still running within the lease, and says so', async () => {
    const s = store({
      canary: { id: LAB_CANARY_DOC_ID, pendingJobId: JOB_ID, consecutiveFailures: 1 },
      jobs: [leftover({ status: 'claimed', claimedAt: at(-60_000) })],
    });
    const h = harness({ s });
    const summary = await h.canary.run();
    expect(summary).toMatchObject({ ok: false, outcome: 'previous-in-flight', jobLeftInFlight: true });
    expect(s.data.lab_jobs.get(JOB_ID).status).toBe('claimed');
    expect(s.data.admin_config.get(LAB_CANARY_DOC_ID)).toMatchObject({ pendingJobId: JOB_ID, consecutiveFailures: 2 });
  });

  it('withdraws one claimed past the lease and the grace: no agent is finishing it', async () => {
    const s = store({
      canary: { id: LAB_CANARY_DOC_ID, pendingJobId: 'old-job' },
      jobs: [
        {
          id: 'old-job',
          type: 'shell-echo',
          status: 'claimed',
          createdAt: at(-CLAIM_LEASE_MS - CANARY_ABANDON_GRACE_MS - 120_000),
          claimedAt: at(-CLAIM_LEASE_MS - CANARY_ABANDON_GRACE_MS - 60_000),
        },
      ],
    });
    const h = harness({ s });
    await h.canary.run();
    expect(s.data.lab_jobs.has('old-job')).toBe(false);
  });
});
