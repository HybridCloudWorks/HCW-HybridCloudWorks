import { describe, it, expect } from 'vitest';
import { bindConditionValues } from './cosmos-client.js';
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
      type: 'architecture',
      title: 'T',
      summary: 'S long enough.',
      provider: 'Azure',
    });
    expect(bad.error).toMatch(/Overview is required/);
    const good = validateSubmission({
      type: 'architecture',
      title: 'T',
      summary: 'S long enough.',
      provider: 'Azure',
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
      type: 'coder_corner',
      title: 'Tips',
      summary: 'S long enough.',
      provider: 'GCP',
      content: 'body',
      language: 'Python',
      tags: ['extra'],
    });
    const doc = composeSubmissionDoc(value);
    expect(doc.tags.slice(0, 2)).toEqual(['coder-corner', 'gcp']);
    expect(doc.category).toBe('Coder Corner');
  });
});

/**
 * A Cosmos stand-in with the one property that matters here: writes to a single
 * document are SERIALIZED.
 *
 * That is what makes `incrementIf` a compare-and-increment rather than a faster
 * read-modify-write, and it is the whole basis of the fix, so the fake has to
 * model it rather than assume it. Each method runs to completion without an
 * internal await, so once the microtask queue hands it control no other caller
 * interleaves — exactly the guarantee Cosmos gives within a partition.
 *
 * The predicate is evaluated through the real `bindConditionValues`, so a
 * condition this repository could not safely bind fails here too.
 */
const CONDITION_TERM = /^c\.([A-Za-z_][A-Za-z0-9_]*)\s*(<=|>=|<|>|=)\s*(-?\d+)$/;

function evaluateCondition(sql, doc) {
  const where = sql.replace(/^FROM\s+c\s+WHERE\s+/i, '');
  return where.split(/\s+AND\s+/i).every((term) => {
    const match = CONDITION_TERM.exec(term.trim());
    if (!match) throw new Error(`fake Cosmos cannot evaluate predicate: ${term}`);
    const [, field, op, literal] = match;
    const actual = doc[field];
    // Cosmos comparisons against an absent or non-numeric property are
    // undefined, and an undefined predicate does not match. A fake that
    // defaulted these to 0 would hide the malformed-document path.
    if (typeof actual !== 'number') return false;
    const rhs = Number(literal);
    if (op === '<') return actual < rhs;
    if (op === '>') return actual > rhs;
    if (op === '<=') return actual <= rhs;
    if (op === '>=') return actual >= rhs;
    return actual === rhs;
  });
}

const fail = (code) => Object.assign(new Error(`fake Cosmos ${code}`), { code });

function makeQuotaStore(initial = null) {
  let doc = initial ? { ...initial, id: 'k1', _etag: 'e0' } : null;
  let etag = 0;
  const nextEtag = () => `e${(etag += 1)}`;
  const calls = { readDoc: 0, incrementIf: 0, createDoc: 0, replaceDocIfMatch: 0 };

  return {
    calls,
    get doc() {
      return doc;
    },
    async readDoc() {
      calls.readDoc += 1;
      return doc ? { ...doc } : null;
    },
    async incrementIf(_container, _id, { path, value, condition, conditionValues }) {
      calls.incrementIf += 1;
      const sql = bindConditionValues(condition, conditionValues);
      if (!doc) throw fail(404);
      if (!evaluateCondition(sql, doc)) throw fail(412);
      const field = path.slice(1);
      doc = { ...doc, [field]: (doc[field] ?? 0) + value, _etag: nextEtag() };
      return { ...doc };
    },
    async createDoc(_container, document) {
      calls.createDoc += 1;
      if (doc) throw fail(409);
      doc = { ...document, _etag: nextEtag() };
      return { ...doc };
    },
    async replaceDocIfMatch(_container, document) {
      calls.replaceDocIfMatch += 1;
      if (!doc || document._etag !== doc._etag) throw fail(412);
      doc = { ...document, _etag: nextEtag() };
      return { ...doc };
    },
  };
}

/** Run one request; resolve to whether it was accepted. */
async function submit(store, now) {
  try {
    await enforceSubmissionQuota(store, 'k1', { now });
    return true;
  } catch (err) {
    if (err.code === 'SUBMISSION_RATE_LIMIT') return false;
    throw err;
  }
}

const HOUR = 60 * 60 * 1000;

