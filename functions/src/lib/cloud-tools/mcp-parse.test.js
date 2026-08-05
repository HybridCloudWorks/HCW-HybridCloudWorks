import { describe, expect, it } from 'vitest';

import {
  parseMcpResponseBody,
  toTextContent,
  normalizeAwsSearchResults,
  normalizeMicrosoftSearchResults,
} from './mcp-parse.js';

/**
 * The two `normalize*` cases are ported from Site-Main
 * `functions/cloud-tools-mcp.test.js` (commit 07f3123) unchanged.
 *
 * The rest are added here. `parseMcpResponseBody` and `toTextContent` had no
 * coverage in the original despite being the functions that decide whether a
 * third-party documentation response degrades gracefully or takes a request
 * down with it — worth pinning before the handlers start depending on them.
 */

describe('normalizeAwsSearchResults', () => {
  it('normalizes AWS knowledge results into comparison-friendly references', () => {
    const normalized = normalizeAwsSearchResults({
      structuredContent: {
        results: [
          {
            title: 'Amazon EC2 pricing',
            url: 'https://docs.aws.amazon.com/ec2/',
            context: 'Pricing and purchasing options for EC2.',
          },
        ],
      },
    });

    expect(normalized).toEqual([
      {
        title: 'Amazon EC2 pricing',
        url: 'https://docs.aws.amazon.com/ec2/',
        snippet: 'Pricing and purchasing options for EC2.',
        source: 'aws-knowledge-mcp',
      },
    ]);
  });

  it('caps at three results', () => {
    const results = Array.from({ length: 10 }, (_, i) => ({ title: `r${i}`, url: '', context: '' }));
    expect(normalizeAwsSearchResults({ results })).toHaveLength(3);
  });

  it('falls back to a default title and empty strings for missing fields', () => {
    expect(normalizeAwsSearchResults({ results: [{}] })).toEqual([
      { title: 'AWS documentation', url: '', snippet: '', source: 'aws-knowledge-mcp' },
    ]);
  });

  it('returns an empty array for a malformed payload rather than throwing', () => {
    expect(normalizeAwsSearchResults(undefined)).toEqual([]);
    expect(normalizeAwsSearchResults({})).toEqual([]);
    expect(normalizeAwsSearchResults({ results: 'not an array' })).toEqual([]);
  });
});

describe('normalizeMicrosoftSearchResults', () => {
  it('normalizes Microsoft docs search results into comparison-friendly references', () => {
    const normalized = normalizeMicrosoftSearchResults({
      structuredContent: {
        results: [
          {
            title: 'Azure Virtual Machines pricing',
            contentUrl: 'https://learn.microsoft.com/azure/virtual-machines/',
            content: 'Understand VM pricing and options.',
          },
        ],
      },
    });

    expect(normalized).toEqual([
      {
        title: 'Azure Virtual Machines pricing',
        url: 'https://learn.microsoft.com/azure/virtual-machines/',
        snippet: 'Understand VM pricing and options.',
        source: 'microsoftdocs-mcp',
      },
    ]);
  });

  it('reads contentUrl/content, not url/context', () => {
    // The two upstream APIs use different field names for the same concepts.
    // Reading the AWS names here would silently produce empty links.
    const normalized = normalizeMicrosoftSearchResults({
      results: [{ title: 't', url: 'wrong', context: 'wrong' }],
    });

    expect(normalized[0].url).toBe('');
    expect(normalized[0].snippet).toBe('');
  });

  it('returns an empty array for a malformed payload rather than throwing', () => {
    expect(normalizeMicrosoftSearchResults(undefined)).toEqual([]);
    expect(normalizeMicrosoftSearchResults({ results: null })).toEqual([]);
  });
});

describe('parseMcpResponseBody', () => {
  it('parses a plain JSON body', () => {
    expect(parseMcpResponseBody('{"jsonrpc":"2.0","result":{"ok":true}}')).toEqual({
      jsonrpc: '2.0',
      result: { ok: true },
    });
  });

  it('parses a Server-Sent Events body', () => {
    const sse = ['event: message', 'data: {"result":{"value":1}}', ''].join('\n');
    expect(parseMcpResponseBody(sse)).toEqual({ result: { value: 1 } });
  });

  it('joins multiple SSE data lines before parsing', () => {
    const sse = ['data: {"result":', 'data: {"value":2}}', ''].join('\n');
    expect(parseMcpResponseBody(sse)).toEqual({ result: { value: 2 } });
  });

  it('falls through to SSE parsing when a body starts with { but is not JSON', () => {
    const sse = ['{ not json', 'data: {"result":"recovered"}'].join('\n');
    expect(parseMcpResponseBody(sse)).toEqual({ result: 'recovered' });
  });

  it('handles CRLF line endings', () => {
    expect(parseMcpResponseBody('data: {"a":1}\r\n')).toEqual({ a: 1 });
  });

  it('returns {} for empty, whitespace or unparseable input rather than throwing', () => {
    // A docs lookup is enrichment. A bad response from a third-party server
    // must degrade to "no references", never fail the caller.
    expect(parseMcpResponseBody('')).toEqual({});
    expect(parseMcpResponseBody('   ')).toEqual({});
    expect(parseMcpResponseBody(null)).toEqual({});
    expect(parseMcpResponseBody(undefined)).toEqual({});
    expect(parseMcpResponseBody('total garbage')).toEqual({});
    expect(parseMcpResponseBody('data: still garbage')).toEqual({});
  });
});

describe('toTextContent', () => {
  it('passes a string straight through', () => {
    expect(toTextContent('hello')).toBe('hello');
  });

  it('joins the text items of a content array with newlines', () => {
    expect(toTextContent({ content: [{ text: 'a' }, { text: 'b' }] })).toBe('a\nb');
  });

  it('skips non-text and empty content items', () => {
    expect(toTextContent({ content: [{ text: 'a' }, { image: 'x' }, { text: '' }, { text: 'b' }] })).toBe(
      'a\nb'
    );
  });

  it('returns an empty string for anything else', () => {
    expect(toTextContent(null)).toBe('');
    expect(toTextContent(undefined)).toBe('');
    expect(toTextContent({})).toBe('');
    expect(toTextContent({ content: 'not an array' })).toBe('');
  });
});
