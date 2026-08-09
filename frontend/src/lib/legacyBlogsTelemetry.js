import { getFunctionsBase } from '@/lib/functionsBase';

// `recordLegacyBlogsRead` has no Azure Functions route yet — see TODO.md T-316.
// The beacon is therefore inert until that route is ported; it resolves through
// the shared base so it starts working the moment the route exists, rather than
// pointing at the decommissioned Google Cloud Functions host it used to target.
const FUNCTIONS_BASE = getFunctionsBase();
const LEGACY_BLOGS_TELEMETRY_ENDPOINT = FUNCTIONS_BASE
  ? `${FUNCTIONS_BASE}/recordLegacyBlogsRead`
  : '';

export function recordLegacyBlogsRead({ source, count = 1, details = {} } = {}) {
  if (!LEGACY_BLOGS_TELEMETRY_ENDPOINT || typeof window === 'undefined') {
    return;
  }

  const payload = {
    source: String(source || 'unknown').slice(0, 80),
    count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
    details: details && typeof details === 'object' && !Array.isArray(details) ? details : {},
  };

  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(
        LEGACY_BLOGS_TELEMETRY_ENDPOINT,
        new Blob([body], { type: 'application/json' })
      );
      return;
    }

    void fetch(LEGACY_BLOGS_TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry must never block content reads.
  }
}
