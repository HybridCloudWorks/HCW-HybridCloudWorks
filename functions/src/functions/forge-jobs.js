/**
 * forge-jobs.js — `forge-article` and `generate-weekly-digest` as platform
 * jobs (T-322).
 *
 * Site-Main: `forgeArticle` (300 s / 1 GiB HTTP, also called in a sequential
 * bulk loop) and `generateWeeklyDigest` (300 s HTTP with a 20 s client abort
 * — the preview never returned in time). Both run under the job worker's
 * non-HTTP budget here. There is no ContentForge page or digest button in
 * this repo's frontend yet (both post-date the 2026-07-22 import); the
 * Mailing List page gained the two digest buttons, the Forge page is T-409.
 */
import { readDoc, queryDocs, patchDoc, upsertDoc } from '../lib/cosmos-client.js';
import * as ai from '../lib/ai/router.js';
import { createForgeConfigLoader } from '../lib/content/forge-config.js';
import { createDrafter } from '../lib/content/drafting.js';
import { createGrader } from '../lib/content/forge-grader.js';
import { createForge } from '../lib/content/forge.js';
import { createDigest } from '../lib/content/digest.js';
import { scrapeArticle } from '../lib/content/scrape.js';
import {
  scrapeToSource,
  inferProviderFromUrl,
  buildUrlSourceDoc,
} from '../lib/content/draft-from-url.js';
import { registerJobType } from '../lib/jobs.js';

export const FORGE_MAX_BATCH = 10;

const store = { readDoc, queryDocs, patchDoc, upsertDoc };
const config = createForgeConfigLoader({ store });

/** `{ sourceContentId }` or `{ sourceContentIds: [...] }` (≤ FORGE_MAX_BATCH) → the ids to forge. */
export function resolveForgeTargets(payload = {}) {
  const ids = Array.isArray(payload.sourceContentIds)
    ? payload.sourceContentIds
    : payload.sourceContentId
      ? [payload.sourceContentId]
      : [];
  const clean = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!clean.length) throw new Error('sourceContentId (or sourceContentIds) required');
  if (clean.length > FORGE_MAX_BATCH)
    throw new Error(`At most ${FORGE_MAX_BATCH} documents per forge job`);
  return clean;
}

registerJobType('forge-article', {
  description:
    'ContentForge: generate, scrub, validate, grade and stage a draft from an ingested or inspected document (forge_ready above the publish threshold, otherwise editing).',
  maxPayloadBytes: 2048,
  // Up to 10 documents × (generation + grading, each a long model call).
  timeoutMs: 28 * 60 * 1000,
  worker: async (payload, { context, job }) => {
    const ids = resolveForgeTargets(payload);
    const forge = createForge({
      store,
      config,
      drafter: createDrafter({ store, ai }),
      grader: createGrader({ ai }),
      log: context,
    });
    const actor = job?.requestedBy || {};
    const outcomes = [];
    for (const contentId of ids) {
      const outcome = await forge.runForgePipeline({ contentId, actor });
      outcomes.push(
        outcome.ok
          ? outcome.result
          : {
              success: false,
              contentId,
              skipped: outcome.httpStatus === 409,
              error: outcome.error,
              duplicateOf: outcome.duplicateOf,
            }
      );
      context.log?.(
        `[forge-article] ${contentId} → ${outcome.ok ? outcome.result.status : outcome.error}`
      );
    }
    // A single-document job that did not forge is a failed job, as upstream's
    // HTTP status was; a batch reports per document.
    if (ids.length === 1 && !outcomes[0].success && !outcomes[0].skipped)
      throw new Error(outcomes[0].error);
    return ids.length === 1
      ? outcomes[0]
      : {
          total: ids.length,
          staged: outcomes.filter((o) => o.status === 'forge_ready').length,
          editing: outcomes.filter((o) => o.status === 'editing').length,
          skipped: outcomes.filter((o) => o.skipped).length,
          failed: outcomes.filter((o) => !o.success && !o.skipped).length,
          outcomes,
        };
  },
});

/**
 * The unattended half of "paste a URL" (Blog Machine T-602): scrape → source
 * document → the same pipeline `forge-article` runs. Split from the worker
 * for tests; the registered worker below wires the real dependencies.
 *
 * @param {{ url: string, provider?: string }} payload
 * @param {object} deps — { scrape, forge, store, now, uuid, log, actor }
 */
export async function runForgeFromUrl(payload, { scrape, forge, store: docStore, now, uuid, log, actor }) {
  const source = await scrapeToSource(String(payload?.url || '').trim(), { scrape, log });
  const provider = String(payload?.provider || '').trim() || inferProviderFromUrl(source.url);
  const doc = buildUrlSourceDoc({ source, provider, now, uuid });
  await docStore.upsertDoc('content', doc);
  log.log?.(`[forge-from-url] ${source.url} → content/${doc.id} (${source.wordCount} words)`);

  const outcome = await forge.runForgePipeline({ contentId: doc.id, actor });
  log.log?.(`[forge-from-url] ${doc.id} → ${outcome.ok ? outcome.result.status : outcome.error}`);
  // A duplicate (409) is a legitimate answer — the URL's story is already
  // published — so it reports rather than fails, same as forge-article.
  if (!outcome.ok && outcome.httpStatus !== 409) throw new Error(outcome.error);
  return outcome.ok
    ? { ...outcome.result, sourceUrl: source.url }
    : {
        success: false,
        contentId: doc.id,
        skipped: true,
        sourceUrl: source.url,
        error: outcome.error,
        duplicateOf: outcome.duplicateOf,
      };
}

registerJobType('forge-from-url', {
  description:
    'Blog Machine: scrape a URL into a source content document, then run the forge pipeline on it — staged forge_ready above the publish threshold, otherwise editing.',
  maxPayloadBytes: 4096,
  // One scrape plus the same generation + grading budget forge-article gets.
  timeoutMs: 28 * 60 * 1000,
  worker: async (payload, { context, job }) =>
    runForgeFromUrl(payload, {
      scrape: scrapeArticle,
      forge: createForge({
        store,
        config,
        drafter: createDrafter({ store, ai }),
        grader: createGrader({ ai }),
        log: context,
      }),
      store,
      now: () => new Date(),
      uuid: () => crypto.randomUUID(),
      log: context,
      actor: job?.requestedBy || {},
    }),
});

registerJobType('generate-weekly-digest', {
  description:
    'Draft the weekly newsletter from the content published in the last N days ({ days, dryRun }); dryRun returns the preview without saving.',
  maxPayloadBytes: 256,
  timeoutMs: 10 * 60 * 1000,
  worker: (payload) =>
    createDigest({ store, drafter: createDrafter({ store, ai }) }).run(payload || {}),
});
