/**
 * digest.js — the weekly newsletter auto-drafter.
 *
 * Ported from Site-Main `cms/newsletter.js` `generateWeeklyDigest` (088f458):
 * the live `content` published in the last N days becomes one drafted
 * newsletter in `newsletters` (status `Draft`), or — `dryRun` — a preview
 * that saves nothing. The Klaviyo proxy and the public subscribe endpoint in
 * the same upstream module are separate ports (still notImplemented).
 */
import { randomUUID } from 'node:crypto';

export const DIGEST_MAX_ITEMS = 25;

export function clampWindowDays(days) {
  return Math.min(Math.max(Number(days) || 7, 1), 31);
}

export function buildDigestContext(items) {
  return items
    .map((item) => `Title: ${item.title}\nProvider: ${item.provider}\nSummary: ${item.summary}\n`)
    .join('\n---\n');
}

export const DIGEST_INSTRUCTION =
  "You are drafting an engaging email newsletter. The provided markdown contains a list of articles published this week. Write a friendly, conversational introduction, highlight the key themes of this week's content, and provide short, punchy summaries for each item. Conclude with a warm sign-off.";

/**
 * @param {object} deps
 * @param {{ queryDocs: Function, upsertDoc: Function }} deps.store
 * @param {{ generateDraft: Function }} deps.drafter
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createDigest({ store, drafter, now = () => new Date(), uuid = randomUUID }) {
  /**
   * @param {{ dryRun?: boolean, days?: number }} [payload]
   */
  async function run({ dryRun = false, days = 7 } = {}) {
    const windowDays = clampWindowDays(days);
    const windowStart = new Date(now().getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const today = now().toISOString().split('T')[0];

    const rows = await store.queryDocs(
      'content',
      `SELECT TOP ${DIGEST_MAX_ITEMS} c.Title, c.title, c.Summary, c.summary, c["Cloud Provider"], c.cloudProvider FROM c WHERE c.Live = true AND c.publishedAt >= @since ORDER BY c.publishedAt DESC`,
      [{ name: '@since', value: windowStart }]
    );
    const publishedItems = (rows || []).map((data) => ({
      title: data.Title || data.title || 'Untitled',
      summary: data.Summary || data.summary || '',
      provider: data['Cloud Provider'] || data.cloudProvider || 'Multi',
    }));

    if (publishedItems.length === 0) {
      return {
        success: false,
        message: `No new content published in the last ${windowDays} days.`,
        sourceItemsCount: 0,
      };
    }

    const draft = await drafter.generateDraft({
      url: 'weekly-digest',
      cloudProvider: 'Auto',
      scrapedTitle: `Weekly Digest: ${today}`,
      description: "A summary of this week's published content.",
      markdown: buildDigestContext(publishedItems),
      customInstructionPrompt: DIGEST_INSTRUCTION,
    });
    const title = draft.title || `Weekly Digest: ${today}`;
    const content = draft.postContent || '';

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        title,
        content,
        sourceItemsCount: publishedItems.length,
        message: 'Preview only — nothing saved.',
      };
    }

    const stamp = now().toISOString();
    const id = uuid();
    await store.upsertDoc('newsletters', {
      id,
      title,
      content,
      status: 'Draft',
      createdAt: stamp,
      updatedAt: stamp,
      sourceItemsCount: publishedItems.length,
    });
    return {
      success: true,
      draftId: id,
      sourceItemsCount: publishedItems.length,
      message: 'Newsletter drafted successfully.',
    };
  }

  return { run };
}
