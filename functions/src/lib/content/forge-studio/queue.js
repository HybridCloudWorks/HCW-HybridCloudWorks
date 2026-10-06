/**
 * The Forge Studio Queue (owner request 2026-10-06): many URLs in, each one
 * a queue entry whose "From a URL" fields the owner completes one at a time
 * or for several at once, and which then goes through the same
 * `forge-from-url` job a single URL does — with its brief carried on the
 * job, so the brief lands on the document the job creates whether or not a
 * browser is still open to save it.
 *
 * One document PER ENTRY in `admin_config` (`docType: forge_queue_item`,
 * the constant partition every admin_config document carries). The first
 * cut held every entry in one document; the owner's first real import was a
 * browser favourites export of several hundred links, which a 2 MB item
 * cannot hold and a 200-entry cap refused (owner, 2026-10-06). Entries as
 * documents lift the cap to MAX_QUEUE_ITEMS, make every edit an independent
 * ETag-guarded write, and let the job's onComplete record an outcome
 * without racing a bulk edit of other entries. The old single document is
 * migrated into entries on the first read after deploy and emptied.
 *
 * Entry statuses: `queued` (fields may still be blank), `forging` (a job is
 * running, `jobId` says which), `forged` (`contentId` is the document; the
 * entry stays until removed so the owner can open it), `failed` (`error`
 * says why; Save again re-queues it).
 */
import { ADMIN_CONFIG_PARTITION } from '../../cosmos-client.js';
import { JOBS_CONTAINER, TERMINAL_JOB_STATUSES, newJobDoc } from '../../jobs.js';
import { actorName, json } from './config.js';
import { normalizeBrief, text } from './brief.js';

export const QUEUE_DOC_TYPE = 'forge_queue_item';
export const QUEUE_ID_PREFIX = 'forge_queue_item:';
/** The single document the first cut kept; read once and emptied. */
export const LEGACY_QUEUE_DOC_ID = 'forge_queue';
/** A favourites export is hundreds; thousands is still one admin's list. */
export const MAX_QUEUE_ITEMS = 5000;
export const MAX_URLS_PER_ADD = 2000;
export const MAX_IDS_PER_CALL = 2000;
/** Per-entry ETag retries: a bulk edit and the job's onComplete can touch one entry together. */
export const ITEM_WRITE_ATTEMPTS = 6;
/** Forging entries the list reconciles against their job documents per read. */
export const RECONCILE_PER_READ = 50;
export const QUEUE_STATUSES = Object.freeze(['queued', 'forging', 'forged', 'failed']);
/** The brief fields a queue entry may carry; `mode` and `sourceUrl` are the entry's own. */
export const QUEUE_BRIEF_FIELDS = Object.freeze([
  'objective',
  'audience',
  'tone',
  'readingLevel',
  'targetLength',
  'keyMessage',
  'requiredTopics',
  'prohibitedTopics',
  'callsToAction',
  'sources',
  'targetChannel',
  'campaign',
  'seoKeywords',
]);

const SAFE_ID = /^[A-Za-z0-9_:-]{1,120}$/;
const refuse = (status, body) => ({ error: json(status, body) });
const CONTAINER = 'admin_config';
const PK = { partitionKey: ADMIN_CONFIG_PARTITION };

/**
 * A URL as the queue stores it: http(s) only, trimmed, the fragment dropped
 * (it never reaches the server), nothing else changed — tracking parameters
 * stay because the page they lead to is the same page the owner saw.
 */
export function normalizeQueueUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  parsed.hash = '';
  return parsed.toString().slice(0, 2000);
}

/** The brief a queue entry carries, normalised, always in URL mode on its own URL. */
export function entryBrief(entry, fields = {}) {
  const merged = { ...(entry.brief || {}) };
  for (const key of QUEUE_BRIEF_FIELDS) {
    if (fields[key] !== undefined) merged[key] = fields[key];
  }
  return normalizeBrief({ ...merged, mode: 'url', sourceUrl: entry.url });
}

