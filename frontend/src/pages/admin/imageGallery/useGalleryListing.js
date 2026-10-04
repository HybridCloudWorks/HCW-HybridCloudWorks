/**
 * The Image Gallery's listing state (split out of ImageGalleryPage.jsx for
 * PR #841): the filters, the debounced search, the one read per (filters,
 * generation) against GET cms/images, the persisted folders, and the filter
 * options derived from what came back.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  asListing,
  fetchGalleryFolders,
  folderOptions,
  queryGalleryImages,
} from '@/lib/imageGallery';
import {
  EMPTY_LISTING,
  filtersFromSearch,
  providerValuesFrom,
  slotValuesFrom,
  tagValuesFrom,
} from './galleryPageModel';

/**
 * The listing read as a settled outcome, never a throw: what came back, or
 * the empty listing and the reason. asListing again here: idempotent on the
 * envelope, and it means a caller (or a test) handing back a bare array still
 * renders.
 */
async function settledListing(params) {
  try {
    return { listing: asListing(await queryGalleryImages(params)), error: '' };
  } catch (err) {
    return { listing: EMPTY_LISTING, error: err?.message || 'The gallery could not be read.' };
  }
}

export default function useGalleryListing(search) {
  const [filters, setFilters] = useState(() => filtersFromSearch(search));
  const [debouncedQ, setDebouncedQ] = useState(() => filtersFromSearch(search).q);
  const [listing, setListing] = useState(EMPTY_LISTING);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [persistedFolders, setPersistedFolders] = useState([]);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(filters.q), 250);
    return () => clearTimeout(timer);
  }, [filters.q]);

  const queryParams = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ]);

  // One read per (filters, generation); a slower older answer never paints
  // over a newer one because the cleanup marks it stale.
  const readListing = useCallback(async (params, isStale) => {
    setLoading(true);
    const outcome = await settledListing(params);
    if (isStale()) return;
    setListing(outcome.listing);
    setError(outcome.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The read marks itself pending; that is the one state write an effect
    // that starts a fetch has to make.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    readListing(queryParams, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [queryParams, generation, readListing]);

  useEffect(() => {
    let cancelled = false;
    fetchGalleryFolders()
      .then((folders) => {
        if (!cancelled) setPersistedFolders(folders);
      })
      .catch(() => {
        // Folders fall back to the seeds plus whatever the items use.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(() => setGeneration((g) => g + 1), []);
  const { items, facets } = listing;
  const folders = useMemo(() => folderOptions(items, persistedFolders), [items, persistedFolders]);
  const providerValues = useMemo(() => providerValuesFrom(facets, items), [facets, items]);
  const slotValues = useMemo(() => slotValuesFrom(facets, items), [facets, items]);
  const tagValues = useMemo(() => tagValuesFrom(facets, items), [facets, items]);

  return {
    filters,
    setFilters,
    items,
    facets,
    total: listing.total,
    hasMore: listing.hasMore,
    loading,
    error,
    setError,
    refresh,
    folders,
    providerValues,
    slotValues,
    tagValues,
    setPersistedFolders,
  };
}
