/**
 * "Import from docs/content" (POST cms/drafts/import-repo): every article in
 * the repository's docs/content not yet imported becomes a draft, once. The
 * per-file results stay on the page until dismissed; the list reloads.
 */
import { useState } from 'react';
import { postJSON } from '@/lib/api';
import { IMPORT_ROUTE, summarizeImport } from './draftForm';

export function useDraftImport({ list, toast }) {
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);

  const run = async () => {
    setImporting(true);
    try {
      const answer = await postJSON(IMPORT_ROUTE, {});
      setResults(answer.results || []);
      toast(summarizeImport(answer.counts));
      await list.reload();
    } catch (err) {
      toast({ title: 'Import failed', description: err.message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  return { importing, results, run, dismiss: () => setResults(null) };
}
