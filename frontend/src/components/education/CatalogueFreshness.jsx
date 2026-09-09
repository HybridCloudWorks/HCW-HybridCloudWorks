/**
 * Renders "Catalogue checked against <vendor> on <date>" from a data file's
 * `DATA_AS_OF` and `DATA_SOURCE` (#461) — the date a person last verified
 * the catalogue, which is the only freshness claim these hand-maintained
 * pages can truthfully make. Nothing on them refreshes itself, so a page
 * that mounts this should carry no "updated weekly" style copy alongside
 * it. Removing such copy is a hand edit to the page (the Azure page's was
 * dropped in #464; the five pages wired in #465 never had any); this
 * component only renders the line and does not detect or remove them.
 */
import React from 'react';
import { formatCertDate } from '@/lib/certStatus';

export default function CatalogueFreshness({ asOf, source, className = '' }) {
  if (!asOf) return null;
  return (
    <p className={`text-xs text-foreground/50 ${className}`} data-catalogue-as-of={asOf}>
      Catalogue checked against{' '}
      {source?.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          {source.label}
        </a>
      ) : (
        (source?.label ?? 'the vendor')
      )}{' '}
      on <time dateTime={asOf}>{formatCertDate(asOf)}</time>.
    </p>
  );
}
