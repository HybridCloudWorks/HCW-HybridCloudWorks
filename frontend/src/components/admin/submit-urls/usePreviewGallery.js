/**
 * The Stage 3 gallery: every image saved against this builder session's
 * preview id, newest first, re-read whenever a generation lands. Out of
 * SubmitUrlsPage.jsx so the page is a composition root (PR #841).
 *
 * `silent` refreshes behind the existing grid (the small spinner) instead of
 * replacing it with the loading state.
 */
import { useCallback, useEffect, useState } from 'react';
import { getJSON } from '@/lib/api';

export function usePreviewGallery({ previewSessionId, generatedImageIds, setError }) {
  const [galleryItems, setGalleryItems] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryRefreshing, setGalleryRefreshing] = useState(false);

  const loadPreviewGalleryItems = useCallback(
    async ({ silent = false } = {}) => {
      if (!previewSessionId) return;
      if (silent) {
        setGalleryRefreshing(true);
      } else {
        setGalleryLoading(true);
      }

      try {
        const res = await getJSON(
          `cms/images?articleId=${encodeURIComponent(previewSessionId)}&limit=24`
        );
        // Server returns each gallery newest-first already.
        setGalleryItems(res.generated || []);
      } catch (err) {
        setError(err.message || 'Failed to load saved gallery images.');
      } finally {
        setGalleryLoading(false);
        setGalleryRefreshing(false);
      }
    },
    [previewSessionId, setError]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPreviewGalleryItems();
  }, [loadPreviewGalleryItems, generatedImageIds]);

  return {
    galleryItems,
    setGalleryItems,
    galleryLoading,
    galleryRefreshing,
    loadPreviewGalleryItems,
  };
}
