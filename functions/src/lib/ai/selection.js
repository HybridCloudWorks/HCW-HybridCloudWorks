/**
 * selection.js — the selection document, `admin_settings/ai-routing` version 2
 * (ADR 0034 §2, slice 3, #858).
 *
 *   {
 *     id: 'ai-routing', version: 2,
 *     global: { priority: [{ provider, model|null }, …] },
 *     tasks: { <task>: { mode: 'recommended'|'global'|'custom',
 *                        chain?: [{ provider, model|null }], thenGlobal?: boolean,
 *                        exclude?: string[] } },
 *     updatedAt, updatedBy
 *   }
 *
 * `global.priority` is the Priority 1, 2, 3 … list; `tasks` holds only the
 * tasks an administrator touched, and a task absent from it is `global`.
 * `chain` exists only for `custom`; `thenGlobal` (default true) says the
 * global list follows the chain; `exclude` names providers that never serve
 * the task whatever the mode says — the administrator's "off" for one task,
 * kept apart from the code-level locks in select.js, which no document lifts.
 *
 * Two readers, two strictnesses, the rule routing-table.js set for v1:
 *
 *   normalizeSelection DROPS what it cannot use — an unknown provider, an
 *   unknown task, a duplicate — so a stored oddity never breaks a call.
 *   validateSelection NAMES the mistake, so a save never stores one.
 *
 * The v1 document (`{ routes }`, ADR 0033 §4) is migrated to this shape in
 * memory on every read and on disk at the first save: migrate-selection.js.
 */
import { DEFAULT_PROVIDER_ORDER } from './provider-order.js';
import { AI_TASKS, TASK_NAMES } from './tasks.js';
import { selectChain } from './select.js';

export const SELECTION_VERSION = 2;
export const SELECTION_MODES = Object.freeze(['recommended', 'global', 'custom']);
/**
 * A custom chain's length cap: one step per provider the router implements.
 * The Tasks tab offers four (ADR 0034 §4); the document allows one more so a
 * migrated v1 route (a primary, three fallbacks) with a placement prepended
 * keeps every provider it named. Duplicates collapse, so nothing longer is
 * ever useful.
 */
export const MAX_CHAIN_LENGTH = DEFAULT_PROVIDER_ORDER.length;

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cleanProvider = (value) =>
  String(value ?? '')
    .toLowerCase()
    .trim();

const cleanModel = (value) => {
  const model = typeof value === 'string' ? value.trim() : '';
  return model || null;
};

const isKnownProvider = (provider) => DEFAULT_PROVIDER_ORDER.includes(provider);

/**
 * A list of `{ provider, model }` steps, normalised: known providers only,
 * the first occurrence of a provider kept (§6: duplicates collapse to the
 * first), models trimmed or null, at most `limit` entries.
 */
export function normalizeSteps(raw, limit = Infinity) {
  const steps = [];
  const seen = new Set();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const provider = cleanProvider(isPlainObject(entry) ? entry.provider : entry);
    if (!isKnownProvider(provider) || seen.has(provider)) continue;
    seen.add(provider);
    steps.push({ provider, model: cleanModel(isPlainObject(entry) ? entry.model : null) });
    if (steps.length >= limit) break;
  }
  return steps;
}

/** A list of provider names, normalised: known, unique, in the order given. */
function normalizeProviders(raw) {
  const out = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const provider = cleanProvider(entry);
    if (isKnownProvider(provider) && !out.includes(provider)) out.push(provider);
  }
  return out;
}

/** One task's entry, normalised; `chain` and `thenGlobal` only for `custom`. */
function normalizeTask(raw) {
  const base = isPlainObject(raw) ? raw : {};
  const mode = SELECTION_MODES.includes(base.mode) ? base.mode : 'global';
  const exclude = normalizeProviders(base.exclude);
  const entry = { mode };
  if (mode === 'custom') {
    entry.chain = normalizeSteps(base.chain, MAX_CHAIN_LENGTH);
    entry.thenGlobal = base.thenGlobal !== false;
  }
  if (exclude.length) entry.exclude = exclude;
  return entry;
}

/**
 * The document, normalised to the shape above. Nothing here throws: an
 * unknown provider or task is dropped, a bad mode reads as `global`, a
 * missing `global.priority` reads as empty (the resolver falls back to the
 * default order for a document with no list at all — see select.js).
 *
 * @param {unknown} doc
 */
export function normalizeSelection(doc) {
  const base = isPlainObject(doc) ? doc : {};
  const tasks = {};
  for (const [task, raw] of Object.entries(isPlainObject(base.tasks) ? base.tasks : {})) {
    if (!TASK_NAMES.includes(task)) continue;
    tasks[task] = normalizeTask(raw);
  }
  return {
    version: SELECTION_VERSION,
    global: { priority: normalizeSteps(isPlainObject(base.global) ? base.global.priority : null) },
    tasks,
    updatedAt: typeof base.updatedAt === 'string' ? base.updatedAt : null,
    updatedBy: typeof base.updatedBy === 'string' ? base.updatedBy : null,
  };
}

