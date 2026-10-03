/**
 * The content taxonomy for a component (ADR 0033 §4): the saved lists, or the
 * defaults while they load or when the read fails, so a picker or a chip
 * always has a label to show. One fetch per session (lib/taxonomy.js caches).
 */
import { useEffect, useState } from 'react';
import { defaultTaxonomy, loadTaxonomy } from '@/lib/taxonomy';

export function useTaxonomy() {
  const [state, setState] = useState(() => ({
    taxonomy: defaultTaxonomy(),
    loading: true,
    error: null,
  }));

  useEffect(() => {
    let cancelled = false;
    loadTaxonomy()
      .then((taxonomy) => {
        if (!cancelled) setState({ taxonomy, loading: false, error: null });
      })
      .catch((err) => {
        // loadTaxonomy already falls back to the defaults; this is the one
        // path left for a thrown non-network error.
        if (!cancelled) {
          setState({
            taxonomy: defaultTaxonomy(),
            loading: false,
            error: err?.message || 'The content taxonomy could not be read; showing the defaults.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
