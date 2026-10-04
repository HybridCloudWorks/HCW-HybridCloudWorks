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
  // A source-grounded episode's script (#433): Gemini reading the owner's
  // pages and videos, billed as input. Its own row so the cost of grounding
  // on sources is attributable apart from the guide-grounded scripts; the
  // audio half is the same row as every other episode's.
  listenAndLearnSourceScript: 'listen-and-learn:source-script',
  listenAndLearnAudio: 'listen-and-learn:audio',
  // The podcast's own pipeline (#432): a transcript scripted from a published
  // article (#435) and the audio read from it. Its own rows, not Listen &
  // Learn's, so the cost of each product is attributable on its own.
  podcastScript: 'podcast:script',
  podcastAudio: 'podcast:audio',
  // The ElevenLabs live check on the Audio tab (#432, 2026-09-26): a fixed
  // two-turn sample of under 300 characters. Its own row so a check never
  // reads as episode spend.
  podcastSample: 'podcast:sample',
  // The AI Engine's Test button (#180): a one-word prompt capped at 16
  // tokens. The slug predates this table (proxy.js wrote it inline), and
  // stored rows carry it, so it is registered as it was written.
  adminTest: 'admin_test',
  // The same Test, run by the weekly probeAiProviders timer against every
  // provider with a key (#701, 2026-09-29). Its own row so the check's
  // spend, a fraction of a cent a week, is not read as someone testing.
  aiProviderProbe: 'ai-engine:probe',
  // A router call whose call site named no feature (ADR 0033). The call-sites
  // test keeps this from happening in production code; the row exists so a
  // call that somehow slips through is still visible rather than unrecorded.
  aiUnspecified: 'ai:unspecified',
});

/**
 * The `source` the router stamps on the row it writes for every call
 * (router.js recordCallUsage): `ai:<feature>`, the feature being the one the
 * call site declared. The Usage tab turns the prefix into the feature's
 * catalogue label, so no new USAGE_SOURCES entry is needed per feature.
 */
export const FEATURE_SOURCE_PREFIX = 'ai:';

export function featureSource(feature) {
  const name = String(feature || '').trim();
  return name ? `${FEATURE_SOURCE_PREFIX}${name}` : USAGE_SOURCES.aiUnspecified;
}

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
 * @param {string} [record.recordedRowId] the id of the row the router already
 *   wrote for this call (router.js recordCallUsage). The write then REPLACES
 *   that row — same id, this caller's `source` — so a call recorded by the
 *   router and again by its caller is one row, not two (ADR 0033).
 * @param {boolean} [record.unpriced] true when the cost table has no rate
 *   for the model; the row then costs 0 and says so, instead of a default
 *   rate posing as a figure
 * @returns {Promise<object|null>} the row written, or null if the write failed
 */
export async function recordAiUsage(
  { store, ai, uuid = () => crypto.randomUUID(), now = () => new Date() },
  {
    provider,
    model,
    promptTokens = 0,
    completionTokens = 0,
    source,
    costUsd,
    estimatedTokens,
    recordedRowId,
    unpriced,
  }
) {
  // Everything is inside the try, including building the row. Pricing it calls
  // into the cost table, and an earlier version did that outside — so a caller
  // that passed an `ai` without `getCostEstimate` threw a TypeError that
  // propagated out and failed the episode whose cost it was trying to record.
  // Bookkeeping must not be able to destroy the work it is bookkeeping.
  try {
    const inTokens = Number(promptTokens) || 0;
    const outTokens = Number(completionTokens) || 0;
    const isUnpriced =
      unpriced === true || (typeof ai?.isPriced === 'function' && !ai.isPriced(provider, model));

    const row = {
      id: typeof recordedRowId === 'string' && recordedRowId ? recordedRowId : uuid(),
      provider,
      model,
      promptTokens: inTokens,
      completionTokens: outTokens,
      totalTokens: inTokens + outTokens,
      estimatedCostUsd: isUnpriced
        ? 0
        : typeof costUsd === 'number'
          ? costUsd
          : ai.getCostEstimate(provider, model, inTokens, outTokens),
      source: source || USAGE_SOURCES.admin,
      // Only ever true, never false: an absent flag reads as "reported", which
      // is what every historical row is.
      ...(estimatedTokens ? { estimatedTokens: true } : {}),
      ...(isUnpriced ? { unpriced: true } : {}),
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
