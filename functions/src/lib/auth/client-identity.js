/**
 * Identifying an anonymous caller, for rate limiting.
 *
 * ===========================================================================
 * DECISION 6 — the origin MUST be locked to Cloudflare, and this code refuses
 * to pretend otherwise
 * ===========================================================================
 * Cloudflare sits in front of the API (`infra/main.tf`, proxied records), so
 * the true client address is `CF-Connecting-IP`.
 *
 * That header is only trustworthy if the origin cannot be reached directly.
 * Today it can: the Function App has no `ip_restriction`, no `https_only`, and
 * `<app>.azurewebsites.net` resolves publicly. Anyone who finds the origin
 * hostname can send `CF-Connecting-IP: 1.2.3.4` and mint unlimited quota per
 * fabricated address — while also bypassing the WAF and any Cloudflare-side
 * rate limit.
 *
 * So the decision is: lock the origin, and make the code fail loudly until it
 * is locked, rather than silently trusting a spoofable header.
 *
 * Required infrastructure, which is NOT yet in main.tf:
 *   - `https_only = true` (bearer tokens currently traverse plaintext HTTP if
 *     anyone asks for it)
 *   - `ip_restriction` limited to Cloudflare's published ranges, or
 *     Authenticated Origin Pulls
 *   - a Cloudflare transform rule injecting a shared secret header, checked
 *     here via CF_ORIGIN_SECRET
 *
 * Note X-Forwarded-For is NOT used: it is client-spoofable, and App Service
 * appends its own hop with a `:port` suffix that trips naive splitting.
 */

import { createHash } from 'node:crypto';

/** Header Cloudflare sets to the true client address. */
const CF_CLIENT_IP_HEADER = 'cf-connecting-ip';

/** Header a Cloudflare transform rule injects, proving the request came via CF. */
const CF_ORIGIN_SECRET_HEADER = 'x-hcw-origin-secret';

/**
 * @param {object} [options]
 * @param {string} [options.originSecret] Expected shared secret. When set, a
 *   request without it is treated as bypassing Cloudflare.
 * @param {string} [options.ipSalt] Salt for the address hash.
 * @param {boolean} [options.allowUnverifiedOrigin] Dev escape hatch.
 */
export function createClientIdentity({
  originSecret = process.env.CF_ORIGIN_SECRET,
  ipSalt = process.env.CLIENT_IP_SALT,
  allowUnverifiedOrigin = process.env.NODE_ENV !== 'production',
} = {}) {
  /**
   * Did this request actually arrive through Cloudflare?
   *
   * Constant-time-ish comparison is not required — the secret is not derived
   * from user input and a timing oracle here yields nothing an attacker cannot
   * get by simply reaching the origin directly, which is the thing being fixed.
   */
  const viaCloudflare = (request) => {
    if (!originSecret) return false;
    return request?.headers?.get?.(CF_ORIGIN_SECRET_HEADER) === originSecret;
  };

  return {
    viaCloudflare,

    /**
     * A stable, pseudonymous key for an anonymous caller.
     *
     * The hash is deliberate: the raw address is a GDPR-relevant identifier and
     * would otherwise become a Cosmos document id, turning the quota container
     * into a browsable list of visitor IPs. The salt stops that set being
     * rainbow-tableable — it belongs in Key Vault.
     *
     * @param {object} request
     * @returns {{ key: string, trusted: boolean }}
     * @throws when the origin is not verifiably Cloudflare and we are not in dev
     */
    anonymousKey(request) {
      const trusted = viaCloudflare(request);

      if (!trusted && !allowUnverifiedOrigin) {
        // Fail closed. Rate limiting on a spoofable identifier is not rate
        // limiting, and silently degrading to one is how a limiter becomes
        // decorative.
        throw new Error(
          'Refusing to rate-limit on an unverified origin: the request did not present ' +
            'the Cloudflare shared secret. Lock the origin (ip_restriction / Authenticated ' +
            'Origin Pulls) and set CF_ORIGIN_SECRET.'
        );
      }

      const ip = request?.headers?.get?.(CF_CLIENT_IP_HEADER) || 'unknown';
      const hash = createHash('sha256')
        .update(`${ipSalt ?? ''}:${ip}`)
        .digest('hex');

      return { key: hash, trusted };
    },

    /**
     * The rate-limit key for a caller: their Entra oid when authenticated,
     * otherwise the hashed address.
     *
     * Site-Main only rate-limits anonymous callers (`cloud-tools.js:1809`
     * checks `!user?.uid`); this preserves that by returning null for a known
     * user, meaning "no anonymous limit applies".
     */
    rateLimitKey(request, user) {
      if (user?.oid || user?.sub) return null;
      return this.anonymousKey(request).key;
    },
  };
}
