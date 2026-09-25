/**
 * The shell both status cards on `/education/labs` share (#681): a headed
 * section with an intro sentence, and a body that is exactly one of three
 * things — the server's error sentence, a notice for a state with nothing to
 * enumerate (loading, route not published, not provisioned, unreachable), or
 * the card's own facts. A card supplies its notices as an ordered table of
 * `{ when, text, muted }` rows, read top to bottom by `firstNotice`, and its
 * facts as a render function of the subject; this component decides which of
 * the three applies. That keeps each card's decision in one ordered list
 * rather than a ladder of early returns, and keeps the two cards from
 * carrying the same shell twice.
 */
import React from 'react';

export const MUTED = 'text-slate-600 dark:text-slate-400';
const PLAIN = 'text-slate-900 dark:text-slate-100';

/**
 * The first notice whose `when(...args)` holds, as `{ text, muted }`, or null
 * when none does — which is the cue to render the facts.
 * @param {ReadonlyArray<{when: Function, text: Function, muted?: boolean}>} notices
 */
export function firstNotice(notices, ...args) {
  const hit = notices.find(({ when }) => when(...args));
  return hit ? { text: hit.text(...args), muted: Boolean(hit.muted) } : null;
}

function StatusBody({ error, errorPrefix, notice, noticeTestId, children }) {
  if (error) {
    return (
      <p role="alert" className="text-sm">
        {errorPrefix}: {error.message}
      </p>
    );
  }
  if (notice) {
    return (
      <p className={`text-sm ${notice.muted ? MUTED : PLAIN}`} data-testid={noticeTestId}>
        {notice.text}
      </p>
    );
  }
  return children;
}

/**
 * @param {object} props
 * @param {string} props.id prefix for the heading id (`<id>-heading`)
 * @param {string} props.testId the section's data-testid
 * @param {string} props.title
 * @param {React.ReactNode} props.intro one or two sentences under the title
 * @param {string} props.errorPrefix the words before the server's sentence
 * @param {string} props.noticeTestId data-testid the notice paragraph carries
 * @param {ReadonlyArray<object>} props.notices the card's `{ when, text, muted }` rows
 * @param {unknown} props.subject the fetched body: `undefined` while nothing
 *   has arrived, `null` when the route answered 404, otherwise the object
 * @param {boolean} props.loading
 * @param {Error|null} props.error
 * @param {(subject: object) => React.ReactNode} props.children the facts,
 *   called only when there is no error and no notice
 */
export default function StatusCard({
  id,
  testId,
  title,
  intro,
  errorPrefix,
  noticeTestId,
  notices,
  subject,
  loading,
  error,
  children,
}) {
  const notice = firstNotice(notices, subject, loading);
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="glass rounded-xl p-6 flex flex-col gap-3"
      data-testid={testId}
    >
      <h2 id={`${id}-heading`} className="text-xl font-bold text-slate-950 dark:text-white">
        {title}
      </h2>
      <p className={`text-sm ${MUTED}`}>{intro}</p>
      <StatusBody
        error={error}
        errorPrefix={errorPrefix}
        notice={notice}
        noticeTestId={noticeTestId}
      >
        {error || notice ? null : children(subject)}
      </StatusBody>
    </section>
  );
}
