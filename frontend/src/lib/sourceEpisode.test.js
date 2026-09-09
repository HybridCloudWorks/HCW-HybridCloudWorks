/**
 * The source-episode enqueue (#433).
 *
 * The one thing that matters structurally: the job is the same type as a
 * guide run, but the enqueue goes to the validating route rather than the
 * generic `enqueueJob`, so a refused list is the server's sentence thrown
 * from `postJSON` and not a failed job polled for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api', () => ({ postJSON: vi.fn() }));
vi.mock('@/lib/jobs', () => ({ runJob: vi.fn() }));

const { postJSON } = await import('@/lib/api');
const { runJob } = await import('@/lib/jobs');
const { SOURCE_EPISODE_ROUTE, generateSourceEpisode } = await import('./sourceEpisode.js');

const sources = [
  { kind: 'page', url: 'https://example.com/a' },
  { kind: 'video', url: 'https://youtu.be/abc123' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateSourceEpisode', () => {
  it('runs the generate-listen-and-learn job with the source payload', async () => {
    runJob.mockResolvedValue({ status: 'succeeded', result: { sourceCount: 2 } });
    const onUpdate = vi.fn();

    const job = await generateSourceEpisode({
      platform: 'azure',
      examCode: 'AZ-104',
      title: 'Entra ID basics',
      sources,
      certTitle: 'Azure Administrator',
      onUpdate,
    });

    expect(job.result.sourceCount).toBe(2);
    const [[type, payload, options]] = runJob.mock.calls;
    expect(type).toBe('generate-listen-and-learn');
    expect(payload).toEqual({
      platform: 'azure',
      examCode: 'AZ-104',
      title: 'Entra ID basics',
      sources,
      certTitle: 'Azure Administrator',
    });
    expect(options.onUpdate).toBe(onUpdate);
    expect(options.maxWaitMs).toBeGreaterThan(25 * 60 * 1000);
  });

  it('enqueues through the validating route, not the generic enqueueJob', async () => {
    runJob.mockResolvedValue({});
    await generateSourceEpisode({ platform: 'azure', examCode: 'AZ-104', title: 'T', sources });

    const [[, , { fetchers }]] = runJob.mock.calls;
    postJSON.mockResolvedValue({ ok: true, jobId: 'job-1' });
    const accepted = await fetchers.enqueue({
      type: 'generate-listen-and-learn',
      payload: { x: 1 },
    });

    expect(accepted).toEqual({ ok: true, jobId: 'job-1' });
    expect(postJSON).toHaveBeenCalledWith(SOURCE_EPISODE_ROUTE, { x: 1 });
    expect(SOURCE_EPISODE_ROUTE).toBe('cms/listen-and-learn/source-episode');
  });

  it('omits optional fields rather than sending empty strings', async () => {
    runJob.mockResolvedValue({});
    await generateSourceEpisode({
      platform: 'azure',
      examCode: 'AZ-104',
      title: 'T',
      sources,
      certTitle: '',
      certSlug: '',
    });
    const [[, payload]] = runJob.mock.calls;
    expect(payload).not.toHaveProperty('certTitle');
    expect(payload).not.toHaveProperty('certSlug');
  });
});
