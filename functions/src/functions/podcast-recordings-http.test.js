/**
 * What podcast-recordings-http.js wires into its handlers.
 *
 * The routes themselves are covered by route-inventory.test.js and
 * api-contract.test.js; this pins the DEPENDENCIES, because a handler that
 * is handed `uploadBlob` without `deleteBlob` compiles, registers, passes
 * the inventory and then leaves every orphaned upload reachable on the
 * media route until the lifecycle rule — a regression nothing else would
 * catch (Copilot on #451).
 */
import { describe, it, expect, vi } from 'vitest';

const registrations = new Map();
vi.mock('@azure/functions', () => ({
  output: { storageQueue: (options) => ({ type: 'queue', ...options }) },
}));
vi.mock('../lib/auth/http-route.js', () => ({
  httpRoute: (name, options) => registrations.set(name, options),
}));
vi.mock('../lib/auth/default-guard.js', () => ({
  getDefaultGuard: () => ({ requireRole: vi.fn() }),
}));
const uploadBlob = vi.fn();
const deleteBlob = vi.fn();
vi.mock('../lib/blob-storage.js', () => ({
  uploadBlob: (...args) => uploadBlob(...args),
  deleteBlob: (...args) => deleteBlob(...args),
}));
vi.mock('../lib/cosmos-client.js', () => ({ readDoc: vi.fn(), upsertDoc: vi.fn() }));

const created = [];
vi.mock('../lib/podcast/recording-handlers.js', () => ({
  createPodcastRecordingHandlers: (deps) => {
    created.push(deps);
    return {
      generateFromRecording: vi.fn(async () => ({ status: 202 })),
      uploadRecording: vi.fn(async () => ({ status: 202 })),
    };
  },
}));

await import('./podcast-recordings-http.js');

describe('podcast-recordings-http registrations', () => {
  it('registers both routes as POST with the platform-jobs queue output', () => {
    const generate = registrations.get('generatePodcastTranscriptFromRecording');
    const upload = registrations.get('uploadPodcastRecording');
    expect(generate.route).toBe('cms/podcast/transcripts/generate-from-recording');
    expect(upload.route).toBe('cms/podcast/recordings/upload');
    for (const spec of [generate, upload]) {
      expect(spec.methods).toEqual(['POST']);
      expect(spec.extraOutputs[0]).toMatchObject({ type: 'queue', queueName: 'platform-jobs' });
    }
  });

  it('hands the handlers a storage seam with BOTH uploadBlob and deleteBlob', async () => {
    const upload = registrations.get('uploadPodcastRecording');
    const context = { extraOutputs: { set: vi.fn() } };
    await upload.handler({}, context);

    const deps = created.at(-1);
    expect(typeof deps.storage.uploadBlob).toBe('function');
    expect(typeof deps.storage.deleteBlob).toBe('function');
    await deps.storage.deleteBlob('podcast', 'uploads/x.mp3');
    expect(deleteBlob).toHaveBeenCalledWith('podcast', 'uploads/x.mp3');
    expect(typeof deps.store.readDoc).toBe('function');
    expect(typeof deps.store.upsertDoc).toBe('function');
    expect(typeof deps.guard.requireRole).toBe('function');
  });
});
