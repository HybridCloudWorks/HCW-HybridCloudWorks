/**
 * POST cms/content/import-repo and GET cms/content/import-repo/candidates.
 *
 * What is pinned here, in the order the owner asked for it: the path
 * allow-list at the request, the fetch pinned to two hosts with no redirect,
 * a cap and a deadline, the status written is `in_review` and never
 * `published`, a re-import updates the same document, a published article is
 * refused rather than overwritten, and the editor role. The handlers run
 * against the real createContentDocument and an in-memory store, so the
 * document asserted is the one the write path actually builds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GITHUB_FETCH_TIMEOUT_MS,
  MAX_DRAFT_BYTES,
  MAX_IMPORT_PATHS,
  createRepoDraftSource,
  createRepoImportHandlers,
  isPinnedUrl,
  parseImportRequest,
} from './repo-import.js';
import { repoDraftContentId, sha256Hex } from './repo-draft.js';
import { createContentDocument } from './content-create.js';

const LAB_01 = 'docs/content/blog-lab-01-landing-zone.md';
const LAB_02 = 'docs/content/blog-lab-02-one-container.md';
const LAB_03 = 'docs/content/blog-lab-03-agent-explains.md';
const LAB_TEXT = Object.fromEntries(
  [LAB_01, LAB_02, LAB_03].map((path) => [
    path,
    readFileSync(join(process.cwd(), '..', ...path.split('/')), 'utf8'),
  ])
);
const SHA = '2fb230c9ac7118c4f87d4cf8031e0571d47e74d8';

const RAW_PREFIX = 'https://raw.githubusercontent.com/HybridCloudWorks/HCW-HybridCloudWorks/main/docs/content/';
const API_PREFIX = 'https://api.github.com/repos/HybridCloudWorks/HCW-HybridCloudWorks/';

const USER = { oid: 'u1', email: 'editor@hcw.dev' };
const context = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
const allowGuard = () => ({
  requireRole: vi.fn(async () => ({ user: USER, role: 'editor', error: null })),
});
const denyGuard = () => ({
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
});
const makeRequest = (body) => ({
  method: body === undefined ? 'GET' : 'POST',
  headers: { get: () => 'vitest' },
  json: async () => body,
});
const parse = (res) => ({ status: res.status, body: JSON.parse(res.body) });

// ── a fetch double that answers like GitHub ────────────────────────────────

function textResponse(body, { status = 200, headers = {}, url = '' } = {}) {
  const bytes = Buffer.from(body, 'utf8');
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ 'content-length': String(bytes.length), ...headers }),
    body: null,
    arrayBuffer: async () => bytes,
  };
}

function listing(paths) {
  return JSON.stringify([
    ...paths.map((path) => ({
      type: 'file',
      path,
      name: path.split('/').at(-1),
      size: 100,
      sha: 'b'.repeat(40),
    })),
    { type: 'dir', path: 'docs/content/blog-dir', name: 'blog-dir', size: 0, sha: 'c'.repeat(40) },
  ]);
}

/** Routes a URL to a canned response; records every call. */
function githubFetch({ files = LAB_TEXT, commitSha = SHA, overrides = {} } = {}) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url, init });
    if (overrides[url]) return overrides[url](url, init);
    if (url.startsWith(`${API_PREFIX}contents/docs/content`)) {
      return textResponse(
        listing([
          ...Object.keys(files),
          'docs/content/blog-template.md',
          'docs/content/blog-machine.md',
          'docs/content/README.md',
        ]),
        { url }
      );
    }
    if (url.startsWith(`${API_PREFIX}commits?`)) {
      return textResponse(JSON.stringify(commitSha ? [{ sha: commitSha }] : []), { url });
    }
    if (url.startsWith(RAW_PREFIX)) {
      const path = `docs/content/${url.slice(RAW_PREFIX.length)}`;
      if (files[path] === undefined) return textResponse('404: Not Found', { status: 404, url });
      return textResponse(files[path], { url });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return { fetchImpl, calls };
}

// ── an in-memory content store that answers the queries the code runs ─────

