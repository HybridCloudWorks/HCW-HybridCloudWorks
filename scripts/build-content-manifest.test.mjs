/**
 * What the manifest fetch says when it fails.
 *
 * This exists because of one sentence. The failure message used to read "a 403
 * usually means the per-run origin window is closed or has not propagated;
 * anything else is the app itself", and on 2026-08-31 a 404 was read as "the
 * app itself" — so the investigation went at a Function App reporting 121
 * registered functions and every health row green. The app was fine. The route
 * had simply never been deployed.
 *
 * A message is not usually worth a test. This one is, because it is the only
 * thing the nightly job leaves behind: nobody watches the run, they read the
 * one line in the failure email. Getting it wrong does not fail loudly — it
 * sends a person somewhere else, which is more expensive than no message.
 */
import { describe, it, expect } from 'vitest';
import { buildManifest, describeFetchFailure } from './build-content-manifest.mjs';

const URL = 'https://func-site-prod-cus-01.azurewebsites.net/api/public/content-manifest';

describe('describeFetchFailure', () => {
  it('sends a 403 at the origin window and nowhere else', () => {
    const message = describeFetchFailure(403, URL);
    expect(message).toContain('403');
    expect(message).toContain('origin window');
    // The distinguishing claim: a 403 is not a deploy problem.
    expect(message).not.toContain('Deploy Functions');
  });

  it('sends a 404 at the deployed revision, not at the app', () => {
    const message = describeFetchFailure(404, URL);
    expect(message).toContain('404');
    expect(message).toContain('Deploy Functions');
    expect(message).toContain('public-content-manifest.js');
    // THE ASSERTION THIS FILE EXISTS FOR. The old message routed a 404 to "the
    // app itself"; saying the host answered is what separates a missing deploy
    // from an outage.
    expect(message).toMatch(/host answered/i);
    expect(message).not.toMatch(/this is the app itself/i);
  });

  it('sends anything else at the app, and says why it is neither of the other two', () => {
    const message = describeFetchFailure(500, URL);
    expect(message).toContain('500');
    expect(message).toMatch(/this is the app itself/i);
    expect(message).toContain('403');
    expect(message).toContain('404');
  });

  it('names the URL in every case, so the line stands alone in an email', () => {
    for (const status of [403, 404, 500, 502]) {
      expect(describeFetchFailure(status, URL)).toContain(URL);
    }
  });
});

describe('buildManifest', () => {
  const azure = (id, slug) => ({
    id,
    slug,
    cloudProvider: 'azure',
    title: `Item ${id}`,
  });

  it('lists one route per slug and names the duplicates it dropped', () => {
    // The live sitemap of 2026-09-06 carried one blog URL three times because
    // the published set held the same slug three times (issue #373).
    const manifest = buildManifest([
      azure('a1', 'enable-ai-powered-discovery'),
      azure('a2', 'enable-ai-powered-discovery'),
      azure('a3', 'another-article'),
      azure('a4', 'enable-ai-powered-discovery'),
    ]);

    expect(manifest.routes).toEqual([
      '/azure/blog/enable-ai-powered-discovery',
      '/azure/blog/another-article',
    ]);
    expect(manifest.skipped).toEqual([
      'enable-ai-powered-discovery: duplicate slug (item a2); first occurrence kept',
      'enable-ai-powered-discovery: duplicate slug (item a4); first occurrence kept',
    ]);
  });

  it('keeps the first occurrence, not the last', () => {
    const manifest = buildManifest([
      { ...azure('a1', 'same'), title: 'first' },
      { ...azure('a2', 'same'), title: 'second' },
    ]);
    expect(manifest.data['article:same'].title).toBe('first');
  });
});
