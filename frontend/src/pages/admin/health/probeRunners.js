/**
 * The live runners (ADR 0033 §1 Platform, §8): probes that make a request of
 * their own rather than reading the snapshot — the AI providers through
 * testAiProvider, the labs snapshot, the newsletter issues, /api/health, and
 * the media route behind covers. Each answers one result in lib/status.js's
 * vocabulary and never throws: a read that fails is an unavailable result.
 */
import { getJSON, postJSON } from '@/lib/api';
import { ago, messageOf, plural, result } from './probeKit';

/**
 * A read as a probe sees it: `{ value }` when it answered, `{ failure }` — the
 * unavailable result naming what could not be read — when it threw. Runners
 * read through this so none needs a try/catch of its own.
 */
async function attempt(whatFailed, read) {
  try {
    return { value: await read() };
  } catch (error) {
    return { failure: result('unavailable', `${whatFailed}: ${messageOf(error)}`) };
  }
}

const listOf = (value) => (Array.isArray(value) ? value : []);

// ── AI providers ─────────────────────────────────────────────────────────────

async function testProvider(item) {
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
}

/** When the weekly probe (or a click) last tested any provider, as a sentence. */
function lastTestNote(items) {
  const [lastProbe] = items
    .filter((item) => item.lastTested)
    .sort((a, b) => Date.parse(b.lastTested) - Date.parse(a.lastTested));
  if (!lastProbe) return '';
  const by = lastProbe.lastTestedBy === 'probe' ? 'the weekly probe' : 'a click';
  return ` Last recorded test: ${lastProbe.id} ${ago(lastProbe.lastTested) ?? ''} by ${by}.`;
}

const outcomeLine = (o) => {
  if (!o.ok) return `${o.id}: ${o.error || 'failed'}`;
  return `${o.id}: connected${Number.isFinite(o.latencyMs) ? ` in ${o.latencyMs} ms` : ''}`;
};

/** The verdict from how many enabled providers answered: all, none, or some. */
function providersVerdict(outcomes, note) {
  const ok = outcomes.filter((o) => o.ok).length;
  const extra = { detail: outcomes.map(outcomeLine).join('\n') };
  if (ok === outcomes.length) {
    return result('healthy', `${plural(ok, 'enabled provider')} answered.${note}`, extra);
  }
  if (ok === 0) {
    return result(
      'unavailable',
      `None of the ${outcomes.length} enabled providers answered.${note}`,
      extra
    );
  }
  return result(
    'degraded',
    `${ok} of ${outcomes.length} enabled providers answered.${note}`,
    extra
  );
}

/** Every enabled AI provider, tested through the AI Engine's own test. */
export async function runAiProviders() {
  const read = await attempt('The provider list could not be read', async () =>
    listOf((await getJSON('cms/config/ai-providers'))?.items)
  );
  if (read.failure) return read.failure;
  const enabled = read.value.filter((item) => item.enabled !== false);
  if (enabled.length === 0)
    return result('misconfigured', 'No AI provider is enabled on the AI Engine page.');
  const outcomes = await Promise.all(enabled.map(testProvider));
  return providersVerdict(outcomes, lastTestNote(read.value));
}

// ── Lab agents ───────────────────────────────────────────────────────────────

const latestOf = (values) => values.filter(Boolean).sort().at(-1);

export async function runLabAgents() {
  const read = await attempt('The labs snapshot could not be read', async () =>
    listOf((await postJSON('getLabsSnapshot', {}))?.agents)
  );
  if (read.failure) return read.failure;
  const agents = read.value;
  if (agents.length === 0) return result('unknown', 'No lab agent has registered yet.');
  const online = agents.filter((agent) => agent.online).length;
  const latest = latestOf(agents.map((agent) => agent.lastSeenAt));
  const seen = latest ? ` Last heartbeat ${ago(latest) ?? 'at an unknown time'}.` : '';
  if (online === agents.length)
    return result('healthy', `${plural(agents.length, 'agent')} online.${seen}`);
  if (online === 0) return result('unavailable', `All ${agents.length} agents are offline.${seen}`);
  return result('degraded', `${online} of ${agents.length} agents online.${seen}`);
}