function memoryStore(seed = []) {
  const docs = new Map(seed.map((doc) => [doc.id, { _etag: '"e0"', ...doc }]));
  const audits = [];
  let etag = 1;
  const nextEtag = () => `"e${etag++}"`;
  const store = {
    docs,
    audits,
    queryDocs: vi.fn(async (container, query, parameters = []) => {
      if (container !== 'content') throw new Error(`unexpected container ${container}`);
      const param = (name) => parameters.find((p) => p.name === name)?.value;
      const all = [...docs.values()];
      if (query.includes('c.repoPath = @repoPath')) {
        return all.filter((d) => d.repoPath === param('@repoPath'));
      }
      if (query.includes('ARRAY_CONTAINS(@paths, c.repoPath)')) {
        return all.filter((d) => param('@paths').includes(d.repoPath));
      }
      if (query.includes('c.normalizedTitle = @title')) {
        return all.filter((d) => d.normalizedTitle === param('@title'));
      }
      const field = /c\["([^"]+)"\] = @value/.exec(query)?.[1];
      if (field) return all.filter((d) => d[field] === param('@value')).slice(0, 1);
      throw new Error(`unexpected query ${query}`);
    }),
    readDoc: vi.fn(async (container, id) => {
      const doc = docs.get(id);
      return doc ? structuredClone(doc) : null;
    }),
    createDoc: vi.fn(async (container, doc) => {
      if (docs.has(doc.id)) throw Object.assign(new Error('Conflict'), { code: 409 });
      docs.set(doc.id, { ...doc, _etag: nextEtag() });
      return doc;
    }),
    patchDoc: vi.fn(async (container, id, updates, options = {}) => {
      const doc = docs.get(id);
      if (!doc) throw Object.assign(new Error('missing'), { code: 404 });
      if (options.ifMatch && options.ifMatch !== doc._etag) {
        throw Object.assign(new Error('changed'), { code: 412 });
      }
      const next = { ...doc };
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      next._etag = nextEtag();
      docs.set(id, next);
      return next;
    }),
    upsertDoc: vi.fn(async (container, doc) => {
      if (container === 'admin_audit_logs') {
        audits.push(doc);
        return doc;
      }
      // The import must never upsert content: create-only or conditioned patch.
      throw new Error(`upsertDoc on ${container} — the import must not replace documents`);
    }),
  };
  return store;
}

function handlersWith({ store = memoryStore(), fetch = githubFetch(), guard = allowGuard(), ...rest } = {}) {
  const handlers = createRepoImportHandlers({
    guard,
    store,
    source: createRepoDraftSource({ fetch: fetch.fetchImpl }),
    persist: createContentDocument,
    now: () => new Date('2026-09-28T12:00:00.000Z'),
    uuid: (() => {
      let n = 0;
      return () => `audit-${++n}`;
    })(),
    ...rest,
  });
  return { handlers, store, fetch, guard };
}

beforeEach(() => {
  context.log.mockClear();
  context.warn.mockClear();
  context.error.mockClear();
});

// ── the allow-list, at the request ─────────────────────────────────────────

describe('parseImportRequest', () => {
  it('accepts 1-10 allow-listed paths and drops repeats', () => {
    expect(parseImportRequest({ paths: [LAB_01, LAB_02, LAB_01] })).toEqual({
      ok: true,
      paths: [LAB_01, LAB_02],
    });
  });

  it.each([
    [null],
    [[]],
    [{}],
    [{ paths: 'docs/content/blog-lab-01-landing-zone.md' }],
    [{ paths: [] }],
    [{ paths: Array.from({ length: MAX_IMPORT_PATHS + 1 }, (_, i) => `docs/content/blog-x${i}.md`) }],
  ])('refuses a malformed body (%j)', (body) => {
    expect(parseImportRequest(body).ok).toBe(false);
  });

  it('names every path that fails the allow-list', () => {
    const result = parseImportRequest({
      paths: [LAB_01, '../secrets.md', 'docs/content/blog-template.md', 'infra/main.tf'],
    });
    expect(result.ok).toBe(false);
    expect(result.invalid.map((entry) => entry.path)).toEqual([
      '../secrets.md',
      'docs/content/blog-template.md',
      'infra/main.tf',
    ]);
  });
});

