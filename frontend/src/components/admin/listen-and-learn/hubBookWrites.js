/**
 * The Listen & Learn Hub's writes on a book — generate, create, patch,
 * delete, add a chapter — as module-level functions over the hook's state
 * bag (useListenAndLearn). Each re-reads what it changed: the grid after a
 * book write, the open book after a chapter is added.
 */
import {
  createBook as apiCreateBook,
  createChapter as apiCreateChapter,
  deleteBook as apiDeleteBook,
  followJob,
  generateEpisodes,
  patchBook as apiPatchBook,
} from '@/lib/listenAndLearn';
import { formatCost, queuedMessage } from './episodeView';
import { closeBook, outcome, readEpisodes, readSets, refreshOpen } from './hubReads';
import { followChapterJob } from './hubChapterWrites';

/** What a finished run says, from the report the job returned. */
export function runSummary(report, status) {
  if (!report) return `Run ${status}`;
  const parts = [`${report.generated} drafted`];
  if (report.failed) parts.push(`${report.failed} failed`);
  if (report.withoutAudio) parts.push(`${report.withoutAudio} without audio`);
  if (report.costUsd) parts.push(formatCost(report.costUsd));
  return `Done — ${parts.join(', ')}`;
}

export async function runGenerate(state, form) {
  state.setGenerating(true);
  state.setError(null);
  state.setProgress('Queued…');
  try {
    const job = await generateEpisodes({
      platform: form.platform,
      examCode: form.examCode.trim(),
      studyGuideUrl: form.studyGuideUrl.trim(),
      certTitle: form.certTitle?.trim() || undefined,
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

export async function createBookFlow(state, fields) {
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

export async function patchBookFlow(state, fields) {
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

export async function deleteBookFlow(state, { force = false } = {}) {
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

export async function createChapterFlow(state, fields) {
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