/** The queue entry a URL becomes: one admin_config document of its own. */
export function newEntry({ url, id, stamp, actor, title = '' }) {
  return {
    id: id.startsWith(QUEUE_ID_PREFIX) ? id : `${QUEUE_ID_PREFIX}${id}`,
    configScope: ADMIN_CONFIG_PARTITION,
    docType: QUEUE_DOC_TYPE,
    url,
    title: text(title, 300),
    addedAt: stamp,
    addedBy: actor,
    brief: normalizeBrief({ mode: 'url', sourceUrl: url }),
    kind: '',
    ideaOrigin: 'imported-source',
    status: 'queued',
    jobId: null,
    contentId: null,
    error: null,
    updatedAt: stamp,
  };
}

/** Every entry, newest first (same stamp: insertion order). */
export async function readEntries(store) {
  const rows = await store.queryDocs(
    CONTAINER,
    'SELECT * FROM c WHERE c.configScope = @scope AND c.docType = @type',
    [
      { name: '@scope', value: ADMIN_CONFIG_PARTITION },
      { name: '@type', value: QUEUE_DOC_TYPE },
    ],
    PK
  );
  return [...(rows || [])].sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
}

/** One entry by id, or null when there is none (or the id names something else). */
export async function readEntry(store, id) {
  if (!SAFE_ID.test(String(id || '')) || !String(id).startsWith(QUEUE_ID_PREFIX)) return null;
  const doc = await store.readDoc(CONTAINER, id, ADMIN_CONFIG_PARTITION);
  return doc && doc.docType === QUEUE_DOC_TYPE ? doc : null;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read → `change(entry)` → patch under the entry's ETag, retried while
 * another writer gets there first. `change` returns the fields to write, or
 * null to write nothing. Resolves to the entry after, or null when it is
 * gone.
 */
export async function updateEntry(
  store,
  id,
  change,
  { attempts = ITEM_WRITE_ATTEMPTS, sleep = null } = {}
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0 && sleep) await sleep(25 * 2 ** Math.min(attempt, 5) + Math.random() * 25);
    const current = await readEntry(store, id);
    if (!current) return null;
    const patch = change({ ...current });
    if (!patch) return current;
    try {
      return await store.patchDoc(CONTAINER, id, patch, { ...PK, ifMatch: current._etag });
    } catch (error) {
      if (error?.code !== 412) throw error;
    }
  }
  throw new Error('A queue entry kept changing; nothing was written. Try again.');
}

/** The ids a body names, cleaned; the refusal when none or too many. */
function idsOf(body) {
  const raw = Array.isArray(body?.ids) ? body.ids : [];
  const ids = [
    ...new Set(raw.map((id) => String(id || '').trim()).filter((id) => SAFE_ID.test(id))),
  ];
  if (!ids.length) return refuse(400, { ok: false, error: 'ids required' });
  if (ids.length > MAX_IDS_PER_CALL) {
    return refuse(400, { ok: false, error: `At most ${MAX_IDS_PER_CALL} ids per call` });
  }
  return { ids };
}

/** The `fields` of an update: only the brief keys the queue knows, plus `kind`; the refusal when nothing usable. */
function fieldsOf(body) {
  const raw = body?.fields && typeof body.fields === 'object' ? body.fields : {};
  const fields = {};
  for (const key of QUEUE_BRIEF_FIELDS) {
    if (raw[key] !== undefined) fields[key] = raw[key];
  }
  const kind = raw.kind !== undefined ? text(raw.kind, 60) : undefined;
  if (!Object.keys(fields).length && kind === undefined) {
    return refuse(400, { ok: false, error: 'fields required: nothing to apply' });
  }
  return { fields, kind };
}

