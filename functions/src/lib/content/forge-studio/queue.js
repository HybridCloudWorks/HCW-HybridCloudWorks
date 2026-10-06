/**
 * The Forge Studio Queue (owner request 2026-10-06): many URLs in, each one a
 * queue entry whose "From a URL" fields the owner completes one at a time or
 * for several at once, and which then goes through the same `forge-from-url`
 * job a single URL does — with its brief carried on the job, so the brief
 * lands on the document the job creates whether or not a browser is still
 * open to save it.
 *
 * One document, `admin_config/forge_queue`, holds every entry: the queue is
 * small (MAX_QUEUE_ITEMS), one editor works it, and a single document means
 * a bulk edit is one write and no new container is needed. Every write is a
 * read → change → `replaceDocIfMatch` under the ETag, retried a few times,
 * because two writers do touch it: the Studio, and the job's onComplete hook
 * recording an outcome.
 *
 * Entry statuses: `queued` (fields may still be blank), `forging` (a job is
 * running, `jobId` says which), `forged` (`contentId` is the document; the
 * entry stays until removed so the owner can open it), `failed` (`error`
 * says why; Save again re-queues it).
 */
import { ADMIN_CONFIG_PARTITION } from '../../cosmos-client.js';
import { JOBS_CONTAINER, newJobDoc } from '../../jobs.js';
import { actorName, json } from './config.js';
import { normalizeBrief, text } from './brief.js';

export const QUEUE_DOC_ID = 'forge_queue';
export const MAX_QUEUE_ITEMS = 200;
export const MAX_URLS_PER_ADD = 100;
export const MAX_IDS_PER_CALL = 200;
export const QUEUE_WRITE_ATTEMPTS = 4;
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

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const refuse = (status, body) => ({ error: json(status, body) });

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

/** The queue document as stored, or the empty one when none exists yet. */
export const emptyQueue = () => ({
  id: QUEUE_DOC_ID,
  configScope: ADMIN_CONFIG_PARTITION,
  items: [],
  updatedAt: null,
});

export async function readQueue(store) {
  const doc = await store.readDoc('admin_config', QUEUE_DOC_ID, ADMIN_CONFIG_PARTITION);
  if (!doc) return emptyQueue();
  return { ...doc, items: Array.isArray(doc.items) ? doc.items : [] };
}

/**
 * Read → `mutate(items)` → write under the ETag, retried while another
 * writer gets there first. `mutate` returns the next items array (or null
 * to write nothing). Resolves to the document as written.
 */
export async function updateQueue(store, mutate, { now = () => new Date() } = {}) {
  for (let attempt = 0; attempt < QUEUE_WRITE_ATTEMPTS; attempt += 1) {
    const current = await readQueue(store);
    const nextItems = await mutate(current.items.map((item) => ({ ...item })));
    if (nextItems === null) return current;
    const next = {
      ...current,
      id: QUEUE_DOC_ID,
      configScope: ADMIN_CONFIG_PARTITION,
      items: nextItems,
      updatedAt: now().toISOString(),
    };
    try {
      if (current._etag) {
        return await store.replaceDocIfMatch('admin_config', next, {
          partitionKey: ADMIN_CONFIG_PARTITION,
        });
      }
      const { _etag, ...fresh } = next;
      void _etag;
      return await store.createDoc('admin_config', fresh);
    } catch (error) {
      if (error?.code !== 412 && error?.code !== 409) throw error;
    }
  }
  throw new Error('The Forge Studio Queue kept changing; nothing was written. Try again.');
}

/** The brief a queue entry carries, normalised, always in URL mode on its own URL. */
export function entryBrief(entry, fields = {}) {
  const merged = { ...(entry.brief || {}) };
  for (const key of QUEUE_BRIEF_FIELDS) {
    if (fields[key] !== undefined) merged[key] = fields[key];
  }
  return normalizeBrief({ ...merged, mode: 'url', sourceUrl: entry.url });
}

