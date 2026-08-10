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
import { isIP } from 'node:net';

/** Header Cloudflare sets to the true client address. */
const CF_CLIENT_IP_HEADER = 'cf-connecting-ip';

/**
 * How much of an IPv6 address identifies the *subscriber* rather than the host.
 *
 * A residential or mobile IPv6 customer is allocated a whole prefix, not one
 * address — /64 is the smallest thing RFC 4291 lets a link use, and it is what
 * providers hand out at the low end. Hashing the full address therefore gave
 * one client 2^64 distinct quota documents: unlimited submissions, every bucket
 * reading well under the limit, and unbounded growth of `submission_quota` as a
 * side effect (TODO.md T-205).
 *
 * Truncating to /64 is the conservative choice in the direction that matters.
 * It can over-group — two households behind one ISP's /64 would share a bucket,
 * which is the same situation every IPv4 NAT already creates — but it cannot
 * under-group, and under-grouping is what makes a limiter decorative.
 */
const IPV6_PREFIX_HEXTETS = 4;

/** `::ffff:192.0.2.1` is an IPv4 client wearing an IPv6 shirt. */
const IPV4_MAPPED_PREFIX = /^::ffff:/i;

/**
 * Expand an IPv6 address to its eight four-digit hextets.
 *
 * `isIP` has already established the address is well-formed, so this only has
 * to handle the two compressions the text form allows: `::` for a run of zero
 * groups, and leading zeros dropped within a group.
 */
function expandIpv6(address) {
  const [head, tail = ''] = address.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const gap = 8 - headParts.length - tailParts.length;
  return [...headParts, ...Array(Math.max(0, gap)).fill('0'), ...tailParts].map((part) =>
    part.toLowerCase().padStart(4, '0')
  );
}

/**
 * Reduce a client address to the unit the quota should actually count.
 *
 * Returns a family-tagged string rather than a bare address so the two shapes
 * can never collide in the hash, and so a `submission_quota` document id is
 * traceable to *what kind* of thing it counted without being traceable to whom.
 *
 * Anything unparseable becomes a single shared bucket. That is deliberate: an
 * unrecognised value means the header is absent or malformed, and the safe
 * reading of "I do not know who this is" is "share one quota with everyone else
 * I cannot identify", not "have a fresh quota of your own".
 *
 * @param {string} raw value of the CF-Connecting-IP header
 * @returns {string} normalized, family-tagged quota unit
 */
export function normalizeClientIp(raw) {
  // A zone index (`fe80::1%eth0`) is link-local scope, meaningless to us and
  // rejected by isIP if left on.
  const address = String(raw ?? '')
    .trim()
    .split('%')[0];

  const family = isIP(address);
  if (family === 4) return `v4:${address}`;
  if (family !== 6) return 'unknown';

  if (IPV4_MAPPED_PREFIX.test(address)) {
    // The embedded address is the real client. Fall back to treating it as
    // opaque IPv6 if it is in the hex rather than the dotted form.
    const embedded = address.slice(address.lastIndexOf(':') + 1);
    if (isIP(embedded) === 4) return `v4:${embedded}`;
  }

  return `v6:${expandIpv6(address).slice(0, IPV6_PREFIX_HEXTETS).join(':')}::/64`;
}

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

      // Normalized BEFORE hashing, because the hash is what the quota counts:
      // hashing the raw address gave an IPv6 client one bucket per address in
      // its /64 (TODO.md T-205).
      const unit = normalizeClientIp(request?.headers?.get?.(CF_CLIENT_IP_HEADER));
      const hash = createHash('sha256')
        .update(`${ipSalt ?? ''}:${unit}`)
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
