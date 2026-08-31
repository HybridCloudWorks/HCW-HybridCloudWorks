/**
 * Renders admin-authored prose that may be HTML *or* markdown.
 *
 * The architecture and framework overviews were HTML-only —
 * `dangerouslySetInnerHTML` over a sanitizer pass — which is correct for the
 * `overviewHtml` field they were written for. But both publish contracts also
 * accept the blog body fields, and those hold **markdown**: pushing markdown
 * through innerHTML renders `## Heading` as literal text rather than a heading.
 *
 * So the fallback that lets a contract's declared body actually reach a reader
 * needs to know which of the two it is holding. Same heuristic
 * `BlogDetailTemplate` already used inline, extracted so there is one definition.
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { markdownCodeComponents } from '@/components/shared/CodeBlock';

/**
 * Block-level tags are the signal. An inline `<em>` inside otherwise-markdown
 * prose is common and must not flip the whole body to the HTML path.
 */
export function looksLikeHtml(value = '') {
  return /<\s*(p|div|span|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|section|article|blockquote)\b[^>]*>/i.test(
    String(value)
  );
}

export default function RichTextBody({ value, className }) {
  const text = String(value || '').trim();
  if (!text) return null;

  if (looksLikeHtml(text)) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }} />;
  }

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownCodeComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
