import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  CONFIRMATION_TTL_MS,
  buildConfirmationToken,
  deriveConfirmationKey,
  verifyConfirmationToken,
} from './confirmation-token.js';

// Deliberately unlike a real Resend key, so no secret scanner mistakes it.
const API_KEY = 'not-a-real-resend-key-EXAMPLE-VALUE-FOR-TESTS';
const NOW = 1_800_000_000_000;
const subscriber = { email: 'reader+news@example.com', source: 'footer' };

describe('deriveConfirmationKey', () => {
  it('is stable for one key, different for another, and is not the key', () => {
    const key = deriveConfirmationKey(API_KEY);
    expect(key.equals(deriveConfirmationKey(API_KEY))).toBe(true);
    expect(key.equals(deriveConfirmationKey(`${API_KEY}-rotated`))).toBe(false);
    expect(key.toString('utf8')).not.toContain(API_KEY);
    expect(key).toHaveLength(32);
  });

  it('refuses to derive from nothing rather than signing with an empty key', () => {
    expect(() => deriveConfirmationKey('')).toThrow(/API key is required/);
  });
});

describe('a confirmation token', () => {
  const key = deriveConfirmationKey(API_KEY);
  const token = buildConfirmationToken(key, subscriber, { now: () => NOW });

  it('names the subscriber it was issued for', () => {
    expect(verifyConfirmationToken(key, token, NOW + 1000)).toEqual(subscriber);
  });

  it('is URL-fragment safe, because the email links to #t=<token>', () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('expires after 48 hours, and not a moment earlier', () => {
    expect(verifyConfirmationToken(key, token, NOW + CONFIRMATION_TTL_MS - 1)).toEqual(subscriber);
    expect(verifyConfirmationToken(key, token, NOW + CONFIRMATION_TTL_MS)).toBeNull();
  });

  it('cannot be re-pointed at another address by editing the payload', () => {
    // The attack this signature exists for: subscribe someone who never asked.
    const [, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ v: 1, e: 'victim@example.com', s: 'footer', x: NOW + CONFIRMATION_TTL_MS })
    ).toString('base64url');
    expect(verifyConfirmationToken(key, `${forged}.${signature}`, NOW)).toBeNull();
  });

  it('cannot have its expiry extended', () => {
    const [, signature] = token.split('.');
    const extended = Buffer.from(
      JSON.stringify({ v: 1, e: subscriber.email, s: 'footer', x: NOW + 10 * CONFIRMATION_TTL_MS })
    ).toString('base64url');
    expect(verifyConfirmationToken(key, `${extended}.${signature}`, NOW + CONFIRMATION_TTL_MS)).toBeNull();
  });

  it('is refused under a rotated key', () => {
    expect(verifyConfirmationToken(deriveConfirmationKey(`${API_KEY}-rotated`), token, NOW)).toBeNull();
  });

  it('answers null for anything that is not a token, without throwing', () => {
    for (const bad of [undefined, null, 42, '', '.', 'abc', 'abc.', '.abc', 'a.b.c', 'x'.repeat(5000)]) {
      expect(verifyConfirmationToken(key, bad, NOW), String(bad).slice(0, 20)).toBeNull();
    }
  });

  it('refuses a CORRECTLY SIGNED payload that is the wrong version or names no address', () => {
    // Signed with the real key, so these fail on their claims and not on the
    // signature — which is the only way this case tests anything.
    const signed = (claims) => {
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
    };
    expect(verifyConfirmationToken(key, signed({ v: 1, e: 'x@example.com', s: 's', x: NOW + 1000 }), NOW)).toEqual({
      email: 'x@example.com',
      source: 's',
    });
    expect(verifyConfirmationToken(key, signed({ v: 2, e: 'x@example.com', s: 's', x: NOW + 1000 }), NOW)).toBeNull();
    expect(verifyConfirmationToken(key, signed({ v: 1, e: '', s: 's', x: NOW + 1000 }), NOW)).toBeNull();
    expect(verifyConfirmationToken(key, signed({ v: 1, e: 'x@example.com', s: 's', x: 'soon' }), NOW)).toBeNull();
  });
});
