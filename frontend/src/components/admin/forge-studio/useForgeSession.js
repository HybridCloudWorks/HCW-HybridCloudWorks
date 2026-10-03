/**
 * One Forge Studio session (ADR 0033 §7 slice 2): the brief, the content
 * document it becomes, the forge job that writes the first draft, the AI
 * actions over the draft text, and the saves. Held at page level so the
 * four workspace tabs read and write the same state; `?contentId=` on the
 * URL names the document so a reload comes back to it.
 *
 * Server side, in order of use:
 *   POST cms/drafts                   the draft document, status drafting
 *                                     (lib/cms/drafts-handlers.js), so it is
 *                                     on the Drafts page from the first save
 *   POST cms/forge/brief              kind, idea origin and the brief on it
 *   enqueueJob forge-article          the forge writes, scrubs, grades and
 *     or forge-from-url               stages the draft (forge-jobs.js)
 *   GET  cms/content/item             the document as it now stands
 *   POST cms/forge/assist             one AI action over the text
 *   POST cms/forge/save               the edited text, under the ETag
 *   POST cms/drafts/{id}/send-to-review
 *
 * Every write that fails is said on the page; nothing here retries a save.
 */
import { useCallback, useMemo, useState } from 'react';
import { getJSON, postJSON } from '@/lib/api';
import { runJob } from '@/lib/jobs';
import {
  EMPTY_BRIEF,
  MODE_ORIGINS,
  bodyOf,
  briefToMarkdown,
  splitList,
  titleOf,
  toBriefPayload,
} from './brief';

export const FORGE_JOB_MAX_WAIT_MS = 28 * 60 * 1000;

const isConflict = (err) => err?.status === 412 || err?.code === 'CONFLICT';

const itemRoute = (id) => `cms/content/item?contentId=${encodeURIComponent(id)}`;