/** The patch that applies `fields` (and `kind`) to an entry; a failed entry goes back to queued. */
export function applyFields(entry, { fields, kind }, stamp) {
  return {
    brief: entryBrief(entry, fields),
    ...(kind !== undefined ? { kind } : {}),
    ...(entry.status === 'failed' ? { status: 'queued', error: null } : {}),
    updatedAt: stamp,
  };
}

/**
 * What a job's onComplete records on the entry it was started for: the
 * document when it succeeded, the error when it did not. A `skipped`
 * duplicate (the forge's 409) is recorded as forged on the duplicate.
 */
export function outcomeFor({ status, result, error }) {
  if (status === 'succeeded' && result && result.success !== false) {
    return { status: 'forged', contentId: result.contentId || null, error: null };
  }
  if (status === 'succeeded' && result?.skipped) {
    return {
      status: 'forged',
      contentId: result.duplicateOf || result.contentId || null,
      error: result.error ? String(result.error).slice(0, 500) : null,
    };
  }
  const message = error || result?.error || `the forge job ${status || 'did not finish'}`;
  return {
    status: 'failed',
    contentId: result?.contentId || null,
    error: String(message).slice(0, 500),
  };
}

/**
 * The job's onComplete half: the entry `queueItemId` names takes the
 * outcome, under its own ETag with retries. Nothing when the entry is gone
 * (the owner removed it while the job ran). Should every attempt lose, the
 * list's reconcile reads the job document on the next open.
 */
export async function recordQueueOutcome(
  store,
  { queueItemId, status, result, error },
  { now, sleep = defaultSleep }
) {
  const id = String(queueItemId || '');
  if (!SAFE_ID.test(id)) return null;
  const outcome = outcomeFor({ status, result, error });
  return updateEntry(store, id, () => ({ ...outcome, updatedAt: now().toISOString() }), {
    attempts: 10,
    sleep,
  });
}

/**
 * Forging entries whose job has already finished take its outcome from the
 * job document: the hook above may have lost every ETag race, or the host
 * may have recycled before it ran. At most RECONCILE_PER_READ per read.
 * Resolves to the entries with the outcomes applied.
 */
export async function reconcileForging(ctx, entries) {
  const forging = entries
    .filter((item) => item.status === 'forging' && item.jobId)
    .slice(0, RECONCILE_PER_READ);
  if (!forging.length) return entries;
  const updated = new Map();
  for (const item of forging) {
    const job = await ctx.store.readDoc(JOBS_CONTAINER, item.jobId, item.jobId).catch(() => null);
    if (!job || !TERMINAL_JOB_STATUSES.includes(job.status)) continue;
    const outcome = outcomeFor({ status: job.status, result: job.result, error: job.error });
    const after = await updateEntry(ctx.store, item.id, (entry) =>
      entry.status === 'forging' ? { ...outcome, updatedAt: ctx.now().toISOString() } : null
    ).catch(() => null);
    if (after) updated.set(item.id, after);
  }
  return updated.size ? entries.map((item) => updated.get(item.id) || item) : entries;
}

/** A legacy item as an entry document, its fields and status kept. */
function entryFromLegacy(ctx, item, url) {
  const stamp = ctx.now().toISOString();
  return {
    ...newEntry({
      url,
      id: ctx.uuid(),
      stamp: item.addedAt || stamp,
      actor: item.addedBy || 'migration',
      title: item.title,
    }),
    brief: entryBrief({ url, brief: item.brief || {} }),
    kind: text(item.kind, 60),
    status: QUEUE_STATUSES.includes(item.status) ? item.status : 'queued',
    jobId: item.jobId || null,
    contentId: item.contentId || null,
    error: item.error || null,
    updatedAt: item.updatedAt || stamp,
  };
}

/**
 * The first cut's single document: its entries become documents of their
 * own (URLs the queue already has are skipped), and it is emptied so this
 * runs once. Nothing when there is no such document or it is already empty.
 */
