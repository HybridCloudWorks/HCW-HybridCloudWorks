/**
 * link-check.js — `checkLiveLinks`, weekly link-rot check for live pages.
 *
 * Ported from Site-Main index.js (088f458). Lives here rather than on the
 * VPS labs platform because the lab sandbox has no network access. Rot means
 * gone (404/410) or a hard network failure; 5xx and 429 are not alerted on a
 * weekly cadence. Every HEAD failure is confirmed with a GET — some CDNs
 * answer HEAD with 404 while serving the same URL over GET.
 */
import { digestDateOf, mergeDigest, raiseAlert } from './workflow-records.js';

const CONCURRENCY = 8;
const PROBE_TIMEOUT_MS = 10000;

export function collectLiveLinkTargets(data, docId) {
  const targets = [];
  const publicUrl =
    data.slugPageUrl ||
    data.publishedUrl ||
    data.publicUrl ||
    (data.curatedSubpagePath
      ? `https://hybridcloudworks.com${String(data.curatedSubpagePath).startsWith('/') ? data.curatedSubpagePath : `/${data.curatedSubpagePath}`}`
      : null);
  if (publicUrl) targets.push({ docId, kind: 'page', url: publicUrl });
  const sourceUrl = String(data.sourceUrl || data.url || '').trim();
  if (/^https?:\/\//i.test(sourceUrl)) targets.push({ docId, kind: 'source', url: sourceUrl });
  return targets;
}

/** HTTP status of `url`, 0 on network failure or timeout. */
export async function probeUrl(url, fetchImpl = globalThis.fetch) {
  const attempt = async (method) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 HybridCloudWorks-LinkCheck/1.0' },
      });
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const status = await attempt('HEAD');
    if (status >= 400) return attempt('GET');
    return status;
  } catch {
    try {
      return await attempt('GET');
    } catch {
      return 0;
    }
  }
}

export function createLinkCheck({
  store,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
  log = {},
}) {
  async function run() {
    const rows = await store.queryDocs(
      'content',
      'SELECT TOP 300 c.id, c.slugPageUrl, c.publishedUrl, c.publicUrl, c.curatedSubpagePath, c.sourceUrl, c.url FROM c WHERE c.Live = true',
      []
    );
    const targets = (rows || []).flatMap((data) => collectLiveLinkTargets(data, data.id));

    const broken = [];
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY);
      const statuses = await Promise.all(batch.map((t) => probeUrl(t.url, fetchImpl)));
      statuses.forEach((status, idx) => {
        if (status === 404 || status === 410 || status === 0)
          broken.push({ ...batch[idx], status });
      });
    }

    const digestDate = digestDateOf(now());
    await mergeDigest(store, digestDate, {
      linkRot: {
        lastRunAt: now().toISOString(),
        checked: targets.length,
        broken: broken.length,
        sampleBroken: broken.slice(0, 15),
      },
    });
    if (broken.length > 0) {
      await raiseAlert(
        store,
        `link-rot-${digestDate}`,
        {
          alertType: 'link_rot_detected',
          severity: 'warning',
          brokenCount: broken.length,
          checkedCount: targets.length,
          sampleBroken: broken.slice(0, 10),
          source: 'checkLiveLinks',
        },
        now
      );
      log.warn?.(`[checkLiveLinks] ${broken.length}/${targets.length} broken links detected`);
    } else {
      log.log?.(`[checkLiveLinks] All ${targets.length} links healthy`);
    }
    return { checked: targets.length, broken: broken.length };
  }
  return { run };
}
