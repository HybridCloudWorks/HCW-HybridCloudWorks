/**
 * The browser's copy of the server's source rule (#433).
 *
 * The equality with `isYouTubeVideoUrl` / `validateGroundingSources` is
 * pinned on the functions side (listen-and-learn/source-episode.test.js),
 * which imports this module and runs both over one table. What is asserted
 * here is the form-facing shape: a verdict per line, blank lines skipped,
 * nothing dropped silently.
 */
import { describe, it, expect } from 'vitest';
import { classifySourceLines, classifySourceUrl, isYouTubeVideoUrl } from './sourceUrl.js';

describe('classifySourceUrl', () => {
  it('classifies a YouTube video, a page, and refuses the rest with a sentence', () => {
    expect(classifySourceUrl('https://www.youtube.com/watch?v=abc123')).toEqual({
      kind: 'video',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(classifySourceUrl('https://youtu.be/abc123')).toMatchObject({ kind: 'video' });
    expect(classifySourceUrl('https://www.youtube.com/shorts/abc123')).toMatchObject({
      kind: 'video',
    });
    expect(classifySourceUrl(' https://example.com/article ')).toEqual({
      kind: 'page',
      url: 'https://example.com/article',
    });
    expect(classifySourceUrl('https://www.youtube.com/playlist?list=PL1')).toMatchObject({
      error: expect.stringMatching(/not a video/),
    });
    expect(classifySourceUrl('ftp://example.com/x')).toMatchObject({
      error: expect.stringMatching(/http\(s\)/),
    });
    expect(classifySourceUrl('not a url')).toMatchObject({ error: 'is not a valid URL' });
    expect(classifySourceUrl('')).toMatchObject({ error: 'is empty' });
  });

  it('never returns both a kind and an error', () => {
    for (const url of ['https://youtu.be/a', 'https://example.com', 'nope', '']) {
      const out = classifySourceUrl(url);
      expect(Boolean(out.kind) !== Boolean(out.error)).toBe(true);
    }
  });

  it('isYouTubeVideoUrl needs an id', () => {
    expect(isYouTubeVideoUrl('https://www.youtube.com/watch?v=')).toBe(false);
    expect(isYouTubeVideoUrl('https://youtu.be/')).toBe(false);
    expect(isYouTubeVideoUrl('https://www.youtube.com/@channel')).toBe(false);
    expect(isYouTubeVideoUrl('https://notyoutube.com/watch?v=abc')).toBe(false);
    expect(isYouTubeVideoUrl('nope')).toBe(false);
  });
});

describe('classifySourceLines', () => {
  it('reads one URL per line, skips blanks, and keeps the bad ones so they can be shown', () => {
    const out = classifySourceLines(
      '\nhttps://example.com/a\r\n  \nhttps://youtu.be/abc123\nnot a url\n'
    );
    expect(out).toEqual([
      { kind: 'page', url: 'https://example.com/a' },
      { kind: 'video', url: 'https://youtu.be/abc123' },
      { url: 'not a url', error: 'is not a valid URL' },
    ]);
  });

  it('is empty for nothing', () => {
    expect(classifySourceLines('')).toEqual([]);
    expect(classifySourceLines(undefined)).toEqual([]);
  });
});
