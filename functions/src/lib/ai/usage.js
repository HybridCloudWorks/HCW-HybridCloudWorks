/**
 * One writer for `ai_usage`, the container the portal's Usage tab reads.
 *
 * Extracted from ai/proxy.js when Listen & Learn became the second thing that
 * spends money on a model. The reason it is shared rather than copied: that
 * page does its arithmetic client-side over whatever rows it finds, totalling
 * `totalTokens` and `estimatedCostUsd` and grouping by `provider`. A second
 * writer with a slightly different shape does not error — it silently totals
 * zero and the spend it represents simply does not appear.
 *
 * A failure here must never fail the call that produced it. The model has
 * already answered and already been paid for; losing the record is strictly
 * better than losing the work.
 */

export const USAGE_CONTAINER = 'ai_usage';

/**
 * `source` says which part of the site spent the money. The Usage tab groups by
 * it, so these are effectively a public enum — add a value here rather than
 * inventing one at a call site, or the breakdown grows a row nobody recognises.
 */
export const USAGE_SOURCES = Object.freeze({
  admin: 'admin',
  listenAndLearnScript: 'listen-and-learn:script',
  listenAndLearnAudio: 'listen-and-learn:audio',
});

/**
 * Write one usage row.
 *
 * @param {object} deps
 * @param {{ upsertDoc: Function }} deps.store
 * @param {{ getCostEstimate: Function }} deps.ai
 * @param {() => string} [deps.uuid]
 * @param {() => Date} [deps.now]
 * @param {object} record
 * @param {string} record.provider
 * @param {string} record.model
 * @param {number} record.promptTokens
 * @param {number} record.completionTokens
 * @param {string} [record.source]
 * @param {number} [record.costUsd] a cost the caller already computed
 * @param {boolean} [record.estimatedTokens] true when the counts are derived
 *   rather than reported by the API
 * @returns {Promise<object|null>} the row written, or null if the write failed
 */
export async function recordAiUsage(
  { store, ai, uuid = () => crypto.randomUUID(), now = () => new Date() },
  { provider, model, promptTokens = 0, completionTokens = 0, source, costUsd, estimatedTokens }
) {
  // Everything is inside the try, including building the row. Pricing it calls
  // into the cost table, and an earlier version did that outside — so a caller
  // that passed an `ai` without `getCostEstimate` threw a TypeError that
  // propagated out and failed the episode whose cost it was trying to record.
  // Bookkeeping must not be able to destroy the work it is bookkeeping.
  try {
    const inTokens = Number(promptTokens) || 0;
    const outTokens = Number(completionTokens) || 0;

    const row = {
      id: uuid(),
      provider,
      model,
      promptTokens: inTokens,
      completionTokens: outTokens,
      totalTokens: inTokens + outTokens,
      estimatedCostUsd:
        typeof costUsd === 'number'
          ? costUsd
          : ai.getCostEstimate(provider, model, inTokens, outTokens),
      source: source || USAGE_SOURCES.admin,
      // Only ever true, never false: an absent flag reads as "reported", which
      // is what every historical row is.
      ...(estimatedTokens ? { estimatedTokens: true } : {}),
      timestamp: now().toISOString(),
    };

    await store.upsertDoc(USAGE_CONTAINER, row);
    return row;
  } catch {
    // Intentionally swallowed — see the module header.
    return null;
  }
}

/**
 * Write several rows, returning what was actually written.
 *
 * Sequential rather than parallel: these are small writes on a path that has
 * just spent minutes on model calls, and a burst against one container is the
 * reliable way to meet a 429 on the cheapest part of the run.
 */
export async function recordAiUsageBatch(deps, records = []) {
  const written = [];
  for (const record of records) {
    const row = await recordAiUsage(deps, record);
    if (row) written.push(row);
  }
  return written;
}

/** Total estimated spend across rows, for reporting a run's cost back. */
export function totalCostUsd(rows = []) {
  return parseFloat(rows.reduce((sum, r) => sum + (r?.estimatedCostUsd || 0), 0).toFixed(6));
}
