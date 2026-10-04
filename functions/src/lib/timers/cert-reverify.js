/**
 * cert-reverify.js — `reVerifyCertifications`, Sundays at 00:00 UTC.
 *
 * Ported from Site-Main `cms/certifications.js` (088f458). Two checks per
 * certification: the expiry date, and — for Credly verification URLs —
 * whether the badge page now says "Unable to verify badge". Network
 * failures on Credly are ignored to prevent false revokes. A change
 * republishes the public certifications snapshot so the About page reflects
 * it without a manual publish.
 *
 * EVERY certification is examined, not only the active ones (ADR 0033,
 * Spotlight slice). The query used to be `WHERE c.certState = true`, so a
 * cert this timer had marked inactive at expiry stayed inactive after the
 * owner renewed it and moved its expiry date forward: nothing ever looked at
 * it again. Now an inactive cert whose expiry is ahead and whose Credly badge
 * (when it has one) verifies is re-activated.
 *
 * A scheduled job with no HTTP surface, on purpose: "an endpoint for
 * testing" is exactly the shape the archived scrapeCredlyBadges had.
 */

/** Epoch ms of an expiry value: ISO string, bare YYYY-MM-DD, or Date. NaN when unparseable. */
export function parseExpiryMs(expDate) {
  if (!expDate) return NaN;
  if (expDate instanceof Date) return expDate.getTime();
  if (typeof expDate.toDate === 'function') return expDate.toDate().getTime();
  const s = String(expDate);
  return Date.parse(s.includes('T') ? s : `${s}T00:00:00Z`);
}

export function isCredlyUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'credly.com' || url.hostname === 'www.credly.com')
    );
  } catch {
    return false;
  }
}

/**
 * @param {object} deps
 * @param {{ queryDocs: Function, patchDoc: Function }} deps.store
 * @param {typeof fetch} [deps.fetch]
 * @param {(collections: string[]) => Promise<any>} deps.publishSnapshots
 */
export function createCertReverify({
  store,
  fetch: fetchImpl = globalThis.fetch,
  publishSnapshots,
  now = () => new Date(),
  log = {},
}) {
  async function credlySaysRevoked(cert) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetchImpl(cert.verifyUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HCW-Bot/1.0)' },
      });
      const body = await res.text();
      return body.includes('Unable to verify badge');
    } catch (err) {
      log.warn?.(
        `[reVerifyCertifications] Failed to reach Credly for ${cert.name}: ${err?.message || err}`
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** What one certification's state should become: 'inactive', 'active' or null for no change. */
  async function verdictFor(cert, nowMs) {
    const expMs = cert.expDate ? parseExpiryMs(cert.expDate) : NaN;
    const expired = Number.isFinite(expMs) && nowMs > expMs;
    return cert.certState === true
      ? activeVerdict(cert, expired)
      : inactiveVerdict(cert, Number.isFinite(expMs), expired);
  }

  /** Whether Credly, when it is the verifier, says the badge is revoked. */
  async function revokedOnCredly(cert) {
    return isCredlyUrl(cert.verifyUrl) && (await credlySaysRevoked(cert));
  }

  /** An active cert goes inactive when expired or revoked. */
  async function activeVerdict(cert, expired) {
    if (expired) return { next: 'inactive', reason: 'expired' };
    return (await revokedOnCredly(cert)) ? { next: 'inactive', reason: 'revoked' } : null;
  }

  /**
   * Inactive: a renewal moved the expiry ahead, so it comes back — unless
   * Credly still says the badge cannot be verified. A cert with no expiry
   * date stays as the owner set it; the timer has nothing to reason from.
   */
  async function inactiveVerdict(cert, hasExpiry, expired) {
    if (!hasExpiry || expired) return null;
    return (await revokedOnCredly(cert)) ? null : { next: 'active', reason: 'renewed' };
  }

  async function run() {
    const certs = await store.queryDocs('certifications', 'SELECT * FROM c', []);
    const counts = { expired: 0, revoked: 0, renewed: 0 };
    const nowMs = now().getTime();

    for (const cert of certs || []) {
      const verdict = await verdictFor(cert, nowMs);
      if (!verdict) continue;
      counts[verdict.reason] += 1;
      await store.patchDoc('certifications', cert.id, {
        certState: verdict.next === 'active',
        _updatedAt: now().toISOString(),
        reverifiedAt: now().toISOString(),
        reverifyReason: verdict.reason,
      });
      log.log?.(
        `[reVerifyCertifications] Marked ${cert.name} as ${verdict.next} (${verdict.reason})`
      );
    }

    if (counts.expired + counts.revoked + counts.renewed > 0) {
      await publishSnapshots(['certifications']);
      log.log?.('[reVerifyCertifications] Republished certifications snapshot.');
    }
    log.log?.(
      `[reVerifyCertifications] Finished. Expired: ${counts.expired}, Revoked/Invalid: ${counts.revoked}, Renewed: ${counts.renewed}`
    );
    return {
      examined: (certs || []).length,
      expiredCount: counts.expired,
      revokedCount: counts.revoked,
      renewedCount: counts.renewed,
    };
  }
  return { run };
}
