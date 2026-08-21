/**
 * The Coder Corner fields the reader never saw.
 *
 * §2.5 of the public-pages handoff asked whether a snippet deserves its own
 * detail template. It does not — `blogDraft`, headings, tags and share controls
 * are the same job for all four sections `BlogDetailTemplate` serves. What it
 * does need is the presentation for the fields that are specific to a snippet,
 * composed in rather than a fourth full template.
 *
 * The gap was concrete rather than aesthetic: the coder_corner publish contract
 * *requires* `codeSnippet` and `language` before a snippet can go live, and
 * nothing on the public page rendered either. A submission made through
 * `CoderCornerSubmissionPage` happened to survive that, because it fences the
 * snippet into the body markdown itself — but the AI template fill writes the
 * fields and no fence, so an AI-filled snippet published with its code invisible.
 *
 * `repoUrl` was the same story with no redeeming path: collected by the
 * submission form, mapped by `useCoderCornerData`, rendered by nobody.
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { markdownCodeComponents } from '@/components/shared/CodeBlock';

/**
 * The body already showing a fenced block is the signal that the snippet is in
 * the prose — rendering the field too would show the same code twice.
 */
export function bodyHasCodeFence(body = '') {
  return /^\s{0,3}```/m.test(String(body));
}

export default function CoderCornerSnippet({ codeSnippet, language, repoUrl, body = '' }) {
  const showCode = Boolean(String(codeSnippet || '').trim()) && !bodyHasCodeFence(body);
  const showRepo = Boolean(String(repoUrl || '').trim());

  if (!showCode && !showRepo) return null;

  const fence = [
    `\`\`\`${String(language || '').trim()}`,
    String(codeSnippet || '').trim(),
    '```',
  ].join('\n');

  return (
    <section className="mb-12" aria-label="Snippet">
      {showCode && (
        <>
          <h2 className="text-xl font-bold mb-3 flex items-center gap-2 text-slate-900 dark:text-white">
            <span className="material-symbols-outlined text-primary text-[22px]" aria-hidden="true">
              code
            </span>
            The snippet
            {language && (
              <span className="ml-1 px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-[11px] font-semibold uppercase tracking-wider">
                {language}
              </span>
            )}
          </h2>
          <ReactMarkdown components={markdownCodeComponents}>{fence}</ReactMarkdown>
        </>
      )}

      {showRepo && (
        <a
          href={repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-card/80 bg-card/50 text-sm font-semibold text-slate-800 dark:text-slate-200 hover:border-primary/50 hover:text-primary transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            open_in_new
          </span>
          View the source repository
        </a>
      )}
    </section>
  );
}
