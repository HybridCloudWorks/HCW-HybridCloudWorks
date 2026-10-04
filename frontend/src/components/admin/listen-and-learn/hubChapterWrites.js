/**
 * The Listen & Learn Hub's writes on one chapter, as module-level functions
 * over the hook's state bag (useListenAndLearn).
 *
 * Writes are guarded per chapter: a second click on a chapter whose write has
 * not answered is ignored, not sent twice (#555). A write that answers after
 * the hook unmounted paints nothing.
 */
import {
  deleteChapter as apiDeleteChapter,
  deleteVersion as apiDeleteVersion,
  patchChapter as apiPatchChapter,
  regenerateChapter as apiRegenerateChapter,
  reorderChapters as apiReorderChapters,
  reviewEpisode,
} from '@/lib/listenAndLearn';
import { regenerateMessage } from './episodeView';
import { outcome, readSets, refreshOpen } from './hubReads';

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
export async function writeChapter(state, id, run, { after = null } = {}) {
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

export async function writeReview(state, episode, status) {
  const set = state.selected.current;
  if (!set) return;
  await writeChapter(state, episode.id, async () => {
    const res = await reviewEpisode({ ...set, areaSlug: episode.areaSlug || episode.id, status });
    return res?.item ? { ...episode, ...res.item } : { ...episode, status };
  });
}

/** Follow a chapter's job to its end, painting its progress on the row. */
export async function followChapterJob(state, id, start) {
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

export function patchChapterFlow(state, chapterId, fields) {
  return writeChapter(
    state,
    chapterId,
    () => apiPatchChapter({ ...state.selected.current, chapterId }, fields),
    {
      // Archive and restore change the book's counts in the grid.
      after: fields.archived !== undefined ? () => readSets(state) : null,
    }
  );
}

export function regenerateFlow(state, chapterId, ttsModel) {
  return followChapterJob(state, chapterId, (hooks) =>
    apiRegenerateChapter({ ...state.selected.current, chapterId, ttsModel }, hooks)
  );
}

export function deleteVersionFlow(state, chapterId, versionId) {
  return writeChapter(
    state,
    chapterId,
    () => apiDeleteVersion({ ...state.selected.current, chapterId, versionId }),
    { after: () => refreshOpen(state) }
  );
}

export async function deleteChapterFlow(state, chapterId, options) {
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
}

export async function reorderFlow(state, order) {
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
