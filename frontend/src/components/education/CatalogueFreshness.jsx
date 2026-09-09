/**
 * The one honest freshness claim a Learn page can make: the date the
 * catalogue was last checked against the vendor, read from the data file's
 * `DATA_AS_OF` (#461). Nothing on these pages refreshes itself, so this
 * replaces every "updated weekly" style line rather than joining them.
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
