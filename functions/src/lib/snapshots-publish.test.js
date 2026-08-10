/**
 * publishSnapshot — the sanitizer IS the security boundary: hidden certs and
 * non-whitelisted fields must never reach the public _snapshots docs.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createSnapshotPublishHandlers,
  sanitizeCertification,
  sanitizeSpeakerEvent,
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
    expect(out).toMatchObject({
      id: 'c1',
      name: 'AZ-104',
      verifyUrl: 'https://verify',
      display: true,
    });
    expect(out).not.toHaveProperty('description');
    expect(out).not.toHaveProperty('learnUrl');
    expect(out).not.toHaveProperty('_updatedAt');
  });

  it('serializeValue flattens geo-points to public field names', () => {
    expect(serializeValue({ latitude: 1.5, longitude: 2.5 })).toEqual({
      latitude: 1.5,
      longitude: 2.5,
    });
    expect(serializeValue({ toDate: () => new Date('2026-01-01T00:00:00Z') })).toBe(
      '2026-01-01T00:00:00.000Z'
    );
  });
});

describe('sanitizeSpeakerEvent', () => {
  const full = (over = {}) => ({
    id: 'ev1',
    name: 'A Conference Talk',
    date: '2026-09-01T00:00:00.000Z',
    location: 'Austin, TX',
    description: 'About things',
    eventUrl: 'https://conf.test',
    presentationUrl: 'https://slides.test',
    eventImageUrl: 'https://img.test/a.png',
    sessionizeId: 12345,
    display: true,
    // The leak this sanitizer exists to stop — upsertSpeakerEvent stamps both
    // with the admin's email address.
    createdBy: 'admin@hybridcloudworks.com',
    updatedBy: 'other-admin@hybridcloudworks.com',
    // No write-side field allowlist, so an editor can add anything.
    internalNotes: 'client paid 5k, do not publish',
    ...over,
  });

  it('drops hidden events entirely', () => {
    expect(sanitizeSpeakerEvent(full({ display: false }))).toBeNull();
  });

  it('fails closed when display is unset', () => {
    const { display, ...noFlag } = full();
    expect(display).toBe(true); // guard against the fixture drifting
    expect(sanitizeSpeakerEvent(noFlag)).toBeNull();
  });

  it('never emits admin email addresses', () => {
    const out = sanitizeSpeakerEvent(full());
    expect(out).not.toHaveProperty('createdBy');
    expect(out).not.toHaveProperty('updatedBy');
    expect(JSON.stringify(out)).not.toContain('@hybridcloudworks.com');
  });

  it('drops any field an editor adds that is not on the allowlist', () => {
    const out = sanitizeSpeakerEvent(full());
    expect(out).not.toHaveProperty('internalNotes');
    expect(JSON.stringify(out)).not.toContain('do not publish');
  });

  it('emits exactly the fields the widget renders', () => {
    // Derived from mergeWithFirestore and the manual-entry path in
    // CustomSessionizeWidget.jsx. Growing this list publishes a new field to
    // anonymous callers, so the assertion is exact rather than a superset.
    expect(Object.keys(sanitizeSpeakerEvent(full())).sort()).toEqual([
      'date',
      'description',
      'display',
      'eventImageUrl',
      'eventUrl',
      'id',
      'location',
      'name',
      'presentationUrl',
      'sessionizeId',
    ]);
  });

  it('accepts the legacy casing and naming variants', () => {
    const out = sanitizeSpeakerEvent({
      id: 'ev2',
      Title: 'Legacy Talk',
      Location: 'Remote',
      website: 'https://legacy.test',
      display: true,
    });
    expect(out).toMatchObject({
      name: 'Legacy Talk',
      location: 'Remote',
      eventUrl: 'https://legacy.test',
    });
  });

  it('flattens a GeoPoint location into plain lat/long', () => {
    const out = sanitizeSpeakerEvent({
      id: 'ev3',
      name: 'Geo',
      display: true,
      location_coords: { latitude: 30.26, longitude: -97.74 },
    });
    expect(out.location_coords).toEqual({ latitude: 30.26, longitude: -97.74 });
  });

  it('omits absent optional fields rather than emitting nulls', () => {
    const out = sanitizeSpeakerEvent({ id: 'ev4', name: 'Minimal', display: true });
    expect(out).toEqual({ id: 'ev4', name: 'Minimal', display: true });
  });
});

describe('publishSnapshot handler', () => {
  it('sanitizes both collections and counts what survived', async () => {
    // This test previously asserted "raw speakerevents" — it encoded the leak
    // T-201 describes, and passing was not evidence of anything good.
    const store = {
      queryDocs: vi.fn(async (container) =>
        container === 'certifications'
          ? [
              { id: 'visible', name: 'A', display: true, description: 'hidden field' },
              { id: 'hidden', name: 'B', display: false },
            ]
          : [
              { id: 'ev1', title: 'Talk', display: true, createdBy: 'admin@example.com' },
              { id: 'ev2', title: 'Hidden Talk', display: false },
              { id: 'ev3', title: 'No Flag' },
            ]
      ),
      upsertDoc: vi.fn(async (_c, d) => d),
    };
    const h = createSnapshotPublishHandlers({ guard: guardAs('editor'), store, now: () => NOW });
    const body = JSON.parse((await h.publishSnapshot(makeRequest(), context)).body);
    expect(body).toMatchObject({
      certifications: 1,
      speakerevents: 1,
      generatedAt: NOW.toISOString(),
    });

    const certSnap = store.upsertDoc.mock.calls.find(([, d]) => d.id === 'certifications')[1];
    expect(certSnap.items).toHaveLength(1);
    expect(certSnap.items[0].id).toBe('visible');
    expect(certSnap.items[0]).not.toHaveProperty('description');

    const evSnap = store.upsertDoc.mock.calls.find(([, d]) => d.id === 'speakerevents')[1];
    expect(evSnap.items.map((i) => i.id)).toEqual(['ev1']);
    expect(evSnap.items[0]).not.toHaveProperty('createdBy');
    expect(JSON.stringify(evSnap)).not.toContain('admin@example.com');

    expect(store.upsertDoc.mock.calls.every(([c]) => c === '_snapshots')).toBe(true);
  });

  it('every snapshot collection has a sanitizer', async () => {
    // The gap T-201 came from was a collection in SNAPSHOT_COLLECTIONS with no
    // SANITIZERS entry, which published raw rows. Adding a collection without
    // one now fails here rather than in production.
    const seen = [];
    const store = {
      queryDocs: vi.fn(async (container) => {
        seen.push(container);
        return [{ id: 'x', name: 'n', secretField: 'leak', display: true }];
      }),
      upsertDoc: vi.fn(async (_c, d) => d),
    };
    const h = createSnapshotPublishHandlers({ guard: guardAs('editor'), store, now: () => NOW });
    await h.publishSnapshot(makeRequest(), context);

    expect(seen.length).toBeGreaterThan(0);
    for (const [, doc] of store.upsertDoc.mock.calls) {
      for (const item of doc.items) {
        expect(item).not.toHaveProperty('secretField');
      }
    }
  });

  it('denies without store calls', async () => {
    const store = { queryDocs: vi.fn(), upsertDoc: vi.fn() };
    const deny = {
      requireRole: vi.fn(async () => ({
        user: null,
        role: null,
        error: { status: 403, body: '{}' },
      })),
    };
    const h = createSnapshotPublishHandlers({ guard: deny, store, now: () => NOW });
    expect((await h.publishSnapshot(makeRequest(), context)).status).toBe(403);
    expect(store.queryDocs).not.toHaveBeenCalled();
  });
});
