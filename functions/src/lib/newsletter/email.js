/**
 * email.js — the one email-address check the newsletter uses, with no imports.
 *
 * Its own module so a settings validator can check a reply-to without loading
 * the signup handlers, the Resend client and the quota code at cold start.
 * handlers.js re-exports it, so there is still exactly one definition.
 */

/** RFC 5321 caps a path at 256 octets including the brackets. */
export const MAX_EMAIL_LENGTH = 254;

/**
 * A plausible address, trimmed, or null. Deliberately loose: a confirmation
 * email is the real validation, and a strict pattern rejects real addresses.
 */
export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (!email || email.length > MAX_EMAIL_LENGTH) return null;
  // No whitespace or control characters anywhere, one @, a dot in the domain.
  if (/[\s\u0000-\u001f\u007f]/.test(email)) return null;
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return null;
  return email;
}
