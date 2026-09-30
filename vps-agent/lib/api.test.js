/**
 * The agent's only link to the platform (#817).
 *
 * Everything this process may do is these three POSTs, so what they carry is
 * the contract: a bearer token from the certificate credential on every call,
 * the agentId in every body (the server checks it against the token), and a
 * refusal that surfaces as an error with the server's status and message
 * rather than as a job the agent thinks it holds.
 *
 * Node's built-in test runner, like the rest of this package: its lockfile
 * carries one dependency, and a test framework is not worth a second. The
 * credential is injected, so no certificate and no Entra call is involved.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './api.js';

const API = 'https://api.example.test/api';

function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = queue.shift() ?? { status: 200, body: {} };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => {
        if (next.body === undefined) throw new SyntaxError('no body');
        return next.body;
      },
    };
  };
  return { impl, calls };
}

function client({ responses = [], token = 'agent-token' } = {}) {
  const fetch = fakeFetch(responses);
  const scopes = [];
  const api = createApiClient({
    apiBase: API,
    scope: 'api://hcw/.default',
    agentId: 'vps-hostinger-01',
    fetchImpl: fetch.impl,
    credential: {
      getToken: async (scope) => {
        scopes.push(scope);
        return token ? { token } : null;
      },
    },
  });
  return { api, calls: fetch.calls, scopes };
}

describe('every call', () => {
  it('POSTs JSON with a bearer token for the API scope and the agentId in the body', async () => {
    const { api, calls, scopes } = client({ responses: [{ status: 200, body: { ok: true } }] });
    await api.heartbeat({ status: 'idle', activeJobs: 0, hostname: 'h', version: '2.0.0' });

    const [call] = calls;
    assert.equal(call.url, `${API}/agent/heartbeat`);
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers['Content-Type'], 'application/json');
    assert.equal(call.init.headers.Authorization, 'Bearer agent-token');
    assert.deepEqual(scopes, ['api://hcw/.default']);
    assert.deepEqual(call.body, {
      agentId: 'vps-hostinger-01',
      status: 'idle',
      activeJobs: 0,
      hostname: 'h',
      version: '2.0.0',
    });
  });

  it('cannot be made to send a different agentId through a body field', async () => {
    // The spread puts agentId first, so a caller-supplied key could replace
    // it. The three methods pass only named fields, which is what keeps it.
    const { api, calls } = client();
    await api.completeJob({ jobId: 'j1', status: 'succeeded', exitCode: 0, output: 'ok', agentId: 'someone-else' });
    assert.equal(calls[0].body.agentId, 'vps-hostinger-01');
    assert.deepEqual(Object.keys(calls[0].body).sort(), ['agentId', 'exitCode', 'jobId', 'output', 'status']);
  });

  it('refuses to send anything without a token', async () => {
    const { api, calls } = client({ token: null });
    await assert.rejects(api.claimJob(), /failed to acquire an API token/);
    assert.equal(calls.length, 0);
  });

  it('turns a refusal into an error carrying the status and the server message', async () => {
    const { api } = client({ responses: [{ status: 403, body: { error: 'Agent access required' } }] });
    await assert.rejects(api.claimJob(), (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.message, 'Agent access required');
      return true;
    });
  });

  it('names the path and status when a refusal has no readable body', async () => {
    const { api } = client({ responses: [{ status: 502, body: undefined }] });
    await assert.rejects(api.completeJob({ jobId: 'j1', status: 'failed' }), (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.message, 'agent/completeLabJob failed with HTTP 502');
      return true;
    });
  });
});

describe('claimJob', () => {
  it('returns the job the server hands out', async () => {
    const job = { id: 'j1', type: 'terraform-validate', payload: '{}' };
    const { api, calls } = client({ responses: [{ status: 200, body: { job } }] });
    assert.deepEqual(await api.claimJob(), job);
    assert.equal(calls[0].url, `${API}/agent/claimLabJob`);
    assert.deepEqual(calls[0].body, { agentId: 'vps-hostinger-01' });
  });

  it('returns null when there is no job, whether the field is null or absent', async () => {
    const { api } = client({ responses: [{ status: 200, body: { job: null } }, { status: 200, body: {} }] });
    assert.equal(await api.claimJob(), null);
    assert.equal(await api.claimJob(), null);
  });
});
