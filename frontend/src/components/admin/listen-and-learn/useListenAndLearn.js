/**
 * Everything the Listen & Learn Hub reads and writes, in one place, so the
 * four tabs show the same sets and the same episodes (#574).
 *
 * Race-safe the way the Newsletter Hub hardened it in #555:
 *
 * - every episode read goes through one generation counter, so opening set B
 *   while set A is still loading paints B — an A that answers late is dropped
 *   rather than shown under B's heading, which is the bug a bare `cancelled`
 *   flag does not catch because both reads are on the same mount;
 * - unmounting (or auth going away) supersedes whatever is in flight;
 * - a FAILED read empties the list rather than leaving the previous set's
 *   episodes beside an error saying they could not be read;
 * - approvals are guarded per episode: a second click on an episode whose
 *   write has not answered is ignored, not sent twice.
 *
 * The page owns this hook and hands it down, the way CertificationsPage owns
 * useCertifications: Review and Published must agree about what is approved
 * the moment either of them changes it.
 *
 * The hook only holds state. The reads and writes below are module-level
 * functions over one state bag, each with a single exit — the same shape
 * useCertifications uses, and the reason this stays inside Qlty's complexity
 * and return-count budgets as it grows.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSetForReview,
  fetchSets,
  fetchSpeechSettings,
  generateEpisodes,
  reviewEpisode,
} from '@/lib/listenAndLearn';
import { queuedMessage, formatCost } from './episodeView';

/** One GET of the set list, as `{ rows }` or `{ error }` — never throws. */
async function fetchSetsOutcome() {
  let outcome;
  try {
    outcome = { rows: await fetchSets() };
  } catch (error) {
    outcome = { error: error.message };
  }
  return outcome;
}

/** One GET of a set's episodes, as `{ episodes }` or `{ error }`. */
async function fetchEpisodesOutcome(platform, examCode) {
  let outcome;
  try {
    const { episodes } = await fetchSetForReview({ platform, examCode });
    outcome = { episodes };
  } catch (error) {
    outcome = { error: error.message };
  }
  return outcome;
}

async function readSets(state) {
  const outcome = await fetchSetsOutcome();
  if (!state.alive.current) return;
  if (outcome.error) state.setError(outcome.error);
  else state.setSets(outcome.rows);
}

/**
 * Read as generation `mine`. A superseded read paints nothing; a failed one
 * empties the list rather than leaving the previous set's rows under the new
 * set's heading.
 */
async function readEpisodes(state, platform, examCode) {
  const mine = ++state.generation.current;
  state.selected.current = { platform, examCode };
  state.setSelected({ platform, examCode });
  state.setLoading(true);
  state.setError(null);
  const outcome = await fetchEpisodesOutcome(platform, examCode);
  if (mine !== state.generation.current) return;
  if (outcome.error) {
    state.setError(outcome.error);
    state.setEpisodes([]);
  } else {
    state.setEpisodes(outcome.episodes);
  }
  state.setLoading(false);
}

/** Mark an episode busy, or release it, in the ref the guard reads. */
function setBusy(state, slug, busy) {
  const next = new Set(state.busy.current);
  if (busy) next.add(slug);
  else next.delete(slug);
  state.busy.current = next;
  state.setBusySlugs(next);
}

async function writeReview(state, episode, status) {
  const slug = episode.areaSlug;
  const set = state.selected.current;
  // Ignore a second click while the first is unanswered rather than sending
  // the approval twice.
  if (!set || state.busy.current.has(slug)) return;
  setBusy(state, slug, true);
  state.setError(null);
  let failure = null;
  try {
    await reviewEpisode({ platform: set.platform, examCode: set.examCode, areaSlug: slug, status });
  } catch (error) {
    failure = error.message;
  }
  if (!state.alive.current) return;
  // Optimistic on the one field that changed, rather than refetching the whole
  // set: approving five episodes in a row should not cost five round trips
  // through a list that is not otherwise changing.
  if (failure) state.setError(failure);
  else
    state.setEpisodes((rows) =>
      rows.map((row) => (row.areaSlug === slug ? { ...row, status } : row))
    );
  setBusy(state, slug, false);
}

/**
 * What a finished run says it did. The run's own spend is summed from the rows
 * written to `ai_usage`; the same rows roll up under "Breakdown by Feature" on
 * the AI Engine usage tab.
 */
function runSummary(report, jobStatus) {
  if (!report) return `Job ${jobStatus}`;
  const withoutAudio = report.withoutAudio ? `, ${report.withoutAudio} without audio` : '';
  const cost = report.costUsd ? ` · ${formatCost(report.costUsd)}` : '';
  return `${report.generated} drafted, ${report.failed} failed${withoutAudio}${cost}`;
}

async function runGenerate(state, form) {
  state.setGenerating(true);
  state.setError(null);
  state.setProgress('Queued…');
  try {
    const job = await generateEpisodes({
      ...form,
      // "Stored default" is no model at all: the field is dropped, not sent
      // blank, so the payload carries no ttsModel and the stored default reads.
      ttsModel: form.ttsModel || undefined,
      // The expected speech spend arrives with the 202 and is shown then —
      // before the run starts is when it is worth knowing.
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
  if (form.examCode) await readEpisodes(state, form.platform, form.examCode);
  if (state.alive.current) state.setGenerating(false);
}

export default function useListenAndLearn(ready) {
  const [sets, setSets] = useState([]);
  const [selected, setSelected] = useState(null); // { platform, examCode }
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busySlugs, setBusySlugs] = useState(() => new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(null);
  const [speechOptions, setSpeechOptions] = useState([]);
  const [storedModel, setStoredModel] = useState('');

  // Bumped by every episode read; a read whose number is no longer current has
  // been superseded and must paint nothing.
  const generation = useRef(0);
  const alive = useRef(true);
  // Mirrors of the state a write needs to read. Refs rather than deps: an
  // approval must see the set and the busy list as they are when it is
  // clicked, not as they were when its callback was built.
  const selectedRef = useRef(null);
  const busyRef = useRef(new Set());

  const state = useMemo(
    () => ({
      setSets,
      setSelected,
      setEpisodes,
      setLoading,
      setError,
      setBusySlugs,
      setGenerating,
      setProgress,
      generation,
      alive,
      selected: selectedRef,
      busy: busyRef,
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

  // The read is inlined rather than calling readSets: a response that lands
  // after this page unmounts (or after auth flips) must not set state, and the
  // effect is the only place that knows when that is.
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    (async () => {
      const outcome = await fetchSetsOutcome();
      if (cancelled) return;
      if (outcome.error) setError(outcome.error);
      else setSets(outcome.rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  // The stored model default and the priced choices, best effort: a failed
  // load leaves the field on "Stored default", which is what the server
  // applies to a run that names no model, so nothing is lost but the price.
  useEffect(() => {
    if (!ready) return;
    fetchSpeechSettings()
      .then(({ geminiModel, options }) => {
        if (!alive.current) return;
        setSpeechOptions(options);
        if (geminiModel) setStoredModel(geminiModel);
      })
      .catch(() => {});
  }, [ready]);

  const loadSets = useCallback(() => readSets(state), [state]);
  const openSet = useCallback(
    (platform, examCode) => readEpisodes(state, platform, examCode),
    [state]
  );
  const review = useCallback((episode, status) => writeReview(state, episode, status), [state]);
  const generate = useCallback((form) => runGenerate(state, form), [state]);

  return {
    sets,
    selected,
    episodes,
    loading,
    error,
    busySlugs,
    generating,
    progress,
    speechOptions,
    storedModel,
    loadSets,
    openSet,
    review,
    generate,
  };
}
