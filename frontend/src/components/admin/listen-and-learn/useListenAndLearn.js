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
 * The hook only holds state. The reads and writes are module-level functions
 * over one state bag — hubReads, hubBookWrites and hubChapterWrites — each
 * with a single exit, the same shape useCertifications uses, and the reason
 * this stays inside Qlty's complexity and return-count budgets as it grows.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  closeBook,
  readEpisodes,
  readSets,
  setArchivedFilter,
  startSetsRead,
  startSpeechRead,
} from './hubReads';
import {
  createBookFlow,
  createChapterFlow,
  deleteBookFlow,
  patchBookFlow,
  runGenerate,
} from './hubBookWrites';
import {
  deleteChapterFlow,
  deleteVersionFlow,
  patchChapterFlow,
  regenerateFlow,
  reorderFlow,
  writeReview,
} from './hubChapterWrites';

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
      setIncludeArchived: setIncludeArchivedState,
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
  const setIncludeArchived = useCallback((value) => setArchivedFilter(state, value), [state]);
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
    (chapterId, fields) => patchChapterFlow(state, chapterId, fields),
    [state]
  );
  const reorder = useCallback((order) => reorderFlow(state, order), [state]);
  const regenerate = useCallback(
    (chapterId, ttsModel) => regenerateFlow(state, chapterId, ttsModel),
    [state]
  );
  const deleteVersion = useCallback(
    (chapterId, versionId) => deleteVersionFlow(state, chapterId, versionId),
    [state]
  );
  const deleteChapter = useCallback(
    (chapterId, options) => deleteChapterFlow(state, chapterId, options),
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
