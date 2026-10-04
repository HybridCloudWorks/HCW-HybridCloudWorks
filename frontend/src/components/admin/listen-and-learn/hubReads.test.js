/**
 * The hub's reads over a fake state bag: the generation guard drops a read
 * that was superseded, a failed read empties the list, and the archived
 * filter re-reads the grid under the new flag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/listenAndLearn', () => ({
  fetchSets: vi.fn(),
  fetchSetForReview: vi.fn(),
  fetchSpeechOptions: vi.fn(),
  fetchSpeechSettings: vi.fn(),
}));

const { fetchSets, fetchSetForReview } = await import('@/lib/listenAndLearn');
const { outcome, readEpisodes, readSets, setArchivedFilter } = await import('./hubReads.js');
const { runSummary } = await import('./hubBookWrites.js');

function fakeState() {
  const names = [
    'setSets',
    'setSetsLoaded',
    'setSelected',
    'setBook',
    'setEpisodes',
    'setLoading',
    'setError',
    'setIncludeArchived',
  ];
  const state = Object.fromEntries(names.map((n) => [n, vi.fn()]));
  state.generation = { current: 0 };
  state.alive = { current: true };
  state.selected = { current: null };
  state.includeArchived = { current: false };
  return state;
}

/** A promise the test settles by hand. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('outcome', () => {
  it('wraps a value and a thrown error without throwing', async () => {
    expect(await outcome(async () => 1)).toEqual({ value: 1 });
    const err = Object.assign(new Error('boom'), { status: 409 });
    expect(await outcome(async () => Promise.reject(err))).toEqual({
      error: 'boom',
      status: 409,
      detail: err,
    });
  });
});

describe('readEpisodes', () => {
  beforeEach(() => {
    fetchSetForReview.mockReset();
  });

  it('paints only the latest read when two overlap', async () => {
    const a = deferred();
    const b = deferred();
    fetchSetForReview.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const state = fakeState();
    const first = readEpisodes(state, 'azure', 'AZ-A');
    const second = readEpisodes(state, 'azure', 'AZ-B');
    b.resolve({ episodes: [{ id: 'b1' }], set: { examCode: 'AZ-B' } });
    await second;
    a.resolve({ episodes: [{ id: 'a1' }], set: { examCode: 'AZ-A' } });
    await first;
    expect(state.setEpisodes).toHaveBeenCalledTimes(1);
    expect(state.setEpisodes).toHaveBeenCalledWith([{ id: 'b1' }]);
    expect(state.setBook).toHaveBeenCalledWith({ examCode: 'AZ-B' });
    expect(state.setLoading).toHaveBeenLastCalledWith(false);
  });

  it('empties the list and the book when the read fails', async () => {
    fetchSetForReview.mockRejectedValueOnce(new Error('503'));
    const state = fakeState();
    await readEpisodes(state, 'aws', 'SAA');
    expect(state.setError).toHaveBeenLastCalledWith('503');
    expect(state.setEpisodes).toHaveBeenCalledWith([]);
    expect(state.setBook).toHaveBeenCalledWith(null);
    expect(state.selected.current).toEqual({ platform: 'aws', examCode: 'SAA' });
  });
});

describe('readSets and setArchivedFilter', () => {
  beforeEach(() => {
    fetchSets.mockReset();
  });

  it('reads the grid under the archived flag and marks it loaded', async () => {
    fetchSets.mockResolvedValueOnce([{ id: 's1' }]);
    const state = fakeState();
    await readSets(state);
    expect(fetchSets).toHaveBeenCalledWith({ archived: false });
    expect(state.setSets).toHaveBeenCalledWith([{ id: 's1' }]);
    expect(state.setSetsLoaded).toHaveBeenCalledWith(true);
  });

  it('paints nothing after the hook has unmounted', async () => {
    fetchSets.mockResolvedValueOnce([]);
    const state = fakeState();
    state.alive.current = false;
    await readSets(state);
    expect(state.setSets).not.toHaveBeenCalled();
    expect(state.setSetsLoaded).not.toHaveBeenCalled();
  });

  it('setArchivedFilter mirrors the flag into the ref and state, then re-reads', async () => {
    fetchSets.mockResolvedValueOnce([{ id: 'archived-1' }]);
    const state = fakeState();
    await setArchivedFilter(state, 'yes');
    expect(state.includeArchived.current).toBe(true);
    expect(state.setIncludeArchived).toHaveBeenCalledWith(true);
    expect(fetchSets).toHaveBeenCalledWith({ archived: true });
    expect(state.setSets).toHaveBeenCalledWith([{ id: 'archived-1' }]);
  });
});

describe('runSummary', () => {
  it('says only the status when the job returned no report', () => {
    expect(runSummary(undefined, 'failed')).toBe('Run failed');
  });

  it('lists what was drafted and what went wrong', () => {
    expect(runSummary({ generated: 4, failed: 1, withoutAudio: 2 }, 'succeeded')).toBe(
      'Done — 4 drafted, 1 failed, 2 without audio'
    );
    expect(runSummary({ generated: 3 }, 'succeeded')).toBe('Done — 3 drafted');
  });
});
