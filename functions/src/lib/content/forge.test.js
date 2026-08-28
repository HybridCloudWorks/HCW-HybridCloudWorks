import { describe, it, expect, vi } from 'vitest';
import {
  createForge,
  postProcessForgedDraft,
  buildForgeImagePack,
  sumForgeUsage,
  applyIncrements,
  resolveForgeSource,
} from './forge.js';
import { createDrafter } from './drafting.js';
import { createDigest } from './digest.js';
import { DEFAULT_PROFILE, DEFAULT_PROMPTS } from './forge-config.js';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';

const NOW = new Date('2026-08-21T18:00:00.000Z');
const GOOD_POST = [
  '## Why gp3 beats gp2',
  'Concrete numbers: 3,000 IOPS baseline, $0.08 per GB-month in us-east-1. '.repeat(30),
  '<module type="recommendation" align="left">Migrate volumes with aws ec2 modify-volume --volume-type gp3.</module>',
  '## Steps',
  'Run the command per volume. '.repeat(30),
  '<module type="spacer">{"style":"gradient"}</module>',
  '<module type="picture" align="right">{"imageUrl":"","caption":"c","imagePrompt":"A Lego engineer swapping disk bricks"}</module>',
  '## TL;DR',
  'Switch to gp3.',
].join('\n\n');

const draftOf = (over = {}) => ({
  title: 'Cut EBS cost — gp2 to gp3',
  summary: 'Numbers – and commands.',
  postContent: GOOD_POST,
  summaryPrompt: 'scene',
  detailsPrompt: 'details',
  keyTopics: ['AWS EBS', 'gp3'],
  ...over,
});

function makeDeps({ draft = draftOf(), gradeOverall = 90, docs = {}, titles = [] } = {}) {
  const content = {
    'c-1': {
      id: 'c-1',
      Title: 'EBS gp3 migration notes',
      content: 'source markdown',
      'Cloud Provider': 'AWS',
      sourceUrl: 'https://src/ebs',
    },
    ...docs,
  };
  const writes = { patches: [], upserts: [] };
  const store = {
    readDoc: vi.fn(async (c, id) => (c === 'content' ? content[id] || null : null)),
    queryDocs: vi.fn(async (_c, q) =>
      q.includes('c.Live = true') ? titles.map((t) => ({ Title: t })) : [{ format: 'how_to' }]
    ),
    patchDoc: vi.fn(async (c, id, u) => {
      writes.patches.push([c, id, u]);
      return { id, ...u };
    }),
    upsertDoc: vi.fn(async (c, d) => {
      writes.upserts.push([c, d]);
      return d;
    }),
  };
  const config = {
    loadForgeProfile: async () => DEFAULT_PROFILE,
    loadForgePrompts: async () => DEFAULT_PROMPTS,
  };
  const drafter = {
    generateDraft: vi.fn(async ({ usageOut }) => {
      usageOut?.push({ promptTokens: 1000, completionTokens: 500, costUsd: 0.0123 });
      return draft;
    }),
  };
  const grader = {
    gradeArticle: vi.fn(async (_a, _p, { usageOut }) => {
      usageOut?.push({ promptTokens: 200, completionTokens: 50, costUsd: 0.001 });
      return {
        overall: gradeOverall,
        subs: [{ key: 'hybrid_arch', score: 90 }],
        skippedLlm: false,
      };
    }),
  };
  let n = 0;
  return { store, config, drafter, grader, writes, now: () => NOW, uuid: () => `uuid-${++n}` };
}

