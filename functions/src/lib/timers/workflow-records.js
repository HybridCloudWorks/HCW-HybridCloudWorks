/**
 * workflow-records.js — the three records the operational timers write:
 * a dated `workflow_digests` document (merged, one per day), a
 * `workflow_alerts` document (raised or refreshed), and a system audit entry.
 *
 * Firestore's `set(..., { merge: true })` becomes read-then-upsert here; a
 * patch replaces its top-level keys, which is how every caller uses it (each
 * timer owns one sub-object of the digest).
 */
import { randomUUID } from 'node:crypto';

/** YYYY-MM-DD of `date` in UTC — the digest document id. */
export function digestDateOf(date) {
  return date.toISOString().slice(0, 10);
}

export async function mergeDigest(store, digestDate, patch) {
  const existing = (await store.readDoc('workflow_digests', digestDate, digestDate)) || {};
  const doc = { ...existing, ...patch, id: digestDate, digestDate };
  await store.upsertDoc('workflow_digests', doc);
  return doc;
}

/** Raise (or refresh) an alert. `firstSeenAt` survives refreshes; `updatedAt` moves. */
export async function raiseAlert(store, alertId, fields, now = () => new Date()) {
  const existing = (await store.readDoc('workflow_alerts', alertId, alertId)) || {};
  const stamp = now().toISOString();
  const doc = {
    ...existing,
    ...fields,
    id: alertId,
    active: true,
    firstSeenAt: existing.firstSeenAt || stamp,
    updatedAt: stamp,
  };
  await store.upsertDoc('workflow_alerts', doc);
  return doc;
}

/** A system (no user) entry in admin_audit_logs — Site-Main's buildSystemAuditLogData. */
export async function writeSystemAudit(
  store,
  { action, source, details = {} },
  { now = () => new Date(), uuid = randomUUID } = {}
) {
  const doc = {
    id: uuid(),
    action: String(action || 'system_action'),
    actor: 'system',
    source: String(source || 'cron'),
    userId: null,
    userEmail: null,
    timestamp: now().toISOString(),
    details,
    compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
  };
  await store.upsertDoc('admin_audit_logs', doc);
  return doc;
}

/** Epoch ms of an ISO string / Date / Firestore-shaped value, else 0. */
export function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}