describe('POST import — a path outside the allow-list reaches nothing', () => {
  it.each([
    ['a traversal', 'docs/content/../../.github/workflows/ci.yml'],
    ['another directory', 'docs/architecture/blog-x.md'],
    ['the template', 'docs/content/blog-template.md'],
    ['the machine doc', 'docs/content/blog-machine.md'],
  ])('%s is a 400 for the whole request, before any fetch or read', async (_label, bad) => {
    const { handlers, store, fetch } = handlersWith();
    const res = parse(await handlers.importDrafts(makeRequest({ paths: [LAB_01, bad] }), context));
    expect(res.status).toBe(400);
    expect(res.body.invalid).toEqual([{ path: bad, reason: expect.any(String) }]);
    expect(fetch.fetchImpl).not.toHaveBeenCalled();
    expect(store.queryDocs).not.toHaveBeenCalled();
    expect(store.createDoc).not.toHaveBeenCalled();
  });
});

// ── the fetch, pinned ──────────────────────────────────────────────────────

describe('isPinnedUrl', () => {
  it.each([
    `${RAW_PREFIX}blog-lab-01-landing-zone.md`,
    `${API_PREFIX}contents/docs/content?ref=main`,
    `${API_PREFIX}commits?path=docs%2Fcontent%2Fblog-x.md&sha=main&per_page=1`,
  ])('admits %s', (url) => {
    expect(isPinnedUrl(url)).toBe(true);
  });

  it.each([
    ['another host', 'https://evil.test/HybridCloudWorks/HCW-HybridCloudWorks/main/docs/content/blog-x.md'],
    ['a look-alike suffix', 'https://raw.githubusercontent.com.evil.test/HybridCloudWorks/HCW-HybridCloudWorks/main/docs/content/blog-x.md'],
    ['userinfo before another host', 'https://raw.githubusercontent.com@evil.test/HybridCloudWorks/HCW-HybridCloudWorks/main/docs/content/blog-x.md'],
    ['userinfo on the right host', 'https://user:pw@raw.githubusercontent.com/HybridCloudWorks/HCW-HybridCloudWorks/main/docs/content/blog-x.md'],
    ['a port', 'https://raw.githubusercontent.com:8443/HybridCloudWorks/HCW-HybridCloudWorks/main/docs/content/blog-x.md'],
    ['plain http', 'http://raw.githubusercontent.com/HybridCloudWorks/HCW-HybridCloudWorks/main/docs/content/blog-x.md'],
    ['another repository', 'https://raw.githubusercontent.com/someone/else/main/docs/content/blog-x.md'],
    ['another branch', 'https://raw.githubusercontent.com/HybridCloudWorks/HCW-HybridCloudWorks/dev/docs/content/blog-x.md'],
    ['outside docs/content', 'https://raw.githubusercontent.com/HybridCloudWorks/HCW-HybridCloudWorks/main/infra/main.tf'],
    ['another repository on the API', 'https://api.github.com/repos/someone/else/contents/docs'],
    ['a GitHub page', 'https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/docs/content/blog-x.md'],
    ['not a URL', 'docs/content/blog-x.md'],
  ])('refuses %s', (_label, url) => {
    expect(isPinnedUrl(url)).toBe(false);
  });
});

