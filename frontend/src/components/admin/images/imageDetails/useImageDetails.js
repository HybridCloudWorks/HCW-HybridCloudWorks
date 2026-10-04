/**
 * The state behind ImageDetailsDialog (ADR 0033): the form, the usage lookup
 * that runs when the dialog opens, and the reset when a different image is
 * opened in the same dialog.
 */
import { useEffect, useState } from 'react';
import { fetchImageUsage } from '@/lib/imageGallery';
import { fieldsFrom } from './imageDetailsFields';

export function useImageDetails(item) {
  const [fields, setFields] = useState(() => fieldsFrom(item));
  const [usage, setUsage] = useState(null);
  const [usageError, setUsageError] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [itemId, setItemId] = useState(item?.id);
  if (item?.id !== itemId) {
    // A different image opened in the same dialog: reset the form to it.
    setItemId(item?.id);
    setFields(fieldsFrom(item));
    setUsage(null);
    setUsageError('');
  }

  useEffect(() => {
    if (!item?.id) return undefined;
    let cancelled = false;
    fetchImageUsage(item)
      .then((res) => {
        if (!cancelled) setUsage(res);
      })
      .catch((err) => {
        if (!cancelled) setUsageError(err?.message || 'Could not read where this image is used.');
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  const setField = (key) => (e) => setFields((prev) => ({ ...prev, [key]: e.target.value }));
  const usedBy = usage?.usedBy ?? item?.usedBy ?? [];
  const variants = usage?.variants ?? [];

  return {
    fields,
    setField,
    usage,
    usageError,
    usedBy,
    variants,
    showPrompt,
    togglePrompt: () => setShowPrompt((prev) => !prev),
  };
}
