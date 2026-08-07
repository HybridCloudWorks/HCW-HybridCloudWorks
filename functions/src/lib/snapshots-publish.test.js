/**
 * publishSnapshot — the sanitizer IS the security boundary: hidden certs and
 * non-whitelisted fields must never reach the public _snapshots docs.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createSnapshotPublishHandlers,
  sanitizeCertification,
  serializeValue,
} from './snapshots-publish.js';

const context = { log: vi.fn(), error: vi.fn() };
const guardAs = (role) => ({
  requireRole: vi.fn(async () => ({ user: { oid: 'u1' }, role, error: null })),
});
const makeRequest = () => ({ headers: { get: () => null }, json: async () => ({}) });
const NOW = new Date('2026-08-07T06:30:00.000Z');

describe('sanitizeCertification', () => {
  it('drops hidden certs entirely', () => {
    expect(sanitizeCertification({ id: 'x', name: 'Secret', display: false })).toBeNull();
    expect(sanitizeCertification({ id: 'x', name: 'Unset' })).toBeNull();
  });

  it('whitelists fields — internal ones never pass through', () => {
    const out = sanitizeCertification({
      id: 'c1',
      name: 'AZ-104',
      issuer: 'Microsoft',
      display: true,
      description: 'INTERNAL NOTES',
      learnUrl: 'https://internal',
      _updatedAt: 'stamp',
      verifyUrl: 'https://verify',
    });
    expect(out).toMatchObject({ id: 'c1', name: 'AZ-104', verifyUrl: 'https://verify', display: true });
    expect(out).not.toHaveProperty('description');
    expect(out).not.toHaveProperty('learnUrl');
    expect(out).not.toHaveProperty('_updatedAt');
  });

  it('serializeValue flattens geo-points to public field names', () => {
    expect(serializeValue({ latitude: 1.5, longitude: 2.5 })).toEqual({ latitude: 1.5, longitude: 2.5 });
    expect(serializeValue({ toDate: () => new Date('2026-01-01T00:00:00Z') })).toBe(
      '2026-01-01T00:00:00.000Z'
    );
  });
});

describe('publishSnapshot handler', () => {
  it('writes sanitized certifications and raw speakerevents with counts', async () => {
    const store = {
      queryDocs: vi.fn(async (container) =>
        container === 'certifications'
          ? [
              { id: 'visible', name: 'A', display: true, description: 'hidden field' },
              { id: 'hidden', name: 'B', display: false },
            ]
          : [{ id: 'ev1', title: 'Talk' }]
      ),
      upsertDoc: vi.fn(async (_c, d) => d),
    };
    const h = createSnapshotPublishHandlers({ guard: guardAs('editor'), store, now: () => NOW });
    const body = JSON.parse((await h.publishSnapshot(makeRequest(), context)).body);
    expect(body).toMatchObject({ certifications: 1, speakerevents: 1, generatedAt: NOW.toISOString() });

    const certSnap = store.upsertDoc.mock.calls.find(([, d]) => d.id === 'certifications')[1];
    expect(certSnap.items).toHaveLength(1);
    expect(certSnap.items[0].id).toBe('visible');
    expect(certSnap.items[0]).not.toHaveProperty('description');
    expect(store.upsertDoc.mock.calls.every(([c]) => c === '_snapshots')).toBe(true);
  });

  it('denies without store calls', async () => {
    const store = { queryDocs: vi.fn(), upsertDoc: vi.fn() };
    const deny = { requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })) };
    const h = createSnapshotPublishHandlers({ guard: deny, store, now: () => NOW });
    expect((await h.publishSnapshot(makeRequest(), context)).status).toBe(403);
    expect(store.queryDocs).not.toHaveBeenCalled();
  });
});
