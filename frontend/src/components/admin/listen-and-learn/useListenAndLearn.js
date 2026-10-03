/**
 * Everything the Listen & Learn Hub reads and writes, in one place, so the
 * four tabs show the same books and the same chapters (#574, ADR 0033 §4).
 *
 * Race-safe the way the Newsletter Hub hardened it in #555:
 *
 * - every chapter read goes through one generation counter, so opening book
 *   B while book A is still loading paints B — an A that answers late is
 *   dropped rather than shown under B's heading, which is the bug a bare
 *   `cancelled` flag does not catch because both reads are on the same mount;
 * - unmounting (or auth going away) supersedes whatever is in flight;
 * - a FAILED read empties the list rather than leaving the previous book's
 *   chapters beside an error saying they could not be read;
 * - writes are guarded per chapter: a second click on a chapter whose write
 *   has not answered is ignored, not sent twice.
 *
 * The page owns this hook and hands it down, the way CertificationsPage owns
 * useCertifications: Library and Review must agree about what is approved
 * the moment either of them changes it.
 *
 * The hook only holds state. The reads and writes below are module-level
 * functions over one state bag, each with a single exit — the same shape
 * useCertifications uses, and the reason this stays inside Qlty's complexity
 * and return-count budgets as it grows.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createBook as apiCreateBook,
  createChapter as apiCreateChapter,
  deleteBook as apiDeleteBook,
  deleteChapter as apiDeleteChapter,
  deleteVersion as apiDeleteVersion,
  fetchSetForReview,
  fetchSets,
  fetchSpeechOptions,
  fetchSpeechSettings,
  followJob,
  generateEpisodes,
  patchBook as apiPatchBook,
  patchChapter as apiPatchChapter,
  regenerateChapter as apiRegenerateChapter,
  reorderChapters as apiReorderChapters,
  reviewEpisode,
} from '@/lib/listenAndLearn';
import { formatCost, queuedMessage, regenerateMessage } from './episodeView';

/** One call, as `{ value }` or `{ error }` — never throws. */
async function outcome(run) {
  let result;
  try {
    result = { value: await run() };
  } catch (error) {
    result = { error: error.message, status: error.status, detail: error };
  }
  return result;
}

async function readSets(state) {
  const result = await outcome(() => fetchSets({ archived: state.includeArchived.current }));
  if (!state.alive.current) return;
  if (result.error) state.setError(result.error);
  else state.setSets(result.value);
  state.setSetsLoaded(true);
}

/**
 * Read as generation `mine`. A superseded read paints nothing; a failed one
 * empties the list rather than leaving the previous book's rows under the
 * new book's heading.
 */
async function readEpisodes(state, platform, examCode) {
  const mine = ++state.generation.current;
  state.selected.current = { platform, examCode };
  state.setSelected({ platform, examCode });
  state.setLoading(true);
  state.setError(null);
  const result = await outcome(() => fetchSetForReview({ platform, examCode }));
  if (mine !== state.generation.current) return;
  if (result.error) {
    state.setError(result.error);
    state.setEpisodes([]);
    state.setBook(null);
  } else {
    state.setEpisodes(result.value.episodes);
    state.setBook(result.value.set);
  }
  state.setLoading(false);
}

function closeBook(state) {
  state.generation.current += 1;
  state.selected.current = null;
  state.setSelected(null);
  state.setBook(null);
  state.setEpisodes([]);
  state.setLoading(false);
}

/** Reload the open book's chapters in place, keeping the heading. */
async function refreshOpen(state) {
  const set = state.selected.current;
  if (set) await readEpisodes(state, set.platform, set.examCode);
}

/** Mark a chapter busy, or release it, in the ref the guard reads. */
function setBusy(state, id, busy) {
  const next = new Set(state.busy.current);
  if (busy) next.add(id);
  else next.delete(id);
  state.busy.current = next;
  state.setBusySlugs(next);
}

function setChapterProgress(state, id, message) {
  state.setChapterProgress((prev) => {
    const next = { ...prev };
    if (message) next[id] = message;
    else delete next[id];
    return next;
  });
}

