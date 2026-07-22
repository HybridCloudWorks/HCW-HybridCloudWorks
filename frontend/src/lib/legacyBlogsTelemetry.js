const LEGACY_BLOGS_TELEMETRY_ENDPOINT = import.meta.env.VITE_GCP_FUNCTIONS_URL
  ? `${import.meta.env.VITE_GCP_FUNCTIONS_URL}/recordLegacyBlogsRead`
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
