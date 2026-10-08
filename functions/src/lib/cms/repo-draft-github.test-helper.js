/**
 * A fetch double that answers like GitHub for the three calls
 * repo-draft-source.js makes — the contents listing, the raw file and the
 * commit lookup — and records every URL it is asked for. Shared by
 * repo-draft-source.test.js and drafts-handlers.test.js (moved here from the
 * retired repo-import.test.js).
 */
import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LAB_01 = 'docs/content/blog-lab-01-landing-zone.md';
export const LAB_02 = 'docs/content/blog-lab-02-one-container.md';
export const LAB_03 = 'docs/content/blog-lab-03-agent-explains.md';

/** The three lab drafts, read from the repository's own docs/content. */
export const LAB_TEXT = Object.fromEntries(
  [LAB_01, LAB_02, LAB_03].map((path) => [
    path,
    readFileSync(join(process.cwd(), '..', ...path.split('/')), 'utf8'),
  ])
);
export const SHA = '2fb230c9ac7118c4f87d4cf8031e0571d47e74d8';

export const RAW_PREFIX =
  'https://raw.githubusercontent.com/saulpatinojr/HCW-HybridCloudWorks/main/docs/content/';
export const API_PREFIX = 'https://api.github.com/repos/saulpatinojr/HCW-HybridCloudWorks/';

export function textResponse(body, { status = 200, headers = {}, url = '' } = {}) {
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

/** One raw file, or GitHub's 404 for a path the repository does not hold. */
function rawFile(files, url) {
  const text = files[`docs/content/${url.slice(RAW_PREFIX.length)}`];
  return text === undefined
    ? textResponse('404: Not Found', { status: 404, url })
    : textResponse(text, { url });
}

/** URL prefix → canned answer. The listing also carries the two contract docs and a README. */
function githubRoutes({ files, commitSha }) {
  const listed = [
    ...Object.keys(files),
    'docs/content/blog-template.md',
    'docs/content/blog-machine.md',
    'docs/content/README.md',
  ];
  const commits = JSON.stringify(commitSha ? [{ sha: commitSha }] : []);
  return [
    [`${API_PREFIX}contents/docs/content`, (url) => textResponse(listing(listed), { url })],
    [`${API_PREFIX}commits?`, (url) => textResponse(commits, { url })],
    [RAW_PREFIX, (url) => rawFile(files, url)],
  ];
}

/** Routes a URL to a canned response; records every call. */
export function githubFetch({ files = LAB_TEXT, commitSha = SHA, overrides = {} } = {}) {
  const calls = [];
  const routes = githubRoutes({ files, commitSha });
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url, init });
    const answer = overrides[url] || routes.find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!answer) throw new Error(`unexpected fetch ${url}`);
    return answer(url, init);
  });
  return { fetchImpl, calls };
}
