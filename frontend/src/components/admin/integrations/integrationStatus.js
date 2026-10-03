/**
 * The persisted outcome of each service test (ADR 0033 Platform).
 *
 * `cms/integration-status` holds one record per service id —
 * `{ lastOkAt, lastFailAt, lastError, lastTestedBy }` — written by whoever
 * last pressed a beaker and read by the Integrations and Health pages on load,
 * so "last worked 2 d ago" survives a reload instead of living in one browser
 * session. The server side is functions/src/lib/integrations/integration-status.js.
 */
import { getJSON, sendJSON } from '@/lib/api';

export const INTEGRATION_STATUS_ROUTE = 'cms/integration-status';

/** Every service's record, `{}` when nothing has been recorded. */
export async function readIntegrationStatus() {
  const response = await getJSON(INTEGRATION_STATUS_ROUTE);
  const services = response?.services;
  return services && typeof services === 'object' && !Array.isArray(services) ? services : {};
}

/**
 * Record one test's outcome. The error is the test's own sentence, which the
 * operator who pressed the button has already seen; never a credential.
 */
export async function recordIntegrationStatus(serviceId, result) {
  const body = { service: serviceId, ok: result?.ok === true };
  if (!body.ok) body.error = String(result?.message ?? '').slice(0, 300);
  const response = await sendJSON(INTEGRATION_STATUS_ROUTE, 'PUT', body);
  return response?.status ?? null;
}

/** The record as it will read once the server has the write, for an optimistic update. */
export function mergeStatus(previous, result, at) {
  const record = { ...(previous ?? {}) };
  if (result?.ok) record.lastOkAt = at;
  else {
    record.lastFailAt = at;
    record.lastError = String(result?.message ?? '') || null;
  }
  return record;
}

/**
 * The most recent recorded verdict as `{ ok, at, message }`, or null when
 * nothing was recorded. A failure newer than the last success is a failure
 * even if the service once worked — that is what "last failed" means.
 */
export function persistedVerdict(record) {
  const okAt = Date.parse(record?.lastOkAt ?? '');
  const failAt = Date.parse(record?.lastFailAt ?? '');
  const hasOk = Number.isFinite(okAt);
  const hasFail = Number.isFinite(failAt);
  if (!hasOk && !hasFail) return null;
  if (hasFail && (!hasOk || failAt > okAt)) {
    return {
      ok: false,
      at: record.lastFailAt,
      message: record.lastError || 'The last test failed.',
    };
  }
  return { ok: true, at: record.lastOkAt, message: 'The last test passed.' };
}
