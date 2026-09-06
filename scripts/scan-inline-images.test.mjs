import { describe, it, expect } from 'vitest';
import { bodyOf, externalImageHosts } from './scan-inline-images.mjs';

describe('scan-inline-images', () => {
  it('reads every body field, not only the one the page renders', () => {
    expect(bodyOf({ content: 'c', Content: 'C', blogDraft: 'd' })).toBe('d\nC\nc');
    expect(bodyOf({ content: 'c', Content: 42 })).toBe('\n\nc');
    expect(bodyOf({})).toBe('\n\n');
  });

  it('counts third-party image hosts from HTML and markdown, ignoring the site and relative paths', () => {
    const body = [
      '<img src="https://devblogs.microsoft.com/a.png">',
      "<img alt='x' src='https://devblogs.microsoft.com/b.png'>",
      '![d](https://cdn.example.org/d.webp "title")',
      '![own](/api/public/media/covers/c/x.png)',
      '<img src="https://hybridcloudworks.com/icons/logo.png">',
      '<img src="data:image/png;base64,AAAA">',
    ].join('\n');
    const hosts = externalImageHosts(body);
    expect([...hosts.entries()]).toEqual([
      ['devblogs.microsoft.com', 2],
      ['cdn.example.org', 1],
    ]);
    expect(externalImageHosts('')).toEqual(new Map());
  });
});
