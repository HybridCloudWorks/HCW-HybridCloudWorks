/**
 * Shared article typography classes. BlogDetailTemplate renders published
 * articles with these; PreviewPanel uses the same constants so the editor
 * preview matches the published page instead of approximating it.
 */

export const ARTICLE_PROSE_CLASS =
  'prose dark:prose-invert prose-lg max-w-none ' +
  'prose-headings:text-slate-900 dark:prose-headings:text-white prose-headings:font-bold prose-headings:scroll-mt-28 ' +
  'prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl ' +
  'prose-h2:border-b prose-h2:border-slate-300 dark:prose-h2:border-slate-700 prose-h2:pb-2 ' +
  '!prose-p:text-slate-900 dark:prose-p:text-slate-300 prose-p:leading-[1.8] ' +
  'prose-a:text-primary prose-a:no-underline hover:prose-a:underline ' +
  'prose-strong:text-slate-900 dark:prose-strong:text-white ' +
  'prose-em:text-slate-700 dark:prose-em:text-slate-200 ' +
  'prose-code:bg-slate-100 dark:prose-code:bg-slate-800 prose-code:text-emerald-700 dark:prose-code:text-emerald-300 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none ' +
  'prose-pre:bg-slate-100 dark:prose-pre:bg-slate-900 prose-pre:border prose-pre:border-slate-300 dark:prose-pre:border-slate-700 prose-pre:rounded-xl ' +
  'prose-blockquote:border-l-4 prose-blockquote:border-primary/60 !prose-blockquote:text-slate-900 dark:prose-blockquote:text-slate-300 prose-blockquote:bg-slate-100/80 dark:prose-blockquote:bg-card/30 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-blockquote:not-italic ' +
  '!prose-li:text-slate-900 dark:prose-li:text-slate-300 prose-li:leading-relaxed ' +
  'prose-ul:my-4 prose-ol:my-4 ' +
  'prose-table:text-sm prose-thead:text-slate-900 dark:prose-thead:text-white prose-th:border prose-th:border-slate-300 dark:prose-th:border-slate-700 prose-td:border prose-td:border-slate-300 dark:prose-td:border-slate-700';

export const HEADING_PROSE_CLASS =
  'prose dark:prose-invert prose-lg max-w-none ' +
  'prose-headings:text-slate-900 dark:prose-headings:text-white prose-headings:font-bold prose-headings:scroll-mt-28 ' +
  'prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl ' +
  'prose-h2:border-b prose-h2:border-slate-300 dark:prose-h2:border-slate-700 prose-h2:pb-2';