/** Replace one chapter in the list with the server's copy of it. */
function paintChapter(state, item) {
  if (!item?.id) return;
  state.setEpisodes((prev) => prev.map((e) => (e.id === item.id ? { ...e, ...item } : e)));
}

/**
 * One guarded write on a chapter: busy while it runs, the server's copy
 * painted on success, the error shown on failure. `after` runs on success
 * for the writes whose effect is wider than one row.
 */
async function writeChapter(state, id, run, { after = null } = {}) {
  if (!state.selected.current || state.busy.current.has(id)) return null;
  setBusy(state, id, true);
  state.setError(null);
  const result = await outcome(run);
  if (state.alive.current) {
    if (result.error) state.setError(result.error);
    else if (result.value && typeof result.value === 'object' && result.value.id) {
      paintChapter(state, result.value);
    }
    if (!result.error && after) await after(result.value);
  }
  if (state.alive.current) setBusy(state, id, false);
  return result;
}

async function writeReview(state, episode, status) {
  const set = state.selected.current;
  if (!set) return;
  await writeChapter(state, episode.id, async () => {
    const res = await reviewEpisode({ ...set, areaSlug: episode.areaSlug || episode.id, status });
    return res?.item ? { ...episode, ...res.item } : { ...episode, status };
  });
}

/** What a finished run says, from the report the job returned. */
function runSummary(report, status) {
  if (!report) return `Run ${status}`;
  const parts = [`${report.generated} drafted`];
  if (report.failed) parts.push(`${report.failed} failed`);
  if (report.withoutAudio) parts.push(`${report.withoutAudio} without audio`);
  if (report.costUsd) parts.push(formatCost(report.costUsd));
  return `Done — ${parts.join(', ')}`;
}

async function runGenerate(state, form) {
  state.setGenerating(true);
  state.setError(null);
  state.setProgress('Queued…');
  try {
    const job = await generateEpisodes({
      platform: form.platform,
      examCode: form.examCode.trim(),
      studyGuideUrl: form.studyGuideUrl.trim(),
      certTitle: form.certTitle?.trim() || undefined,
      ...(form.ttsModel ? { ttsModel: form.ttsModel } : {}),
      onAccepted: (accepted) => state.setProgress(queuedMessage(accepted?.speech)),
      onUpdate: (j) => state.setProgress(`Job ${j.status}…`),
    });
    state.setProgress(runSummary(job?.result, job?.status));
  } catch (error) {
    // Episodes save as they complete, so even a timeout leaves work behind —
    // reload rather than leaving the page showing a stale set.
    state.setError(error.message);
    state.setProgress(null);
  }
  await readSets(state);
  if (form.examCode) await readEpisodes(state, form.platform, form.examCode.trim());
  if (state.alive.current) state.setGenerating(false);
}

/** Follow a chapter's job to its end, painting its progress on the row. */
async function followChapterJob(state, id, start) {
  if (!state.selected.current || state.busy.current.has(id)) return null;
  setBusy(state, id, true);
  state.setError(null);
  setChapterProgress(state, id, 'Queued…');
  const result = await outcome(() =>
    start({
      onAccepted: (accepted) => setChapterProgress(state, id, regenerateMessage(accepted?.speech)),
      onUpdate: (j) => setChapterProgress(state, id, `Job ${j.status}…`),
    })
  );
  if (state.alive.current) {
    const job = result.value;
    if (result.error) state.setError(result.error);
    else if (job?.status !== 'succeeded') state.setError(job?.error || `Job ${job?.status}`);
    setChapterProgress(state, id, null);
    await refreshOpen(state);
  }
  if (state.alive.current) setBusy(state, id, false);
  return result;
}

async function createBookFlow(state, fields) {
  state.setError(null);
  const result = await outcome(() => apiCreateBook(fields));
  if (!state.alive.current) return result;
  if (result.error) {
    state.setError(result.error);
    return result;
  }
  await readSets(state);
  if (result.value) await readEpisodes(state, result.value.provider, result.value.examCode);
  return result;
}

