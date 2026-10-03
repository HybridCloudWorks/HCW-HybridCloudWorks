/**
 * The articles written for a lab, or for all of them (#677, filled in by
 * ADR 0033 "Labs"): each is a published page on this site,
 * `/<provider>/blog/<slug>`, from the catalogue row's `articleSlugs`. An
 * empty list renders nothing, so no page ever holds a heading over a
 * promise.
 */
import React from 'react';
import { Link } from 'react-router';
import { articlePath } from '@/data/labs/catalogue';
import { providerName } from './labsWords';

const MUTED = 'text-slate-600 dark:text-slate-400';

/**
 * @param {object} props
 * @param {ReadonlyArray<{provider: string, slug: string, title: string}>} props.articles
 */
export default function LabArticles({ articles }) {
  if (!articles || articles.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2 list-none p-0 m-0" data-testid="lab-articles">
      {articles.map((entry) => (
        <li key={`${entry.provider}/${entry.slug}`} className="text-sm">
          <Link
            to={articlePath(entry)}
            className="font-semibold text-slate-900 dark:text-slate-100 underline underline-offset-4 hover:text-primary"
          >
            {entry.title}
          </Link>
          <span className={`ml-2 text-xs ${MUTED}`}>{providerName(entry.provider)} blog</span>
        </li>
      ))}
    </ul>
  );
}