/** The queue entry a URL becomes. */
export function newEntry({ url, id, stamp, actor, title = '' }) {
  return {
    id,
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

/** The ids a body names, cleaned; the refusal when none or too many. */
function idsOf(body) {
  const raw = Array.isArray(body?.ids) ? body.ids : [];
  const ids = [...new Set(raw.map((id) => String(id || '').trim()).filter((id) => SAFE_ID.test(id)))];
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

/** One entry with `fields` (and `kind`) applied; a failed entry goes back to queued. */
export function applyFields(entry, { fields, kind }, stamp) {
  return {
    ...entry,
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
  return { status: 'failed', contentId: result?.contentId || null, error: String(message).slice(0, 500) };
}

/**
 * The job's onComplete half: the entry `queueItemId` names takes the outcome.
 * Nothing when the entry is gone (the owner removed it while the job ran).
 */
export async function recordQueueOutcome(store, { queueItemId, status, result, error }, { now }) {
  const id = String(queueItemId || '');
  if (!SAFE_ID.test(id)) return null;
  const outcome = outcomeFor({ status, result, error });
  return updateQueue(
    store,
    (items) => {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return null;
      items[index] = { ...items[index], ...outcome, updatedAt: now().toISOString() };
      return items;
    },
    { now }
  );
}

/** The public shape of the queue: items newest first, the ETag for the UI's own freshness. */
const answer = (doc, extra = {}) =>
  json(200, {
    ok: true,
    items: [...(doc.items || [])].sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt))),
    total: (doc.items || []).length,
    max: MAX_QUEUE_ITEMS,
    updatedAt: doc.updatedAt || null,
    ...extra,
  });

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * The four routes (editor), each one call:
 *   GET  cms/forge/queue          → the entries
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
    list: guarded(async () => answer(await readQueue(store))),

    add: guarded(async (request, auth) => {
      const body = await readBody(request);
      const raw = Array.isArray(body?.urls) ? body.urls : [];
      if (raw.length > MAX_URLS_PER_ADD) {
        return json(400, { ok: false, error: `At most ${MAX_URLS_PER_ADD} URLs per add` });
      }
      const urls = [...new Set(raw.map(normalizeQueueUrl).filter(Boolean))];
      if (!urls.length) return json(400, { ok: false, error: 'urls required: no http(s) URL given' });
      const stamp = now().toISOString();
      const actor = actorName(auth.user);
      let added = [];
      let skipped = [];
      let full = 0;
      const doc = await updateQueue(
        store,
        (items) => {
          const have = new Set(items.map((item) => item.url));
          added = [];
          skipped = [];
          full = 0;
          for (const url of urls) {
            if (have.has(url)) {
              skipped.push(url);
              continue;
            }
            if (items.length >= MAX_QUEUE_ITEMS) {
              full += 1;
              continue;
            }
            const entry = newEntry({ url, id: uuid(), stamp, actor });
            items.push(entry);
            have.add(url);
            added.push(entry.id);
          }
          return added.length ? items : null;
        },
        { now }
      );
      return answer(doc, { added, skipped, full });
    }),

    update: guarded(async (request) => {
      const body = await readBody(request);
      const picked = idsOf(body);
      if (picked.error) return picked.error;
      const stamp = now().toISOString();
      if (body?.remove === true) {
        const gone = new Set(picked.ids);
        const doc = await updateQueue(
          store,
          (items) => {
            const kept = items.filter((item) => !gone.has(item.id));
            return kept.length === items.length ? null : kept;
          },
          { now }
        );
        return answer(doc, { removed: picked.ids });
      }
      const change = fieldsOf(body);
      if (change.error) return change.error;
      const wanted = new Set(picked.ids);
      let applied = [];
      const doc = await updateQueue(
        store,
        (items) => {
          applied = [];
          return items.map((item) => {
            if (!wanted.has(item.id) || item.status === 'forging') return item;
            applied.push(item.id);
            return applyFields(item, change, stamp);
          });
        },
        { now }
      );
      return answer(doc, { applied });
    }),

    /** Start one job per entry; `io.enqueue` is the queue output binding. */
    forge: guarded(async (request, auth, context, io) => {
      if (typeof io?.enqueue !== 'function') {
        context?.error?.('forge/queue/forge: no queue output wired');
        return json(500, { ok: false, error: 'Job queue is not configured' });
      }
      const body = await readBody(request);
      const picked = idsOf(body);
      if (picked.error) return picked.error;
      const wanted = new Set(picked.ids);
      const stamp = now().toISOString();
      const jobs = [];
      let started = [];
      const doc = await updateQueue(
        store,
        (items) => {
          started = [];
          jobs.length = 0;
          return items.map((item) => {
            if (!wanted.has(item.id) || item.status === 'forging' || item.status === 'forged') {
              return item;
            }
            const jobId = uuid();
            jobs.push(
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
                requestedBy: auth.user,
                createdAt: stamp,
              })
            );
            started.push({ id: item.id, jobId });
            return { ...item, status: 'forging', jobId, error: null, updatedAt: stamp };
          });
        },
        { now }
      );
      // The entries are marked first, then each job is written and queued:
      // a job that fails to queue is swept back by the stale-queued sweeper,
      // and an entry left `forging` with no job is the visible symptom.
      for (const jobDoc of jobs) {
        await store.upsertDoc(JOBS_CONTAINER, jobDoc);
        io.enqueue({ jobId: jobDoc.id, type: jobDoc.type });
      }
      return answer(doc, { started });
    }),
  };
}
