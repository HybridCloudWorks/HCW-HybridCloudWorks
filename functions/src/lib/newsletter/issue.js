/**
 * issue.js — build this week's newsletter as a DRAFT (ADR 0030 §2a).
 *
 * Replaces `lib/content/digest.js`, which drafted a markdown article from
 * titles and summaries with no links into `newsletters`, where no code read
 * it; the `build-newsletter-issue` job runs this instead of
 * `generate-weekly-digest`. Its drafts carry no `kind`, so the admin surface,
 * which reads only `kind: 'weekly_issue'`, ignores them. An issue is
 * structured instead: the registered sections' items (each with the public URL
 * publishing stored), a short AI-written intro and subject, and a note the
 * owner can add. The email is rendered from that structure (render.js), so
 * editing the note never means editing HTML.
 *
 * Building never sends. An issue is created `draft`, and nothing in this module
 * reaches Resend: sending is a separate, approval-gated step (ADR 0029 §1b's
 * rule, kept by the owner on 2026-09-13).
 *
 * ## One issue per day, and an approved one is never rebuilt
 *
 * The id is the UTC date of the build, so pressing Build twice refreshes the
 * same draft (keeping the owner's note) instead of creating two drafts that
 * could both be approved. Once an issue is scheduled or sent, a rebuild on
 * that day is refused: the email readers get must be the one that was approved.
 */
import { SECTIONS, collectSections, plainText } from './sections.js';

export const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 31;
const MAX_INTRO_LENGTH = 1200;

/** Statuses a rebuild may overwrite. Anything else has left the owner's hands. */
const REBUILDABLE = new Set(['draft', 'rejected']);

export const INTRO_INSTRUCTION = [
  'You are writing the opening of a weekly email newsletter, not an article.',
  'In "title": a subject line of at most 70 characters naming the week\'s main theme. No emoji, no clickbait.',
  'In "postContent": 3 or 4 plain sentences in one paragraph, first person plural, summarising what was',
  'published and what it means for people running hybrid and multi-cloud estates.',
  'Plain text only in postContent: no markdown, no headings, no lists, no links, no bullet characters.',
  'Mention only items listed in the source material. Do not invent news, numbers or dates.',
].join(' ');

/** Remove markdown a model may still emit, so the renderer only ever escapes text. */
export function stripMarkdown(value) {
  return String(value ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$)/g, '$1$2')
    .trim();
}

export function clampWindowDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.floor(n), MAX_WINDOW_DAYS);
}

/** The context the drafter reads: what is in the issue, and nothing else. */
export function buildIntroContext(sections) {
  return sections
    .map((section) =>
      [`## ${section.title}`, ...section.items.map((item) => `- ${item.title}${item.summary ? ` — ${item.summary}` : ''}`)].join('\n')
    )
    .join('\n\n');
}

const defaultSubject = (since, until) => {
  const fmt = (date) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
  return `HybridCloudWorks Weekly: ${fmt(since)} – ${fmt(new Date(until.getTime() - 1))}`;
};

/**
 * @param {object} deps
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function }} deps.store
 * @param {{ generateDraft: Function } | null} deps.drafter null skips the intro
 * @param {() => Date} [deps.now]
 * @param {object[]} [deps.sections]
 * @param {object} [deps.log]
 */
export function createIssueBuilder({ store, drafter, now = () => new Date(), sections = SECTIONS, log }) {
  /**
   * @param {{ days?: number }} [payload]
   */
  async function build({ days } = {}) {
    const until = now();
    const windowDays = clampWindowDays(days);
    const since = new Date(until.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const id = `issue-${until.toISOString().slice(0, 10)}`;

    const existing = await store.readDoc('newsletters', id, id).catch(() => null);
    if (existing && !REBUILDABLE.has(existing.status)) {
      return {
        success: false,
        issueId: id,
        message: `Today's issue is already ${existing.status}; it is not rebuilt, so readers get the version that was approved.`,
      };
    }

    const collected = await collectSections({ store, since, until, sections, log });
    const itemCount = collected.sections.reduce((sum, section) => sum + section.items.length, 0);
    if (itemCount === 0) {
      return {
        success: false,
        itemCount: 0,
        problems: collected.problems,
        message: `Nothing new in the last ${windowDays} days, so no issue was built.`,
      };
    }

    let subject = defaultSubject(since, until);
    let intro = '';
    let introError = null;
    if (drafter) {
      try {
        const draft = await drafter.generateDraft({
          url: 'weekly-newsletter',
          cloudProvider: 'Auto',
          scrapedTitle: subject,
          description: "This week's newsletter issue.",
          markdown: buildIntroContext(collected.sections),
          customInstructionPrompt: INTRO_INSTRUCTION,
        });
        const drafted = plainText(stripMarkdown(draft?.title), 120);
        if (drafted) subject = drafted;
        intro = stripMarkdown(draft?.postContent).slice(0, MAX_INTRO_LENGTH);
      } catch (error) {
        // The AI being off or down costs the intro, not the issue: the items
        // are the newsletter, and the owner can write the note by hand.
        introError = String(error?.message ?? error).slice(0, 300);
        log?.warn?.(`[newsletter] intro not drafted: ${introError}`);
      }
    }

    const stamp = until.toISOString();
    const doc = {
      id,
      kind: 'weekly_issue',
      version: 1,
      status: 'draft',
      periodStart: since.toISOString(),
      periodEnd: until.toISOString(),
      subject,
      intro,
      introError,
      customNote: typeof existing?.customNote === 'string' ? existing.customNote : '',
      sections: collected.sections,
      itemCount,
      problems: collected.problems,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    await store.upsertDoc('newsletters', doc);
    return {
      success: true,
      issueId: id,
      itemCount,
      sections: collected.sections.map((section) => section.id),
      problems: collected.problems,
      message: `Drafted ${id} with ${itemCount} item(s). Review and approve it on the Mailing List page.`,
    };
  }

  return { build };
}
