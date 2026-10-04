/**
 * The Listen & Learn Hub's reads, as module-level functions over the hook's
 * state bag (useListenAndLearn). Each has a single exit, and together they
 * carry the race rules the hub inherited from #555:
 *
 * - every chapter read goes through one generation counter, so opening book
 *   B while book A is still loading paints B — an A that answers late is
 *   dropped rather than shown under B's heading;
 * - unmounting (or auth going away) supersedes whatever is in flight;
 * - a FAILED read empties the list rather than leaving the previous book's
 *   chapters beside an error saying they could not be read.
 */
import {
  fetchSetForReview,
  fetchSets,
  fetchSpeechOptions,
  fetchSpeechSettings,
} from '@/lib/listenAndLearn';

/** One call, as `{ value }` or `{ error }` — never throws. */
export async function outcome(run) {
  let result;
  try {
    result = { value: await run() };
  } catch (error) {
    result = { error: error.message, status: error.status, detail: error };
  }
  return result;
}

export async function readSets(state) {
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
export async function readEpisodes(state, platform, examCode) {
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

export function closeBook(state) {
  state.generation.current += 1;
  state.selected.current = null;
  state.setSelected(null);
  state.setBook(null);
  state.setEpisodes([]);
  state.setLoading(false);
}

/** Reload the open book's chapters in place, keeping the heading. */
export async function refreshOpen(state) {
  const set = state.selected.current;
  if (set) await readEpisodes(state, set.platform, set.examCode);
}

/** Show or hide archived books, then re-read the grid under that filter. */
export function setArchivedFilter(state, value) {
  state.includeArchived.current = Boolean(value);
  state.setIncludeArchived(Boolean(value));
  return readSets(state);
}

export function startSetsRead(state) {
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
export function startSpeechRead(state) {
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
