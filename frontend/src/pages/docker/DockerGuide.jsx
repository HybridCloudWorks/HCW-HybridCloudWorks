/**
 * The shape of a Docker hub guide page (#772, #773): the sandboxes page's
 * frame (#774) for a longer piece. A heading and an introduction, numbered
 * sections each under the Learn pages' `SectionHeading`, every command in the
 * labs' `CommandLine` block with its shell named above it, a dated line saying
 * when the facts that move were last checked, and a row of links out.
 *
 * Static on purpose, like the rest of the Docker hub: nothing here reads the
 * content API, so the page pre-renders whole and cannot show an empty state.
 * Each page is a static route in App.jsx and listed in STANDALONE_ROUTES in
 * scripts/prerender-entry.jsx.
 */
import React from 'react';
import { Helmet } from 'react-helmet-async';
import SectionHeading from '@/components/education/SectionHeading';
import CommandLine from '@/components/labs/CommandLine';
import Eyebrow from '@/components/shared/Eyebrow';
import { PlaceholderLink } from './DockerPlaceholderPage';

export const PROSE = 'max-w-3xl text-sm leading-relaxed text-slate-700 dark:text-slate-300';
const MUTED = 'text-slate-600 dark:text-slate-400';

/** Inline code, for a file, a flag or a value named in a sentence. */
export function Code({ children }) {
  return <code className="font-mono text-xs">{children}</code>;
}

/**
 * Commands, in the order given. Each entry is `{ shell, command }`: the shell
 * is printed above the block, and the block holds the command and nothing else.
 */
export function Commands({ commands, testId }) {
  return (
    <div className="flex max-w-3xl flex-col gap-3" data-testid={testId}>
      {commands.map((entry) => (
        <CommandLine
          key={`${entry.shell}:${entry.command}`}
          shell={entry.shell}
          command={entry.command}
        />
      ))}
    </div>
  );
}

/** One section of a guide: an `<h2>` with an id a link can point at, and its body. */
export function GuideSection({ id, title, children }) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="relative flex flex-col gap-4"
      data-guide-section={id}
    >
      <SectionHeading id={headingId} className="mb-0">
        {title}
      </SectionHeading>
      {children}
    </section>
  );
}

/**
 * @param {object} props
 * @param {string} props.pageId - `data-page`, for tests and the audit.
 * @param {string} props.eyebrow
 * @param {string} props.title - The `<h1>`, and the start of the document title.
 * @param {string} props.description - The meta description.
 * @param {string} props.canonical - The page's absolute URL.
 * @param {React.ReactNode} props.intro - The paragraph under the heading.
 * @param {React.ReactNode} props.checked - The dated "last checked" line.
 * @param {Array<{label: string, to?: string, href?: string, external?: boolean}>} props.links
 */
export default function DockerGuide({
  pageId,
  eyebrow,
  title,
  description,
  canonical,
  intro,
  checked,
  links,
  children,
}) {
  return (
    <>
      <Helmet>
        <title>{`${title} | Hybrid Cloud Works`}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonical} />
      </Helmet>

      <main
        data-page={pageId}
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
            {intro}
          </p>
        </div>

        {children}

        <p className={`relative max-w-3xl text-sm ${MUTED}`} data-testid="guide-checked">
          {checked}
        </p>

        <nav aria-label="More on Docker" className="relative flex flex-wrap gap-3">
          {links.map((link) => (
            <PlaceholderLink key={link.label} link={link} />
          ))}
        </nav>
      </main>
    </>
  );
}
