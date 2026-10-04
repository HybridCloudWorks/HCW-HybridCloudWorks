/**
 * The Image Prompts page's state and handlers, out of the page (PR #841):
 * the library load with its retry, the two derived views, and the toast-
 * and-reload wrapper every write goes through.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  buildSetHandlers,
  filterSets,
  indexPageAssignments,
  usePromptLibrary,
} from './libraryState';

const SETS = [
  {
    name: 'Azure Chibi',
    purpose: 'Covers for Azure posts',
    theme: '',
    primaryPrompt: 'Chibi engineers',
    tags: ['azure'],
    pages: [{ pagePath: '/azure/blog', promptName: 'Hero' }],
  },
  {
    name: 'AWS Lego',
    purpose: '',
    theme: 'bricks',
    primaryPrompt: 'Lego builders',
    tags: [],
    pages: [],
    archivedAt: '2026-09-01T00:00:00Z',
  },
];

describe('indexPageAssignments', () => {
  it('maps every assigned page to its set and prompt', () => {
    expect(indexPageAssignments(SETS)).toEqual({
      '/azure/blog': { setName: 'Azure Chibi', promptName: 'Hero' },
    });
  });
});

describe('filterSets', () => {
  it('hides archived sets unless asked, and matches name, purpose, theme, prompt and tags', () => {
    expect(filterSets(SETS, '', false).map((s) => s.name)).toEqual(['Azure Chibi']);
    expect(filterSets(SETS, '', true).map((s) => s.name)).toEqual(['Azure Chibi', 'AWS Lego']);
    expect(filterSets(SETS, 'bricks', true).map((s) => s.name)).toEqual(['AWS Lego']);
    expect(filterSets(SETS, '  AZURE ', true).map((s) => s.name)).toEqual(['Azure Chibi']);
    expect(filterSets(SETS, 'nothing', true)).toEqual([]);
  });
});

describe('usePromptLibrary', () => {
  it('loads once, reports a failed read, and reloads on refresh', async () => {
    const fetchPromptLibrary = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ sets: [] });
    const { result } = renderHook(() => usePromptLibrary(fetchPromptLibrary));

    await waitFor(() =>
      expect(result.current.loadError).toBe('The prompt library could not be read.')
    );
    expect(result.current.library).toBeNull();

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.library).toEqual({ sets: [] }));
    expect(result.current.loadError).toBe('');
    expect(fetchPromptLibrary).toHaveBeenCalledTimes(2);
  });
});

describe('buildSetHandlers', () => {
  const setup = (apiOverrides = {}) => {
    const api = {
      savePromptSet: vi.fn(async () => true),
      deletePromptSet: vi.fn(async () => true),
      renamePromptSet: vi.fn(async () => false),
      savePageAssignment: vi.fn(async () => true),
      generateSetSample: vi.fn(async () => ({ imageUrl: '/x.png' })),
      ...apiOverrides,
    };
    const ctx = {
      api,
      open: vi.fn(),
      openName: 'Azure Chibi',
      navigate: vi.fn(),
      toast: vi.fn(),
      hookError: 'server said no',
      refresh: vi.fn(),
    };
    return { ...ctx, handlers: buildSetHandlers(ctx) };
  };

  it('toasts success and reloads after a write that succeeds', async () => {
    const { handlers, api, toast, refresh, open } = setup();
    await handlers.onSaveSet('Azure Chibi', { purpose: 'x' });
    expect(api.savePromptSet).toHaveBeenCalledWith('Azure Chibi', { purpose: 'x' });
    expect(toast).toHaveBeenCalledWith({
      title: 'Set saved',
      description: '"Azure Chibi" updated.',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the result of a create, and the grid after a delete', async () => {
    const { handlers, open } = setup();
    await handlers.onCreateSet('New Set', {});
    expect(open).toHaveBeenLastCalledWith('New Set');
    await handlers.onDeleteSet('New Set');
    expect(open).toHaveBeenLastCalledWith('');
  });

  it("shows the hook's error on a refused write and does not reload or navigate", async () => {
    const { handlers, toast, refresh, open } = setup();
    await handlers.onRenameSet('Azure Chibi', 'Azure Toys');
    expect(toast).toHaveBeenCalledWith({
      title: 'Set not renamed',
      description: 'server said no',
      variant: 'destructive',
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('words an assignment and an unassignment differently', async () => {
    const { handlers, toast } = setup();
    await handlers.onAssignPage('/azure/blog', 'Azure Chibi', 'Hero');
    expect(toast.mock.calls.at(-1)[0].description).toBe(
      '/azure/blog now generates with "Azure Chibi" / Hero.'
    );
    await handlers.onAssignPage('/azure/blog', '', '');
    expect(toast.mock.calls.at(-1)[0].title).toBe('Page unassigned');
  });

  it('links to the gallery filtered by set, falling back to the open set for an image', () => {
    const { handlers, navigate } = setup();
    handlers.onOpenGallery('AWS Lego');
    expect(navigate).toHaveBeenLastCalledWith('/admin/image-gallery?set=AWS%20Lego');
    handlers.onOpenImage({ id: 'img1' });
    expect(navigate).toHaveBeenLastCalledWith('/admin/image-gallery?set=Azure%20Chibi&q=img1');
  });
});
