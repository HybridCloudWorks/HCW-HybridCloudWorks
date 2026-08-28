/**
 * forge.js — the ContentForge pipeline: one ingested/inspected document in,
 * a graded, module-validated draft staged for publish (or routed to editing)
 * out.
 *
 * Ported from Site-Main `cms/forge.js` `runForgePipeline` and its seams
 * (088f458). Stages: dedupe against the published corpus → load config →
 * rotating format → compose prompt → generate → deterministic scrub,
 * banned-phrase check and module validation (with mechanical repair) →
 * versioned save → inline grade → status routing (`forge_ready` when the
 * grade clears the publish threshold and the draft is clean, otherwise
 * `editing`).
 *
 * Two behaviours preserved because they look like bugs:
 *   1. Dedupe fails open — a store hiccup never blocks generation.
 *   2. bumpForgeStats is best-effort — a failed counter never fails a run.
 *
 * One difference from upstream, stated: Firestore wrote the content update,
 * the version snapshot and the audit entry in one transaction. Cosmos cannot
 * span three containers, so they are written in that order (content first,
 * as content-update.js does); a failure after the first write leaves a
 * forged document without its version row, which the next save records.
 *
 * Not ported: `forgeScheduled` (the daily auto-forge timer, T-323),
 * `gradeContentItem` / `assignForgeImages` / the config endpoints — the
 * ContentForge admin page that calls them is a T-409 scoped port.
 */
import { randomUUID } from 'node:crypto';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { findBannedPhrases, validateModules } from '../cms/content-modules.js';
import {
  buildContentQualityReport,
  buildImageReadinessReport,
  ensureTldrSectionAtEnd,
} from '../cms/content-quality.js';
import { applyPublishTimeCoverTrigger } from '../cms/publish.js';
import { buildVoiceAndFormatBlock, pickNextFormat } from './voice.js';
import {
  buildForgeModuleInstruction,
  findSimilarTitle,
  repairModules,
  scrubDashes,
} from './forge-pipeline.js';

/** The source fields a forge run reads, alias-coalesced; `{ error }` when it cannot run. */
export function resolveForgeSource(contentId, data) {
  if (!data)
    return { error: { ok: false, httpStatus: 404, error: `Content ${contentId} not found` } };
  const sourceMarkdown = String(
    data.content || data.Content || data.postContent || data.blogDraft || ''
  );
  if (!sourceMarkdown.trim()) {
    return {
      error: { ok: false, httpStatus: 400, error: 'Source content is empty; ingest it first.' },
    };
  }
  return {
    data,
    sourceMarkdown,
    sourceUrl: String(data.sourceUrl || data.url || '').trim(),
    cloudProvider: data['Cloud Provider'] || data.cloudProvider || null,
    sourceTitle: data.Title || data.title || 'Untitled',
  };
}

/**
 * Deterministic post-processing of a generated draft: dash scrub, TL;DR,
 * banned-phrase scan, module validation with mechanical repair. Pure.
 */
export function postProcessForgedDraft(draft, data, prompts) {
  let forgedContent = String(draft.postContent || '');
  if (prompts.styleRules.noEmDash) forgedContent = scrubDashes(forgedContent);
  forgedContent = ensureTldrSectionAtEnd(forgedContent);

  const bannedHits = findBannedPhrases(forgedContent, prompts.extraBannedPhrases);
  let moduleReport = validateModules(forgedContent);
  let moduleRepairs = [];
  if (!moduleReport.valid) {
    const repaired = repairModules(forgedContent);
    if (repaired.repairs.length) {
      forgedContent = repaired.markdown;
      moduleRepairs = repaired.repairs;
      moduleReport = validateModules(forgedContent);
    }
  }
  const forgedTitle = prompts.styleRules.noEmDash
    ? scrubDashes(String(draft.title || data.Title || data.title || ''))
    : String(draft.title || '');
  const forgedSummary = prompts.styleRules.noEmDash
    ? scrubDashes(String(draft.summary || ''))
    : String(draft.summary || '');

  return { forgedContent, forgedTitle, forgedSummary, bannedHits, moduleReport, moduleRepairs };
}

/** Cover slot (when the draft carries prompts) plus one slot per picture-module prompt. */
export function buildForgeImagePack(draft, moduleReport) {
  return [
    ...(draft.summaryPrompt || draft.detailsPrompt
      ? [
          {
            slot: 'cover',
            prompt: [draft.summaryPrompt, draft.detailsPrompt].filter(Boolean).join(' '),
            status: 'pending',
          },
        ]
      : []),
    ...moduleReport.picturePrompts.map((prompt, index) => ({
      slot: `module:${index}`,
      prompt,
      status: 'pending',
    })),
  ];
}

