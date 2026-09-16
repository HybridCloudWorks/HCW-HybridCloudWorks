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
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSetForReview,
  fetchSets,
  fetchSpeechSettings,
  generateEpisodes,
  reviewEpisode,
} from '@/lib/listenAndLearn';
import { queuedMessage, formatCost } from './episodeView';

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
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Supersede anything in flight: its `mine` can never match again.
      generation.current += 1;
    };
  }, []);

  const loadSets = useCallback(async () => {
    try {
      const rows = await fetchSets();
      if (alive.current) setSets(rows);
    } catch (err) {
      if (alive.current) setError(err.message);
    }
  }, []);

  // The read is inlined rather than calling loadSets: a response that lands
  // after this page unmounts (or after auth flips) must not set state, and the
  // effect is the only place that knows when that is.
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchSets();
        if (!cancelled) setSets(rows);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
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

  const openSet = useCallback(async (platform, examCode) => {
    const mine = ++generation.current;
    setSelected({ platform, examCode });
    setLoading(true);
    setError(null);
    try {
      const { episodes: rows } = await fetchSetForReview({ platform, examCode });
      if (mine !== generation.current) return;
      setEpisodes(rows);
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err.message);
      setEpisodes([]);
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  const review = useCallback(
    async (episode, status) => {
      const slug = episode.areaSlug;
      // Ignore a second click while the first is unanswered rather than
      // sending the approval twice.
      if (busySlugs.has(slug) || !selected) return;
      setBusySlugs((busy) => new Set(busy).add(slug));
      setError(null);
      try {
        await reviewEpisode({
          platform: selected.platform,
          examCode: selected.examCode,
          areaSlug: slug,
          status,
        });
        // Optimistic on the one field that changed, rather than refetching the
        // whole set: approving five episodes in a row should not cost five
        // round trips through a list that is not otherwise changing.
        if (alive.current) {
          setEpisodes((rows) =>
            rows.map((row) => (row.areaSlug === slug ? { ...row, status } : row))
          );
        }
      } catch (err) {
        if (alive.current) setError(err.message);
      } finally {
        if (alive.current) {
          setBusySlugs((busy) => {
            const next = new Set(busy);
            next.delete(slug);
            return next;
          });
        }
      }
    },
    [busySlugs, selected]
  );

  const generate = useCallback(
    async (form) => {
      setGenerating(true);
      setError(null);
      setProgress('Queued…');
      try {
        const job = await generateEpisodes({
          ...form,
          // "Stored default" is no model at all: the field is dropped, not sent
          // blank, so the payload carries no ttsModel and the stored default reads.
          ttsModel: form.ttsModel || undefined,
          // The expected speech spend arrives with the 202 and is shown then —
          // before the run starts is when it is worth knowing.
          onAccepted: (accepted) => setProgress(queuedMessage(accepted?.speech)),
          onUpdate: (j) => setProgress(`Job ${j.status}…`),
        });
        const report = job?.result;
        const withoutAudio = report?.withoutAudio ? `, ${report.withoutAudio} without audio` : '';
        // The run's own spend, summed from the rows written to ai_usage. Shown
        // here because this is the moment it is worth knowing; the same rows roll
        // up under "Breakdown by Feature" on the AI Engine usage tab.
        const cost = report?.costUsd ? ` · ${formatCost(report.costUsd)}` : '';
        setProgress(
          report
            ? `${report.generated} drafted, ${report.failed} failed${withoutAudio}${cost}`
            : `Job ${job?.status}`
        );
        await loadSets();
        await openSet(form.platform, form.examCode);
      } catch (err) {
        // Episodes save as they complete, so even a timeout leaves work behind —
        // reload rather than leaving the page showing a stale set.
        setError(err.message);
        setProgress(null);
        await loadSets();
        if (form.examCode) await openSet(form.platform, form.examCode);
      } finally {
        if (alive.current) setGenerating(false);
      }
    },
    [loadSets, openSet]
  );

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
