/**
 * The prompt library (#634).
 *
 * The load is an effect with a cancellation flag that was checked at four
 * points inline, and none of it was tested. The stale-write case below is the
 * reason those checks exist: the page path changes as the operator picks a
 * provider, so a slow earlier request can still answer after a newer one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  NO_SETS_STATUS,
  NO_TARGET_STATUS,
  applyPromptSelection,
  assignedStatus,
  clearPromptLibrary,
  loadPromptLibrary,
  noAssignmentStatus,
  selectPromptName,
  selectPromptSet,
} from './promptStage';

function bag(overrides = {}) {
  return {
    promptLibraryPagePath: '/azure/blog',
    selectedPromptSet: '',
    fetchPageAssignment: vi.fn().mockResolvedValue({}),
    fetchPrompt: vi.fn().mockResolvedValue(null),
    fetchPromptNames: vi.fn().mockResolvedValue([]),
    fetchPromptSet: vi.fn().mockResolvedValue({}),
    fetchPromptSets: vi.fn().mockResolvedValue([]),
    savePageAssignment: vi.fn().mockResolvedValue(undefined),
    setDetailsPrompt: vi.fn(),
    setPromptLibraryError: vi.fn(),
    setPromptLibraryLoading: vi.fn(),
    setPromptLibraryStatus: vi.fn(),
    setPromptNames: vi.fn(),
    setPromptSets: vi.fn(),
    setSelectedPromptName: vi.fn(),
    setSelectedPromptSet: vi.fn(),
    setSelectedSlotTemplates: vi.fn(),
    setSummaryPrompt: vi.fn(),
    ...overrides,
  };
}

const never = () => false;
const always = () => true;

describe('the status lines', () => {
  it('read the same whether loaded or chosen by hand', () => {
    // Each of these was built twice inline, so the two could drift.
    expect(assignedStatus('Set A', 'Prompt 1')).toBe('Assigned: Set A / Prompt 1');
    expect(assignedStatus('Set A', '')).toBe('Assigned: Set A');
    expect(noAssignmentStatus('/azure/blog')).toBe('No Prompt Set assigned to /azure/blog yet.');
  });
});

describe('applyPromptSelection', () => {
  it('clears the prompts when the set is cleared', async () => {
    // Otherwise the previous set's prompts stay behind and get generated from.
    const state = bag();
    await applyPromptSelection(state, '', '');
    expect(state.setSummaryPrompt).toHaveBeenCalledWith('');
    expect(state.setDetailsPrompt).toHaveBeenCalledWith('');
    expect(state.fetchPromptSet).not.toHaveBeenCalled();
  });

  it('fetches only the set when no prompt name is chosen', async () => {
    const state = bag();
    await applyPromptSelection(state, 'Set A', '');
    expect(state.fetchPromptSet).toHaveBeenCalledWith('Set A');
    expect(state.fetchPrompt).not.toHaveBeenCalled();
  });

  it('loads the prompts and slot templates it was given', async () => {
    const state = bag({
      fetchPromptSet: vi.fn().mockResolvedValue({ primaryPrompt: 'summary text' }),
      fetchPrompt: vi.fn().mockResolvedValue({
        additionalParameters: 'details text',
        slotTemplates: { hero: 'wide' },
      }),
    });
    await applyPromptSelection(state, 'Set A', 'Prompt 1');
    expect(state.setSummaryPrompt).toHaveBeenCalledWith('summary text');
    expect(state.setDetailsPrompt).toHaveBeenCalledWith('details text');
    expect(state.setSelectedSlotTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ hero: 'wide' })
    );
  });

  it('fills every slot template, not only the ones returned', async () => {
    const state = bag({
      fetchPromptSet: vi.fn().mockResolvedValue({}),
      fetchPrompt: vi.fn().mockResolvedValue({ slotTemplates: { hero: 'wide' } }),
    });
    await applyPromptSelection(state, 'Set A', 'Prompt 1');
    const [[templates]] = state.setSelectedSlotTemplates.mock.calls;
    expect(Object.keys(templates).sort()).toEqual(
      ['hero', 'secondary1', 'secondary2', 'secondary3'].sort()
    );
  });
});

describe('clearPromptLibrary', () => {
  it('empties everything and says why', () => {
    const state = bag();
    clearPromptLibrary(state, 'because');
    expect(state.setPromptNames).toHaveBeenCalledWith([]);
    expect(state.setSelectedPromptSet).toHaveBeenCalledWith('');
    expect(state.setSelectedPromptName).toHaveBeenCalledWith('');
    expect(state.setPromptLibraryStatus).toHaveBeenCalledWith('because');
  });
});

describe('loadPromptLibrary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks for nothing without a page target', async () => {
    const state = bag({ promptLibraryPagePath: '' });
    await loadPromptLibrary(state, never);
    expect(state.fetchPromptSets).not.toHaveBeenCalled();
    expect(state.setPromptLibraryStatus).toHaveBeenCalledWith(NO_TARGET_STATUS);
    // Not a spinner state: there is nothing to wait for.
    expect(state.setPromptLibraryLoading).not.toHaveBeenCalled();
  });

  it('distinguishes "no sets exist" from "none assigned here"', async () => {
    const none = bag({ fetchPromptSets: vi.fn().mockResolvedValue([]) });
    await loadPromptLibrary(none, never);
    expect(none.setPromptLibraryStatus).toHaveBeenCalledWith(NO_SETS_STATUS);

    const some = bag({ fetchPromptSets: vi.fn().mockResolvedValue(['Set A']) });
    await loadPromptLibrary(some, never);
    expect(some.setPromptLibraryStatus).toHaveBeenCalledWith(noAssignmentStatus('/azure/blog'));
  });

  it('applies an assignment it finds', async () => {
    const state = bag({
      fetchPromptSets: vi.fn().mockResolvedValue(['Set A']),
      fetchPageAssignment: vi.fn().mockResolvedValue({ setName: 'Set A', promptName: 'P1' }),
      fetchPromptNames: vi.fn().mockResolvedValue(['P1', 'P2']),
      fetchPromptSet: vi.fn().mockResolvedValue({ primaryPrompt: 'sp' }),
      fetchPrompt: vi.fn().mockResolvedValue({ additionalParameters: 'dp' }),
    });
    await loadPromptLibrary(state, never);
    expect(state.setSelectedPromptSet).toHaveBeenCalledWith('Set A');
    expect(state.setPromptLibraryStatus).toHaveBeenCalledWith('Assigned: Set A / P1');
    expect(state.setSummaryPrompt).toHaveBeenCalledWith('sp');
  });

  it('trims a padded assignment from the server', async () => {
    const state = bag({
      fetchPageAssignment: vi.fn().mockResolvedValue({ setName: '  Set A  ', promptName: '  P1 ' }),
    });
    await loadPromptLibrary(state, never);
    expect(state.setSelectedPromptSet).toHaveBeenCalledWith('Set A');
  });

  it('writes nothing once cancelled', async () => {
    // The real case: the operator changed provider while this was in flight.
    const state = bag({ fetchPromptSets: vi.fn().mockResolvedValue(['Set A']) });
    await loadPromptLibrary(state, always);
    expect(state.setPromptSets).not.toHaveBeenCalled();
    expect(state.setPromptLibraryStatus).not.toHaveBeenCalled();
    // Including the spinner: the newer load owns it now.
    expect(state.setPromptLibraryLoading).not.toHaveBeenCalledWith(false);
  });

  it('reports a failure, but not a cancelled one', async () => {
    const failing = () => bag({ fetchPromptSets: vi.fn().mockRejectedValue(new Error('down')) });
    const live = failing();
    await loadPromptLibrary(live, never);
    expect(live.setPromptLibraryError).toHaveBeenCalledWith('down');

    const cancelled = failing();
    await loadPromptLibrary(cancelled, always);
    expect(cancelled.setPromptLibraryError).not.toHaveBeenCalledWith('down');
  });

  it('clears the spinner when it finishes uncancelled', async () => {
    const state = bag();
    await loadPromptLibrary(state, never);
    expect(state.setPromptLibraryLoading).toHaveBeenLastCalledWith(false);
  });
});

describe('selectPromptSet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves the assignment immediately, with no separate Save press', async () => {
    const state = bag({ fetchPromptNames: vi.fn().mockResolvedValue(['P1']) });
    await selectPromptSet(state, 'Set A');
    expect(state.savePageAssignment).toHaveBeenCalledWith('/azure/blog', 'Set A', '');
    expect(state.setPromptLibraryStatus).toHaveBeenCalledWith('Assigned: Set A');
  });

  it('persists the empty assignment when the set is cleared', async () => {
    // Clearing has to be saved too, or a reload brings the old set back.
    const state = bag();
    await selectPromptSet(state, '');
    expect(state.savePageAssignment).toHaveBeenCalledWith('/azure/blog', '', '');
    expect(state.setPromptNames).toHaveBeenCalledWith([]);
  });

  it('always clears the chosen prompt name when the set changes', async () => {
    const state = bag({ fetchPromptNames: vi.fn().mockResolvedValue(['P1']) });
    await selectPromptSet(state, 'Set B');
    expect(state.setSelectedPromptName).toHaveBeenCalledWith('');
  });

  it('does nothing beyond the local choice without a page target', async () => {
    const state = bag({ promptLibraryPagePath: '' });
    await selectPromptSet(state, 'Set A');
    expect(state.setSelectedPromptSet).toHaveBeenCalledWith('Set A');
    expect(state.savePageAssignment).not.toHaveBeenCalled();
  });

  it('reports a failure and clears the spinner', async () => {
    const state = bag({ fetchPromptNames: vi.fn().mockRejectedValue(new Error('no set')) });
    await selectPromptSet(state, 'Set A');
    expect(state.setPromptLibraryError).toHaveBeenCalledWith('no set');
    expect(state.setPromptLibraryLoading).toHaveBeenLastCalledWith(false);
  });
});

describe('selectPromptName', () => {
  beforeEach(() => vi.clearAllMocks());

  it('needs a set before a name means anything', async () => {
    const state = bag({ selectedPromptSet: '' });
    await selectPromptName(state, 'P1');
    expect(state.setSelectedPromptName).toHaveBeenCalledWith('P1');
    expect(state.savePageAssignment).not.toHaveBeenCalled();
  });

  it('applies and saves the pair', async () => {
    const state = bag({ selectedPromptSet: 'Set A' });
    await selectPromptName(state, 'P1');
    expect(state.savePageAssignment).toHaveBeenCalledWith('/azure/blog', 'Set A', 'P1');
    expect(state.setPromptLibraryStatus).toHaveBeenCalledWith('Assigned: Set A / P1');
  });

  it('drops back to the set-only status when the name is cleared', async () => {
    const state = bag({ selectedPromptSet: 'Set A' });
    await selectPromptName(state, '');
    expect(state.setPromptLibraryStatus).toHaveBeenCalledWith('Assigned: Set A');
  });

  it('reports a failure and clears the spinner', async () => {
    const state = bag({
      selectedPromptSet: 'Set A',
      fetchPromptSet: vi.fn().mockRejectedValue(new Error('no prompt')),
    });
    await selectPromptName(state, 'P1');
    expect(state.setPromptLibraryError).toHaveBeenCalledWith('no prompt');
    expect(state.setPromptLibraryLoading).toHaveBeenLastCalledWith(false);
  });
});
