/**
 * Renders "Catalogue checked against <vendor> on <date>" from a data file's
 * `DATA_AS_OF` and `DATA_SOURCE` (#461) — the date a person last verified
 * the catalogue, which is the only freshness claim these hand-maintained
 * pages can truthfully make. Nothing on them refreshes itself, so a page
 * that mounts this should carry no "updated weekly" style copy alongside
 * it. Removing such copy is a hand edit to the page (the Azure page's was
 * dropped in #464; the five pages wired in #465 never had any); this
 * component only renders the line and does not detect or remove them.
 *
 * THE COLOUR IS A TOKEN, NOT A FADED FOREGROUND. `text-foreground/50` read
 * 3.28:1 on the `/education` tiles in light mode (2026-09-29), under the
 * 4.5:1 WCAG AA asks of text this small. `--muted-foreground` is the theme's
 * own secondary-text colour and is kept above 4.5:1 in both themes
 * (index.css says so where it is defined). CatalogueFreshness.test.jsx pins it.
 */
import React from 'react';
import { formatIsoDate } from '@/lib/certStatus';

export const FRESHNESS_TEXT_CLASS = 'text-xs text-muted-foreground';

export default function CatalogueFreshness({ asOf, source, className = '' }) {
  if (!asOf) return null;
  return (
    <p className={`${FRESHNESS_TEXT_CLASS} ${className}`} data-catalogue-as-of={asOf}>
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
      on <time dateTime={asOf}>{formatIsoDate(asOf)}</time>.
    </p>
  );
}