describe('pure seams', () => {
  it('resolveForgeSource coalesces aliases and gates missing/empty sources', () => {
    expect(resolveForgeSource('x', null).error.httpStatus).toBe(404);
    expect(resolveForgeSource('x', { Title: 't' }).error.httpStatus).toBe(400);
    expect(
      resolveForgeSource('x', {
        blogDraft: 'b',
        url: 'https://u',
        cloudProvider: 'GCP',
        title: 'T',
      })
    ).toMatchObject({
      sourceMarkdown: 'b',
      sourceUrl: 'https://u',
      cloudProvider: 'GCP',
      sourceTitle: 'T',
    });
  });

  it('postProcessForgedDraft scrubs dashes, scans banned phrases, repairs modules', () => {
    const forged = postProcessForgedDraft(
      draftOf({
        postContent: `${GOOD_POST}\n\nLet's dive in. <module type="fact" align="middle">f</module>`,
      }),
      {},
      DEFAULT_PROMPTS
    );
    expect(forged.forgedTitle).toBe('Cut EBS cost, gp2 to gp3');
    expect(forged.forgedSummary).toBe('Numbers, and commands.');
    expect(forged.bannedHits).toEqual(["let's dive in"]);
    expect(forged.moduleRepairs).toEqual(['Dropped invalid align "middle" on a fact module']);
    expect(forged.moduleReport.valid).toBe(true);
    expect(forged.moduleReport.picturePrompts).toEqual(['A Lego engineer swapping disk bricks']);
    expect(buildForgeImagePack(draftOf(), forged.moduleReport)).toEqual([
      { slot: 'cover', prompt: 'scene details', status: 'pending' },
      { slot: 'module:0', prompt: 'A Lego engineer swapping disk bricks', status: 'pending' },
    ]);
  });

  it('sums usage and applies dotted increments', () => {
    expect(
      sumForgeUsage([
        { promptTokens: 1, completionTokens: 2, costUsd: 0.1 },
        { promptTokens: 3, completionTokens: 4, costUsd: 0.2000001 },
      ])
    ).toEqual({ calls: 2, promptTokens: 4, completionTokens: 6, costUsd: 0.3 });
    expect(
      applyIncrements({ totals: { forged: 1 } }, { 'totals.forged': 1, 'formats.how_to.staged': 1 })
    ).toEqual({ totals: { forged: 2 }, formats: { how_to: { staged: 1 } } });
  });
});

