/**
 * What every probe module shares (ADR 0033 §1 Platform, §8): the hubs, the
 * deep links a probe sends the reader to, the one result shape, and the
 * builders for the three probe kinds — so a probe group under probeGroups/
 * is a list of facts and nothing else.
 */
import { getSessionizeSpeakerId } from '@/lib/adminSettings';
import { toSystemStatus } from '@/lib/status';
import { serviceById } from '@/components/admin/integrations/serviceRegistry';

export const HUBS = Object.freeze({
  pipeline: 'Pipeline',
  creative: 'Creative',
  amplify: 'Amplify',
  enhanced: 'Enhanced',
  spotlight: 'Spotlight',
  platform: 'Platform',
});

// ── Deep links ───────────────────────────────────────────────────────────────

export const INTEGRATIONS = (group) => ({
  to: `/admin/integrations?tab=services&group=${group}`,
  label: 'Integrations',
});
export const KEYS = { to: '/admin/integrations?tab=keys', label: 'Keys' };
export const SETTINGS = (tab) => ({ to: `/admin/platform?tab=${tab}`, label: 'Platform Settings' });
export const AI_ENGINE = { to: '/admin/ai-engine', label: 'AI Engine' };
export const LABS = { to: '/admin/labs?tab=agents', label: 'Labs' };
export const NEWSLETTER = { to: '/admin/mailing-list?tab=settings', label: 'Newsletter Hub' };
export const QUEUE = { to: '/admin/queue', label: 'Review Queue' };
export const GALLERY = { to: '/admin/image-gallery', label: 'Image Gallery' };
export const FORGE = { to: '/admin/forge-studio', label: 'Forge Studio' };
export const LIVE_PAGES = { to: '/admin/live-pages', label: 'Live Pages' };
export const ALERTS = { to: '/admin/health?tab=alerts', label: 'Alerts' };
export const IDENTITY = { to: '/admin/integrations?tab=identity', label: 'Identity' };

// ── Results ──────────────────────────────────────────────────────────────────

export const stamp = () => new Date().toISOString();

/** One result. `status` is an id from lib/status.js. */
export const result = (status, summary, extra = {}) => ({
  status: toSystemStatus(status).id,
  summary,
  checkedAt: stamp(),
  ...extra,
});

/** A refusal that names a missing setting is misconfigured; anything else is unavailable. */
export function classifyFailure(message) {
  return /not configured|is not set|not provisioned|no .* configured/i.test(String(message ?? ''))
    ? 'misconfigured'
    : 'unavailable';
}

export const ago = (iso, now = Date.now()) => {
  const then = Date.parse(iso ?? '');
  if (!Number.isFinite(then)) return null;
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
};

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The message an error carries, or the error itself when it has none. */
export const messageOf = (error) => error?.message || error;

/** The result while the ops-health snapshot is missing: a failed read, or still loading. */
export const snapshotMissing = (ctx) =>
  ctx?.ops?.error
    ? result('unavailable', `The ops-health snapshot could not be read: ${ctx.ops.error}`)
    : result('unknown', 'Waiting for the ops-health snapshot.');

// ── Builders ─────────────────────────────────────────────────────────────────

/**
 * A probe backed by an Integrations service card: the same `test` function,
 * so the two pages cannot disagree about whether Publer answers.
 */
export function fromService(id, { hub, covers, impact, action, safe = true, costNote } = {}) {
  const service = serviceById(id);
  if (!service) throw new Error(`probeRegistry: no service '${id}'`);
  return {
    id,
    label: service.name,
    hub,
    covers,
    impact,
    action,
    href: INTEGRATIONS(service.group),
    kind: 'live',
    safe: safe && !service.skipInTestAll,
    costNote: costNote ?? service.skipInTestAll ?? null,
    run: async () => {
      try {
        const arg =
          service.setting === 'sessionizeSpeakerId' ? await getSessionizeSpeakerId() : undefined;
        return result('healthy', await service.test(arg));
      } catch (error) {
        const message = error?.message || `${service.name} did not answer.`;
        return result(classifyFailure(message), message);
      }
    },
  };
}

export const snapshotProbe = (entry) => ({ kind: 'snapshot', safe: true, ...entry });
export const sessionProbe = (entry) => ({ kind: 'session', ...entry });
export const liveProbe = (entry) => ({ kind: 'live', safe: true, ...entry });
