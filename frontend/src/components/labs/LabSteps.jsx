/**
 * A lab's steps, in order (ADR 0033 §4): each a title, its body (Markdown
 * from the catalogue: prose, inline code and fenced commands) and, on the
 * one step a runner job can check, the hint that says what to submit and
 * what the check does.
 *
 * Markdown is rendered with react-markdown, the renderer the admin editor
 * already uses, with links kept in-site where the catalogue wrote a path and
 * opened in a new tab where it wrote an https address. The body never comes
 * from a visitor, so there is nothing to sanitise beyond what the renderer
 * does by default (no raw HTML).
 */
import React from 'react';
import { Link } from 'react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckCircle2 } from 'lucide-react';

const MUTED = 'text-slate-600 dark:text-slate-400';

/** In-site paths stay in the router; anything else opens in a new tab. */
function MarkdownLink({ href, children }) {
  if (href && href.startsWith('/')) {
    return (
      <Link to={href} className="underline underline-offset-4 hover:text-primary">
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4 hover:text-primary"
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function Code({ className, children }) {
  // react-markdown gives a fenced block a `language-*` class and inline code none.
  if (className) {
    return (
      <code className={`${className} block font-mono text-xs leading-relaxed`}>{children}</code>
    );
  }
  return (
    <code className="rounded bg-slate-200/70 dark:bg-slate-800 px-1 py-px font-mono text-[0.85em] text-slate-900 dark:text-slate-100">
      {children}
    </code>
  );
}

function Pre({ children }) {
  return (
    <pre className="my-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 p-3">
      {children}
    </pre>
  );
}

const COMPONENTS = {
  a: MarkdownLink,
  code: Code,
  pre: Pre,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
};

/**
 * @param {object} props
 * @param {ReadonlyArray<{title: string, body: string, validation?: {jobType: string, hint: string}}>} props.steps
 */
export default function LabSteps({ steps }) {
  return (
    <ol className="flex flex-col gap-4 list-none p-0 m-0" data-testid="lab-steps">
      {steps.map((entry, index) => (
        <li
          key={entry.title}
          className="glass rounded-xl p-5 flex gap-4"
          data-testid="lab-step"
          aria-labelledby={`lab-step-${index + 1}-title`}
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 flex flex-col gap-2">
            <h3
              id={`lab-step-${index + 1}-title`}
              className="text-base font-bold text-slate-950 dark:text-white"
            >
              <span className="sr-only">Step {index + 1}: </span>
              {entry.title}
            </h3>
            <div className="text-sm text-slate-700 dark:text-slate-300">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
                {entry.body}
              </ReactMarkdown>
            </div>
            {entry.validation ? (
              <p
                className={`flex gap-2 rounded-lg border border-emerald-300/60 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 px-3 py-2 text-xs ${MUTED}`}
                data-testid="lab-step-validation"
              >
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
                <span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Checked by the agent
                  </span>{' '}
                  (<span className="font-mono">{entry.validation.jobType}</span>):{' '}
                  {entry.validation.hint}
                </span>
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