async function patchBookFlow(state, fields) {
  const set = state.selected.current;
  if (!set) return null;
  state.setError(null);
  const result = await outcome(() => apiPatchBook(set, fields));
  if (!state.alive.current) return result;
  if (result.error) state.setError(result.error);
  else {
    state.setBook((prev) => ({ ...(prev || {}), ...(result.value || {}) }));
    // Archive and restore change every chapter's status too.
    if (fields.archived !== undefined) await refreshOpen(state);
    await readSets(state);
  }
  return result;
}

async function deleteBookFlow(state, { force = false } = {}) {
  const set = state.selected.current;
  if (!set) return null;
  state.setError(null);
  const result = await outcome(() => apiDeleteBook(set, { force }));
  if (!state.alive.current) return result;
  if (result.error && result.status !== 409) state.setError(result.error);
  if (!result.error) {
    closeBook(state);
    await readSets(state);
  }
  return result;
}

async function createChapterFlow(state, fields) {
  const set = state.selected.current;
  if (!set) return null;
  state.setError(null);
  const result = await outcome(() => apiCreateChapter(set, fields));
  if (!state.alive.current) return result;
  if (result.error) {
    state.setError(result.error);
    return result;
  }
  await refreshOpen(state);
  await readSets(state);
  const created = result.value?.item;
  const job = result.value?.job;
  if (created && job?.jobId) {
    await followChapterJob(state, created.id, ({ onUpdate }) => followJob(job, { onUpdate }));
  }
  return result;
}

async function reorderFlow(state, order) {
  const set = state.selected.current;
  if (!set) return null;
  // Paint the new order at once; the server's confirmation lands after.
  state.setEpisodes((prev) => {
    const byId = new Map(prev.map((e) => [e.id, e]));
    const moved = order.map((id, index) => ({ ...byId.get(id), order: index })).filter((e) => e.id);
    const rest = prev.filter((e) => !order.includes(e.id));
    return [...moved, ...rest];
  });
  const result = await outcome(() => apiReorderChapters(set, order));
  if (state.alive.current && result.error) {
    state.setError(result.error);
    await refreshOpen(state);
  }
  return result;
}

function startSetsRead(state) {
  let cancelled = false;
  (async () => {
    const result = await outcome(() => fetchSets({ archived: state.includeArchived.current }));
    if (cancelled) return;
    if (result.error) state.setError(result.error);
    else state.setSets(result.value);
    state.setSetsLoaded(true);
  })();
  return () => {
    cancelled = true;
  };
}

/**
 * The stored model default and the priced choices, best effort: a failed load
 * leaves the field on "Stored default", which is what the server applies to a
 * run that names no model, so nothing is lost but the price. The catalogue
 * (voices, providers, default) is read beside it for the Settings tab and
 * the voice dialog.
 */
function startSpeechRead(state) {
  fetchSpeechSettings()
    .then(({ geminiModel, options }) => {
      if (!state.alive.current) return;
      state.setSpeechOptions(options);
      if (geminiModel) state.setStoredModel(geminiModel);
    })
    .catch(() => {});
  fetchSpeechOptions()
    .then((catalog) => {
      if (state.alive.current) state.setCatalog(catalog || null);
    })
    .catch((error) => {
      if (state.alive.current) state.setCatalog({ error: error.message });
    });
}

