/**
 * The "Explain this …" control the anonymous explain route is asked through
 * (#613 for the pricing comparison, #670 for a landing zone component): one
 * button, one request, one answer panel labelled as generated, one failure
 * panel, and the rule that ties them together. The two callers differ only in
 * what they send and what the words are — scenario/ExplainButton.jsx and
 * landingZone/LzExplainButton.jsx each build a body and pass their labels.
 *
 * ONLY ON A CLICK. Nothing here fetches on mount or on a body change: an
 * explanation costs a model call and counts against the reader's five an
 * hour, shared across kinds, so it is asked for, never assumed. The answer is
 * keyed to the exact body it explained — change the body and the panel goes
 * away rather than describing something no longer on the page — and that key
 * is compared during render, so there is no effect and no setState in one.
 *
 * FAILURES IN WORDS. 429 says to try again in a while and 503 shows the
 * server's own sentence (the kind's toggle off, no provider, or paused for
 * the day); neither offers a retry, because retrying would not help. Any
 * other failure names its message and offers Retry.
 */
import React, { useState } from 'react';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatLocalDateTime } from '@/lib/cloudPricing';

const paragraphs = (text) =>
  String(text)
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * @param {object} props
 * @param {{ text: string, model: string, generatedAt: string, cached: boolean }} props.explanation
 * @param {string} props.generatedLabel  the line above the text that says it is generated
 * @param {string} props.cachedNote  appended to the model line when the answer was cached
 * @param {string} props.testId
 */
export function Explanation({ explanation, generatedLabel, cachedNote, testId }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-900"
      data-testid={testId}
      data-cached={explanation.cached ? 'true' : undefined}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400">
        {generatedLabel}
      </p>
      {paragraphs(explanation.text).map((paragraph, index) => (
        <p key={index} className="text-slate-800 dark:text-slate-200">
          {paragraph}
        </p>
      ))}
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {explanation.model} · {formatLocalDateTime(explanation.generatedAt)}
        {explanation.cached ? ` · ${cachedNote}` : ''}
      </p>
    </div>
  );
}

/**
 * @param {object} props
 * @param {Error & { status?: number }} props.error
 * @param {() => void} props.onRetry
 */
export function Failure({ error, onRetry }) {
  let text;
  if (error.status === 429)
    text = 'Explanations are limited to a few an hour. Try again in a while.';
  else if (error.status === 503) text = error.message;
  else text = `The explanation could not be generated: ${error.message}`;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
      data-status={error.status ?? 'error'}
    >
      <p className="min-w-0 flex-1 break-words">{text}</p>
      {error.status === 429 || error.status === 503 ? null : (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.body  the request body; its JSON is the key the answer is held under
 * @param {(body: object) => Promise<object>} props.request  the publicApi call for this kind
 * @param {{ idle: string, busy: string, generated: string, cached: string }} props.labels
 *   the button's text at rest and while loading, the generated-by line, and the cached note
 * @param {string} props.title  the button's tooltip
 * @param {boolean} [props.disabled]  when there is nothing to explain yet
 * @param {{ button: string, panel: string }} props.testIds
 */
export function ExplainControl({ body, request, labels, title, disabled = false, testIds }) {
  const key = JSON.stringify(body);
  // One record: which body it is about, and where the request got to.
  const [record, setRecord] = useState(null);
  const current = record?.key === key ? record : null;
  const loading = current?.status === 'loading';

  const ask = () => {
    setRecord({ key, status: 'loading' });
    request(body).then(
      (explanation) =>
        setRecord((prev) => (prev?.key === key ? { key, status: 'done', explanation } : prev)),
      (error) => setRecord((prev) => (prev?.key === key ? { key, status: 'error', error } : prev))
    );
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={ask}
        disabled={disabled || loading}
        title={title}
        data-testid={testIds.button}
      >
        {loading ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
        )}
        {loading ? labels.busy : labels.idle}
      </Button>
      {current?.status === 'done' ? (
        <div className="basis-full">
          <Explanation
            explanation={current.explanation}
            generatedLabel={labels.generated}
            cachedNote={labels.cached}
            testId={testIds.panel}
          />
        </div>
      ) : null}
      {current?.status === 'error' ? (
        <div className="basis-full">
          <Failure error={current.error} onRetry={ask} />
        </div>
      ) : null}
    </>
  );
}
