/**
 * The server calls behind the session (forgeJobs.js): the order Generate
 * makes them in, what a job's outcome means, and the words it gets.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_BRIEF } from './brief';
import { describeJob, isConflict, jobFailure, writeFirstDraft } from './forgeJobs';

const getJSON = vi.fn();
const postJSON = vi.fn();
const runJob = vi.fn();
vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  postJSON: (...args) => postJSON(...args),
}));
vi.mock('@/lib/jobs', () => ({ runJob: (...args) => runJob(...args) }));

const brief = (over = {}) => ({ ...EMPTY_BRIEF, ...over });

beforeEach(() => {
  getJSON.mockReset();
  postJSON.mockReset();
  runJob.mockReset();
  postJSON.mockImplementation(async (route) =>
    route === 'cms/drafts' ? { ok: true, draft: { id: 'c1' } } : { ok: true }
  );
  runJob.mockResolvedValue({ status: 'succeeded', result: { success: true, contentId: 'c9' } });
});

describe('writeFirstDraft', () => {
  it('creates the document, saves the brief on it, then runs forge-article against it', async () => {
    const { id, job } = await writeFirstDraft(
      { contentId: '', title: ' Hub ', brief: brief({ objective: 'Teach', seoKeywords: 'a, b' }) },
      { templateLabel: 'How-To' },
      { maxWaitMs: 1 }
    );
    expect(id).toBe('c1');
    expect(job.status).toBe('succeeded');
    expect(postJSON.mock.calls.map(([route]) => route)).toEqual(['cms/drafts', 'cms/forge/brief']);
    expect(postJSON.mock.calls[0][1].fields).toEqual({
      title: 'Hub',
      body: expect.stringContaining('**Requested format:** How-To'),
      tags: ['a', 'b'],
    });
    expect(runJob).toHaveBeenCalledWith(
      'forge-article',
      { sourceContentId: 'c1' },
      { maxWaitMs: 1 }
    );
  });

  it('with a document already, only the job runs', async () => {
    await writeFirstDraft({ contentId: 'c1', title: 'Hub', brief: brief() }, {}, {});
    expect(postJSON).not.toHaveBeenCalled();
    expect(runJob).toHaveBeenCalledWith('forge-article', { sourceContentId: 'c1' }, {});
  });

  it('from a URL the job makes the document and the brief lands on it afterwards', async () => {
    const { id } = await writeFirstDraft(
      { contentId: '', title: '', brief: brief({ mode: 'url', sourceUrl: ' https://a.test ' }) },
      {},
      {}
    );
    expect(runJob).toHaveBeenCalledWith('forge-from-url', { url: 'https://a.test' }, {});
    expect(id).toBe('c9');
    expect(postJSON).toHaveBeenCalledWith(
      'cms/forge/brief',
      expect.objectContaining({ contentId: 'c9' })
    );
  });

  it('refuses an empty URL, and an untitled draft, before any call', async () => {
    await expect(
      writeFirstDraft({ contentId: '', title: '', brief: brief({ mode: 'url' }) }, {}, {})
    ).rejects.toThrow(/Paste the URL/);
    await expect(
      writeFirstDraft({ contentId: '', title: '  ', brief: brief() }, {}, {})
    ).rejects.toThrow(/title/);
    expect(runJob).not.toHaveBeenCalled();
    expect(postJSON).not.toHaveBeenCalled();
  });
});

describe('jobFailure / describeJob / isConflict', () => {
  it('turns anything but a successful draft into an error', () => {
    expect(jobFailure({ status: 'succeeded', result: { success: true } })).toBeNull();
    expect(jobFailure({ status: 'failed', error: 'boom' }).message).toBe('boom');
    expect(jobFailure(null).message).toBe('The forge job did not finish.');
    expect(jobFailure({ status: 'succeeded', result: { success: false } }).message).toBe(
      'The forge did not produce a draft.'
    );
  });

  it('describes a status it has no words for by its name', () => {
    expect(describeJob({ status: 'cancelled' })).toBe('Cancelled.');
    expect(describeJob({ status: 'odd' })).toBe('odd');
    expect(describeJob({})).toBe('');
  });

  it('knows a version conflict by status or code', () => {
    expect(isConflict({ status: 412 })).toBe(true);
    expect(isConflict({ code: 'CONFLICT' })).toBe(true);
    expect(isConflict(new Error('x'))).toBe(false);
  });
});
