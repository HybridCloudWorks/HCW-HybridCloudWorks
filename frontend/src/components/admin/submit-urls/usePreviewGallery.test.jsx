/**
 * The Stage 3 gallery read (PR #841): once on mount, again when a generation
 * lands, silently on an explicit refresh, and a failure goes to the page's
 * error line rather than throwing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const getJSON = vi.fn();
vi.mock('@/lib/api', () => ({ getJSON: (...args) => getJSON(...args) }));

const { usePreviewGallery } = await import('./usePreviewGallery.js');

beforeEach(() => {
  getJSON.mockReset();
});

describe('usePreviewGallery', () => {
  it('loads the session gallery on mount and again when the generated ids change', async () => {
    getJSON.mockResolvedValue({ generated: [{ id: 'g1' }] });
    const setError = vi.fn();
    const { result, rerender } = renderHook(
      ({ ids }) =>
        usePreviewGallery({ previewSessionId: 'preview-1-ab', generatedImageIds: ids, setError }),
      { initialProps: { ids: {} } }
    );

    await waitFor(() => expect(result.current.galleryItems).toEqual([{ id: 'g1' }]));
    expect(getJSON).toHaveBeenCalledWith('cms/images?articleId=preview-1-ab&limit=24');
    expect(result.current.galleryLoading).toBe(false);

    rerender({ ids: { hero: 'g1' } });
    await waitFor(() => expect(getJSON).toHaveBeenCalledTimes(2));
    expect(setError).not.toHaveBeenCalled();
  });

  it('refreshes silently without entering the loading state', async () => {
    getJSON.mockResolvedValue({ generated: [] });
    // Stable, as the page's useState setter is: a fresh function each render
    // would re-create the loader and re-run its effect every render.
    const setError = vi.fn();
    const ids = {};
    const { result } = renderHook(() =>
      usePreviewGallery({ previewSessionId: 'p', generatedImageIds: ids, setError })
    );
    await waitFor(() => expect(getJSON).toHaveBeenCalledTimes(1));

    let pending;
    act(() => {
      pending = result.current.loadPreviewGalleryItems({ silent: true });
    });
    expect(result.current.galleryRefreshing).toBe(true);
    expect(result.current.galleryLoading).toBe(false);
    await act(() => pending);
    expect(result.current.galleryRefreshing).toBe(false);
  });

  it('reports a failed read through setError and clears both flags', async () => {
    getJSON.mockRejectedValue(new Error('gallery down'));
    const setError = vi.fn();
    const ids = {};
    const { result } = renderHook(() =>
      usePreviewGallery({ previewSessionId: 'p', generatedImageIds: ids, setError })
    );
    await waitFor(() => expect(setError).toHaveBeenCalledWith('gallery down'));
    expect(result.current.galleryLoading).toBe(false);
    expect(result.current.galleryRefreshing).toBe(false);
    expect(result.current.galleryItems).toEqual([]);
  });

  it('asks for nothing without a session id', async () => {
    const setError = vi.fn();
    const { result } = renderHook(() =>
      usePreviewGallery({ previewSessionId: '', generatedImageIds: {}, setError })
    );
    await act(() => result.current.loadPreviewGalleryItems());
    expect(getJSON).not.toHaveBeenCalled();
  });
});
