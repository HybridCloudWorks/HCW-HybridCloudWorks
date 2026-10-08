/**
 * The GitHub side of the repository draft import: repo-draft-source.js. Two
 * hosts, no token, no redirects, one deadline over headers and body, a byte
 * cap. Moved unchanged from repo-import.test.js when that route was retired
 * for the Drafts page (drafts-handlers.js), which reads docs/content through
 * the same source.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  GITHUB_FETCH_TIMEOUT_MS,
  MAX_DRAFT_BYTES,
  createRepoDraftSource,
  isPinnedUrl,
} from './repo-draft-source.js';
import { sha256Hex } from './repo-draft.js';
import {
  API_PREFIX,
  LAB_01,
  LAB_02,
  LAB_03,
  LAB_TEXT,
  RAW_PREFIX,
  githubFetch,
  textResponse,
} from './repo-draft-github.test-helper.js';

describe('isPinnedUrl', () => {
  it.each([
    `${RAW_PREFIX}blog-lab-01-landing-zone.md`,
    `${API_PREFIX}contents/docs/content?ref=main`,
    `${API_PREFIX}commits?path=docs%2Fcontent%2Fblog-x.md&sha=main&per_page=1`,
  ])('admits %s', (url) => {
    expect(isPinnedUrl(url)).toBe(true);
  });

  it.each([
    [
      'another host',
      'https://evil.test/saulpatinojr/HCW-HybridCloudWorks/main/docs/content/blog-x.md',
    ],
    [
      'a look-alike suffix',
      'https://raw.githubusercontent.com.evil.test/saulpatinojr/HCW-HybridCloudWorks/main/docs/content/blog-x.md',
    ],
    [
      'userinfo before another host',
      'https://raw.githubusercontent.com@evil.test/saulpatinojr/HCW-HybridCloudWorks/main/docs/content/blog-x.md',
    ],
    [
      'userinfo on the right host',
      'https://user:pw@raw.githubusercontent.com/saulpatinojr/HCW-HybridCloudWorks/main/docs/content/blog-x.md',
    ],
    [
      'a port',
      'https://raw.githubusercontent.com:8443/saulpatinojr/HCW-HybridCloudWorks/main/docs/content/blog-x.md',
    ],
    [
      'plain http',
      'http://raw.githubusercontent.com/saulpatinojr/HCW-HybridCloudWorks/main/docs/content/blog-x.md',
    ],
    [
      'another repository',
      'https://raw.githubusercontent.com/someone/else/main/docs/content/blog-x.md',
    ],
    [
      'another branch',
      'https://raw.githubusercontent.com/saulpatinojr/HCW-HybridCloudWorks/dev/docs/content/blog-x.md',
    ],
    [
      'outside docs/content',
      'https://raw.githubusercontent.com/saulpatinojr/HCW-HybridCloudWorks/main/infra/main.tf',
    ],
    ['another repository on the API', 'https://api.github.com/repos/someone/else/contents/docs'],
    [
      'a GitHub page',
      'https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/docs/content/blog-x.md',
    ],
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
        [url]: () =>
          textResponse('', { status: 302, headers: { location: 'https://evil.test/x' } }),
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
      overrides: {
        [url]: () => textResponse('---\ntitle: x\n---\nx', { url: 'https://evil.test/x.md' }),
      },
    });
    await expect(
      createRepoDraftSource({ fetch: fetch.fetchImpl }).fetchDraft(LAB_01)
    ).rejects.toMatchObject({ code: 'REDIRECTED' });
  });

  it("names undici's redirect: 'error' rejection as a redirect", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    });
    await expect(
      createRepoDraftSource({ fetch: fetchImpl }).fetchDraft(LAB_01)
    ).rejects.toMatchObject({
      code: 'REDIRECTED',
    });
  });

  it('refuses a body over the cap, declared or streamed', async () => {
    const url = `${RAW_PREFIX}blog-lab-01-landing-zone.md`;
    const declared = githubFetch({
      overrides: {
        [url]: () =>
          textResponse('small', { headers: { 'content-length': String(MAX_DRAFT_BYTES + 1) } }),
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
    await expect(
      createRepoDraftSource({ fetch: streamed }).fetchDraft(LAB_01)
    ).rejects.toMatchObject({
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
      createRepoDraftSource({ fetch: githubFetch().fetchImpl }).fetchDraft(
        'docs/content/blog-gone.md'
      )
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a file that is not UTF-8', async () => {
    const url = `${RAW_PREFIX}blog-lab-01-landing-zone.md`;
    const bytes = Buffer.from([0xff, 0xfe, 0xfd]);
    const fetch = githubFetch({
      overrides: {
        [url]: () => ({
          ...textResponse(''),
          headers: new Headers(),
          arrayBuffer: async () => bytes,
        }),
      },
    });
    await expect(
      createRepoDraftSource({ fetch: fetch.fetchImpl }).fetchDraft(LAB_01)
    ).rejects.toMatchObject({ code: 'NOT_UTF8' });
  });

  it('treats the commit lookup as best-effort: a failure is null, never a throw', async () => {
    const failing = vi.fn(async () => textResponse('nope', { status: 500 }));
    await expect(
      createRepoDraftSource({ fetch: failing }).lastCommitSha(LAB_01)
    ).resolves.toBeNull();
    const garbage = githubFetch({ commitSha: 'not-a-sha' });
    await expect(
      createRepoDraftSource({ fetch: garbage.fetchImpl }).lastCommitSha(LAB_01)
    ).resolves.toBeNull();
  });
});