describe('runForgePipeline', () => {
  it('stages a clean draft above threshold as forge_ready with version, audit, stats and cover trigger', async () => {
    const d = makeDeps();
    const out = await createForge(d).runForgePipeline({
      contentId: 'c-1',
      actor: { oid: 'o1', email: 'ed@hcw' },
    });
    expect(out.ok).toBe(true);
    expect(out.result).toMatchObject({
      contentId: 'c-1',
      status: 'forge_ready',
      overall: 90,
      threshold: 80,
      formatKey: 'comparison',
      moduleCount: 3,
      moduleRepairs: [],
      bannedPhraseHits: [],
      imagePackSlots: 2,
      usage: { calls: 2, promptTokens: 1200, completionTokens: 550, costUsd: 0.0133 },
    });
    // the forge instruction carried the master prompt, the rotated format and
    // the module override — as the drafter's voiceBlock (replacing its own
    // unconfigured copy), with the picked format alongside so the two sides
    // cannot rotate to different formats.
    const draftCall = d.drafter.generateDraft.mock.calls[0][0];
    expect(draftCall.voiceBlock).toMatch(/^You are writing for Hybrid Cloud Works/);
    expect(draftCall.voiceBlock).toMatch(/Comparison \/ Trade-off/);
    expect(draftCall.voiceBlock).toMatch(/ContentForge module requirements/);
    expect(draftCall.format?.key).toBe('comparison');
    expect(draftCall.customInstructionPrompt).toBeUndefined();
    const [, id, update] = d.writes.patches.find(([c]) => c === 'content');
    expect(id).toBe('c-1');
    expect(update).toMatchObject({
      Title: 'Cut EBS cost, gp2 to gp3',
      contentStatus: 'forge_ready',
      Live: false,
      format: 'comparison',
      keyTopics: ['AWS EBS', 'gp3'],
      altCoverImageTrigger: true,
      forgeReadyNotifyTrigger: true,
      updatedBy: 'ed@hcw',
      forgeGrade: { overall: 90, gradedBy: 'forge_pipeline' },
      forgeMeta: { formatKey: 'comparison', forgedBy: 'ed@hcw', forgedAt: NOW.toISOString() },
    });
    expect(update.contentQuality.critique.verdict).toBe('pass');
    expect(update.forgeImagePack).toHaveLength(2);
    const [, version] = d.writes.upserts.find(([c]) => c === 'content_versions');
    expect(version).toMatchObject({
      contentId: 'c-1',
      versionReason: 'forge_generated',
      versionCreatedBy: 'ed@hcw',
      draft: update.content,
    });
    const [, audit] = d.writes.upserts.find(([c]) => c === 'admin_audit_logs');
    expect(audit).toMatchObject({
      action: 'content_forged',
      userId: 'o1',
      contentId: 'c-1',
      details: { nextStatus: 'forge_ready', overall: 90 },
    });
    const [, stats] = d.writes.upserts.find(([c]) => c === 'admin_config');
    expect(stats).toMatchObject({
      id: 'forge_stats',
      configScope: ADMIN_CONFIG_PARTITION,
      totals: { forged: 1, staged: 1, costUsd: 0.0133 },
      formats: { comparison: { forged: 1, staged: 1, costUsd: 0.0133 } },
      // The rolling day bucket the daily-limit enforcement reads (T-607).
      today: { date: NOW.toISOString().slice(0, 10), forged: 1 },
    });
  });

  it('routes a below-threshold or unclean draft to editing and patches existing stats', async () => {
    const d = makeDeps({ gradeOverall: 50 });
    d.store.readDoc.mockImplementation(async (c, id) =>
      c === 'admin_config'
        ? { id: 'forge_stats', totals: { forged: 4 } }
        : id === 'c-1'
          ? { id: 'c-1', Title: 'T', content: 'm' }
          : null
    );
    const out = await createForge(d).runForgePipeline({ contentId: 'c-1', actor: {} });
    expect(out.result.status).toBe('editing');
    const [, , update] = d.writes.patches.find(([c]) => c === 'content');
    expect(update.altCoverImageTrigger).toBeUndefined();
    expect(update.forgeReadyNotifyTrigger).toBeUndefined();
    expect(update.contentQuality.critique.verdict).toBe('revise');
    expect(update.contentQuality.issues).toContain(
      'Editorial critique: Forge grade 50% is below threshold 80%.'
    );
    const [, , stats] = d.writes.patches.find(([c]) => c === 'admin_config');
    expect(stats.totals).toMatchObject({ forged: 5, editing: 1 });

    const banned = makeDeps({
      draft: draftOf({ postContent: `${GOOD_POST}\n\nIn today's fast-paced digital landscape.` }),
    });
    expect(
      (await createForge(banned).runForgePipeline({ contentId: 'c-1', actor: {} })).result
    ).toMatchObject({
      status: 'editing',
      bannedPhraseHits: ["in today's fast-paced digital landscape"],
    });
  });

  it('skips likely duplicates before spending tokens, and reports generation/grading failures', async () => {
    const dupe = makeDeps({ titles: ['Notes on the EBS gp3 migration'] });
    const out = await createForge(dupe).runForgePipeline({ contentId: 'c-1', actor: {} });
    expect(out).toMatchObject({
      ok: false,
      httpStatus: 409,
      duplicateOf: 'Notes on the EBS gp3 migration',
    });
    expect(dupe.drafter.generateDraft).not.toHaveBeenCalled();
    expect(dupe.writes.upserts.find(([c]) => c === 'admin_config')[1].totals).toEqual({
      skippedDuplicates: 1,
    });

    const broken = makeDeps();
    broken.drafter.generateDraft.mockRejectedValue(new Error('429'));
    expect(
      await createForge(broken).runForgePipeline({ contentId: 'c-1', actor: {} })
    ).toMatchObject({ ok: false, httpStatus: 502, error: 'Generation failed: 429' });
    expect(broken.writes.patches).toHaveLength(0);

    const ungraded = makeDeps();
    ungraded.grader.gradeArticle.mockRejectedValue(new Error('boom'));
    const r = await createForge(ungraded).runForgePipeline({ contentId: 'c-1', actor: {} });
    expect(r.result).toMatchObject({ status: 'editing', overall: 0 });

    expect(
      (await createForge(makeDeps()).runForgePipeline({ contentId: 'missing', actor: {} }))
        .httpStatus
    ).toBe(404);
  });
});