describe('enforceSubmissionQuota — sequential behaviour', () => {
  it('starts a window on the first submission', async () => {
    const store = makeQuotaStore(null);
    await submit(store, 1000);
    expect(store.doc).toMatchObject({ id: 'k1', windowStartMs: 1000, count: 1 });
  });

  it('increments within the window without rewriting the window start', async () => {
    const store = makeQuotaStore({ windowStartMs: 1000, count: 2 });
    await submit(store, 1000 + 60_000);
    expect(store.doc).toMatchObject({ windowStartMs: 1000, count: 3 });
  });

  it('takes a single round trip for the common accepted case', async () => {
    // The point of the conditional increment: no read, no ETag, no retry. If
    // this ever needs a read again, the atomicity has been lost.
    const store = makeQuotaStore({ windowStartMs: 1000, count: 2 });
    await submit(store, 1000 + 60_000);
    expect(store.calls).toMatchObject({ incrementIf: 1, readDoc: 0, replaceDocIfMatch: 0 });
  });

  it('rejects at the limit with a typed error and does not increment', async () => {
    const store = makeQuotaStore({ windowStartMs: 1000, count: SUBMISSIONS_PER_HOUR });
    await expect(enforceSubmissionQuota(store, 'k1', { now: 2000 })).rejects.toMatchObject({
      code: 'SUBMISSION_RATE_LIMIT',
    });
    expect(store.doc.count).toBe(SUBMISSIONS_PER_HOUR);
  });

  it('resets after the window lapses', async () => {
    const store = makeQuotaStore({ windowStartMs: 1000, count: SUBMISSIONS_PER_HOUR });
    const later = 1000 + HOUR + 1;
    await submit(store, later);
    expect(store.doc).toMatchObject({ windowStartMs: later, count: 1 });
  });

  it('treats a document stamped exactly one window ago as lapsed', async () => {
    // The SQL predicate and the JavaScript window check are two expressions of
    // one rule, written by different hands in different languages. This pins
    // them to the same boundary.
    const store = makeQuotaStore({ windowStartMs: 1000, count: SUBMISSIONS_PER_HOUR });
    await submit(store, 1000 + HOUR);
    expect(store.doc).toMatchObject({ windowStartMs: 1000 + HOUR, count: 1 });
  });

  it('repairs a document whose count is missing rather than looping', async () => {
    // The predicate cannot match a non-numeric count, so this always falls to
    // the slow path; without the replace it would spin to the attempt ceiling
    // and reject a legitimate first request.
    const store = makeQuotaStore({ windowStartMs: 1000 });
    expect(await submit(store, 1000 + 60_000)).toBe(true);
    expect(store.doc.count).toBe(1);
  });

  it('propagates a genuine store fault instead of allowing the request', async () => {
    // Failing open here would turn any Cosmos outage into an open submission
    // endpoint.
    const store = makeQuotaStore({ windowStartMs: 1000, count: 0 });
    store.incrementIf = async () => {
      throw Object.assign(new Error('service unavailable'), { code: 503 });
    };
    await expect(enforceSubmissionQuota(store, 'k1', { now: 1000 })).rejects.toMatchObject({
      code: 503,
    });
  });
});

describe('enforceSubmissionQuota — concurrency (TODO.md T-204)', () => {
  it('admits exactly the limit from a cold start under a burst', async () => {
    // The defect, as an assertion. The previous implementation read, compared
    // and wrote as three separate operations, so all 200 of these read
    // `count: 0`, all passed the check, and all wrote `count: 1` — 200 accepted
    // against a limit of 5, and a counter left at 1 so the next burst did it
    // again.
    const store = makeQuotaStore(null);
    const results = await Promise.all(Array.from({ length: 200 }, () => submit(store, 1000)));

    expect(results.filter(Boolean)).toHaveLength(SUBMISSIONS_PER_HOUR);
    expect(store.doc.count).toBe(SUBMISSIONS_PER_HOUR);
  });

  it('admits exactly the remaining allowance when a window is already open', async () => {
    const store = makeQuotaStore({ windowStartMs: 1000, count: 3 });
    const results = await Promise.all(
      Array.from({ length: 50 }, () => submit(store, 1000 + 60_000))
    );

    expect(results.filter(Boolean)).toHaveLength(SUBMISSIONS_PER_HOUR - 3);
    expect(store.doc.count).toBe(SUBMISSIONS_PER_HOUR);
  });

  it('admits exactly the limit when a burst arrives as the window rolls over', async () => {
    // The reset is the one thing the predicate cannot express, so it runs
    // through read-then-replace-if-match — the path where a lost update would
    // reappear if the ETag were dropped.
    const store = makeQuotaStore({ windowStartMs: 1000, count: SUBMISSIONS_PER_HOUR });
    const later = 1000 + HOUR + 1;
    const results = await Promise.all(Array.from({ length: 100 }, () => submit(store, later)));

    expect(results.filter(Boolean)).toHaveLength(SUBMISSIONS_PER_HOUR);
    expect(store.doc).toMatchObject({ windowStartMs: later, count: SUBMISSIONS_PER_HOUR });
  });

  it('does not let a burst reset the counter behind itself', async () => {
    // The compounding half of the old defect: the burst ended with the counter
    // reading 1, so the limit reset every cycle rather than every hour. A
    // second burst must find no allowance left.
    const store = makeQuotaStore(null);
    await Promise.all(Array.from({ length: 200 }, () => submit(store, 1000)));
    const second = await Promise.all(Array.from({ length: 200 }, () => submit(store, 2000)));

    expect(second.filter(Boolean)).toHaveLength(0);
    expect(store.doc.count).toBe(SUBMISSIONS_PER_HOUR);
  });
});