export default function useListenAndLearn(ready) {
  const [sets, setSets] = useState([]);
  const [setsLoaded, setSetsLoaded] = useState(false);
  const [selected, setSelected] = useState(null); // { platform, examCode }
  const [book, setBook] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busySlugs, setBusySlugs] = useState(() => new Set());
  const [chapterProgress, setChapterProgress] = useState({});
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(null);
  const [speechOptions, setSpeechOptions] = useState([]);
  const [storedModel, setStoredModel] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [includeArchived, setIncludeArchivedState] = useState(false);

  // Bumped by every chapter read; a read whose number is no longer current has
  // been superseded and must paint nothing.
  const generation = useRef(0);
  const alive = useRef(true);
  // Mirrors of the state a write needs to read. Refs rather than deps: an
  // approval must see the book and the busy list as they are when it is
  // clicked, not as they were when its callback was built.
  const selectedRef = useRef(null);
  const busyRef = useRef(new Set());
  const includeArchivedRef = useRef(false);

  const state = useMemo(
    () => ({
      setSets,
      setSetsLoaded,
      setSelected,
      setBook,
      setEpisodes,
      setLoading,
      setError,
      setBusySlugs,
      setChapterProgress,
      setGenerating,
      setProgress,
      setSpeechOptions,
      setStoredModel,
      setCatalog,
      generation,
      alive,
      selected: selectedRef,
      busy: busyRef,
      includeArchived: includeArchivedRef,
    }),
    []
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Supersede anything in flight: its `mine` can never match again.
      generation.current += 1;
    };
  }, []);

  useEffect(() => (ready ? startSetsRead(state) : undefined), [ready, state]);

  useEffect(() => {
    if (ready) startSpeechRead(state);
  }, [ready, state]);

  const loadSets = useCallback(() => readSets(state), [state]);
  const setIncludeArchived = useCallback(
    (value) => {
      includeArchivedRef.current = Boolean(value);
      setIncludeArchivedState(Boolean(value));
      return readSets(state);
    },
    [state]
  );
  const openSet = useCallback(
    (platform, examCode) => readEpisodes(state, platform, examCode),
    [state]
  );
  const close = useCallback(() => closeBook(state), [state]);
  const review = useCallback((episode, status) => writeReview(state, episode, status), [state]);
  const generate = useCallback((form) => runGenerate(state, form), [state]);
  const createBook = useCallback((fields) => createBookFlow(state, fields), [state]);
  const patchBook = useCallback((fields) => patchBookFlow(state, fields), [state]);
  const deleteBook = useCallback((options) => deleteBookFlow(state, options), [state]);
  const createChapter = useCallback((fields) => createChapterFlow(state, fields), [state]);
  const patchChapter = useCallback(
    (chapterId, fields) =>
      writeChapter(
        state,
        chapterId,
        () => apiPatchChapter({ ...state.selected.current, chapterId }, fields),
        {
          // Archive and restore change the book's counts in the grid.
          after: fields.archived !== undefined ? () => readSets(state) : null,
        }
      ),
    [state]
  );
  const reorder = useCallback((order) => reorderFlow(state, order), [state]);
  const regenerate = useCallback(
    (chapterId, ttsModel) =>
      followChapterJob(state, chapterId, (hooks) =>
        apiRegenerateChapter({ ...state.selected.current, chapterId, ttsModel }, hooks)
      ),
    [state]
  );
  const deleteVersion = useCallback(
    (chapterId, versionId) =>
      writeChapter(
        state,
        chapterId,
        () => apiDeleteVersion({ ...state.selected.current, chapterId, versionId }),
        { after: () => refreshOpen(state) }
      ),
    [state]
  );
  const deleteChapter = useCallback(
    async (chapterId, options) => {
      const set = state.selected.current;
      if (!set) return null;
      const result = await outcome(() => apiDeleteChapter({ ...set, chapterId }, options));
      if (!state.alive.current) return result;
      if (result.error && result.status !== 409) state.setError(result.error);
      if (!result.error) {
        state.setEpisodes((prev) => prev.filter((e) => e.id !== chapterId));
        await readSets(state);
      }
      return result;
    },
    [state]
  );

  return {
    sets,
    setsLoaded,
    selected,
    book,
    episodes,
    loading,
    error,
    busySlugs,
    chapterProgress,
    generating,
    progress,
    speechOptions,
    storedModel,
    catalog,
    includeArchived,
    setIncludeArchived,
    loadSets,
    openSet,
    closeBook: close,
    review,
    generate,
    createBook,
    patchBook,
    deleteBook,
    createChapter,
    patchChapter,
    reorder,
    regenerate,
    deleteVersion,
    deleteChapter,
    clearError: useCallback(() => setError(null), []),
  };
}
