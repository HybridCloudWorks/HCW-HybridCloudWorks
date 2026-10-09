/**
 * bin/report-coder-automation.js and the function behind it (2026-10-08).
 *
 * The load-bearing assertion is that a token fed on stdin appears in nothing
 * the process writes, on any path: success, a server refusal that quotes it,
 * a thrown error that quotes it, bad input that contains it, and missing
 * configuration. Then the contract the host side builds on: one JSON object
 * in, agentId from configuration, `{"ok":true,"stored":<bool>}` out, the
 * error's class alone on stderr, exit 0 or 1.
 *
 * The function is driven with an injected client, and once through the real
 * lib/api.js with an injected fetch and credential, so the body on the wire
 * is checked too. The bin is spawned for the paths that need no network.
 * Node's built-in test runner, like the rest of this package.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { createApiClient } from './api.js';
import { INPUT_FIELDS, MAX_INPUT_BYTES, parseInput, runReportCoderAutomation } from './report-coder-automation.js';

// Shaped like a Coder key, and plainly not one.
// Built at run time: a literal in Coder's API key shape reads as a leaked
// token to secret scanners (GitGuardian flagged these on #1030).
const TOKEN = ['FAKEKEYID0', 'FAKESECRETFAKESECRET00'].join('-');
const REPORT = { checkedAt: '2026-10-08T04:30:00Z', templateVersion: 'brave_turing4' };
const ENV = {
  LABS_AGENT_API_BASE: 'https://api.example.test/api/',
  LABS_AGENT_TENANT_ID: 'tenant',
  LABS_AGENT_CLIENT_ID: 'client',
  LABS_AGENT_CERT_PATH: '/etc/hcw/labs-agent.pem',
  LABS_AGENT_API_SCOPE: 'api://hcw/.default',
  LABS_AGENT_ID: 'vps-hostinger-01',
};

function sink() {
  const chunks = [];
  return {
    chunks,
    text: () => chunks.join(''),
    write(chunk, callback) {
      chunks.push(String(chunk));
      callback?.();
      return true;
    },
  };
}

/** Run the function with `input` on stdin and a client that does `answer`. */
async function run(input, { answer = async () => ({ ok: true, stored: true }), env = ENV } = {}) {
  const stdout = sink();
  const stderr = sink();
  const calls = [];
  const configs = [];
  const code = await runReportCoderAutomation({
    stdin: Readable.from([Buffer.from(typeof input === 'string' ? input : JSON.stringify(input))]),
    stdout,
    stderr,
    env,
    hostname: () => 'the-hostname',
    createClient: (config) => {
      configs.push(config);
      return {
        reportCoderAutomation: async (body) => {
          calls.push(body);
          return answer(body);
        },
      };
    },
  });
  return { code, stdout: stdout.text(), stderr: stderr.text(), calls, configs };
}

const assertNoToken = (...outputs) => {
  for (const output of outputs) {
    assert.doesNotMatch(output, /FAKESECRET/, 'the token reached an output');
    assert.doesNotMatch(output, /FAKEKEYID0/, 'the token id reached an output');
  }
};

describe('success', () => {
  it('sends the report and the token, and prints {"ok":true,"stored":true} alone', async () => {
    const result = await run({ statusToken: TOKEN, report: REPORT });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '{"ok":true,"stored":true}\n');
    assert.equal(result.stderr, '');
    assert.deepEqual(result.calls, [{ statusToken: TOKEN, report: REPORT }]);
    assertNoToken(result.stdout, result.stderr);
  });

  it('prints stored false for a report with no token, and only the two fields whatever the server adds', async () => {
    const result = await run({ report: REPORT }, { answer: async () => ({ ok: true, stored: false, extra: TOKEN }) });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '{"ok":true,"stored":false}\n');
    assert.deepEqual(result.calls, [{ statusToken: undefined, report: REPORT }]);
  });

  it('builds the client from the agent configuration, the same names as index.js', async () => {
    const { configs } = await run({ report: REPORT });
    assert.equal(configs.length, 1);
    assert.equal(configs[0].apiBase, 'https://api.example.test/api');
    assert.equal(configs[0].agentId, 'vps-hostinger-01');
    assert.equal(configs[0].certificatePath, '/etc/hcw/labs-agent.pem');
    const { LABS_AGENT_ID: _omitted, ...noId } = ENV;
    assert.equal((await run({ report: REPORT }, { env: noId })).configs[0].agentId, 'the-hostname');
  });

  it('puts agentId, the token and the report on the wire through lib/api.js, nothing else', async () => {
    const requests = [];
    const stdout = sink();
    const code = await runReportCoderAutomation({
      stdin: Readable.from([Buffer.from(JSON.stringify({ statusToken: TOKEN, report: REPORT }))]),
      stdout,
      stderr: sink(),
      env: ENV,
      createClient: (config) =>
        createApiClient({
          ...config,
          credential: { getToken: async () => ({ token: 'agent-token' }) },
          fetchImpl: async (url, init) => {
            requests.push({ url, init, body: JSON.parse(init.body) });
            return { ok: true, status: 200, json: async () => ({ ok: true, stored: true }) };
          },
        }),
    });
    assert.equal(code, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.example.test/api/agent/reportCoderAutomation');
    assert.equal(requests[0].init.method, 'POST');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer agent-token');
    assert.deepEqual(requests[0].body, { agentId: 'vps-hostinger-01', statusToken: TOKEN, report: REPORT });
    assert.equal(stdout.text(), '{"ok":true,"stored":true}\n');
  });
});

