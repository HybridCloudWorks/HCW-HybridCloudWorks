/**
 * The Health Hub's probe registry — one entry per hub dependency, so "is
 * every part of the platform working?" is answered by one list rather than by
 * knowing which page happens to carry a test (ADR 0033 §1 Platform, §8).
 *
 * Every entry is `{ id, label, hub, covers, impact, action, href, kind, safe }`
 * plus the function that answers it, and every answer is one shape:
 *
 *   { status, summary, detail?, checkedAt }
 *
 * where `status` is lib/status.js's vocabulary — healthy / degraded /
 * misconfigured / unavailable / unknown — so a probe here reads like a card
 * on the Integrations page and a row on the Overview tab.
 *
 * Three kinds, by where the answer comes from:
 *
 *   live      `run(ctx)` makes a request and returns a result. These are the
 *             tests the Integrations page already had (SERVICES[].test, run
 *             by the same function so the two pages cannot disagree), plus
 *             reads of routes other hubs expose: the AI providers list and
 *             testAiProvider, the labs snapshot, the newsletter issues, the
 *             public content list for cover images, /api/health.
 *   snapshot  `evaluate(ctx)` reads the ops-health snapshot the page already
 *             holds. Its "Test" is a re-read of the snapshot, so Test all
 *             refreshes it once and evaluates every snapshot probe from it.
 *   session   `evaluate(ctx)` reads a check the page runs with the session's
 *             own token (identity, the Labs no-op probe, the smoke tests);
 *             its "Test" is that check's own action.
 *
 * `safe` says whether Test all may press it. A probe that writes real data
 * (the smoke tests enqueue jobs and build digests; the Labs probe creates a
 * job) or spends quota (YouTube) is run from its own card only, and its
 * `costNote` says why.
 *
 * Pure where it can be: `resolveProbe`, the evaluators and the report lines
 * take data and return data, so the registry is tested without a DOM.
 */

import { getJSON, postJSON } from '@/lib/api';
import { getSessionizeSpeakerId } from '@/lib/adminSettings';
import { SYSTEM_STATUS, toSystemStatus } from '@/lib/status';
import { SERVICES, serviceById } from '@/components/admin/integrations/serviceRegistry';
import {
  evaluateIdentity,
  evaluateLabsProbe,
  evaluateUnauthenticatedProbe,
  verdictStatus,
} from './probes';

export const HUBS = Object.freeze({
  pipeline: 'Pipeline',
  creative: 'Creative',
  amplify: 'Amplify',
  enhanced: 'Enhanced',
  spotlight: 'Spotlight',
  platform: 'Platform',
});

/** Deep links a probe sends the reader to. */
const INTEGRATIONS = (group) => ({
  to: `/admin/integrations?tab=services&group=${group}`,
  label: 'Integrations',
});
const KEYS = { to: '/admin/integrations?tab=keys', label: 'Keys' };
const SETTINGS = (tab) => ({ to: `/admin/platform?tab=${tab}`, label: 'Platform Settings' });
const AI_ENGINE = { to: '/admin/ai-engine', label: 'AI Engine' };
const LABS = { to: '/admin/labs?tab=agents', label: 'Labs' };
const NEWSLETTER = { to: '/admin/mailing-list?tab=settings', label: 'Newsletter Hub' };
const QUEUE = { to: '/admin/queue', label: 'Review Queue' };
const GALLERY = { to: '/admin/image-gallery', label: 'Image Gallery' };
const FORGE = { to: '/admin/forge-studio', label: 'Forge Studio' };
const LIVE_PAGES = { to: '/admin/live-pages', label: 'Live Pages' };
const ALERTS = { to: '/admin/health?tab=alerts', label: 'Alerts' };

const stamp = () => new Date().toISOString();

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

