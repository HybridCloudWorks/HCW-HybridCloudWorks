/**
 * cert-reverify.js — `reVerifyCertifications`, Sundays at midnight Chicago.
 *
 * Ported from Site-Main `cms/certifications.js` (088f458). Two checks per
 * active certification: the expiry date, and — for Credly verification URLs
 * — whether the badge page now says "Unable to verify badge". Network
 * failures on Credly are ignored to prevent false revokes. A change
 * republishes the public certifications snapshot so the About page reflects
 * it without a manual publish.
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

  async function run() {
    const certs = await store.queryDocs(
      'certifications',
      'SELECT * FROM c WHERE c.certState = true',
      []
    );
    let expiredCount = 0;
    let revokedCount = 0;
    const nowMs = now().getTime();

    for (const cert of certs || []) {
      let changed = false;
      if (cert.expDate) {
        const expMs = parseExpiryMs(cert.expDate);
        if (Number.isFinite(expMs) && nowMs > expMs) {
          changed = true;
          expiredCount += 1;
        }
      }
      if (!changed && isCredlyUrl(cert.verifyUrl) && (await credlySaysRevoked(cert))) {
        changed = true;
        revokedCount += 1;
      }
      if (changed) {
        await store.patchDoc('certifications', cert.id, {
          certState: false,
          updatedAt: now().toISOString(),
        });
        log.log?.(`[reVerifyCertifications] Marked ${cert.name} as certState=false`);
      }
    }

    if (expiredCount + revokedCount > 0) {
      await publishSnapshots(['certifications']);
      log.log?.('[reVerifyCertifications] Republished certifications snapshot.');
    }
    log.log?.(
      `[reVerifyCertifications] Finished. Expired: ${expiredCount}, Revoked/Invalid: ${revokedCount}`
    );
    return { examined: (certs || []).length, expiredCount, revokedCount };
  }
  return { run };
}
