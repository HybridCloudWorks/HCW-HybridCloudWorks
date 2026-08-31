/**
 * Opening the manifest pull request (T-726).
 *
 * ## The two failures this catches
 *
 * GraphQL answers **200 with an `errors` array**, so `response.ok` says nothing
 * about whether `enablePullRequestAutoMerge` ran. Treating a 200 as success
 * would report auto-merge as armed when it was refused — and the manifest would
 * then sit in an open pull request that everyone believed was merging itself.
 * `allow_auto_merge` was false on this repository when this was written, so
 * that is the path the first run takes.
 *
 * And a refused auto-merge must not fail the job. The pull request exists
 * either way; a red nightly job with no manifest is strictly worse than an open
 * pull request someone merges by hand.
 */
import { describe, it, expect } from 'vitest';
import {
  autoMergeOutcome,
  openManifestPullRequest,
  parseCreatedPullRequest,
} from './open-manifest-pr.mjs';

describe('parseCreatedPullRequest', () => {
  it('reads the number and node id', () => {
    expect(
      parseCreatedPullRequest({ number: 301, node_id: 'PR_x', html_url: 'https://x.test/301' })
    ).toEqual({ number: 301, nodeId: 'PR_x', url: 'https://x.test/301' });
  });

  // Returning null here would leave a branch pushed with nothing tracking it,
  // and the job reporting success.
  it('throws on a payload it cannot read rather than returning null', () => {
    expect(() => parseCreatedPullRequest({})).toThrow(/integer `number`/);
    expect(() => parseCreatedPullRequest({ number: 1 })).toThrow(/node_id/);
    expect(() => parseCreatedPullRequest(null)).toThrow(/integer `number`/);
  });
});

describe('autoMergeOutcome', () => {
  it('treats a clean response as armed', () => {
    expect(autoMergeOutcome({ data: { enablePullRequestAutoMerge: {} } })).toEqual({
      enabled: true,
      reason: null,
    });
  });

  // THE FAILURE THIS FILE EXISTS FOR: HTTP 200 carrying errors.
  it('treats a 200 carrying errors as NOT armed, and keeps the reason', () => {
    const outcome = autoMergeOutcome({
      errors: [{ message: 'Auto-merge is not allowed for this repository' }],
    });
    expect(outcome.enabled).toBe(false);
    expect(outcome.reason).toMatch(/not allowed/);
  });

  it('still reports not-armed when the error carries no message', () => {
    expect(autoMergeOutcome({ errors: [{}] })).toEqual({
      enabled: false,
      reason: 'GraphQL refused the mutation without a message',
    });
  });
});

describe('openManifestPullRequest', () => {
  function fakeFetch(steps) {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url, init });
      const next = steps.shift();
      if (!next) throw new Error(`unexpected call to ${url}`);
      return next;
    };
    impl.calls = calls;
    return impl;
  }
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const created = ok({ number: 301, node_id: 'PR_x', html_url: 'https://x.test/301' });

  it('creates the pull request against the given head and base', async () => {
    const fetchImpl = fakeFetch([created, ok({ data: {} })]);
    const pull = await openManifestPullRequest({
      token: 't',
      owner: 'o',
      repo: 'r',
      head: 'chore/manifest-1',
      title: 'T',
      body: 'B',
      fetchImpl,
    });

    expect(pull.number).toBe(301);
    expect(pull.autoMerge.enabled).toBe(true);
    expect(JSON.parse(fetchImpl.calls[0].init.body)).toEqual({
      title: 'T',
      body: 'B',
      head: 'chore/manifest-1',
      base: 'main',
    });
  });

  it('reports auto-merge unarmed without throwing when GraphQL refuses', async () => {
    const fetchImpl = fakeFetch([created, ok({ errors: [{ message: 'not allowed' }] })]);
    const pull = await openManifestPullRequest({
      token: 't',
      owner: 'o',
      repo: 'r',
      head: 'h',
      fetchImpl,
    });
    expect(pull.number).toBe(301);
    expect(pull.autoMerge).toEqual({ enabled: false, reason: 'not allowed' });
  });

  it('reports unarmed without throwing when the mutation call itself fails', async () => {
    const fetchImpl = fakeFetch([created, { ok: false, status: 502, json: async () => ({}) }]);
    const pull = await openManifestPullRequest({
      token: 't',
      owner: 'o',
      repo: 'r',
      head: 'h',
      fetchImpl,
    });
    expect(pull.autoMerge.enabled).toBe(false);
    expect(pull.autoMerge.reason).toMatch(/502/);
  });

  // Creating the pull request is the part that must fail loudly: without it
  // there is nothing tracking the pushed branch.
  it('throws when the pull request cannot be created', async () => {
    const fetchImpl = fakeFetch([{ ok: false, status: 422, json: async () => ({}) }]);
    await expect(
      openManifestPullRequest({ token: 't', owner: 'o', repo: 'r', head: 'h', fetchImpl })
    ).rejects.toThrow(/was not pushed, or a pull request for it is already open/);
  });
});
