import { describe, expect, it } from 'vitest';
import { safeUrl } from './safeUrl';

const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);

describe('safeUrl', () => {
  it('passes ordinary http and https links through unchanged', () => {
    expect(safeUrl('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
    expect(safeUrl('http://example.com')).toBe('http://example.com');
  });

  it('allows mailto', () => {
    expect(safeUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });

  it('allows relative references', () => {
    expect(safeUrl('/aws/blog/thing')).toBe('/aws/blog/thing');
    expect(safeUrl('#section')).toBe('#section');
    expect(safeUrl('?page=2')).toBe('?page=2');
  });

  // The reason this module exists.
  it('refuses javascript: in any casing or with surrounding space', () => {
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('JavaScript:alert(1)')).toBeUndefined();
    expect(safeUrl('JAVASCRIPT:alert(1)')).toBeUndefined();
    expect(safeUrl('  javascript:alert(1)  ')).toBeUndefined();
  });

  // A protocol split by a control character parses as javascript: in a browser
  // while reading as safe to a prefix check. Refused before parsing.
  it('refuses a protocol smuggled through control characters', () => {
    expect(safeUrl(`java${TAB}script:alert(1)`)).toBeUndefined();
    expect(safeUrl(`java${NEWLINE}script:alert(1)`)).toBeUndefined();
    expect(safeUrl('java script:alert(1)')).toBeUndefined();
  });

  it('refuses data:, vbscript: and file:', () => {
    expect(safeUrl('data:text/html;base64,PHN2Zz4=')).toBeUndefined();
    expect(safeUrl('vbscript:msgbox(1)')).toBeUndefined();
    expect(safeUrl('file:///etc/passwd')).toBeUndefined();
  });

  it('refuses non-strings and blanks rather than throwing', () => {
    expect(safeUrl(undefined)).toBeUndefined();
    expect(safeUrl(null)).toBeUndefined();
    expect(safeUrl(42)).toBeUndefined();
    expect(safeUrl({})).toBeUndefined();
    expect(safeUrl('')).toBeUndefined();
    expect(safeUrl('   ')).toBeUndefined();
  });

  it('returns the caller fallback when one is given', () => {
    expect(safeUrl('javascript:alert(1)', '#')).toBe('#');
    expect(safeUrl(undefined, '/home')).toBe('/home');
  });

  // Returning the parsed href would silently rewrite links — trailing slash,
  // lowercased host, percent-encoding. A safe URL passes through byte for byte.
  it('returns the original string, not a normalized one', () => {
    expect(safeUrl('https://Example.COM/A%20B')).toBe('https://Example.COM/A%20B');
  });
});