const ago = (iso, now = Date.now()) => {
  const then = Date.parse(iso ?? '');
  if (!Number.isFinite(then)) return null;
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ── Builders ─────────────────────────────────────────────────────────────────

/**
 * A probe backed by an Integrations service card: the same `test` function,
 * so the two pages cannot disagree about whether Publer answers.
 */
function fromService(id, { hub, covers, impact, action, safe = true, costNote } = {}) {
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

const snapshotProbe = (entry) => ({ kind: 'snapshot', safe: true, ...entry });
const sessionProbe = (entry) => ({ kind: 'session', ...entry });

// ── Snapshot evaluators (pure) ───────────────────────────────────────────────

const snapshotMissing = (ctx) =>
  ctx?.ops?.error
    ? result('unavailable', `The ops-health snapshot could not be read: ${ctx.ops.error}`)
    : result('unknown', 'Waiting for the ops-health snapshot.');

export function evaluateCosmos(ctx) {
  if (ctx?.ops?.loaded && ctx.snapshot) {
    return result('healthy', 'Cosmos DB answered the ten-query ops snapshot.', {
      checkedAt: ctx.snapshot.lastCheckedAt ?? ctx.snapshot.generatedAt ?? stamp(),
    });
  }
  return snapshotMissing(ctx);
}

export function evaluateRuntimeConfig(ctx) {
  const readiness = ctx?.snapshot?.readiness;
  if (!readiness) return snapshotMissing(ctx);
  const unresolved = Array.isArray(readiness.unresolvedSecrets) ? readiness.unresolvedSecrets : [];
  const checkedAt = readiness.lastCheckedAt ?? stamp();
  if (readiness.configGeneration === 'unset') {
    return result(
      'unavailable',
      'The runtime configuration stamp never reached this worker, so its app settings may be stale.',
      { checkedAt }
    );
  }
  if (unresolved.length > 0) {
    return result(
      'misconfigured',
      `${plural(unresolved.length, 'Key Vault reference')} did not resolve: ${unresolved.join(', ')}.`,
      {
        checkedAt,
        detail: `Generation ${readiness.configGeneration} by ${readiness.configWriter}.`,
      }
    );
  }
  return result(
    'healthy',
    `Configuration generation ${readiness.configGeneration ?? 'unknown'} (${readiness.configWriter ?? 'unknown writer'}); every Key Vault reference resolved.`,
    { checkedAt }
  );
}

/** The scheduler has written no run: idle, unless the watchdog says items are overdue. */
function idleSchedulerVerdict(overdue, when, checkedAt) {
  if (overdue > 0) {
    return result(
      'degraded',
      `${plural(overdue, 'scheduled item')} overdue and the scheduler has written no run.${when}`,
      { checkedAt }
    );
  }
  return result('unknown', `Idle: nothing was due since the last published run.${when}`, {
    checkedAt,
  });
}

/** The scheduler's last run, judged by its status and the watchdog's overdue count. */
function schedulerRunVerdict(ops, overdue, when, checkedAt) {
  const counts = `${ops.published ?? 0} published, ${ops.skipped ?? 0} skipped, ${ops.failed ?? 0} failed of ${ops.due ?? 0} due.`;
  if (ops.status === 'failed') {
    return result('unavailable', `The last run failed. ${counts}${when}`, { checkedAt });
  }
  if (ops.status === 'degraded' || overdue > 0) {
    const overdueNote = overdue > 0 ? `${plural(overdue, 'item')} overdue. ` : '';
    return result('degraded', `${overdueNote}${counts}${when}`, { checkedAt });
  }
  return result('healthy', `${counts}${when}`, { checkedAt });
}

export function evaluateScheduledPublishing(ctx) {
  const digest = ctx?.snapshot?.digest;
  if (!ctx?.snapshot?.readiness) return snapshotMissing(ctx);
  const ops = digest?.publishingOps;
  const watchdog = digest?.publishingWatchdog;
  const overdue = Number(watchdog?.overdueScheduledCount) || 0;
  const checkedAt = digest?.lastCheckedAt ?? ctx.snapshot.lastCheckedAt ?? stamp();
  const lastRun = ops?.lastRunAt || watchdog?.lastRunAt;
  const when = lastRun ? ` Last activity ${ago(lastRun) ?? 'at an unknown time'}.` : '';
  return ops
    ? schedulerRunVerdict(ops, overdue, when, checkedAt)
    : idleSchedulerVerdict(overdue, when, checkedAt);
}

const countProbe =
  (pick, { zero, some, badStatus = 'degraded' }) =>
  (ctx) => {
    const signals = ctx?.snapshot?.operationalSignals;
    if (!signals) return snapshotMissing(ctx);
    const count = Number(pick(signals)) || 0;
    const checkedAt = signals.lastCheckedAt ?? stamp();
    return count === 0
      ? result('healthy', zero, { checkedAt })
      : result(badStatus, some(count, signals), { checkedAt });
  };

export const evaluatePublishingFailures = countProbe((s) => s.publishFailureCount, {
  zero: 'No open publish-failure alerts.',
  some: (n) => `${plural(n, 'open publish-failure alert')}.`,
});

export const evaluateQueueSla = countProbe((s) => s.queueBreachCount, {
  zero: 'Nothing has waited in the review queue for more than 24 hours.',
  some: (n, s) =>
    `${plural(n, 'item')} waiting more than 24 hours; the oldest staged item is ${s.oldestStagedHours ?? 0} h old.`,
});

export const evaluateOrphanedImages = countProbe((s) => s.orphanedGeneratedImages, {
  zero: 'Every generated image belongs to a content document that exists.',
  some: (n) => `${plural(n, 'generated image')} point at content that no longer exists.`,
});

export function evaluateStorage(ctx) {
  const storage = ctx?.snapshot?.storage;
  if (!storage) {
    return ctx?.snapshot?.readiness
      ? result('unknown', 'This snapshot carries no storage figures.')
      : snapshotMissing(ctx);
  }
  const floor = storage.bounded ? 'at least ' : '';
  return result(
    'healthy',
    `${floor}${plural(storage.generatedImages ?? 0, 'generated image row')} in Cosmos.`,
    {
      checkedAt: storage.lastCheckedAt ?? stamp(),
      detail: 'Blob byte counts are not read here: there is no cheap count route.',
    }
  );
}

export function evaluateLinkRot(ctx) {
  if (!ctx?.snapshot?.readiness) return snapshotMissing(ctx);
  const rot = ctx.snapshot.digest?.linkRot;
  if (!rot)
    return result('unknown', 'The weekly link check has not written a result to this digest yet.');
  const checkedAt = rot.lastRunAt ?? ctx.snapshot.digest?.lastCheckedAt ?? stamp();
  if ((rot.broken ?? 0) === 0) {
    return result(
      'healthy',
      `All ${rot.checked ?? 0} live links answered on the last weekly check.`,
      { checkedAt }
    );
  }
  const sample = (rot.sampleBroken ?? []).slice(0, 5).map((row) => `${row.url} (${row.status})`);
  return result('degraded', `${rot.broken} of ${rot.checked} live links are broken.`, {
    checkedAt,
    detail: sample.length ? sample.join('\n') : undefined,
  });
}

export function evaluateForge(ctx) {
  const forge = ctx?.snapshot?.forge;
  if (!forge) {
    return ctx?.snapshot?.readiness
      ? result('unknown', 'This snapshot carries no forge statistics.')
      : snapshotMissing(ctx);
  }
  if (!forge.updatedAt) return result('unknown', 'The scheduled forge has never recorded a run.');
  return result(
    'healthy',
    `${plural(forge.forgedToday ?? 0, 'item')} forged on ${forge.todayDate ?? 'today'}; last activity ${ago(forge.updatedAt) ?? 'at an unknown time'}.`,
    {
      checkedAt: forge.lastCheckedAt ?? stamp(),
    }
  );
}

export function evaluateTelegramNotify(ctx) {
  const state = ctx?.snapshot?.telegramNotifyState;
  if (!state) return snapshotMissing(ctx);
  const sources = Object.entries(state)
    .filter(([key, value]) => key !== 'id' && key !== 'lastCheckedAt' && value?.lastNotifiedAt)
    .sort((a, b) => Date.parse(b[1].lastNotifiedAt) - Date.parse(a[1].lastNotifiedAt));
  const checkedAt = state.lastCheckedAt ?? stamp();
  if (sources.length === 0) {
    return result('unknown', 'No Telegram notice has been recorded as sent yet.', { checkedAt });
  }
  const [[source, { lastNotifiedAt }]] = sources;
  return result(
    'healthy',
    `Last notice ${ago(lastNotifiedAt) ?? 'at an unknown time'} (${source}); ${plural(sources.length, 'source')} have notified.`,
    {
      checkedAt,
    }
  );
}

// ── Session evaluators (pure) ────────────────────────────────────────────────

export function evaluateIdentitySession(ctx) {
  if (!ctx?.identity) return result('unknown', 'Reading the session…');
  const verdict = evaluateIdentity(ctx.identity.token, ctx.identity.admin);
  return result(verdictStatus(verdict.pass), verdict.reason);
}

export function evaluateRegistrySession(ctx) {
  if (!ctx?.identity) return result('unknown', 'Reading the session…');
  const { admin, adminError, adminHttp } = ctx.identity;
  if (!admin) return result('unavailable', adminError || 'getCurrentAdminStatus did not answer.');
  if (!admin.isAdmin)
    return result(
      'unavailable',
      `HTTP ${adminHttp}: the registry does not list this principal as an admin.`
    );
  if (admin.uidMatchesToken === false)
    return result('unavailable', 'The registry row is keyed on a different principal.');
  return result(
    'healthy',
    `HTTP ${adminHttp}: admin, role ${admin.role ?? 'unset'}, ${admin.active ? 'active' : 'inactive'}.`
  );
}

export function evaluateLabsSession(ctx) {
  const verdict = evaluateLabsProbe(ctx?.labs);
  return result(verdictStatus(verdict.pass), verdict.reason);
}

export function evaluateUnauthSession(ctx) {
  const verdict = evaluateUnauthenticatedProbe(ctx?.unauth);
  return result(verdictStatus(verdict.pass), verdict.reason);
}

const smokeEvaluator = (actionId, idle) => (ctx) => {
  const run = ctx?.smoke?.lastRuns?.[actionId];
  if (!run) return result('unknown', idle);
  return result(run.ok ? 'healthy' : 'unavailable', run.message, { checkedAt: run.at });
};

// ── Live runners ─────────────────────────────────────────────────────────────

/** Every enabled AI provider, tested through the AI Engine's own test. */
export async function runAiProviders() {
  let items;
  try {
    const res = await getJSON('cms/config/ai-providers');
    items = Array.isArray(res?.items) ? res.items : [];
  } catch (error) {
    return result('unavailable', `The provider list could not be read: ${error?.message || error}`);
  }
  const enabled = items.filter((item) => item.enabled !== false);
  if (enabled.length === 0)
    return result('misconfigured', 'No AI provider is enabled on the AI Engine page.');
  const outcomes = await Promise.all(
    enabled.map(async (item) => {
      try {
        const out = await postJSON('testAiProvider', { providerId: item.id });
        return {
          id: item.id,
          ok: out?.status === 'connected',
          latencyMs: out?.latencyMs,
          error: out?.error,
        };
      } catch (error) {
        return { id: item.id, ok: false, error: error?.message || 'the test threw' };
      }
    })
  );
  const ok = outcomes.filter((o) => o.ok);
  const [lastProbe] = items
    .filter((item) => item.lastTested)
    .sort((a, b) => Date.parse(b.lastTested) - Date.parse(a.lastTested));
  const probeNote = lastProbe
    ? ` Last recorded test: ${lastProbe.id} ${ago(lastProbe.lastTested) ?? ''} by ${lastProbe.lastTestedBy === 'probe' ? 'the weekly probe' : 'a click'}.`
    : '';
  const detail = outcomes
    .map(
      (o) =>
        `${o.id}: ${o.ok ? `connected${Number.isFinite(o.latencyMs) ? ` in ${o.latencyMs} ms` : ''}` : o.error || 'failed'}`
    )
    .join('\n');
  if (ok.length === outcomes.length) {
    return result('healthy', `${plural(ok.length, 'enabled provider')} answered.${probeNote}`, {
      detail,
    });
  }
  if (ok.length === 0)
    return result(
      'unavailable',
      `None of the ${outcomes.length} enabled providers answered.${probeNote}`,
      { detail }
    );
  return result(
    'degraded',
    `${ok.length} of ${outcomes.length} enabled providers answered.${probeNote}`,
    { detail }
  );
}

export async function runLabAgents() {
  let agents;
  try {
    const res = await postJSON('getLabsSnapshot', {});
    agents = Array.isArray(res?.agents) ? res.agents : [];
  } catch (error) {
    return result('unavailable', `The labs snapshot could not be read: ${error?.message || error}`);
  }
  if (agents.length === 0) return result('unknown', 'No lab agent has registered yet.');
  const online = agents.filter((agent) => agent.online);
  const latest = agents
    .map((agent) => agent.lastSeenAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const seen = latest ? ` Last heartbeat ${ago(latest) ?? 'at an unknown time'}.` : '';
  if (online.length === agents.length)
    return result('healthy', `${plural(agents.length, 'agent')} online.${seen}`);
  if (online.length === 0)
    return result('unavailable', `All ${agents.length} agents are offline.${seen}`);
  return result('degraded', `${online.length} of ${agents.length} agents online.${seen}`);
}

export async function runNewsletterBuild() {
  let issues;
  let sendDay = null;
  try {
    const res = await getJSON('cms/newsletters');
    issues = Array.isArray(res?.issues) ? res.issues : [];
  } catch (error) {
    return result(
      'unavailable',
      `The newsletter issues could not be read: ${error?.message || error}`
    );
  }
  try {
    const settings = await getJSON('cms/platform-settings/newsletter-settings');
    sendDay = settings?.value?.sendDay ?? null;
  } catch {
    // The schedule is context, not the verdict.
  }
  const schedule = sendDay ? ` Issues build weekly for ${sendDay}.` : '';
  if (issues.length === 0) return result('unknown', `No issue has been built yet.${schedule}`);
  const latest = issues
    .map((issue) => issue.createdAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const ageMs = Date.now() - Date.parse(latest ?? '');
  if (!Number.isFinite(ageMs))
    return result(
      'unknown',
      `${plural(issues.length, 'issue')} exist but none carries a build time.${schedule}`
    );
  const days = Math.floor(ageMs / 86400000);
  if (days > 8)
    return result(
      'degraded',
      `The newest issue was built ${days} days ago; the weekly build has missed.${schedule}`
    );
  return result('healthy', `Newest issue built ${ago(latest) ?? 'recently'}.${schedule}`);
}

export async function runUnresolvedSecrets(ctx) {
  let count;
  try {
    const res = await getJSON('health');
    count = Number(res?.unresolvedSecrets);
  } catch (error) {
    return result('unavailable', `/api/health did not answer: ${error?.message || error}`);
  }
  const names = ctx?.snapshot?.readiness?.unresolvedSecrets ?? [];
  if (!Number.isFinite(count))
    return result('unknown', '/api/health answered without an unresolvedSecrets count.');
  if (count === 0)
    return result('healthy', 'Every Key Vault reference resolved on the answering worker.');
  return result(
    'misconfigured',
    `${plural(count, 'Key Vault reference')} did not resolve${names.length ? `: ${names.join(', ')}` : ''}.`
  );
}

/** Read a URL's status without downloading its body. */
async function headStatus(url) {
  const res = await fetch(url, { method: 'GET', cache: 'no-store' });
  try {
    await res.body?.cancel?.();
  } catch {
    // The status is what was wanted.
  }
  return res.status;
}

const servedByApi = (url) => typeof url === 'string' && /\/api\/public\/media\//.test(url);

export async function runBlob() {
  let heroes;
  try {
    const res = await getJSON('cms/platform-settings/default-heroes');
    heroes = res?.value?.heroes ?? {};
  } catch (error) {
    return result(
      'unavailable',
      `The default covers could not be read: ${error?.message || error}`
    );
  }
  const urls = Object.values(heroes).filter((url) => typeof url === 'string' && url.trim());
  if (urls.length === 0)
    return result(
      'unknown',
      'No default cover is configured, so there is no known asset to fetch.'
    );
  const probeable = urls.filter(servedByApi);
  if (probeable.length === 0) {
    return result(
      'unknown',
      'The default covers are served from another host, which this page cannot probe without CORS.'
    );
  }
  try {
    const status = await headStatus(probeable[0]);
    if (status >= 200 && status < 400)
      return result(
        'healthy',
        `A default cover answered HTTP ${status} through /api/public/media.`
      );
    return result(
      'unavailable',
      `A default cover answered HTTP ${status} through /api/public/media.`
    );
  } catch (error) {
    return result('unavailable', `The media route did not answer: ${error?.message || error}`);
  }
}

export async function runBrokenRelationships() {
  let items;
  try {
    const res = await getJSON('public/content?limit=20');
    const list = Array.isArray(res) ? res : res?.items;
    items = Array.isArray(list) ? list : [];
  } catch (error) {
    return result(
      'unavailable',
      `The public content list could not be read: ${error?.message || error}`
    );
  }
  const covers = items
    .map((item) => ({
      id: item.id ?? item.slug,
      url: item.coverImage || item.imageUrl || item.contentImageUrl,
    }))
    .filter((row) => typeof row.url === 'string' && row.url.trim());
  if (covers.length === 0)
    return result('unknown', 'None of the 20 newest published items carries a cover image URL.');
  const probeable = covers.filter((row) => servedByApi(row.url));
  if (probeable.length === 0) {
    return result(
      'unknown',
      `${plural(covers.length, 'cover')} found, all on hosts this page cannot probe without CORS.`
    );
  }
  const statuses = await Promise.all(
    probeable.map(async (row) => {
      try {
        return { ...row, status: await headStatus(row.url) };
      } catch {
        return { ...row, status: 0 };
      }
    })
  );
  const broken = statuses.filter(
    (row) => row.status === 404 || row.status === 410 || row.status === 0
  );
  if (broken.length === 0) {
    return result(
      'healthy',
      `${plural(probeable.length, 'cover')} of the 20 newest published items answered.`
    );
  }
  return result(
    'degraded',
    `${broken.length} of ${probeable.length} covers checked do not answer.`,
    {
      detail: broken.map((row) => `${row.id}: HTTP ${row.status}`).join('\n'),
    }
  );
}

// ── The registry ─────────────────────────────────────────────────────────────

export const PROBES = Object.freeze([
  // ── Pipeline ──────────────────────────────────────────────────────────────
  sessionProbe({
    id: 'rss-fetch',
    label: 'RSS fetch job',
    hub: 'pipeline',
    covers: 'Pulls every feed and creates new content candidates.',
    impact: 'Without it the Review Queue stops receiving new items.',
    action:
      'Run it from the Pipeline Smoke Tests card below; a failed feed is named in the result.',
    href: QUEUE,
    safe: false,
    costNote: 'Writes real content documents, so it runs from its own button only.',
    evaluate: smokeEvaluator('rss', 'Not run in this session.'),
    run: (ctx) => ctx.actions.runSmoke('rss'),
  }),
  sessionProbe({
    id: 'batch-inspect',
    label: 'Batch inspect job',
    hub: 'pipeline',
    covers: 'Runs the inspector on up to ten ingested items.',
    impact: 'Items without metadata reach review unexplained.',
    action: 'Run it below; a model refusal shows on the AI providers probe too.',
    href: QUEUE,
    safe: false,
    costNote: 'Spends model calls and writes inspection results.',
    evaluate: smokeEvaluator('inspect', 'Not run in this session.'),
    run: (ctx) => ctx.actions.runSmoke('inspect'),
  }),
  sessionProbe({
    id: 'reviewer-digest',
    label: 'Reviewer digest',
    hub: 'pipeline',
    covers: 'Builds the reviewer summary from queued and recent RSS entries.',
    impact: 'The Overview digest row and the Telegram summary go stale.',
    action: 'Run it below; an indexing error names the Cosmos indexing policy.',
    href: ALERTS,
    safe: false,
    costNote: 'Writes a digest document.',
    evaluate: smokeEvaluator('digest', 'Not run in this session.'),
    run: (ctx) => ctx.actions.runSmoke('digest'),
  }),
  snapshotProbe({
    id: 'scheduled-publishing',
    label: 'Scheduled publishing',
    hub: 'pipeline',
    covers: 'The 15-minute scheduler that publishes due items, and its 6-hour watchdog.',
    impact: 'Scheduled items stay unpublished and overdue.',
    action: 'Open Alerts for the failure; the Publish page lists what is due.',
    href: { to: '/admin/published', label: 'Publish' },
    evaluate: evaluateScheduledPublishing,
  }),
  snapshotProbe({
    id: 'publishing-failures',
    label: 'Publishing failures',
    hub: 'pipeline',
    covers: 'Open scheduled_publish_failures alerts.',
    impact: 'Each one is a scheduled item that did not go live.',
    action: 'Resolve the alert once the item is republished.',
    href: ALERTS,
    evaluate: evaluatePublishingFailures,
  }),
  snapshotProbe({
    id: 'queue-sla',
    label: 'Review queue age',
    hub: 'pipeline',
    covers: 'Items waiting in review for more than 24 hours, and the oldest staged item.',
    impact: 'Content ages before anyone sees it.',
    action: 'Work the Review Queue oldest first.',
    href: QUEUE,
    evaluate: evaluateQueueSla,
  }),
  snapshotProbe({
    id: 'link-rot',
    label: 'Live page links',
    hub: 'pipeline',
    covers: 'The weekly link-rot check over every live page and its source URL.',
    impact: 'Visitors meet 404s on pages this site still links to.',
    action: 'Fix or unpublish the broken pages listed in the detail.',
    href: LIVE_PAGES,
    evaluate: evaluateLinkRot,
  }),
  snapshotProbe({
    id: 'broken-relationships',
    label: 'Cover images of published items',
    hub: 'pipeline',
    kind: 'live',
    covers: 'Whether the cover image URLs of the 20 newest published items answer.',
    impact: 'Published pages render a broken image.',
    action: 'Regenerate or replace the cover from the Editor.',
    href: GALLERY,
    run: runBrokenRelationships,
  }),

  // ── Creative ──────────────────────────────────────────────────────────────
  {
    id: 'ai-providers',
    label: 'AI providers',
    hub: 'creative',
    kind: 'live',
    safe: true,
    costNote: 'One short prompt per enabled provider, the same as the AI Engine Test button.',
    covers: 'Every provider enabled on the AI Engine page, asked one word.',
    impact: 'Drafts, summaries, inspection and scripts fail or fall to a backup.',
    action: 'Reorder or disable a provider on AI Engine; rotate a rejected key on Keys.',
    href: AI_ENGINE,
    run: runAiProviders,
  },
  fromService('replicate', {
    hub: 'creative',
    covers: 'Cover image generation.',
    impact: 'New posts fall back to a stock cover.',
    action: 'Rotate the key on the Keys tab if the account is refused.',
  }),
  fromService('firecrawl', {
    hub: 'creative',
    covers: 'Reading a submitted URL into clean text.',
    impact: 'URL submissions cannot be summarised.',
    action: 'Top up credits or rotate the key.',
  }),
  snapshotProbe({
    id: 'forge',
    label: 'Scheduled forge',
    hub: 'creative',
    covers: 'The autonomous forge timer and its daily budget.',
    impact: 'Nothing is drafted overnight.',
    action: 'Check the forge schedule and daily limit in Forge Studio.',
    href: FORGE,
    evaluate: evaluateForge,
  }),
  snapshotProbe({
    id: 'orphaned-images',
    label: 'Orphaned generated images',
    hub: 'creative',
    covers: 'Generated image rows whose content document no longer exists.',
    impact: 'Blob storage holds images nothing shows.',
    action: 'Archive or delete them from the Image Gallery.',
    href: GALLERY,
    evaluate: evaluateOrphanedImages,
  }),

  // ── Amplify ───────────────────────────────────────────────────────────────
  fromService('publer', {
    hub: 'amplify',
    covers: 'Social autoposting and the Social Hub.',
    impact: 'Live publishes produce no social posts.',
    action: 'Check the key and workspace id lights on Keys; the Social Hub lists refused posts.',
  }),
  fromService('resend', {
    hub: 'amplify',
    covers: 'The mailing list and newsletter sends.',
    impact: 'Issues cannot be sent and sign-ups cannot be confirmed.',
    action: 'Mint a Full access key and paste it on Keys.',
  }),
  {
    id: 'newsletter-build',
    label: 'Newsletter build timer',
    hub: 'amplify',
    kind: 'live',
    safe: true,
    covers: 'Whether a weekly issue has been built on schedule.',
    impact: 'No issue to review or send this week.',
    action: 'Check the send day in Newsletter Hub Settings and build an issue by hand.',
    href: NEWSLETTER,
    run: runNewsletterBuild,
  },
  fromService('linkie', {
    hub: 'amplify',
    covers: 'The link-in-bio page.',
    impact: 'New live pages are not added to the bio links.',
    action: 'Rotate the key on Keys.',
  }),
  fromService('telegram', {
    hub: 'amplify',
    covers: 'Approve-or-reject notices and alert messages.',
    impact: 'Nobody is told when content is ready or when something fails.',
    action: 'Re-mint the bot token with BotFather and re-register the webhook.',
  }),
  snapshotProbe({
    id: 'telegram-notify',
    label: 'Telegram notices sent',
    hub: 'amplify',
    covers: 'When each alert source last sent a Telegram message, from the notify cooldown state.',
    impact: 'Silence here with alerts open means notices are not going out.',
    action: 'Test Telegram above; check TELEGRAM_CHAT_ID on Keys.',
    href: INTEGRATIONS('communication'),
    evaluate: evaluateTelegramNotify,
  }),
  fromService('rsscom', {
    hub: 'amplify',
    covers: 'Podcast hosting and episode publishing.',
    impact: 'Episodes have to be uploaded by hand.',
    action: 'Rotate the key on Keys.',
  }),
  fromService('plaud', {
    hub: 'amplify',
    covers: 'Recordings and transcripts from the voice recorder.',
    impact: 'The Recording Hub shows no new recordings.',
    action: 'Reconnect from Recording Hub → Settings; the sign-in renews every 12 hours.',
  }),
  fromService('youtube', {
    hub: 'amplify',
    covers: 'The watch-next videos beside Listen & Learn episodes.',
    impact: 'Episodes show no related videos.',
    action: 'Check quota in the Google console; rotate the key on Keys.',
  }),

  // ── Enhanced ──────────────────────────────────────────────────────────────
  fromService('elevenlabs', {
    hub: 'enhanced',
    covers: 'Podcast narration.',
    impact: 'Episodes cannot be rendered.',
    action: 'Check credits on the Audio tab; rotate the key on Keys.',
  }),
  {
    id: 'lab-agents',
    label: 'Lab agents',
    hub: 'enhanced',
    kind: 'live',
    safe: true,
    covers: 'The registered lab agents and their 30-second heartbeat.',
    impact: 'Lab jobs queue with nothing to run them.',
    action: 'Restart the agent on the VPS; the Labs Agents tab shows which is offline.',
    href: LABS,
    run: runLabAgents,
  },
  sessionProbe({
    id: 'labs-noop',
    label: 'Labs job round trip',
    hub: 'enhanced',
    covers: 'Enqueue a shell-echo job as the console does, read it back, cancel it.',
    impact: 'The Labs console cannot submit jobs.',
    action: 'Run it from the card below; a job left queued is named with its id.',
    href: LABS,
    safe: false,
    costNote: 'Creates and cancels a real lab job.',
    evaluate: evaluateLabsSession,
    run: (ctx) => ctx.actions.runLabs(),
  }),
  sessionProbe({
    id: 'labs-unauth',
    label: 'Labs refuses anonymous jobs',
    hub: 'enhanced',
    covers: 'The same enqueue with no Authorization header must be refused.',
    impact: 'A 200 here means anyone can queue work on the lab.',
    action: 'If it passes anonymously, stop and check the route guard before anything else.',
    href: LABS,
    safe: true,
    evaluate: evaluateUnauthSession,
    run: (ctx) => ctx.actions.runUnauth(),
  }),
  fromService('hybrid-lab', {
    hub: 'enhanced',
    covers: 'Coder workspaces and the Turnstile check behind the public labs page.',
    impact: 'The labs page says the lab is not provisioned.',
    action: 'Seed CODER-URL and CODER-STATUS-TOKEN on Keys.',
  }),

  // ── Spotlight ─────────────────────────────────────────────────────────────
  fromService('sessionize', {
    hub: 'spotlight',
    covers: 'The public speaker feed behind Speaking.',
    impact: 'Speaking events stop updating.',
    action: 'Check the speaker id on the Sessionize card.',
  }),

  // ── Platform ──────────────────────────────────────────────────────────────
  snapshotProbe({
    id: 'cosmos',
    label: 'Cosmos DB',
    hub: 'platform',
    covers: 'Whether the ops-health snapshot, ten queries across six containers, answers.',
    impact: 'Nothing on the admin reads or writes.',
    action: 'Check the Cosmos account and the Function App identity.',
    href: { to: '/admin/health?tab=overview', label: 'Overview' },
    evaluate: evaluateCosmos,
  }),
  {
    id: 'blob',
    label: 'Blob storage',
    hub: 'platform',
    kind: 'live',
    safe: true,
    covers: 'One default cover fetched through /api/public/media.',
    impact: 'Covers and audio do not load on the public site.',
    action: 'Check the storage account and the media route.',
    href: SETTINGS('content'),
    run: runBlob,
  },
  snapshotProbe({
    id: 'storage',
    label: 'Storage usage',
    hub: 'platform',
    covers: 'How many generated image rows exist (a cheap proxy for Blob usage).',
    impact: 'Informational.',
    action: 'Archive from the Image Gallery when it grows.',
    href: GALLERY,
    evaluate: evaluateStorage,
  }),
  snapshotProbe({
    id: 'runtime-config',
    label: 'Runtime configuration',
    hub: 'platform',
    covers:
      'The configuration generation this worker runs and whether its Key Vault references resolved.',
    impact: 'An unresolved reference turns a feature off silently.',
    action: 'Seed the named key on Keys, or check the vault firewall and RBAC.',
    href: KEYS,
    evaluate: evaluateRuntimeConfig,
  }),
  {
    id: 'unresolved-secrets',
    label: 'Unresolved Key Vault references',
    hub: 'platform',
    kind: 'live',
    safe: true,
    covers: 'The count /api/health reports, with the names from the snapshot.',
    impact: 'Each one is an integration quietly off.',
    action: 'Seed the key on Keys.',
    href: KEYS,
    run: runUnresolvedSecrets,
  },
  fromService('qlty', {
    hub: 'platform',
    covers: 'The Code and Security tab.',
    impact: 'That tab says Qlty is not configured.',
    action: 'Rotate the token on Keys.',
  }),
  fromService('cloud-pricing', {
    hub: 'platform',
    covers: 'The daily price snapshot behind the public comparison page.',
    impact: 'The comparison shows stale or no prices.',
    action: 'Press Refresh now on the Cloud pricing card; check the AWS and GCP keys.',
  }),
  sessionProbe({
    id: 'identity-token',
    label: 'Session token',
    hub: 'platform',
    covers: 'Audience, role, scope and version of the token this session sends.',
    impact: 'Every API call from this browser is refused.',
    action: 'Sign out and in; if it persists, check the app registrations on Identity.',
    href: { to: '/admin/integrations?tab=identity', label: 'Identity' },
    safe: true,
    evaluate: evaluateIdentitySession,
    run: (ctx) => ctx.actions.rerunIdentity(),
  }),
  sessionProbe({
    id: 'admin-registry',
    label: 'Admin registry lookup',
    hub: 'platform',
    covers: 'Whether the admins container lists this principal.',
    impact: 'Writes are refused even with a valid token.',
    action: 'Add or reactivate the admin row.',
    href: { to: '/admin/integrations?tab=identity', label: 'Identity' },
    safe: true,
    evaluate: evaluateRegistrySession,
    run: (ctx) => ctx.actions.rerunIdentity(),
  }),
]);

export const PROBE_IDS = Object.freeze(PROBES.map((probe) => probe.id));

/** Probes grouped by hub, in HUBS order. */
export function probesByHub(probes = PROBES) {
  return Object.entries(HUBS)
    .map(([id, label]) => ({ id, label, probes: probes.filter((probe) => probe.hub === id) }))
    .filter((group) => group.probes.length > 0);
}

/**
 * The result to show for one probe: a stored live result, or the evaluation
 * of the page's state for snapshot and session kinds. Never null — a probe
 * with nothing to say says unknown.
 */
export function resolveProbe(probe, ctx, liveResults = {}) {
  if (probe.kind === 'live') {
    return liveResults[probe.id] ?? result('unknown', 'Not tested yet.', { checkedAt: null });
  }
  return probe.evaluate(ctx) ?? result('unknown', 'Not evaluated.', { checkedAt: null });
}

/** The Markdown lines the Report tab adds for the registry. */
export function probeReportLines(probes, resolve) {
  const lines = ['### Probe registry', ''];
  for (const group of probesByHub(probes)) {
    lines.push(`#### ${group.label}`);
    for (const probe of group.probes) {
      const r = resolve(probe);
      const label = SYSTEM_STATUS[r.status]?.label ?? 'Unknown';
      lines.push(
        `- ${probe.label}: ${label}${r.checkedAt ? ` (${r.checkedAt})` : ''} — ${r.summary}`
      );
    }
    lines.push('');
  }
  return lines;
}

/** Every testable, safe probe: what Test all runs. */
export const safeProbes = (probes = PROBES) => probes.filter((probe) => probe.safe);

/** The service ids the registry covers, for the registry test. */
export const SERVICE_PROBE_IDS = Object.freeze(
  PROBES.filter((probe) => SERVICES.some((service) => service.id === probe.id)).map(
    (probe) => probe.id
  )
);
