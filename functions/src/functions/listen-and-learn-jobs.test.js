/**
 * Generation payload validation.
 *
 * `studyGuideUrl` is fetched server-side by the Function App's managed
 * identity, from inside the VNet. An attacker-chosen URL there is an SSRF
 * foothold, not a typo — which is why the scheme check is a hard `https://`
 * prefix test and why it is pinned here rather than left to the parser.
 */
import { describe, it, expect, vi } from 'vitest';

// The module registers a job type on import, and registerJobType throws on a
// duplicate — so the registry is faked rather than shared across test files.
vi.mock('../lib/jobs.js', () => ({ registerJobType: vi.fn() }));
vi.mock('../lib/cosmos-client.js', () => ({
  readDoc: vi.fn(),
  upsertDoc: vi.fn(),
  patchDoc: vi.fn(),
}));
vi.mock('../lib/blob-storage.js', () => ({ uploadBlob: vi.fn() }));
vi.mock('../lib/ai/router.js', () => ({
  generateJsonResponse: vi.fn(),
  getActiveAiProvider: vi.fn(),
}));

const { parseGeneratePayload, MAX_AREAS_PER_RUN } = await import('./listen-and-learn-jobs.js');

const valid = (over = {}) => ({
  platform: 'azure',
  examCode: 'AZ-104',
  studyGuideUrl: 'https://learn.microsoft.com/credentials/az-104',
  ...over,
});

describe('parseGeneratePayload', () => {
  it('accepts a well-formed request and normalises the platform', () => {
    const { value, error } = parseGeneratePayload(valid({ platform: 'AZURE' }));
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      platform: 'azure',
      examCode: 'AZ-104',
      studyGuideUrl: 'https://learn.microsoft.com/credentials/az-104',
      areas: null,
    });
  });

  it('carries the optional certification identity through', () => {
    const { value } = parseGeneratePayload(
      valid({ certTitle: '  Azure Administrator  ', certSlug: 'az-104' })
    );
    expect(value.cert).toEqual({ title: 'Azure Administrator', slug: 'az-104' });
  });

  it('nulls a blank certification title rather than storing an empty string', () => {
    const { value } = parseGeneratePayload(valid({ certTitle: '   ' }));
    expect(value.cert.title).toBeNull();
  });

  it('refuses a platform with no study-guide adapter, naming the ones there are', () => {
    const { error } = parseGeneratePayload(valid({ platform: 'vmware' }));
    expect(error).toMatch(/not available for "vmware"/);
    expect(error).toMatch(/azure, github, aws/);
  });

  it('refuses every non-https study guide URL', () => {
    // http is downgradeable, and file/localhost/metadata URLs are the actual
    // SSRF targets on a Function App inside a VNet.
    for (const studyGuideUrl of [
      'http://learn.microsoft.com/x',
      'file:///etc/passwd',
      'http://169.254.169.254/metadata/instance',
      'HTTPS://learn.microsoft.com/x', // scheme is case-sensitive in this test
      '//learn.microsoft.com/x',
      '',
    ]) {
      expect(parseGeneratePayload(valid({ studyGuideUrl })).error).toBe(
        'studyGuideUrl must be an https URL'
      );
    }
  });

  it('accepts an https URL', () => {
    expect(parseGeneratePayload(valid()).error).toBeUndefined();
  });

  it('requires an exam code', () => {
    expect(parseGeneratePayload(valid({ examCode: '  ' })).error).toBe('examCode is required');
  });

  it('bounds how many areas one run may generate', () => {
    // Each area is a model call plus one or more synthesis requests; an
    // unbounded list is an unbounded spend.
    const areas = Array.from({ length: MAX_AREAS_PER_RUN + 1 }, (_, i) => `area-${i}`);
    expect(parseGeneratePayload(valid({ areas })).error).toMatch(
      new RegExp(`At most ${MAX_AREAS_PER_RUN} areas`)
    );

    const ok = areas.slice(0, MAX_AREAS_PER_RUN);
    expect(parseGeneratePayload(valid({ areas: ok })).error).toBeUndefined();
  });

  it('ignores a non-array areas value instead of trusting it', () => {
    expect(parseGeneratePayload(valid({ areas: 'area-1' })).value.areas).toBeNull();
  });

  it('refuses a missing payload without throwing', () => {
    expect(parseGeneratePayload(undefined).error).toBeTruthy();
    expect(parseGeneratePayload(null).error).toBeTruthy();
  });
});
