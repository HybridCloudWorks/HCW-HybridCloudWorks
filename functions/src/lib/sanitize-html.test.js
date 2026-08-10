/**
 * HTML sanitization for anonymously submitted content.
 *
 * Every assertion here is a negative one, because that is what a sanitizer is:
 * the field arrives through an anonymous endpoint and ends up inside
 * `dangerouslySetInnerHTML` on a public template, so anything that survives
 * this function executes in a visitor's browser (TODO.md T-408).
 */
import { describe, it, expect } from 'vitest';
import { isSafeUrl, sanitizeSubmittedHtml } from './sanitize-html.js';

describe('sanitizeSubmittedHtml', () => {
  it('keeps ordinary prose markup intact', () => {
    const html = '<p>A <strong>hybrid</strong> landing zone.</p><ul><li>One</li></ul>';
    expect(sanitizeSubmittedHtml(html)).toBe(html);
  });

  it('removes scripts along with their content', () => {
    // Unwrapping would leave the payload as text for anything that re-parses.
    const out = sanitizeSubmittedHtml('<p>a</p><script>alert(1)</script><p>b</p>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
    expect(out).toContain('<p>a</p>');
    expect(out).toContain('<p>b</p>');
  });

  it('removes every element that can fetch or execute', () => {
    for (const tag of ['iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'style']) {
      const out = sanitizeSubmittedHtml(`<${tag}>x</${tag}>`);
      expect(out).not.toContain(`<${tag}`);
    }
  });

  it('strips event handlers from elements it keeps', () => {
    const out = sanitizeSubmittedHtml('<p onclick="alert(1)" onmouseover="x()">text</p>');
    expect(out).toBe('<p>text</p>');
  });

  it('strips javascript: and data: URLs but keeps real links', () => {
    expect(sanitizeSubmittedHtml('<a href="javascript:alert(1)">x</a>')).not.toContain(
      'javascript'
    );
    expect(sanitizeSubmittedHtml('<a href="data:text/html,<script>">x</a>')).not.toContain('data:');
    expect(sanitizeSubmittedHtml('<img src="javascript:alert(1)">')).not.toContain('javascript');

    const safe = sanitizeSubmittedHtml('<a href="https://example.com/x">x</a>');
    expect(safe).toContain('href="https://example.com/x"');
  });

  it('is not fooled by control characters inside a scheme', () => {
    // Browsers strip these before parsing the URL, so `java\tscript:` runs.
    expect(sanitizeSubmittedHtml('<a href="java\tscript:alert(1)">x</a>')).not.toContain('script:');
    expect(sanitizeSubmittedHtml('<a href="java\nscript:alert(1)">x</a>')).not.toContain('script:');
  });

  it('hardens the links it keeps', () => {
    const out = sanitizeSubmittedHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });

  it('unwraps unknown tags instead of deleting their text', () => {
    // Unexpected markup should degrade to readable prose, not vanish — a
    // submission is a person's work, not an attack by default.
    expect(sanitizeSubmittedHtml('<marquee>keep this</marquee>')).toBe('keep this');
    expect(sanitizeSubmittedHtml('<custom-el><p>inner</p></custom-el>')).toBe('<p>inner</p>');
  });

  it('survives nested and malformed markup', () => {
    const out = sanitizeSubmittedHtml('<div><p>a<script>alert(1)</script></div><p>b');
    expect(out).not.toContain('alert');
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('strips a script smuggled inside an attribute-looking string', () => {
    const out = sanitizeSubmittedHtml('<p title="&quot;><script>alert(1)</script>">x</p>');
    expect(out).not.toContain('alert(1)');
  });

  it('handles empty and non-string input', () => {
    expect(sanitizeSubmittedHtml('')).toBe('');
    expect(sanitizeSubmittedHtml(null)).toBe('');
    expect(sanitizeSubmittedHtml(undefined)).toBe('');
    expect(sanitizeSubmittedHtml(12345)).toBe('12345');
  });
});

describe('isSafeUrl', () => {
  it('allows relative, fragment, and allowlisted schemes', () => {
    expect(isSafeUrl('/azure/frameworks/x')).toBe(true);
    expect(isSafeUrl('#section')).toBe(true);
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('mailto:a@b.com')).toBe(true);
  });

  it('rejects executable and opaque schemes', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('JaVaScRiPt:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeUrl('vbscript:x')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects empty values', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl('   ')).toBe(false);
  });
});