describe('createRepoDraftSource — two hosts, no redirects, a cap and a deadline', () => {
  it('asks only for the pinned URLs, never follows a redirect and sends no credential', async () => {
    const fetch = githubFetch();
    const source = createRepoDraftSource({ fetch: fetch.fetchImpl });
    await source.listCandidates();
    await source.fetchDraft(LAB_01);
    await source.lastCommitSha(LAB_01);

    expect(fetch.calls.map((call) => call.url)).toEqual([
      `${API_PREFIX}contents/docs/content?ref=main`,
      `${RAW_PREFIX}blog-lab-01-landing-zone.md`,
      `${API_PREFIX}commits?path=docs%2Fcontent%2Fblog-lab-01-landing-zone.md&sha=main&per_page=1`,
    ]);
    for (const { url, init } of fetch.calls) {
      expect(isPinnedUrl(url)).toBe(true);
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    }
  });

  it('lists only importable blog files: not the contract docs, a README or a directory', async () => {
    const source = createRepoDraftSource({ fetch: githubFetch().fetchImpl });
    const candidates = await source.listCandidates();
    expect(candidates.map((c) => c.path)).toEqual([LAB_01, LAB_02, LAB_03]);
    expect(candidates[0]).toEqual({
      path: LAB_01,
      name: 'blog-lab-01-landing-zone.md',
      size: 100,
      blobSha: 'b'.repeat(40),
    });
  });

  it('returns the file, the URL it came from and its sha256', async () => {
    const source = createRepoDraftSource({ fetch: githubFetch().fetchImpl });
    const fetched = await source.fetchDraft(LAB_01);
    expect(fetched.text).toBe(LAB_TEXT[LAB_01]);
    expect(fetched.rawUrl).toBe(`${RAW_PREFIX}blog-lab-01-landing-zone.md`);
    expect(fetched.contentSha256).toBe(sha256Hex(Buffer.from(LAB_TEXT[LAB_01], 'utf8')));
  });

  it('refuses a 3xx even from a fetch that ignores redirect: error', async () => {
    const url = `${RAW_PREFIX}blog-lab-01-landing-zone.md`;
    const fetch = githubFetch({
      overrides: {
        [url]: () => textResponse('', { status: 302, headers: { location: 'https://evil.test/x' } }),
      },
    });
    await expect(
      createRepoDraftSource({ fetch: fetch.fetchImpl }).fetchDraft(LAB_01)
    ).rejects.toMatchObject({ code: 'REDIRECTED' });
    expect(fetch.calls).toHaveLength(1);
  });

  it('refuses a response that says it came from another URL', async () => {
    const url = `${RAW_PREFIX}blog-lab-01-landing-zone.md`;
    const fetch = githubFetch({
      overrides: { [url]: () => textResponse('---\ntitle: x\n---\nx', { url: 'https://evil.test/x.md' }) },
    });
    await expect(
      createRepoDraftSource({ fetch: fetch.fetchImpl }).fetchDraft(LAB_01)
    ).rejects.toMatchObject({ code: 'REDIRECTED' });
  });

  it("names undici's redirect: 'error' rejection as a redirect", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    });
    await expect(createRepoDraftSource({ fetch: fetchImpl }).fetchDraft(LAB_01)).rejects.toMatchObject({
      code: 'REDIRECTED',
    });
  });

  it('refuses a body over the cap, declared or streamed', async () => {
    const url = `${RAW_PREFIX}blog-lab-01-landing-zone.md`;
    const declared = githubFetch({
      overrides: {
        [url]: () => textResponse('small', { headers: { 'content-length': String(MAX_DRAFT_BYTES + 1) } }),
      },
    });
    await expect(
      createRepoDraftSource({ fetch: declared.fetchImpl }).fetchDraft(LAB_01)
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });

    // No Content-Length, and a stream that keeps going: the cap is enforced
    // as the bytes arrive, and the stream is cancelled rather than drained.
    let pulled = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel,
    });
    const streamed = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: '',
      headers: new Headers(),
      body: stream,
    }));
    await expect(createRepoDraftSource({ fetch: streamed }).fetchDraft(LAB_01)).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
    expect(cancel).toHaveBeenCalled();
    expect(pulled).toBeLessThan(MAX_DRAFT_BYTES / (64 * 1024) + 3);
  });

  it('gives up at the deadline, including on a body that never finishes', async () => {
    expect(GITHUB_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    const hung = vi.fn(
      (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    await expect(
      createRepoDraftSource({ fetch: hung, timeoutMs: 20 }).fetchDraft(LAB_01)
    ).rejects.toMatchObject({ code: 'TIMEOUT' });

    const trickle = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      url: '',
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          init.signal.addEventListener('abort', () =>
            controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        },
      }),
    }));
    await expect(
      createRepoDraftSource({ fetch: trickle, timeoutMs: 20 }).fetchDraft(LAB_01)
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('reports a used-up rate limit with its reset time, and a missing file as NOT_FOUND', async () => {
    const rateLimited = vi.fn(async () =>
      textResponse('{"message":"API rate limit exceeded"}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' },
      })
    );
    await expect(
      createRepoDraftSource({ fetch: rateLimited }).listCandidates()
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', resetAt: '2026-09-21T14:13:20.000Z' });

    await expect(
      createRepoDraftSource({ fetch: githubFetch().fetchImpl }).fetchDraft('docs/content/blog-gone.md')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a file that is not UTF-8', async () => {
    const url = `${RAW_PREFIX}blog-lab-01-landing-zone.md`;
    const bytes = Buffer.from([0xff, 0xfe, 0xfd]);
    const fetch = githubFetch({
      overrides: {
        [url]: () => ({ ...textResponse(''), headers: new Headers(), arrayBuffer: async () => bytes }),
      },
    });
    await expect(
      createRepoDraftSource({ fetch: fetch.fetchImpl }).fetchDraft(LAB_01)
    ).rejects.toMatchObject({ code: 'NOT_UTF8' });
  });

  it('treats the commit lookup as best-effort: a failure is null, never a throw', async () => {
    const failing = vi.fn(async () => textResponse('nope', { status: 500 }));
    await expect(createRepoDraftSource({ fetch: failing }).lastCommitSha(LAB_01)).resolves.toBeNull();
    const garbage = githubFetch({ commitSha: 'not-a-sha' });
    await expect(
      createRepoDraftSource({ fetch: garbage.fetchImpl }).lastCommitSha(LAB_01)
    ).resolves.toBeNull();
  });
});