/** Sum the usage records the router collected across generation + grading calls. */
export function sumForgeUsage(usageOut) {
  const totals = usageOut.reduce(
    (acc, entry) => ({
      calls: acc.calls + 1,
      promptTokens: acc.promptTokens + (entry.promptTokens || 0),
      completionTokens: acc.completionTokens + (entry.completionTokens || 0),
      costUsd: acc.costUsd + (entry.costUsd || 0),
    }),
    { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 }
  );
  totals.costUsd = parseFloat(totals.costUsd.toFixed(6));
  return totals;
}

/**
 * Everything a forge run stamps beside the draft: run metadata, the grade
 * record, and the two publish-gate reports built from the forged fields.
 */
export function buildForgeArtifacts({
  data,
  draft,
  forged,
  format,
  prompts,
  grade,
  clean,
  usageTotals,
  actor,
  stamp,
}) {
  const forgeMeta = {
    formatKey: format?.key || null,
    promptVersion: prompts.version,
    moduleCount: forged.moduleReport.moduleCount,
    moduleIssues: forged.moduleReport.issues,
    moduleRepairs: forged.moduleRepairs,
    bannedPhraseHits: forged.bannedHits,
    usage: usageTotals,
    forgedAt: stamp,
    forgedBy: actorName(actor),
  };
  const forgeGrade = {
    overall: grade.overall,
    subs: grade.subs,
    threshold: prompts.publishThreshold,
    skippedLlm: grade.skippedLlm === true,
    gradedAt: stamp,
    gradedBy: 'forge_pipeline',
    promptVersion: prompts.version,
  };
  const contentQuality = buildContentQualityReport(
    {
      ...data,
      Title: forged.forgedTitle,
      title: forged.forgedTitle,
      content: forged.forgedContent,
      postContent: forged.forgedContent,
    },
    {
      verdict: clean && grade.overall >= prompts.publishThreshold ? 'pass' : 'revise',
      genericityScore: null,
      specificityScore: null,
      issues: [
        ...(forged.moduleReport.issues || []),
        ...(forged.bannedHits.length ? [`Banned phrases: ${forged.bannedHits.join(', ')}`] : []),
        ...(grade.overall < prompts.publishThreshold
          ? [`Forge grade ${grade.overall}% is below threshold ${prompts.publishThreshold}%.`]
          : []),
      ],
    }
  );
  const imageReadiness = buildImageReadinessReport({
    ...data,
    summaryPrompt: draft.summaryPrompt || '',
    detailsPrompt: draft.detailsPrompt || '',
    imagePromptSet: data.imageLineage?.promptSet || '',
    imagePromptName: data.imageLineage?.promptName || '',
  });
  return { forgeMeta, forgeGrade, contentQuality, imageReadiness };
}

function actorName(actor) {
  return actor?.email || actor?.oid || actor?.uid || 'forge';
}

/** Apply dotted-path increments ('totals.forged': 1) to a plain object, in place. */
export function applyIncrements(target, increments = {}) {
  for (const [path, amount] of Object.entries(increments)) {
    const segments = path.split('.');
    let node = target;
    for (const segment of segments.slice(0, -1)) {
      if (!node[segment] || typeof node[segment] !== 'object') node[segment] = {};
      node = node[segment];
    }
    const last = segments[segments.length - 1];
    node[last] = (Number(node[last]) || 0) + amount;
  }
  return target;
}

/**
 * @param {object} deps
 * @param {{ readDoc: Function, queryDocs: Function, patchDoc: Function, upsertDoc: Function }} deps.store
 * @param {{ loadForgeProfile: Function, loadForgePrompts: Function }} deps.config
 * @param {{ generateDraft: Function }} deps.drafter
 * @param {{ gradeArticle: Function }} deps.grader
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 * @param {{ log?: Function, warn?: Function, error?: Function }} [deps.log]
 */
