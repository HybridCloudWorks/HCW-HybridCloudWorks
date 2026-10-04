/**
 * Forge Studio's server calls (ADR 0033 §7 slice 2), each one route or one
 * job, and the words a job's status gets on screen. Nothing here holds
 * state: forgeSessionActions.js sequences these and dispatches the result.
 *
 *   POST cms/drafts                   the draft document, status drafting
 *   POST cms/forge/brief              kind, idea origin and the brief on it
 *   enqueueJob forge-article          the forge writes, scrubs, grades and
 *     or forge-from-url               stages the draft (forge-jobs.js)
 *   GET  cms/content/item             the document as it now stands
 *   POST cms/forge/assist             one AI action over the text
 *   POST cms/forge/save               the edited text, under the ETag
 *   POST cms/drafts/{id}/send-to-review
 */
import { getJSON, postJSON } from '@/lib/api';
import { runJob } from '@/lib/jobs';
import { bodyOf, briefToMarkdown, splitList, titleOf, toBriefPayload } from './brief';

export const FORGE_JOB_MAX_WAIT_MS = 28 * 60 * 1000;

export const isConflict = (err) => err?.status === 412 || err?.code === 'CONFLICT';

const itemRoute = (id) => `cms/content/item?contentId=${encodeURIComponent(id)}`;

/** GET the document as it now stands; throws when there is none. */
export async function readDocument(contentId) {
  const res = await getJSON(itemRoute(contentId));
  const doc = res?.item || null;
  if (!doc) throw new Error('The document was not found.');
  return doc;
}

/** POST cms/forge/brief: the brief, kind and idea origin onto a document. */
export async function saveBriefOn(contentId, brief) {
  const saved = await postJSON('cms/forge/brief', {
    contentId,
    brief: toBriefPayload(brief),
    kind: brief.kind,
    ideaOrigin: brief.ideaOrigin,
  });
  if (!saved?.ok) throw new Error(saved?.error || 'The brief was not saved.');
  return saved;
}

/**
 * The first body of a draft: the brief as markdown, plus the source's text
 * when repurposing existing content, so the original is never rewritten.
 */
export async function firstBody(brief, title, templateLabel) {
  const body = briefToMarkdown(brief, title, { templateLabel });
  if (brief.mode !== 'existing' || !brief.sourceContentId) return body;
  const source = await getJSON(itemRoute(brief.sourceContentId));
  const sourceBody = bodyOf(source?.item || {});
  if (!sourceBody.trim()) return body;
  const sourceTitle = titleOf(source.item) || brief.sourceContentId;
  return `${body}\n\n---\n\n## Source material (${sourceTitle})\n\n${sourceBody}`;
}

/**
 * Create the draft document from the brief and save the brief on it; the id.
 * For "existing", the source's body travels into the new draft so the
 * original is never rewritten by the forge.
 */
export async function createDraftDocument({ title, brief, templateLabel = '' }) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Give the piece a title before creating the draft.');
  const body = await firstBody(brief, trimmed, templateLabel);
  const created = await postJSON('cms/drafts', {
    fields: { title: trimmed, body, tags: splitList(brief.seoKeywords).slice(0, 10) },
  });
  const id = created?.draft?.id;
  if (!created?.ok || !id) throw new Error(created?.error || 'The draft was not created.');
  await saveBriefOn(id, brief);
  return id;
}

/** From a URL the job creates the document; the brief is saved onto it afterwards. */
async function forgeFromUrl(brief, jobOptions) {
  const url = brief.sourceUrl.trim();
  if (!url) throw new Error('Paste the URL to forge from.');
  const job = await runJob('forge-from-url', { url }, jobOptions);
  const id = job?.result?.contentId || '';
  // The job made the document; the brief lands on it afterwards, and a
  // failure to do so does not undo a draft that was written.
  if (id) await saveBriefOn(id, brief).catch(() => null);
  return { id, job };
}

/**
 * Write the first draft: the document first (so it exists on Drafts), then
 * the forge job against it. Resolves to the document's id and the job.
 */
export async function writeFirstDraft({ contentId, brief, title }, options, jobOptions) {
  if (!contentId && brief.mode === 'url') return forgeFromUrl(brief, jobOptions);
  const id = contentId || (await createDraftDocument({ title, brief, ...options }));
  const job = await runJob('forge-article', { sourceContentId: id }, jobOptions);
  return { id, job };
}

/** The job's outcome as an error, or null when it produced a draft. */
export function jobFailure(job) {
  if (job?.status !== 'succeeded') {
    return new Error(job?.error || `The forge job ${job?.status || 'did not finish'}.`);
  }
  if (job.result && job.result.success === false) {
    return new Error(job.result.error || 'The forge did not produce a draft.');
  }
  return null;
}

/** What each job status means on screen, in plain words; `failed` carries its error. */
const JOB_WORDS = Object.freeze({
  queued: 'Queued: the forge will pick this up in a moment.',
  running:
    'Running: the forge is reading the brief, writing the draft and grading it. This takes a few minutes.',
  succeeded: 'Done: the draft is written and graded.',
  timeout: 'Timed out: the forge did not finish in time. The document is unchanged.',
  cancelled: 'Cancelled.',
});

export function describeJob(job) {
  if (!job) return '';
  if (job.status === 'failed') return `Failed: ${job.error || 'the forge reported an error'}`;
  return JOB_WORDS[job.status] ?? String(job.status || '');
}

/** POST cms/forge/assist: one AI action over the given text. */
export async function assistOn(contentId, action, { text, instruction = '', tone = '' }) {
  const res = await postJSON('cms/forge/assist', { contentId, action, text, instruction, tone });
  if (!res?.ok) throw new Error(res?.error || 'The action failed.');
  return res;
}

/** POST cms/forge/save: the edited title, summary and body under the ETag. */
export async function saveText(contentId, doc, text) {
  const res = await postJSON('cms/forge/save', {
    contentId,
    etag: doc._etag,
    title: text.title,
    summary: text.summary,
    body: text.body,
  });
  if (!res?.ok) throw new Error(res?.error || 'The draft was not saved.');
  return res;
}

/** Drafts stage → In Review. Only a `drafting` document can take this edge. */
export async function sendDraftToReview(contentId, etag) {
  const res = await postJSON(`cms/drafts/${encodeURIComponent(contentId)}/send-to-review`, {
    etag,
  });
  if (!res?.ok) throw new Error(res?.error || 'Send to review failed.');
  return res;
}