// ── the role ───────────────────────────────────────────────────────────────

describe('the role', () => {
  it.each(['importDrafts', 'listCandidates'])('%s asks for editor and stops at a refusal', async (name) => {
    const { handlers, guard, store, fetch } = handlersWith({ guard: denyGuard() });
    const res = await handlers[name](makeRequest(name === 'importDrafts' ? { paths: [LAB_01] } : undefined), context);
    expect(res.status).toBe(403);
    expect(guard.requireRole).toHaveBeenCalledWith(expect.anything(), 'editor');
    expect(fetch.fetchImpl).not.toHaveBeenCalled();
    expect(store.queryDocs).not.toHaveBeenCalled();
  });
});

// ── creating: in_review, never published ───────────────────────────────────

describe('POST import — a new path', () => {
  it('lands each draft in review, create-only, with an audit row, and publishes nothing', async () => {
    const { handlers, store } = handlersWith();
    const res = parse(
      await handlers.importDrafts(makeRequest({ paths: [LAB_01, LAB_02, LAB_03] }), context)
    );
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ created: 3 });
    expect(res.body.results.map((r) => [r.path, r.outcome, r.contentStatus])).toEqual([
      [LAB_01, 'created', 'in_review'],
      [LAB_02, 'created', 'in_review'],
      [LAB_03, 'created', 'in_review'],
    ]);
    expect(res.body.results[0]).toMatchObject({
      contentId: repoDraftContentId(LAB_01),
      title: 'Build a landing zone you can read',
      slug: 'build-a-landing-zone-you-can-read',
      provider: 'Azure',
      embeds: { 'landing-zone': 1, 'pricing-scenario': 0 },
      repoCommitSha: SHA,
    });

    expect(store.docs.size).toBe(3);
    for (const doc of store.docs.values()) {
      expect(doc.contentStatus).toBe('in_review');
      expect(doc.contentStatus).not.toBe('published');
      expect(doc.Live).toBe(false);
      expect(doc).not.toHaveProperty('publishedAt');
      expect(doc.id).toBe(repoDraftContentId(doc.repoPath));
      expect(doc.repoCommitSha).toBe(SHA);
      expect(doc.content).toContain('```landing-zone\nlz=mg,policy,mgmt,hub&corp=0&online=0\n```');
    }
    // Content was only ever created — never upserted, never patched.
    expect(store.createDoc).toHaveBeenCalledTimes(3);
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(store.upsertDoc.mock.calls.every(([container]) => container === 'admin_audit_logs')).toBe(true);

    expect(store.audits).toHaveLength(3);
    expect(store.audits[0]).toMatchObject({
      action: 'content_repo_import',
      userId: 'u1',
      userEmail: 'editor@hcw.dev',
      contentId: repoDraftContentId(LAB_01),
      details: { repoPath: LAB_01, repoRef: 'main', repoCommitSha: SHA, outcome: 'created', contentStatus: 'in_review' },
    });
  });

  it('records main alone when the commit lookup fails', async () => {
    const fetch = githubFetch({ commitSha: null });
    const { handlers, store } = handlersWith({ fetch });
    await handlers.importDrafts(makeRequest({ paths: [LAB_01] }), context);
    const doc = store.docs.get(repoDraftContentId(LAB_01));
    expect(doc).toMatchObject({ repoRef: 'main', repoCommitSha: null, contentStatus: 'in_review' });
  });

  it('refuses, and creates nothing, when an article like it already exists (the dedup gate)', async () => {
    // Pasted by hand earlier today, with the same title.
    const handPasted = {
      id: 'hand-1',
      Title: 'Build a landing zone you can read',
      normalizedTitle: 'build a landing zone you can read',
      fetchedAt: new Date().toISOString(),
      contentStatus: 'inspected',
    };
    const { handlers, store } = handlersWith({ store: memoryStore([handPasted]) });
    const res = parse(await handlers.importDrafts(makeRequest({ paths: [LAB_01] }), context));
    expect(res.body.results[0]).toMatchObject({
      outcome: 'refused',
      code: 'DUPLICATE',
      existingId: 'hand-1',
      duplicateReason: 'title_within_window',
    });
    expect(store.createDoc).not.toHaveBeenCalled();
    expect(store.docs.size).toBe(1);
  });

  it('refuses a draft whose title a published article already carries, however old', async () => {
    // Published by hand in August: outside the dedup gate's seven-day window.
    const live = {
      id: 'live-1',
      Title: 'Build a landing zone you can read',
      normalizedTitle: 'build a landing zone you can read',
      contentStatus: 'published',
      Live: true,
      publishedAt: '2026-08-01T00:00:00.000Z',
      content: 'the live text',
    };
    const { handlers, store } = handlersWith({ store: memoryStore([live]) });
    const res = parse(await handlers.importDrafts(makeRequest({ paths: [LAB_01] }), context));
    expect(res.body.results[0]).toMatchObject({
      outcome: 'refused',
      code: 'PUBLISHED_ELSEWHERE',
      existingId: 'live-1',
    });
    expect(store.createDoc).not.toHaveBeenCalled();
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(store.docs.get('live-1')).toMatchObject({ content: 'the live text', Live: true });
  });

  it('does not treat an old unpublished article with the same title as published', async () => {
    const old = {
      id: 'old-draft',
      normalizedTitle: 'build a landing zone you can read',
      contentStatus: 'rejected',
      Live: false,
      fetchedAt: '2026-08-01T00:00:00.000Z',
    };
    const { handlers, store } = handlersWith({ store: memoryStore([old]) });
    const res = parse(await handlers.importDrafts(makeRequest({ paths: [LAB_01] }), context));
    expect(res.body.results[0].outcome).toBe('created');
    expect(store.docs.size).toBe(2);
  });

  it('refuses rather than duplicates when a racing import created the id first', async () => {
    const { handlers, store } = handlersWith();
    // The race: the repoPath lookup saw nothing, and the id exists by the time
    // the create runs.
    store.queryDocs.mockImplementationOnce(async () => []);
    store.docs.set(repoDraftContentId(LAB_01), {
      id: repoDraftContentId(LAB_01),
      contentStatus: 'in_review',
      _etag: '"x"',
    });
    const res = parse(await handlers.importDrafts(makeRequest({ paths: [LAB_01] }), context));
    expect(res.body.results[0]).toMatchObject({ outcome: 'refused', code: 'ALREADY_EXISTS' });
    expect(store.docs.size).toBe(1);
  });

  it('refuses a file without front matter and reports a missing file, per path', async () => {
    const fetch = githubFetch({
      files: { [LAB_01]: '# No front matter\n\nJust text.', [LAB_02]: LAB_TEXT[LAB_02] },
    });
    const { handlers, store } = handlersWith({ fetch });
    const res = parse(
      await handlers.importDrafts(makeRequest({ paths: [LAB_01, LAB_02, LAB_03] }), context)
    );
    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => [r.outcome, r.code])).toEqual([
      ['refused', 'NO_FRONT_MATTER'],
      ['created', undefined],
      ['failed', 'NOT_FOUND'],
    ]);
    expect([...store.docs.keys()]).toEqual([repoDraftContentId(LAB_02)]);
    expect(store.audits).toHaveLength(3);
  });

  it('a failed audit write does not fail the import', async () => {
    const store = memoryStore();
    store.upsertDoc.mockRejectedValue(new Error('audit container down'));
    const { handlers } = handlersWith({ store, log: context });
    const res = parse(await handlers.importDrafts(makeRequest({ paths: [LAB_01] }), context));
    expect(res.status).toBe(200);
    expect(res.body.results[0].outcome).toBe('created');
    expect(context.error).toHaveBeenCalledWith('[repo-import] audit row failed', expect.any(Error));
  });
});

