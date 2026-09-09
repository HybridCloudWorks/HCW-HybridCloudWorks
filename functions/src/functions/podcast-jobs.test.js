/**
 * Generation payload validation and the job's registration.
 *
 * The pipeline itself is tested in lib/podcast/generate.test.js; this pins
 * the thin adapter — what the worker accepts, and that it registers at the
 * role of the route that enqueues it.
 */
import { describe, it, expect, vi } from 'vitest';

// The module registers a job type on import, and registerJobType throws on a
// duplicate — so the registry is faked rather than shared across test files.
const registerJobType = vi.fn();
vi.mock('../lib/jobs.js', () => ({ registerJobType: (...args) => registerJobType(...args) }));
vi.mock('../lib/cosmos-client.js', () => ({
  readDoc: vi.fn(),
  upsertDoc: vi.fn(),
  patchDoc: vi.fn(),
}));
vi.mock('../lib/blob-storage.js', () => ({ uploadBlob: vi.fn() }));
vi.mock('../lib/ai/router.js', () => ({
  generateJsonResponse: vi.fn(),
  getCostEstimate: vi.fn(),
}));

const { parseTranscriptPayload, runTranscriptGeneration } = await import('./podcast-jobs.js');

describe('parseTranscriptPayload', () => {
  it('accepts an article id and trims it', () => {
    expect(parseTranscriptPayload({ articleId: ' content-1 ' })).toEqual({
      value: { articleId: 'content-1' },
    });
  });

  it('refuses a missing, blank, non-string or oversized id without throwing', () => {
    expect(parseTranscriptPayload(undefined).error).toBe('articleId is required');
    expect(parseTranscriptPayload({}).error).toBe('articleId is required');
    expect(parseTranscriptPayload({ articleId: '  ' }).error).toBe('articleId is required');
    expect(parseTranscriptPayload({ articleId: 42 }).error).toBe('articleId is required');
    expect(parseTranscriptPayload({ articleId: 'x'.repeat(201) }).error).toBe('articleId is too long');
  });
});

describe('runTranscriptGeneration', () => {
  it('fails a bad payload with the validation message before touching anything', async () => {
    await expect(runTranscriptGeneration({}, { context: { log: vi.fn() } })).rejects.toThrow(
      'articleId is required'
    );
  });
});

describe('registration', () => {
  it('registers generate-podcast-transcript at editor, the role of the route that enqueues it', () => {
    const [type, spec] = registerJobType.mock.calls.find(
      ([name]) => name === 'generate-podcast-transcript'
    );
    expect(type).toBe('generate-podcast-transcript');
    expect(spec.role).toBe('editor');
    expect(typeof spec.worker).toBe('function');
    // One article id; a payload larger than this is not one.
    expect(spec.maxPayloadBytes).toBeLessThanOrEqual(1024);
  });
});
