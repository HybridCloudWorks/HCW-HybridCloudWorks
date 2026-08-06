import { describe, it, expect } from 'vitest';
import {
  validateSubmission,
  composeSubmissionDoc,
  enforceSubmissionQuota,
  SUBMISSION_TYPES,
  SUBMISSIONS_PER_HOUR,
  MAX_CONTENT_LENGTH,
} from './submissions.js';

const blogBody = (over = {}) => ({
  type: 'blog',
  title: 'A useful post',
  summary: 'Something worth reading about Azure.',
  provider: 'Azure',
  content: 'Body text long enough to matter.',
  tags: 'azure, functions',
  ...over,
});

describe('validateSubmission', () => {
  it('rejects a non-object body', () => {
    expect(validateSubmission(null).error).toMatch(/JSON object/);
    expect(validateSubmission('x').error).toMatch(/JSON object/);
  });

  it('rejects unknown types, listing the valid ones', () => {
    const { error } = validateSubmission({ type: 'podcast' });
    for (const t of Object.keys(SUBMISSION_TYPES)) expect(error).toContain(t);
  });

  it.each([
    ['missing title', { title: '   ' }, /Title is required/],
    ['missing summary', { summary: '' }, /Summary is required/],
    ['missing content', { content: '' }, /Content is required/],
    ['oversized content', { content: 'x'.repeat(MAX_CONTENT_LENGTH + 1) }, /under 50KB/],
    ['oversized title', { title: 'x'.repeat(201) }, /Title is too long/],
    ['bad provider', { provider: 'DigitalOcean' }, /cloudProvider must be one of/],
    ['bad sourceUrl', { sourceUrl: 'notaurl' }, /sourceUrl/],
    ['ftp sourceUrl', { sourceUrl: 'ftp://example.com/x' }, /sourceUrl/],
  ])('rejects a blog submission with %s', (_label, over, want) => {
    expect(validateSubmission(blogBody(over)).error).toMatch(want);
  });

  it('accepts a valid blog submission and normalizes tags', () => {
    const res = validateSubmission(blogBody({ tags: ' azure ,, functions , ' }));
    expect(res.error).toBeUndefined();
    expect(res.value.tags).toEqual(['azure', 'functions']);
  });

  it('enforces the per-type provider sets — framework cannot claim Aws', () => {
    const res = validateSubmission({
      type: 'framework',
      title: 'T',
      summary: 'A summary here.',
      provider: 'Aws',
      overviewHtml: '<p>overview</p>',
    });
    expect(res.error).toMatch(/Github, Terraform/);
  });

  it('requires language for coder_corner', () => {
    const res = validateSubmission({
      type: 'coder_corner',
      title: 'Snippets',
      summary: 'A summary here.',
      provider: 'AWS',
      content: 'article body',
    });
    expect(res.error).toMatch(/Language is required/);
  });

  it('requires overviewHtml for architecture, not content', () => {
    const bad = validateSubmission({
      type: 'architecture', title: 'T', summary: 'S long enough.', provider: 'Azure',
    });
    expect(bad.error).toMatch(/Overview is required/);
    const good = validateSubmission({
      type: 'architecture', title: 'T', summary: 'S long enough.', provider: 'Azure',
      overviewHtml: '<p>arch</p>',
    });
    expect(good.error).toBeUndefined();
  });
});

describe('composeSubmissionDoc', () => {
  it('reproduces the review-pipeline contract the admin queue depends on', () => {
    const { value } = validateSubmission(blogBody());
    const doc = composeSubmissionDoc(value, { nowIso: '2026-08-06T00:00:00.000Z' });
    expect(doc).toMatchObject({
      type: 'blog',
      contentStatus: 'ingested',
      storageCollection: 'content',
      publishTarget: 'blog',
      Live: false,
      approvedForBlog: false,
      source: 'template-form',
      submittedVia: 'public-api',
      title: 'A useful post',
      Title: 'A useful post',
      Content: value.content,
      postContent: value.content,
      createdAt: '2026-08-06T00:00:00.000Z',
    });
    expect(doc.slug).toBe('a-useful-post');
    expect(doc.id).toContain('sub-a-useful-post');
  });

  it('coder_corner forces the coder-corner tag set like the page did', () => {
    const { value } = validateSubmission({
      type: 'coder_corner', title: 'Tips', summary: 'S long enough.', provider: 'GCP',
      content: 'body', language: 'Python', tags: ['extra'],
    });
    const doc = composeSubmissionDoc(value);
    expect(doc.tags.slice(0, 2)).toEqual(['coder-corner', 'gcp']);
    expect(doc.category).toBe('Coder Corner');
  });
});

describe('enforceSubmissionQuota', () => {
  const makeStore = (existing) => {
    const writes = [];
    return {
      writes,
      readDoc: async () => existing,
      upsertDoc: async (_c, doc) => writes.push(doc),
    };
  };

  it('starts a window on first submission', async () => {
    const store = makeStore(undefined);
    await enforceSubmissionQuota(store, 'k1', { now: 1000 });
    expect(store.writes[0]).toMatchObject({ id: 'k1', windowStartMs: 1000, count: 1 });
  });

  it('increments within the window', async () => {
    const store = makeStore({ windowStartMs: 1000, count: 2 });
    await enforceSubmissionQuota(store, 'k1', { now: 1000 + 60_000 });
    expect(store.writes[0]).toMatchObject({ windowStartMs: 1000, count: 3 });
  });

  it('rejects at the limit with a typed error and writes nothing', async () => {
    const store = makeStore({ windowStartMs: 1000, count: SUBMISSIONS_PER_HOUR });
    await expect(enforceSubmissionQuota(store, 'k1', { now: 2000 })).rejects.toMatchObject({
      code: 'SUBMISSION_RATE_LIMIT',
    });
    expect(store.writes).toHaveLength(0);
  });

  it('resets after the window lapses', async () => {
    const store = makeStore({ windowStartMs: 1000, count: SUBMISSIONS_PER_HOUR });
    const later = 1000 + 60 * 60 * 1000 + 1;
    await enforceSubmissionQuota(store, 'k1', { now: later });
    expect(store.writes[0]).toMatchObject({ windowStartMs: later, count: 1 });
  });
});