// ── Newsletter build ─────────────────────────────────────────────────────────

/** The configured send day, as context for the verdict; null when it cannot be read. */
async function newsletterSendDay() {
  const read = await attempt(
    '',
    async () => (await getJSON('cms/platform-settings/newsletter-settings'))?.value?.sendDay
  );
  return read.value ?? null;
}

/** The newest issue's age in whole days; NaN when no issue carries a build time. */
const newestIssueAgeDays = (issues) => {
  const latest = latestOf(issues.map((issue) => issue.createdAt));
  return Math.floor((Date.now() - Date.parse(latest ?? '')) / 86400000);
};

export async function runNewsletterBuild() {
  const read = await attempt('The newsletter issues could not be read', async () =>
    listOf((await getJSON('cms/newsletters'))?.issues)
  );
  if (read.failure) return read.failure;
  const issues = read.value;
  const sendDay = await newsletterSendDay();
  const schedule = sendDay ? ` Issues build weekly for ${sendDay}.` : '';
  if (issues.length === 0) return result('unknown', `No issue has been built yet.${schedule}`);
  const days = newestIssueAgeDays(issues);
  if (!Number.isFinite(days))
    return result(
      'unknown',
      `${plural(issues.length, 'issue')} exist but none carries a build time.${schedule}`
    );
  if (days > 8)
    return result(
      'degraded',
      `The newest issue was built ${days} days ago; the weekly build has missed.${schedule}`
    );
  const latest = latestOf(issues.map((issue) => issue.createdAt));
  return result('healthy', `Newest issue built ${ago(latest) ?? 'recently'}.${schedule}`);
}

// ── Key Vault references ─────────────────────────────────────────────────────

export async function runUnresolvedSecrets(ctx) {
  const read = await attempt('/api/health did not answer', async () =>
    Number((await getJSON('health'))?.unresolvedSecrets)
  );
  if (read.failure) return read.failure;
  const count = read.value;
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

// ── Media route ──────────────────────────────────────────────────────────────

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
const filledString = (value) => typeof value === 'string' && value.trim();

/** One default cover fetched through /api/public/media, as a result. */
async function coverVerdict(url) {
  const read = await attempt('The media route did not answer', () => headStatus(url));
  if (read.failure) return read.failure;
  const status = read.value;
  const answered = status >= 200 && status < 400;
  return result(
    answered ? 'healthy' : 'unavailable',
    `A default cover answered HTTP ${status} through /api/public/media.`
  );
}

export async function runBlob() {
  const read = await attempt('The default covers could not be read', async () =>
    Object.values((await getJSON('cms/platform-settings/default-heroes'))?.value?.heroes ?? {})
  );
  if (read.failure) return read.failure;
  const urls = read.value.filter(filledString);
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
  return coverVerdict(probeable[0]);
}

// ── Covers of published items ────────────────────────────────────────────────

/** The cover a public content item names, under the field each era used. */
const coverOf = (item) => ({
  id: item.id ?? item.slug,
  url: item.coverImage || item.imageUrl || item.contentImageUrl,
});

async function probeCover(row) {
  try {
    return { ...row, status: await headStatus(row.url) };
  } catch {
    return { ...row, status: 0 };
  }
}

const isBroken = (row) => [404, 410, 0].includes(row.status);

/** The verdict for the covers that could be fetched. */
async function coversVerdict(probeable) {
  const broken = (await Promise.all(probeable.map(probeCover))).filter(isBroken);
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

export async function runBrokenRelationships() {
  const read = await attempt('The public content list could not be read', async () => {
    const res = await getJSON('public/content?limit=20');
    return listOf(Array.isArray(res) ? res : res?.items);
  });
  if (read.failure) return read.failure;
  const covers = read.value.map(coverOf).filter((row) => filledString(row.url));
  if (covers.length === 0)
    return result('unknown', 'None of the 20 newest published items carries a cover image URL.');
  const probeable = covers.filter((row) => servedByApi(row.url));
  if (probeable.length === 0) {
    return result(
      'unknown',
      `${plural(covers.length, 'cover')} found, all on hosts this page cannot probe without CORS.`
    );
  }
  return coversVerdict(probeable);
}
