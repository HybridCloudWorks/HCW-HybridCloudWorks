import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router';
import Eyebrow from '@/components/shared/Eyebrow';

/**
 * The shape every Docker sub-page takes until its content is written
 * (owner request 2026-09-28): what the page will hold, a plain "Coming soon",
 * and links to what a visitor can already use.
 *
 * Static on purpose. None of these pages reads the content API, so none can
 * render an empty list or an error state that looks like missing data; the
 * page says what it is. When a page gets real content it stops using this.
 *
 * Not a `<header>` for the intro: the site styles `header` as its chrome.
 */

/** The same pill on every placeholder, so "coming soon" reads the same way everywhere. */
export function ComingSoon({ className = '' }) {
  return (
    <p
      className={`!mb-0 inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary dark:text-(--slate-blue) ${className}`}
    >
      <span className="material-symbols-outlined text-sm" aria-hidden="true">
        construction
      </span>
      Coming soon
    </p>
  );
}

/**
 * A link out of a placeholder: a route on this site (`to`), a plain document
 * link on this site (`href`, for a `#section` the browser should scroll to on
 * load), or another site (`href` with `external`).
 */
export function PlaceholderLink({ link }) {
  const className =
    'inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-100 dark:hover:border-slate-400 dark:hover:bg-slate-800';
  const icon = link.external ? 'open_in_new' : 'arrow_forward';
  const content = (
    <>
      {link.label}
      <span className="material-symbols-outlined text-sm" aria-hidden="true">
        {icon}
      </span>
    </>
  );
  if (link.to) {
    return (
      <Link to={link.to} className={className}>
        {content}
      </Link>
    );
  }
  if (link.external) {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${link.label} (opens in a new tab)`}
        className={className}
      >
        {content}
      </a>
    );
  }
  return (
    <a href={link.href} className={className}>
      {content}
    </a>
  );
}

/**
 * @param {object} props
 * @param {string} props.eyebrow - Uppercase label above the heading.
 * @param {string} props.title - The page heading, and the start of its document title.
 * @param {string} props.description - One or two sentences on what the page will be.
 * @param {string[]} props.plans - What the page will cover, one line each.
 * @param {Array<{label: string, to?: string, href?: string, external?: boolean}>} props.links
 */
export default function DockerPlaceholderPage({ eyebrow, title, description, plans, links }) {
  return (
    <>
      <Helmet>
        <title>{`${title} | Hybrid Cloud Works`}</title>
        <meta name="description" content={description} />
      </Helmet>

      <main
        data-page="docker-placeholder"
        className="relative z-10 mx-auto flex w-full max-w-[1100px] flex-col gap-10 px-4 py-12 text-foreground md:px-8"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-[40vh] ambient-glow" />
        </div>

        <div className="relative flex flex-col gap-5">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="display-heading text-4xl text-slate-900 dark:text-white sm:text-5xl">
            {title}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-slate-700 dark:text-(--subtitle-gray) sm:text-lg">
            {description}
          </p>
          <ComingSoon />
        </div>

        <section
          aria-labelledby="docker-plans-heading"
          className="glass-panel relative rounded-2xl p-6 md:p-8"
        >
          <h2
            id="docker-plans-heading"
            className="text-lg font-semibold text-slate-900 dark:text-white"
          >
            What this page will cover
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {plans.map((plan) => (
              <li key={plan}>{plan}</li>
            ))}
          </ul>
        </section>

        <nav aria-label="Docker pages you can use now" className="relative flex flex-wrap gap-3">
          {links.map((link) => (
            <PlaceholderLink key={link.label} link={link} />
          ))}
        </nav>
      </main>
    </>
  );
}