describe('drafter', () => {
  it('a caller-composed voiceBlock + format replaces the base block and skips the rotation query', async () => {
    const store = { queryDocs: vi.fn(async () => []) };
    const ai = {
      getActiveAiProvider: () => 'gemini',
      generateJsonResponse: vi.fn(async () => ({ title: 'T', postContent: 'P' })),
    };
    const drafter = createDrafter({ store, ai, env: {} });
    const out = await drafter.generateDraft({
      url: 'https://u',
      cloudProvider: 'aws',
      scrapedTitle: 'S',
      markdown: 'body',
      voiceBlock: 'THE CONFIGURED VOICE BLOCK',
      format: { key: 'contrarian' },
    });
    // no second pickNextFormat — the caller's format is authoritative
    expect(store.queryDocs).not.toHaveBeenCalled();
    expect(out.format).toBe('contrarian');
    const prompt = ai.generateJsonResponse.mock.calls[0][0].prompt;
    expect(prompt).toContain('THE CONFIGURED VOICE BLOCK');
    // the base (unconfigured) voice block must NOT also be present
    expect(prompt).not.toMatch(/Write as an AWS-focused practitioner/);
  });

  it('composes the instruction with voice/format, admin additions, and PDF parts', async () => {
    const store = { queryDocs: vi.fn(async () => []) };
    const ai = {
      getActiveAiProvider: () => 'openai',
      generateJsonResponse: vi.fn(async () => ({ title: 'T', postContent: 'P' })),
    };
    const drafter = createDrafter({ store, ai, env: { CONTENTFORGE_DRAFT_MODEL: 'gpt-x' } });
    const usageOut = [];
    const out = await drafter.generateDraft({
      url: 'https://u',
      cloudProvider: 'azure',
      scrapedTitle: 'S',
      description: '',
      markdown: 'body',
      customInstructionPrompt: 'Be terse',
      supportingDocuments: [
        { name: 'n', textContent: 'txt' },
        { name: 'p', mimeType: 'application/pdf', base64Data: 'AAAA' },
      ],
      usageOut,
    });
    expect(out).toMatchObject({
      title: 'T',
      postContent: 'P',
      aiProvider: 'openai',
      aiModel: 'gpt-x',
      format: 'how_to',
      gistsCreated: 0,
    });
    const call = ai.generateJsonResponse.mock.calls[0][0];
    expect(call).toMatchObject({ model: 'gpt-x', purpose: 'draft', usageOut });
    expect(call.prompt).toMatch(/Write as an Azure-focused practitioner/);
    expect(call.prompt).toMatch(/Additional admin instructions for this draft[\s\S]*Be terse/);
    expect(call.prompt).toMatch(/extractedDescription: N\/A/);
    expect(call.parts).toHaveLength(4);
    expect(call.parts[3]).toEqual({ inlineData: { mimeType: 'application/pdf', data: 'AAAA' } });
  });
});

describe('weekly digest', () => {
  const items = [
    { Title: 'A', Summary: 'sa', 'Cloud Provider': 'AWS' },
    { title: 'B', summary: 'sb' },
  ];
  const deps = (rows) => ({
    store: { queryDocs: vi.fn(async () => rows), upsertDoc: vi.fn(async (_c, d) => d) },
    drafter: {
      generateDraft: vi.fn(async () => ({
        title: 'Weekly: two posts',
        postContent: 'Hello readers',
      })),
    },
    now: () => NOW,
    uuid: () => 'nl-1',
  });

  it('reports when nothing was published in the window', async () => {
    const d = deps([]);
    expect(await createDigest(d).run({ days: 99 })).toEqual({
      success: false,
      message: 'No new content published in the last 31 days.',
      sourceItemsCount: 0,
    });
    expect(d.store.queryDocs.mock.calls[0][2]).toEqual([
      { name: '@since', value: '2026-07-21T18:00:00.000Z' },
    ]);
    expect(d.drafter.generateDraft).not.toHaveBeenCalled();
  });

  it('previews on dryRun and saves a Draft newsletter otherwise', async () => {
    const d = deps(items);
    const preview = await createDigest(d).run({ dryRun: true });
    expect(preview).toMatchObject({
      success: true,
      dryRun: true,
      title: 'Weekly: two posts',
      content: 'Hello readers',
      sourceItemsCount: 2,
    });
    expect(d.store.upsertDoc).not.toHaveBeenCalled();
    expect(d.drafter.generateDraft.mock.calls[0][0].markdown).toBe(
      'Title: A\nProvider: AWS\nSummary: sa\n\n---\nTitle: B\nProvider: Multi\nSummary: sb\n'
    );
    const saved = await createDigest(d).run({});
    expect(saved).toEqual({
      success: true,
      draftId: 'nl-1',
      sourceItemsCount: 2,
      message: 'Newsletter drafted successfully.',
    });
    expect(d.store.upsertDoc).toHaveBeenCalledWith('newsletters', {
      id: 'nl-1',
      title: 'Weekly: two posts',
      content: 'Hello readers',
      status: 'Draft',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      sourceItemsCount: 2,
    });
  });
});
