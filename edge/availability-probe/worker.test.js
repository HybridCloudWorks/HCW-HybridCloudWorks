import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConnectionString, msToTimeSpan, buildEnvelope, runProbe } from './worker.js';

test('parseConnectionString extracts key and endpoint, normalising the slash', () => {
  const parsed = parseConnectionString(
    'InstrumentationKey=abc-123;IngestionEndpoint=https://centralus-2.in.applicationinsights.azure.com'
  );
  assert.equal(parsed.iKey, 'abc-123');
  assert.equal(parsed.endpoint, 'https://centralus-2.in.applicationinsights.azure.com/');
});

test('parseConnectionString tolerates extra fields and preserves a trailing slash', () => {
  const parsed = parseConnectionString(
    'InstrumentationKey=k;IngestionEndpoint=https://x.example/;LiveEndpoint=https://y.example/'
  );
  assert.equal(parsed.endpoint, 'https://x.example/');
});

test('parseConnectionString is loud about an unset or incomplete secret', () => {
  assert.throws(() => parseConnectionString(''), /InstrumentationKey and IngestionEndpoint/);
  assert.throws(() => parseConnectionString('InstrumentationKey=k'), /IngestionEndpoint/);
});

test('msToTimeSpan renders the hh:mm:ss.fff shape AvailabilityData expects', () => {
  assert.equal(msToTimeSpan(0), '00:00:00.000');
  assert.equal(msToTimeSpan(1234), '00:00:01.234');
  assert.equal(msToTimeSpan(61_005), '00:01:01.005');
  assert.equal(msToTimeSpan(3_600_000 + 62_007), '01:01:02.007');
  // A negative clock skew must not produce a malformed TimeSpan.
  assert.equal(msToTimeSpan(-5), '00:00:00.000');
});

test('buildEnvelope carries the fields the availabilityResults table is keyed on', () => {
  const envelope = buildEnvelope({
    iKey: 'k',
    name: 'edge-api-health',
    start: Date.UTC(2026, 0, 2, 3, 4, 5),
    durationMs: 250,
    success: true,
    message: 'HTTP 200',
  });
  assert.equal(envelope.name, 'Microsoft.ApplicationInsights.Availability');
  assert.equal(envelope.iKey, 'k');
  assert.equal(envelope.time, '2026-01-02T03:04:05.000Z');
  assert.equal(envelope.data.baseType, 'AvailabilityData');
  assert.equal(envelope.data.baseData.name, 'edge-api-health');
  assert.equal(envelope.data.baseData.success, true);
  assert.equal(envelope.data.baseData.duration, '00:00:00.250');
  assert.match(envelope.data.baseData.id, /^[0-9a-f-]{36}$/);
});

function makeEnv() {
  return {
    APPLICATIONINSIGHTS_CONNECTION_STRING:
      'InstrumentationKey=k;IngestionEndpoint=https://ingest.example/',
    PROBE_URL: 'https://api-azure.example.com/api/health',
    PROBE_NAME: 'edge-api-health',
  };
}

test('runProbe reports success=true only on HTTP 200 and posts to v2/track', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://api-azure.example.com/api/health') return { status: 200 };
    return { status: 200 };
  };
  const result = await runProbe(makeEnv(), fetcher);
  assert.equal(result.success, true);
  assert.equal(result.message, 'HTTP 200');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://ingest.example/v2/track');
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.data.baseData.success, true);
});

test('runProbe reports a non-200 as a failed availability result, not an error', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/health')) return { status: 403 };
    return { status: 200 };
  };
  const result = await runProbe(makeEnv(), fetcher);
  assert.equal(result.success, false);
  assert.equal(result.message, 'HTTP 403');
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.data.baseData.success, false);
  assert.equal(body.data.baseData.message, 'HTTP 403');
});

test('runProbe reports a thrown fetch as a failed result with the error text', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/health')) throw new Error('connection reset');
    return { status: 200 };
  };
  const result = await runProbe(makeEnv(), fetcher);
  assert.equal(result.success, false);
  assert.equal(result.message, 'connection reset');
  assert.equal(calls.length, 2, 'the failure must still be reported to ingestion');
});

test('runProbe lets an ingestion failure propagate instead of hiding it', async () => {
  const fetcher = async (url) => {
    if (url.endsWith('/api/health')) return { status: 200 };
    throw new Error('ingestion unreachable');
  };
  await assert.rejects(() => runProbe(makeEnv(), fetcher), /ingestion unreachable/);
});