export async function migrateLegacyQueue(ctx) {
  const legacy = await ctx.store.readDoc(CONTAINER, LEGACY_QUEUE_DOC_ID, ADMIN_CONFIG_PARTITION);
  const items = Array.isArray(legacy?.items) ? legacy.items : [];
  if (!items.length) return 0;
  const have = new Set((await readEntries(ctx.store)).map((entry) => entry.url));
  let moved = 0;
  for (const item of items) {
    const url = normalizeQueueUrl(item.url);
    if (!url || have.has(url)) continue;
    await ctx.store.createDoc(CONTAINER, entryFromLegacy(ctx, item, url));
    have.add(url);
    moved += 1;
  }
  await ctx.store.replaceDocIfMatch(
    CONTAINER,
    { ...legacy, items: [], migratedAt: ctx.now().toISOString(), migratedCount: moved },
    PK
  );
  return moved;
}

/** The public shape of the queue: items newest first, the cap. */
const answer = (items, extra = {}) =>
  json(200, { ok: true, items, total: items.length, max: MAX_QUEUE_ITEMS, ...extra });

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** POST cms/forge/queue — { urls[] } */
async function addUrls(ctx, body, auth) {
  const raw = Array.isArray(body?.urls) ? body.urls : [];
  if (raw.length > MAX_URLS_PER_ADD) {
    return json(400, { ok: false, error: `At most ${MAX_URLS_PER_ADD} URLs per add` });
  }
  const urls = [...new Set(raw.map(normalizeQueueUrl).filter(Boolean))];
  if (!urls.length) return json(400, { ok: false, error: 'urls required: no http(s) URL given' });
  const existing = await readEntries(ctx.store);
  const have = new Set(existing.map((entry) => entry.url));
  const stamp = ctx.now().toISOString();
  const actor = actorName(auth.user);
  const added = [];
  const skipped = [];
  let full = 0;
  let count = existing.length;
  for (const url of urls) {
    if (have.has(url)) {
      skipped.push(url);
    } else if (count >= MAX_QUEUE_ITEMS) {
      full += 1;
    } else {
      const entry = newEntry({ url, id: ctx.uuid(), stamp, actor });
      await ctx.store.createDoc(CONTAINER, entry);
      have.add(url);
      added.push(entry.id);
      count += 1;
    }
  }
  return answer(await readEntries(ctx.store), { added, skipped, full });
}

/**
 * POST cms/forge/queue/update — { ids[], remove: true }. A forging entry is
 * kept: its job is running and will report to it; `removed` names only what
 * went.
 */
async function removeEntries(ctx, ids) {
  const removed = [];
  for (const id of ids) {
    const entry = await readEntry(ctx.store, id);
    if (!entry || entry.status === 'forging') continue;
    await ctx.store.deleteDoc(CONTAINER, id, ADMIN_CONFIG_PARTITION);
    removed.push(id);
  }
  return answer(await readEntries(ctx.store), { removed });
}

/** POST cms/forge/queue/update — { ids[], fields } */
async function updateEntries(ctx, body) {
  const picked = idsOf(body);
  if (picked.error) return picked.error;
  if (body?.remove === true) return removeEntries(ctx, picked.ids);
  const change = fieldsOf(body);
  if (change.error) return change.error;
  const stamp = ctx.now().toISOString();
  const applied = [];
  for (const id of picked.ids) {
    const after = await updateEntry(ctx.store, id, (entry) =>
      entry.status === 'forging' ? null : applyFields(entry, change, stamp)
    );
    if (after && after.status !== 'forging') applied.push(id);
  }
  return answer(await readEntries(ctx.store), { applied });
}

/** The job document one entry starts; the entry's brief rides on the payload. */
const jobFor = (item, { jobId, user, stamp }) =>
  newJobDoc({
    id: jobId,
    type: 'forge-from-url',
    payload: {
      url: item.url,
      brief: entryBrief(item),
      kind: item.kind || '',
      ideaOrigin: item.ideaOrigin || 'imported-source',
      queueItemId: item.id,
    },
    requestedBy: user,
    createdAt: stamp,
  });

