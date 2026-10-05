/**
 * AI Engine — feature switches and the selection document (ADR 0034 §2 and
 * §4). Imported through `@/lib/aiEngine`, which re-exports it.
 *
 * The per-feature placement (`setAiPlacement`) and the v1 route per task
 * (`setAiRoute`) left with slice 4 (#859): the Priority list and the Tasks
 * tab read and write one version 2 document, and the effective model per
 * task is the router's own answer (`getEffectiveRouting`), never a copy of
 * the resolver kept here.
 */
import { getJSON, sendJSON } from '@/lib/api';

/**
 * Which parts of the site may call a model.
 *
 * Returns `{ features, catalogue }`. The catalogue is the API's own list — the
 * page renders its toggles from it rather than from a copy kept here, because a
 * second copy of a list like this is exactly how DEFAULT_PROVIDERS came to
 * describe a platform that no longer existed.
 */
export async function getAiFeatures() {
  const res = await getJSON('cms/ai-features');
  return {
    features: res.features || {},
    catalogue: res.catalogue || {},
  };
}

/** Turn one feature on or off. Merges server-side; other features are untouched. */
export async function setAiFeature(name, enabled) {
  const res = await sendJSON('cms/ai-features', 'PUT', { features: { [name]: enabled } });
  return res.features || {};
}

/**
 * The selection document, version 2: `global.priority` (the Priority list)
 * and `tasks` (each task's mode, chain and exclusions). `migrated` says the
 * stored document is still the old shape and what came back was derived in
 * memory; the first save stores version 2. The task catalogue and the
 * provider list come from the API, never from a copy here.
 */
export async function getAiRouting() {
  const res = await getJSON('cms/ai-routing');
  return {
    selection: res.selection || null,
    migrated: Boolean(res.migrated),
    catalogue: res.catalogue || {},
    providers: res.providers || [],
    updatedAt: res.updatedAt || null,
  };
}

/**
 * Save the whole document. `updatedAt` must be the one read: the API answers
 * 409 when the document changed underneath, and the thrown error carries
 * `status` so the page can reload rather than overwrite (ADR 0034 §6). A
 * refused document (400) throws with the API's own sentence, which the page
 * shows inline. Returns the stored document.
 */
export async function saveAiRouting(selection) {
  const res = await sendJSON('cms/ai-routing', 'PUT', { ...selection, version: 2 });
  return { selection: res.selection || null, updatedAt: res.updatedAt || null };
}

/**
 * The resolver's answer for every task over the configuration the router
 * reads: per task `{ mode, chain, rejected, flags }` beside the registry
 * entry and the document's, per Priority row what a null model resolves to,
 * and what holds a key and is switched on. The page renders this and never
 * computes a chain of its own.
 */
export async function getEffectiveRouting() {
  const res = await getJSON('cms/ai-routing/effective');
  return {
    tasks: res.tasks || {},
    priority: res.priority || [],
    availability: res.availability || { keyed: [], enabled: [], disabled: [] },
    updatedAt: res.updatedAt || null,
  };
}

/**
 * Run one task's effective chain with the Test's limits until a candidate
 * answers. Returns `{ ok, answeredBy, skipped, rejected, flags, error? }`;
 * `ok: false` with every candidate in `skipped` when none did.
 */
export async function testAiTask(task) {
  return sendJSON(`cms/ai-routing/test/${encodeURIComponent(task)}`, 'POST', {});
}