// ── re-importing: idempotent, and never past review ────────────────────────

describe('POST import — a path already imported', () => {
  it('is idempotent: the same file again writes nothing, a changed file updates the same document', async () => {
    const files = { ...LAB_TEXT };
    const fetch = githubFetch({ files });
    const { handlers, store } = handlersWith({ fetch });
    await handlers.importDrafts(makeRequest({ paths: [LAB_01] }), context);
    const id = repoDraftContentId(LAB_01);
    const firstEtag = store.docs.get(id)._etag;

    const again = parse(await handlers.importDrafts(makeRequest({ paths: [LAB_01] }), context));
    expect(again.body.results[0]).toMatchObject({ outcome: 'unchanged', contentId: id });
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(store.docs.get(id)._etag).toBe(firstEtag);

    // The owner edits the draft on main; a reviewer has set the topics meanwhile.
    files[LAB_01] = LAB_TEXT[LAB_01]
      .replace('title: Build a landing zone you can read', 'title: Build a landing zone you can read twice')
      .replace('The platform half', 'The whole platform half');
    store.docs.set(id, { ...store.docs.get(id), keyTopics: ['chosen by the reviewer'], 'Cloud Provider': 'Terraform' });

    const updated = parse(await handlers.importDrafts(makeRequest({ paths: [LAB_01] }), context));
    expect(updated.body.results[0]).toMatchObject({
      outcome: 'updated',
      contentId: id,
      contentStatus: 'in_review',
      title: 'Build a landing zone you can read twice',
    });
    expect(store.docs.size).toBe(1);
    const doc = store.docs.get(id);
    expect(doc).toMatchObject({
      Title: 'Build a landing zone you can read twice',
      contentStatus: 'in_review',
      Live: false,
      keyTopics: ['chosen by the reviewer'],
      'Cloud Provider': 'Terraform',
      normalizedTitle: 'build a landing zone you can read twice',
    });
    expect(doc.content).toContain('The whole platform half');
    // Conditioned on the ETag of the read that decided it.
    expect(store.patchDoc).toHaveBeenCalledTimes(1);
    expect(store.patchDoc.mock.calls[0][3]).toEqual({ ifMatch: expect.stringMatching(/^"e\d+"$/) });
    expect(store.patchDoc.mock.calls[0][2]).not.toHaveProperty('contentStatus');
    expect(store.patchDoc.mock.calls[0][2]).not.toHaveProperty('Live');
    expect(store.createDoc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['published and live', { contentStatus: 'published', Live: true }, 'LIVE'],
    ['published but staged', { contentStatus: 'published', Live: false }, 'NOT_IN_REVIEW'],
    ['approved', { contentStatus: 'approved', Live: false }, 'NOT_IN_REVIEW'],
    ['in the editor', { contentStatus: 'editing', Live: false }, 'NOT_IN_REVIEW'],
    ['rejected', { contentStatus: 'rejected', Live: false }, 'NOT_IN_REVIEW'],
    ['live while claiming review', { contentStatus: 'in_review', Live: true }, 'LIVE'],
  ])('refuses an article that is %s, without fetching or writing', async (_label, state, code) => {
    const published = {
      id: repoDraftContentId(LAB_01),
      repoPath: LAB_01,
      Title: 'Build a landing zone you can read',
      content: 'the published text',
      ...state,
    };
    const { handlers, store, fetch } = handlersWith({ store: memoryStore([published]) });
    const res = parse(await handlers.importDrafts(makeRequest({ paths: [LAB_01] }), context));
    expect(res.body.results[0]).toMatchObject({ outcome: 'refused', code, contentId: published.id });
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(store.createDoc).not.toHaveBeenCalled();
    expect(fetch.fetchImpl).not.toHaveBeenCalled();
    expect(store.docs.get(published.id)).toMatchObject({ ...state, content: 'the published text' });
    expect(store.audits[0].details).toMatchObject({ outcome: 'refused', code });
  });

  it('refuses when the article moves on between the read and the write (412)', async () => {
    const inReview = {
      id: repoDraftContentId(LAB_01),
      repoPath: LAB_01,
      contentStatus: 'in_review',
      Live: false,
      repoContentSha256: 'old',
    };
    const store = memoryStore([inReview]);
    // A reviewer approves it while the file is being fetched.
    const fetch = githubFetch();
    const original = fetch.fetchImpl.getMockImplementation();
    fetch.fetchImpl.mockImplementation(async (url, init) => {
      const doc = store.docs.get(inReview.id);
      store.docs.set(inReview.id, { ...doc, contentStatus: 'approved', _etag: '"approved"' });
      return original(url, init);
    });
    const { handlers } = handlersWith({ store, fetch });
    const res = parse(await handlers.importDrafts(makeRequest({ paths: [LAB_01] }), context));
    expect(res.body.results[0]).toMatchObject({ outcome: 'refused', code: 'CHANGED_DURING_IMPORT' });
    expect(store.docs.get(inReview.id)).toMatchObject({ contentStatus: 'approved', repoContentSha256: 'old' });
  });

  it('refuses a path two documents claim', async () => {
    const store = memoryStore([
      { id: 'a', repoPath: LAB_01, contentStatus: 'in_review' },
      { id: 'b', repoPath: LAB_01, contentStatus: 'in_review' },
    ]);
    const { handlers, fetch } = handlersWith({ store });
    const res = parse(await handlers.importDrafts(makeRequest({ paths: [LAB_01] }), context));
    expect(res.body.results[0]).toMatchObject({ outcome: 'refused', code: 'AMBIGUOUS', contentIds: ['a', 'b'] });
    expect(fetch.fetchImpl).not.toHaveBeenCalled();
  });
});

// ── the candidate list ─────────────────────────────────────────────────────

describe('GET candidates', () => {
  it('lists the drafts on main and marks what is imported and what may be re-imported', async () => {
    const store = memoryStore([
      {
        id: 'in-review',
        repoPath: LAB_01,
        contentStatus: 'in_review',
        Live: false,
        repoCommitSha: SHA,
        repoImportedAt: '2026-09-28T10:00:00.000Z',
      },
      { id: 'live', repoPath: LAB_02, contentStatus: 'published', Live: true, repoImportedAt: '2026-09-27T10:00:00.000Z' },
      { id: 'unrelated', contentStatus: 'in_review' },
    ]);
    const { handlers } = handlersWith({ store });
    const res = parse(await handlers.listCandidates(makeRequest(), context));
    expect(res.status).toBe(200);
    expect(res.body.repo).toEqual({ owner: 'HybridCloudWorks', name: 'HCW-HybridCloudWorks', ref: 'main' });
    expect(res.body.candidates.map((c) => [c.path, c.importable, c.imported?.contentStatus ?? null])).toEqual([
      [LAB_01, true, 'in_review'],
      [LAB_02, false, 'published'],
      [LAB_03, true, null],
    ]);
    expect(res.body.candidates[0].imported).toEqual({
      contentId: 'in-review',
      contentStatus: 'in_review',
      live: false,
      repoCommitSha: SHA,
      importedAt: '2026-09-28T10:00:00.000Z',
    });
    expect(res.body.candidates[1].imported.live).toBe(true);
  });

  it('answers 503 with the reset time when GitHub rate-limits, and 502 when it is unreachable', async () => {
    const limited = {
      fetchImpl: vi.fn(async () =>
        textResponse('{}', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' },
        })
      ),
    };
    const limitedRes = parse(await handlersWith({ fetch: limited }).handlers.listCandidates(makeRequest(), context));
    expect(limitedRes.status).toBe(503);
    expect(limitedRes.body).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect(limitedRes.body.error).toMatch(/2026-09-21T14:13:20.000Z/);

    const down = { fetchImpl: vi.fn(async () => { throw new TypeError('fetch failed'); }) };
    const downRes = parse(await handlersWith({ fetch: down }).handlers.listCandidates(makeRequest(), context));
    expect(downRes.status).toBe(502);
    expect(downRes.body.code).toBe('FETCH_FAILED');
  });
});
