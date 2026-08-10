import { postJSON } from '@/lib/api';

/**
 * Record that a page fell back to the legacy `blogs` container.
 *
 * The number this produces is the evidence for retiring that container: without
 * it, "is anything still reading the fallback?" has no answer and the container
 * stays forever on the grounds that nobody can prove it is unused.
 *
 * This used `navigator.sendBeacon` against an anonymous endpoint. The route is
 * authenticated now (TODO.md T-316) — its only caller is an admin page, so
 * anonymity bought nothing and cost an unauthenticated write endpoint that
 * anyone could use to poison the very evidence it exists to produce. A beacon
 * cannot carry a bearer token, and nothing here needed beacon semantics: the
 * call site is an ordinary async load, not an unload handler.
 *
 * @param {{source?: string, count?: number, details?: object}} [event]
 */
export function recordLegacyBlogsRead({ source, count = 1, details = {} } = {}) {
  const payload = {
    source: String(source || 'unknown').slice(0, 80),
    count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
    details: details && typeof details === 'object' && !Array.isArray(details) ? details : {},
  };

  // Fire-and-forget. Telemetry must never block, delay, or fail a content read,
  // which is why nothing awaits this and every rejection is swallowed.
  void postJSON('cms/telemetry/legacy-blogs-read', payload).catch(() => {});
}
