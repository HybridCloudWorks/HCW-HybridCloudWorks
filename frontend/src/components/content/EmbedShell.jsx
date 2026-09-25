/**
 * The frame every article embed shares (#613, #670): the `not-prose` block a
 * fence becomes, with a Suspense boundary around a lazily loaded card and a
 * one-line placeholder while the chunk arrives. PricingScenarioEmbed.jsx and
 * LandingZoneEmbed.jsx are each a `React.lazy` plus this; the card is the
 * chunk, and the language constant and the loader stay in the embed file so
 * CodeBlock.jsx and the tests keep importing them from there.
 *
 * At pre-render, `prerenderToNodeStream` resolves the lazy import and the
 * static HTML carries the card, not the placeholder; in the browser, React
 * leaves that boundary as the server sent it until the chunk arrives, then
 * hydrates it against markup the card's first render reproduces exactly.
 */
import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

function Placeholder({ testId, text }) {
  return (
    <p
      className="flex items-center gap-2 rounded-lg border border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400"
      data-testid={testId}
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {text}
    </p>
  );
}

/**
 * @param {object} props
 * @param {string} props.testId  on the wrapping block
 * @param {string} props.placeholderTestId  on the loading line
 * @param {string} props.loadingText  the loading line's words
 * @param {React.ReactNode} props.children  the lazy card
 */
export function EmbedShell({ testId, placeholderTestId, loadingText, children }) {
  return (
    <div className="not-prose my-6" data-testid={testId}>
      <Suspense fallback={<Placeholder testId={placeholderTestId} text={loadingText} />}>
        {children}
      </Suspense>
    </div>
  );
}