/** POST cms/forge/brief: the brief, kind and idea origin onto a document. */
async function saveBriefOn(contentId, brief) {
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
async function firstBody(brief, title, templateLabel) {
  const body = briefToMarkdown(brief, title, { templateLabel });
  if (brief.mode !== 'existing' || !brief.sourceContentId) return body;
  const source = await getJSON(itemRoute(brief.sourceContentId));
  const sourceBody = bodyOf(source?.item || {});
  if (!sourceBody.trim()) return body;
  const sourceTitle = titleOf(source.item) || brief.sourceContentId;
  return `${body}\n\n---\n\n## Source material (${sourceTitle})\n\n${sourceBody}`;
}

/** The job's outcome as an error, or null when it produced a draft. */
function jobFailure(job) {
  if (job?.status !== 'succeeded') {
    return new Error(job?.error || `The forge job ${job?.status || 'did not finish'}.`);
  }
  if (job.result && job.result.success === false) {
    return new Error(job.result.error || 'The forge did not produce a draft.');
  }
  return null;
}

/** What a job status means on screen, in plain words. */
export function describeJob(job) {
  if (!job) return '';
  switch (job.status) {
    case 'queued':
      return 'Queued: the forge will pick this up in a moment.';
    case 'running':
      return 'Running: the forge is reading the brief, writing the draft and grading it. This takes a few minutes.';
    case 'succeeded':
      return 'Done: the draft is written and graded.';
    case 'failed':
      return `Failed: ${job.error || 'the forge reported an error'}`;
    case 'timeout':
      return 'Timed out: the forge did not finish in time. The document is unchanged.';
    case 'cancelled':
      return 'Cancelled.';
    default:
      return String(job.status || '');
  }
}

/** The editable text of a document: the three fields the Studio writes. */
export function textOf(doc) {
  return {
    title: titleOf(doc),
    summary: String(doc?.Summary ?? doc?.summary ?? ''),
    body: bodyOf(doc),
  };
}

const INITIAL = {
  title: '',
  brief: { ...EMPTY_BRIEF },
  contentId: '',
  doc: null,
  text: { title: '', summary: '', body: '' },
  loading: false,
  job: null,
  busy: null, // 'create' | 'generate' | 'assist' | 'save' | 'send' | null
  assistResult: null, // { action, label, result, provider, model }; `assist` is the call
  error: null,
  conflict: false,
  notice: null,
};

/**
 * @param {object} options
 * @param {string} [options.initialContentId] from `?contentId=`
 * @param {(id: string) => void} [options.onContentId] mirror the id to the URL
 */
export function useForgeSession({ initialContentId = '', onContentId } = {}) {
  const [state, setState] = useState(() => ({
    ...INITIAL,
    contentId: initialContentId || '',
  }));

  const patch = useCallback((next) => setState((prev) => ({ ...prev, ...next })), []);

  const showDoc = useCallback(
    (doc) => {
      const id = doc?.id || '';
      patch({ doc, contentId: id, text: textOf(doc), conflict: false });
      if (id) onContentId?.(id);
    },
    [patch, onContentId]
  );

  /** GET the document as it now stands. */
  const loadDoc = useCallback(
    async (contentId) => {
      const id = String(contentId || state.contentId || '').trim();
      if (!id) return null;
      patch({ loading: true, error: null });
      try {
        const res = await getJSON(itemRoute(id));
        const doc = res?.item || null;
        if (!doc) throw new Error('The document was not found.');
        showDoc(doc);
        return doc;
      } catch (err) {
        patch({ error: err?.message || 'The document could not be read.' });
        return null;
      } finally {
        patch({ loading: false });
      }
    },
    [patch, showDoc, state.contentId]
  );

  /** Start a mode: a fresh brief seeded for it, title kept if given. */
  const start = useCallback(
    (mode, extras = {}) => {
      const { title = '', ...briefExtras } = extras;
      setState({
        ...INITIAL,
        title,
        brief: {
          ...EMPTY_BRIEF,
          mode,
          ideaOrigin: MODE_ORIGINS[mode] || 'manual',
          ...briefExtras,
        },
      });
      onContentId?.('');
    },
    [onContentId]
  );

  const setTitle = useCallback((title) => patch({ title }), [patch]);
  const setBrief = useCallback(
    (field, value) => setState((prev) => ({ ...prev, brief: { ...prev.brief, [field]: value } })),
    []
  );
  const setBriefFields = useCallback(
    (fields) => setState((prev) => ({ ...prev, brief: { ...prev.brief, ...fields } })),
    []
  );
  const setText = useCallback(
    (field, value) => setState((prev) => ({ ...prev, text: { ...prev.text, [field]: value } })),
    []
  );
  const clearMessages = useCallback(() => patch({ error: null, notice: null }), [patch]);

  /**
   * Create the draft document from the brief and save the brief on it.
   * For "existing", the source's body travels into the new draft so the
   * original is never rewritten by the forge.
   */
  const createDraft = useCallback(
    async ({ templateLabel = '' } = {}) => {
      const title = state.title.trim();
      if (!title) throw new Error('Give the piece a title before creating the draft.');
      const body = await firstBody(state.brief, title, templateLabel);
      const created = await postJSON('cms/drafts', {
        fields: { title, body, tags: splitList(state.brief.seoKeywords).slice(0, 10) },
      });
      const id = created?.draft?.id;
      if (!created?.ok || !id) throw new Error(created?.error || 'The draft was not created.');
      await saveBriefOn(id, state.brief);
      return id;
    },
    [state.title, state.brief]
  );

  /** Save the brief as a draft and stop there (no AI). */
  const saveAsDraft = useCallback(
    async (options) => {
      patch({ busy: 'create', error: null, notice: null });
      try {
        const id = state.contentId || (await createDraft(options));
        if (state.contentId) await saveBriefOn(id, state.brief);
        await loadDoc(id);
        patch({ notice: 'Saved as a draft. It is on the Drafts page.' });
        return id;
      } catch (err) {
        patch({ error: err?.message || 'The draft could not be saved.' });
        return null;
      } finally {
        patch({ busy: null });
      }
    },
    [patch, state.contentId, state.brief, createDraft, loadDoc]
  );

  /**
   * Write the first draft: the document first (so it exists on Drafts), then
   * the forge job against it. From a URL the job creates the document and the
   * brief is saved onto it afterwards.
   */
  const generate = useCallback(
    async (options = {}) => {
      patch({ busy: 'generate', error: null, notice: null, job: { status: 'queued' } });
      const jobOptions = { onUpdate: (job) => patch({ job }), maxWaitMs: FORGE_JOB_MAX_WAIT_MS };
      try {
        let id = state.contentId;
        let job;
        if (!id && state.brief.mode === 'url') {
          const url = state.brief.sourceUrl.trim();
          if (!url) throw new Error('Paste the URL to forge from.');
          job = await runJob('forge-from-url', { url }, jobOptions);
          id = job?.result?.contentId || '';
          // The job made the document; the brief lands on it afterwards, and
          // a failure to do so does not undo a draft that was written.
          if (id) await saveBriefOn(id, state.brief).catch(() => null);
        } else {
          if (!id) id = await createDraft(options);
          job = await runJob('forge-article', { sourceContentId: id }, jobOptions);
        }
        patch({ job });
        if (id) await loadDoc(id);
        const failure = jobFailure(job);
        if (failure) throw failure;
        patch({ notice: 'The draft is written and graded. Review it below.' });
        return job;
      } catch (err) {
        if (err?.job) patch({ job: err.job });
        patch({ error: err?.message || 'The forge job failed.' });
        return null;
      } finally {
        patch({ busy: null });
      }
    },
    [patch, state.contentId, state.brief, createDraft, loadDoc]
  );

  /** One AI action over the given text. */
  const assist = useCallback(
    async (action, { text, instruction = '', tone = '' }) => {
      if (!state.contentId) {
        patch({ error: 'Create the draft first; every AI action is recorded on it.' });
        return null;
      }
      patch({ busy: 'assist', error: null });
      try {
        const res = await postJSON('cms/forge/assist', {
          contentId: state.contentId,
          action,
          text,
          instruction,
          tone,
        });
        if (!res?.ok) throw new Error(res?.error || 'The action failed.');
        const result = {
          action,
          label: res.label,
          result: res.result,
          provider: res.provider,
          model: res.model,
        };
        setState((prev) => ({
          ...prev,
          assistResult: result,
          doc: prev.doc
            ? { ...prev.doc, activity: [...(prev.doc.activity || []), res.activity] }
            : prev.doc,
        }));
        return result;
      } catch (err) {
        patch({ error: err?.message || 'The action failed.' });
        return null;
      } finally {
        patch({ busy: null });
      }
    },
    [patch, state.contentId]
  );

  const clearAssist = useCallback(() => patch({ assistResult: null }), [patch]);

  /** Save the edited title, summary and body under the ETag. */
  const save = useCallback(async () => {
    if (!state.doc) return false;
    patch({ busy: 'save', error: null, notice: null });
    try {
      const res = await postJSON('cms/forge/save', {
        contentId: state.contentId,
        etag: state.doc._etag,
        title: state.text.title,
        summary: state.text.summary,
        body: state.text.body,
      });
      if (!res?.ok) throw new Error(res?.error || 'The draft was not saved.');
      setState((prev) => ({
        ...prev,
        doc: {
          ...prev.doc,
          _etag: res.etag || prev.doc._etag,
          Title: prev.text.title,
          Summary: prev.text.summary,
          content: prev.text.body,
          blogDraft: prev.text.body,
          activity: res.activity || prev.doc.activity,
        },
        notice: 'Saved.',
        conflict: false,
      }));
      return true;
    } catch (err) {
      if (isConflict(err)) {
        patch({
          conflict: true,
          error: err.message,
        });
      } else {
        patch({ error: err?.message || 'The draft was not saved.' });
      }
      return false;
    } finally {
      patch({ busy: null });
    }
  }, [patch, state.doc, state.contentId, state.text]);

  /** Drafts stage → In Review. Only a `drafting` document can take this edge. */
  const sendToReview = useCallback(async () => {
    if (!state.doc) return null;
    patch({ busy: 'send', error: null, notice: null });
    try {
      const res = await postJSON(
        `cms/drafts/${encodeURIComponent(state.contentId)}/send-to-review`,
        { etag: state.doc._etag }
      );
      if (!res?.ok) throw new Error(res?.error || 'Send to review failed.');
      await loadDoc(state.contentId);
      patch({ notice: 'Sent to In Review. It is on the Content Queue; nothing was published.' });
      return res;
    } catch (err) {
      patch({ error: err?.message || 'Send to review failed.' });
      return null;
    } finally {
      patch({ busy: null });
    }
  }, [patch, state.doc, state.contentId, loadDoc]);

  const reset = useCallback(() => {
    setState({ ...INITIAL });
    onContentId?.('');
  }, [onContentId]);

  const dirty = useMemo(() => {
    if (!state.doc) return false;
    const current = textOf(state.doc);
    return (
      current.title !== state.text.title ||
      current.summary !== state.text.summary ||
      current.body !== state.text.body
    );
  }, [state.doc, state.text]);

  return {
    ...state,
    dirty,
    start,
    setTitle,
    setBrief,
    setBriefFields,
    setText,
    clearMessages,
    loadDoc,
    saveAsDraft,
    generate,
    assist,
    clearAssist,
    save,
    sendToReview,
    reset,
  };
}
