/**
 * The prompt-library load effect (PR #841): runs promptStage.
 * loadPromptLibrary for the page path, once per path, and tells a stale run
 * it was cancelled when the path moves on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const loadPromptLibrary = vi.fn();
vi.mock('./promptStage', () => ({
  loadPromptLibrary: (...args) => loadPromptLibrary(...args),
}));

const { usePromptLibraryLoad } = await import('./usePromptLibraryLoad.js');

const SETTERS = [
  'setDetailsPrompt',
  'setPromptLibraryError',
  'setPromptLibraryLoading',
  'setPromptLibraryStatus',
  'setPromptNames',
  'setPromptSets',
  'setSelectedPromptName',
  'setSelectedPromptSet',
  'setSelectedSlotTemplates',
  'setSummaryPrompt',
];
const FETCHERS = [
  'fetchPageAssignment',
  'fetchPrompt',
  'fetchPromptNames',
  'fetchPromptSet',
  'fetchPromptSets',
];

const bag = () => Object.fromEntries([...SETTERS, ...FETCHERS].map((name) => [name, vi.fn()]));

beforeEach(() => {
  loadPromptLibrary.mockReset();
});

describe('usePromptLibraryLoad', () => {
  it('loads once for a page path with the whole bag, and not again on a plain rerender', () => {
    const deps = bag();
    const { rerender } = renderHook(
      ({ path }) => usePromptLibraryLoad({ promptLibraryPagePath: path, ...deps }),
      { initialProps: { path: '/azure/blog' } }
    );
    expect(loadPromptLibrary).toHaveBeenCalledTimes(1);
    const [[passed, isCancelled]] = loadPromptLibrary.mock.calls;
    expect(passed.promptLibraryPagePath).toBe('/azure/blog');
    for (const name of [...SETTERS, ...FETCHERS]) expect(passed[name]).toBe(deps[name]);
    expect(isCancelled()).toBe(false);

    rerender({ path: '/azure/blog' });
    expect(loadPromptLibrary).toHaveBeenCalledTimes(1);
  });

  it('reloads for a new path and cancels the previous run', () => {
    const deps = bag();
    const { rerender } = renderHook(
      ({ path }) => usePromptLibraryLoad({ promptLibraryPagePath: path, ...deps }),
      { initialProps: { path: '/azure/blog' } }
    );
    const [[, firstCancelled]] = loadPromptLibrary.mock.calls;

    rerender({ path: '/aws/blog' });
    expect(loadPromptLibrary).toHaveBeenCalledTimes(2);
    expect(firstCancelled()).toBe(true);
    expect(loadPromptLibrary.mock.calls[1][0].promptLibraryPagePath).toBe('/aws/blog');
    expect(loadPromptLibrary.mock.calls[1][1]()).toBe(false);
  });
});