export function createForge({
  store,
  config,
  drafter,
  grader,
  now = () => new Date(),
  uuid = randomUUID,
  log = {},
}) {
  // Fails open: a store hiccup never blocks generation.
  async function fetchPublishedTitles() {
    try {
      const rows = await store.queryDocs(
        'content',
        'SELECT TOP 300 c.Title, c.title FROM c WHERE c.Live = true',
        []
      );
      return (rows || []).map((row) => row?.Title || row?.title || '').filter(Boolean);
    } catch (err) {
      log.warn?.(`fetchPublishedTitles failed (dedupe skipped): ${err.message}`);
      return [];
    }
  }

  // Best-effort counters in admin_config/forge_stats (read-modify-write; the
  // same shape cms/publish.js bumps on publish). `today` is a single rolling
  // day bucket, reset on date change — the autoForge.dailyLimit enforcement
  // (lib/timers/forge-scheduled.js) reads it, and keeping only the current
  // day stops the document growing forever (T-607).
  async function bumpForgeStats(increments = {}) {
    try {
      const doc =
        (await store.readDoc('admin_config', 'forge_stats', ADMIN_CONFIG_PARTITION)) || {};
      const todayKey = now().toISOString().slice(0, 10);
      const today =
        doc.today?.date === todayKey ? { ...doc.today } : { date: todayKey, forged: 0 };
      const next = applyIncrements(
        { totals: { ...(doc.totals || {}) }, formats: structuredClone(doc.formats || {}), today },
        increments
      );
      next.updatedAt = now().toISOString();
      if (doc.id) {
        await store.patchDoc('admin_config', 'forge_stats', next, {
          partitionKey: ADMIN_CONFIG_PARTITION,
        });
      } else {
        await store.upsertDoc('admin_config', {
          id: 'forge_stats',
          configScope: ADMIN_CONFIG_PARTITION,
          ...next,
        });
      }
    } catch (err) {
      log.warn?.(`bumpForgeStats failed: ${err.message}`);
    }
  }

  async function saveForgeOutcome({
    contentId,
    actor,
    data,
    forged,
    format,
    prompts,
    grade,
    nextStatus,
    draft,
    artifacts,
    imagePack,
  }) {
    const stamp = now().toISOString();
    const by = actorName(actor);
    const update = {
      Title: forged.forgedTitle,
      Summary: forged.forgedSummary,
      blogDraft: forged.forgedContent,
      content: forged.forgedContent,
      keyTopics: Array.isArray(draft.keyTopics) ? draft.keyTopics.slice(0, 12) : [],
      format: format?.key || null,
      contentStatus: nextStatus,
      Live: false,
      forgeMeta: artifacts.forgeMeta,
      forgeGrade: artifacts.forgeGrade,
      forgeImagePack: imagePack,
      contentQuality: artifacts.contentQuality,
      imageReadiness: artifacts.imageReadiness,
      imageQuality: artifacts.imageReadiness,
      blogEditedAt: stamp,
      updatedAt: stamp,
      updatedBy: by,
    };
    // Cover at forge_ready so the image pipeline fires at staging; the
    // publish-time call stays as the idempotent safety net. The notify flag
    // is boolean because the rising-edge claim requires one — contentStatus
    // itself is not a flag (lib/triggers/forge-ready-notify.js).
    if (nextStatus === 'forge_ready') {
      applyPublishTimeCoverTrigger(update, data);
      update.forgeReadyNotifyTrigger = true;
    }

    await store.patchDoc('content', contentId, update);
    await store.upsertDoc('content_versions', {
      id: uuid(),
      contentId,
      title: forged.forgedTitle,
      summary: forged.forgedSummary,
      draft: forged.forgedContent,
      versionCreatedAt: stamp,
      versionCreatedBy: by,
      versionReason: 'forge_generated',
    });
    await store.upsertDoc('admin_audit_logs', {
      id: uuid(),
      action: 'content_forged',
      userId: actor?.oid || actor?.uid || null,
      userEmail: actor?.email || null,
      timestamp: stamp,
      details: {
        contentId,
        formatKey: format?.key || null,
        overall: grade.overall,
        threshold: prompts.publishThreshold,
        nextStatus,
        moduleCount: forged.moduleReport.moduleCount,
        moduleIssues: forged.moduleReport.issues,
        moduleRepairs: forged.moduleRepairs,
        bannedPhraseHits: forged.bannedHits,
        imagePackSlots: imagePack.length,
      },
      userAgent: null,
      contentId,
      contentTitle: forged.forgedTitle,
      compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
    });
  }

  /**
   * Forge one document. Resolves to `{ ok: true, result }` or
   * `{ ok: false, httpStatus, error, duplicateOf? }`; never throws for a
   * pipeline outcome, only for a store failure on the save.
   */
  async function runForgePipeline({ contentId, actor }) {
    const source = resolveForgeSource(
      contentId,
      await store.readDoc('content', contentId, contentId)
    );
    if (source.error) return source.error;
    const { data, sourceMarkdown, sourceUrl, cloudProvider, sourceTitle } = source;

    // 0. Dedupe against the published corpus before spending tokens
    const dupe = findSimilarTitle(sourceTitle, await fetchPublishedTitles());
    if (dupe.similar) {
      await bumpForgeStats({ 'totals.skippedDuplicates': 1 });
      return {
        ok: false,
        httpStatus: 409,
        error: `Skipped as likely duplicate of published "${dupe.bestTitle}" (similarity ${Math.round(dupe.bestScore * 100)}%).`,
        duplicateOf: dupe.bestTitle,
      };
    }

    // 1. Config + format rotation
    const [profile, prompts] = await Promise.all([
      config.loadForgeProfile(),
      config.loadForgePrompts(),
    ]);
    const format = await pickNextFormat(store, 'content', cloudProvider);

    // 2. Compose the forge prompt
    const voiceBlock = buildVoiceAndFormatBlock(cloudProvider, format, {
      masterPrompt: prompts.masterPrompt,
      extraBanned: prompts.extraBannedPhrases,
      styleRules: prompts.styleRules,
    });
    const wordSoupBlock = profile.wordSoup
      ? `\n\nOwner context (weave in perspective where genuinely relevant, never force it):\n${profile.wordSoup.slice(0, 3000)}`
      : '';
    const forgeInstruction = `${voiceBlock}\n\n${buildForgeModuleInstruction(format)}${wordSoupBlock}`;

    // 3. Generate
    const usageOut = [];
    let draft;
    try {
      draft = await drafter.generateDraft({
        url: sourceUrl || 'https://hybridcloudworks.com',
        cloudProvider,
        scrapedTitle: sourceTitle,
        description: data.Summary || data.summary || '',
        markdown: sourceMarkdown,
        // The composed block IS the authority for this draft, not an additive
        // admin note: passed as voiceBlock (with its format) it replaces the
        // drafter's own unconfigured copy instead of stacking under it.
        voiceBlock: forgeInstruction,
        format,
        usageOut,
      });
    } catch (err) {
      log.error?.(`forge generation failed: ${err.message}`);
      return { ok: false, httpStatus: 502, error: `Generation failed: ${err.message}` };
    }
    if (draft?.aiError)
      return { ok: false, httpStatus: 502, error: `Generation failed: ${draft.aiError}` };

    // 4. Deterministic post-processing
    const forged = postProcessForgedDraft(draft, data, prompts);

    // 5. Grade
    let grade;
    try {
      grade = await grader.gradeArticle(
        { title: forged.forgedTitle, summary: forged.forgedSummary, content: forged.forgedContent },
        profile,
        { usageOut }
      );
    } catch (err) {
      log.error?.(`forge grading failed: ${err.message}`);
      grade = { overall: 0, subs: [], skippedLlm: true, note: `Grading failed: ${err.message}` };
    }

    const clean = forged.bannedHits.length === 0 && forged.moduleReport.valid;
    const nextStatus =
      grade.overall >= prompts.publishThreshold && clean ? 'forge_ready' : 'editing';
    const imagePack = buildForgeImagePack(draft, forged.moduleReport);
    const usageTotals = sumForgeUsage(usageOut);
    const artifacts = buildForgeArtifacts({
      data,
      draft,
      forged,
      format,
      prompts,
      grade,
      clean,
      usageTotals,
      actor,
      stamp: now().toISOString(),
    });

    // 6. Save + status routing + audit
    await saveForgeOutcome({
      contentId,
      actor,
      data,
      forged,
      format,
      prompts,
      grade,
      nextStatus,
      draft,
      artifacts,
      imagePack,
    });

    const statsFormatKey = format?.key || 'unknown';
    await bumpForgeStats({
      'totals.forged': 1,
      'today.forged': 1,
      [`totals.${nextStatus === 'forge_ready' ? 'staged' : 'editing'}`]: 1,
      'totals.costUsd': usageTotals.costUsd,
      [`formats.${statsFormatKey}.forged`]: 1,
      [`formats.${statsFormatKey}.costUsd`]: usageTotals.costUsd,
      ...(nextStatus === 'forge_ready' ? { [`formats.${statsFormatKey}.staged`]: 1 } : {}),
    });

    return {
      ok: true,
      result: {
        success: true,
        contentId,
        status: nextStatus,
        overall: grade.overall,
        threshold: prompts.publishThreshold,
        formatKey: format?.key || null,
        moduleCount: forged.moduleReport.moduleCount,
        moduleIssues: forged.moduleReport.issues,
        moduleRepairs: forged.moduleRepairs,
        bannedPhraseHits: forged.bannedHits,
        imagePackSlots: imagePack.length,
        usage: usageTotals,
      },
    };
  }

  return { runForgePipeline, bumpForgeStats, fetchPublishedTitles };
}