const canForge = (item) => item.status !== 'forging' && item.status !== 'forged';

/**
 * One entry into the forge: its job document first, then the entry marked
 * forging under its ETag (only if still forgeable), then its message.
 * Resolves to `{ started }` or `{ failed }` with the sentence.
 */
async function forgeOne(ctx, id, { user, stamp, context, io }) {
  const entry = await readEntry(ctx.store, id);
  if (!entry || !canForge(entry)) return { skipped: true };
  const jobDoc = jobFor(entry, { jobId: ctx.uuid(), user, stamp });
  try {
    await ctx.store.upsertDoc(JOBS_CONTAINER, jobDoc);
  } catch (error) {
    context?.error?.(`[forge/queue] job write failed: ${error?.message || error}`);
    return { failed: String(error?.message || error).slice(0, 300) };
  }
  await updateEntry(ctx.store, id, (current) =>
    canForge(current) ? { status: 'forging', jobId: jobDoc.id, error: null, updatedAt: stamp } : null
  );
  io.enqueue({ jobId: jobDoc.id, type: jobDoc.type });
  return { started: { id, jobId: jobDoc.id } };
}

/**
 * POST cms/forge/queue/forge — { ids[] }; `io.enqueue` is the queue output
 * binding (the route collects what it emits and sets the binding once).
 *
 * A job write that fails leaves that entry and the later ones queued and
 * names them in `notStarted`, so Save again picks them up; a job whose
 * entry failed to be marked still runs, and its onComplete records the
 * outcome on the entry whatever its status then is.
 */
async function forgeEntries(ctx, body, auth, context, io) {
  if (typeof io?.enqueue !== 'function') {
    context?.error?.('forge/queue/forge: no queue output wired');
    return json(500, { ok: false, error: 'Job queue is not configured' });
  }
  const picked = idsOf(body);
  if (picked.error) return picked.error;
  const stamp = ctx.now().toISOString();
  const started = [];
  const notStarted = [];
  for (const id of picked.ids) {
    if (notStarted.length) {
      notStarted.push({ id, error: 'not attempted after an earlier job write failed' });
      continue;
    }
    const one = await forgeOne(ctx, id, { user: auth.user, stamp, context, io });
    if (one.started) started.push(one.started);
    else if (one.failed) notStarted.push({ id, error: one.failed });
  }
  return answer(await readEntries(ctx.store), {
    started,
    ...(notStarted.length ? { notStarted } : {}),
  });
}

/**
 * The four routes (editor), each one call:
 *   GET  cms/forge/queue          → the entries (legacy document migrated first, forging entries reconciled)
 *   POST cms/forge/queue          { urls[] }         add, deduplicated against the queue
 *   POST cms/forge/queue/update   { ids[], fields }  apply fields to each; { ids[], remove: true } removes
 *   POST cms/forge/queue/forge    { ids[] }          start a forge-from-url job per entry, brief on the job
 */
export function createForgeQueueHandlers({
  guard,
  store,
  now = () => new Date(),
  uuid = () => crypto.randomUUID(),
}) {
  const ctx = { store, now, uuid };
  const guarded = (fn) => async (request, context, io) => {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;
    try {
      return await fn(request, auth, context, io);
    } catch (error) {
      context?.error?.(`[forge/queue] ${error?.message || error}`);
      return json(502, { ok: false, error: String(error?.message || error) });
    }
  };
  return {
    list: guarded(async () => {
      await migrateLegacyQueue(ctx);
      return answer(await reconcileForging(ctx, await readEntries(store)));
    }),
    add: guarded(async (request, auth) => addUrls(ctx, await readBody(request), auth)),
    update: guarded(async (request) => updateEntries(ctx, await readBody(request))),
    forge: guarded(async (request, auth, context, io) =>
      forgeEntries(ctx, await readBody(request), auth, context, io)
    ),
  };
}
