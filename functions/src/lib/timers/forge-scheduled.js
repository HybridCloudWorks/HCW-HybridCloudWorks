/**
 * forge-scheduled.js — `forgeScheduled`, daily autonomous forging.
 *
 * Ported from Site-Main `cms/forge.js` (088f458). Off by default twice over:
 * the timer flag, and the Auto-Forge toggle in Forge Memory
 * (`admin_config/forge_prompts.autoForge`). Picks up to `dailyLimit` unforged
 * draft/ingested/inspected items and runs the same pipeline the
 * `forge-article` job uses; results land in `forge_ready` (or `editing`) and
 * still need the human one-click publish. Errors were relayed to Telegram
 * upstream; here they are in the run result (no notifier yet, T-324).
 */

export const CANDIDATE_STATUSES = ['draft', 'ingested', 'inspected'];
export const FORGE_SCHEDULER_ACTOR = Object.freeze({
  oid: 'forge_scheduler',
  email: 'forge_scheduler@system',
});

export function createForgeScheduled({ store, config, forge, log = {} }) {
  async function run() {
    const prompts = await config.loadForgePrompts({ bypassCache: true });
    if (!prompts.autoForge?.enabled || prompts.autoForge.dailyLimit < 1) {
      log.log?.('[forgeScheduled] auto-forge disabled, skipping run.');
      return { skippedRun: true, attempted: 0, staged: 0, editing: 0, skipped: 0, errors: 0 };
    }
    const rows = await store.queryDocs(
      'content',
      `SELECT TOP 25 c.id, c.forgeMeta FROM c WHERE c.contentStatus IN (${CANDIDATE_STATUSES.map((s) => `'${s}'`).join(', ')})`,
      []
    );
    const candidates = (rows || [])
      .filter((item) => !item.forgeMeta)
      .slice(0, prompts.autoForge.dailyLimit);

    const summary = {
      skippedRun: false,
      attempted: 0,
      staged: 0,
      editing: 0,
      skipped: 0,
      errors: 0,
      failures: [],
    };
    for (const candidate of candidates) {
      summary.attempted += 1;
      try {
        const outcome = await forge.runForgePipeline({
          contentId: candidate.id,
          actor: FORGE_SCHEDULER_ACTOR,
        });
        if (!outcome.ok) {
          if (outcome.httpStatus === 409) summary.skipped += 1;
          else {
            summary.errors += 1;
            summary.failures.push({ contentId: candidate.id, error: outcome.error });
          }
          log.warn?.(`[forgeScheduled] ${candidate.id} -> ${outcome.error}`);
        } else if (outcome.result.status === 'forge_ready') summary.staged += 1;
        else summary.editing += 1;
      } catch (err) {
        summary.errors += 1;
        summary.failures.push({ contentId: candidate.id, error: err?.message || String(err) });
        log.error?.(`[forgeScheduled] ${candidate.id} threw: ${err?.message || err}`);
      }
    }
    log.log?.(
      `[forgeScheduled] run complete: ${JSON.stringify({ ...summary, failures: undefined })}`
    );
    return summary;
  }
  return { run };
}
