/**
 * What the operator has picked on the Image Gallery (split out of
 * ImageGalleryPage.jsx for PR #841): the ticked tiles, the tile whose details
 * are open, the ids an action is still working on, and the one URL just
 * copied.
 */
import { useCallback, useState } from 'react';
import { toggledSelection } from '@/lib/imageGallery';
import { withIds, withoutIds } from './galleryPageModel';

export default function useGallerySelection() {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [copiedId, setCopiedId] = useState('');
  const [detailsId, setDetailsId] = useState('');

  const toggleSelected = useCallback(
    (id) => setSelectedIds((prev) => toggledSelection(prev, id)),
    []
  );
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const selectAll = useCallback(
    (items) => setSelectedIds(new Set(items.map((item) => item.id))),
    []
  );
  const deselect = useCallback((id) => setSelectedIds((prev) => withoutIds(prev, [id])), []);

  /** Marks `ids` busy for as long as `work` runs, whatever it returns or throws. */
  const withBusy = useCallback(async (ids, work) => {
    setBusyIds((prev) => withIds(prev, ids));
    try {
      await work();
    } finally {
      setBusyIds((prev) => withoutIds(prev, ids));
    }
  }, []);

  return {
    selectedIds,
    toggleSelected,
    clearSelection,
    selectAll,
    deselect,
    busyIds,
    withBusy,
    copiedId,
    setCopiedId,
    detailsId,
    setDetailsId,
  };
}