/** True when the document carries this module's version. */
export const isSelectionV2 = (doc) => isPlainObject(doc) && doc.version === SELECTION_VERSION;

const PROVIDERS_SENTENCE = `one of ${DEFAULT_PROVIDER_ORDER.join(', ')}`;

/** Errors in a list of steps, each sentence prefixed with `where`. */
function stepErrors(where, raw, limit) {
  if (!Array.isArray(raw)) return [`${where} must be an array of { provider, model? }`];
  const errors = [];
  if (raw.length > limit) errors.push(`${where}: at most ${limit} entries`);
  const seen = new Set();
  raw.forEach((entry, index) => {
    const at = `${where}[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${at} must be { provider, model? }`);
      return;
    }
    const provider = cleanProvider(entry.provider);
    if (!isKnownProvider(provider)) {
      errors.push(`${at}.provider must be ${PROVIDERS_SENTENCE}`);
      return;
    }
    if (seen.has(provider)) errors.push(`${at}: ${provider} is listed twice`);
    seen.add(provider);
    if (entry.model !== undefined && entry.model !== null && typeof entry.model !== 'string') {
      errors.push(`${at}.model must be a string or null`);
    }
  });
  return errors;
}

/** Errors in one task's entry. */
function taskErrors(task, raw) {
  const where = `tasks.${task}`;
  if (!isPlainObject(raw)) return [`${where} must be { mode, chain?, thenGlobal?, exclude? }`];
  const errors = [];
  if (!SELECTION_MODES.includes(raw.mode)) {
    errors.push(`${where}.mode must be one of ${SELECTION_MODES.join(', ')}`);
  }
  if (raw.chain !== undefined) {
    if (raw.mode !== 'custom') errors.push(`${where}.chain is only for mode custom`);
    else errors.push(...stepErrors(`${where}.chain`, raw.chain, MAX_CHAIN_LENGTH));
  } else if (raw.mode === 'custom') {
    errors.push(`${where}.chain is required for mode custom`);
  }
  if (raw.thenGlobal !== undefined && typeof raw.thenGlobal !== 'boolean') {
    errors.push(`${where}.thenGlobal must be a boolean`);
  }
  if (raw.exclude !== undefined) {
    if (!Array.isArray(raw.exclude)) errors.push(`${where}.exclude must be an array of providers`);
    else {
      for (const entry of raw.exclude) {
        if (!isKnownProvider(cleanProvider(entry))) {
          errors.push(`${where}.exclude: unknown provider "${entry ?? ''}"`);
        }
      }
    }
  }
  return errors;
}

/**
 * Every error in a document a save would store, as sentences; empty when it
 * is valid. Stricter than normalizeSelection on purpose (header).
 *
 * The one rule that needs more than the document is §6's first: a `custom`
 * chain with no eligible candidate and `thenGlobal: false` "would have no
 * model". Eligibility is the resolver's (select.js), run here over the
 * `availability` and `catalog` the caller read; without `availability` the
 * rule is not checked (a unit test of the shape alone).
 *
 * @param {unknown} doc
 * @param {{ availability?: { keyed: string[], enabled: string[] }, catalog?: object|null }} [deps]
 * @returns {string[]}
 */
export function validateSelection(doc, { availability, catalog = null } = {}) {
  if (!isPlainObject(doc)) return ['Body must be { version: 2, global: { priority }, tasks }'];
  const errors = [];
  if (doc.version !== SELECTION_VERSION) errors.push(`version must be ${SELECTION_VERSION}`);
  if (!isPlainObject(doc.global)) errors.push('global must be { priority: [{ provider, model? }] }');
  else {
    const priority = stepErrors('global.priority', doc.global.priority, Infinity);
    errors.push(...priority);
    if (!priority.length && doc.global.priority.length === 0) {
      errors.push('global.priority needs at least one provider');
    }
  }
  if (doc.tasks !== undefined && !isPlainObject(doc.tasks)) errors.push('tasks must be an object');
  else {
    for (const [task, raw] of Object.entries(doc.tasks || {})) {
      if (!TASK_NAMES.includes(task)) {
        errors.push(`Unknown AI task: ${task}. Known: ${TASK_NAMES.join(', ')}`);
        continue;
      }
      errors.push(...taskErrors(task, raw));
    }
  }
  if (doc.updatedAt !== undefined && doc.updatedAt !== null && typeof doc.updatedAt !== 'string') {
    errors.push('updatedAt must be a string or null');
  }
  if (errors.length || !availability) return errors;

  const normalized = normalizeSelection(doc);
  for (const [task, entry] of Object.entries(normalized.tasks)) {
    if (entry.mode !== 'custom' || entry.thenGlobal) continue;
    // On read the resolver falls back to the Priority list for this case
    // and flags it; on save it is refused. So the question is whether any
    // entry of the chain itself was eligible, not whether the chain is empty.
    const { chain } = selectChain({ task, selection: normalized, catalog, availability });
    if (!chain.some((candidate) => candidate.selection === 'custom')) {
      errors.push(
        `tasks.${task}: this task would have no model — no entry of its custom chain is eligible and the Priority list does not follow it (${AI_TASKS[task].label})`
      );
    }
  }
  return errors;
}