describe('failure: the class alone on stderr, exit 1, nothing on stdout', () => {
  it('a refusal from the server, even one that quotes the token, prints its HTTP status only', async () => {
    const result = await run(
      { statusToken: TOKEN, report: REPORT },
      {
        answer: async () => {
          throw Object.assign(new Error(`Coder refused ${TOKEN}`), { status: 422 });
        },
      }
    );
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'HTTP 422\n');
    assertNoToken(result.stdout, result.stderr);
  });

  it('a thrown error prints its class, never its text', async () => {
    const result = await run(
      { statusToken: TOKEN, report: REPORT },
      {
        answer: async () => {
          throw new TypeError(`fetch failed while sending ${TOKEN}`);
        },
      }
    );
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'TypeError\n');
    assertNoToken(result.stdout, result.stderr);
  });

  it('a 2xx that does not say ok is not success', async () => {
    const result = await run({ report: REPORT }, { answer: async () => ({ stored: true }) });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'UNEXPECTED_ANSWER\n');
  });

  it('refuses input that is not one JSON object of the two keys, before any client exists', async () => {
    for (const input of [
      `not json ${TOKEN}`,
      `{"statusToken":"${TOKEN}","report":{}} {"report":{}}`,
      JSON.stringify([{ statusToken: TOKEN }]),
      'null',
      JSON.stringify({ agentId: 'someone-else', statusToken: TOKEN, report: REPORT }),
      JSON.stringify({ statusToken: TOKEN, report: REPORT, note: 'x' }),
    ]) {
      const result = await run(input);
      assert.equal(result.code, 1, input);
      assert.equal(result.stderr, 'INVALID_INPUT\n', input);
      assert.equal(result.configs.length, 0, 'a client was built for refused input');
      assertNoToken(result.stdout, result.stderr);
    }
  });

  it('refuses more input than a report could be', async () => {
    const result = await run(JSON.stringify({ report: { lastError: 'x'.repeat(MAX_INPUT_BYTES) } }));
    assert.equal(result.stderr, 'INPUT_TOO_LARGE\n');
    assert.equal(result.calls.length, 0);
  });

  it('refuses to run without the agent configuration, and says MISSING_CONFIG only', async () => {
    const { LABS_AGENT_CERT_PATH: _omitted, ...env } = ENV;
    const result = await run({ statusToken: TOKEN, report: REPORT }, { env });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'MISSING_CONFIG\n');
    assert.equal(result.configs.length, 0);
    assertNoToken(result.stdout, result.stderr);
  });

  it('accepts exactly the route body without agentId', () => {
    assert.deepEqual([...INPUT_FIELDS], ['statusToken', 'report']);
    assert.deepEqual(parseInput('{"report":{"checkedAt":"x"}}'), {
      statusToken: undefined,
      report: { checkedAt: 'x' },
    });
  });
});

describe('the bin, as the host runs it', () => {
  const bin = fileURLToPath(new URL('../bin/report-coder-automation.js', import.meta.url));
  // The parent's environment without any agent setting, so no run here can
  // reach an API or an identity provider.
  const bare = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LABS_AGENT_')));
  const spawn = (input, env = bare) =>
    spawnSync(process.execPath, [bin], { input, env, encoding: 'utf8', timeout: 20_000 });

  it('exits 1 with MISSING_CONFIG and never echoes the token it was given', () => {
    const result = spawn(JSON.stringify({ statusToken: TOKEN, report: REPORT }));
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'MISSING_CONFIG\n');
    assertNoToken(result.stdout, result.stderr);
  });

  it('exits 1 with INVALID_INPUT for input it cannot read, token and all', () => {
    const result = spawn(`{"statusToken":"${TOKEN}",`, { ...bare, ...ENV });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'INVALID_INPUT\n');
    assertNoToken(result.stdout, result.stderr);
  });
});
