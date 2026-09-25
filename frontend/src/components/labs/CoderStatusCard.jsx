/**
 * The Coder status card (#680 Phase 2, frontend half): templates and
 * capacity from `GET public/labs/coder-status`, which the Function App
 * answers from a read-only Coder token. The browser never calls Coder, so
 * the CSP's `connect-src` stays closed (ADR 0032 §4).
 *
 * Three honest absences, each its own sentence: the route is not published,
 * Coder is not yet provisioned (`configured: false`), and Coder is
 * unreachable (`reachable: false`, a cached failure). The last one is the
 * important one — the server caches the failed state on purpose so this card
 * says "unreachable" rather than showing numbers from before the outage.
 */
import React from 'react';
import { formatLocalDateTime } from '@/lib/cloudPricing';
import { capacityWords } from './labsWords';
import StatusCard, { MUTED, firstNotice } from './StatusCard';

export const CODER_NOT_PROVISIONED_SENTENCE = 'Coder is not yet provisioned.';
export const CODER_UNREACHABLE_SENTENCE = 'Coder is unreachable right now.';
export const CODER_ROUTE_MISSING_SENTENCE = 'The Coder status endpoint is not published yet.';
export const CODER_LOADING_SENTENCE = 'Reading Coder status…';

/** " Last checked 25 Sept 2026, 12:00." or nothing, for the unreachable line. */
function lastChecked(asOf) {
  return asOf ? ` Last checked ${formatLocalDateTime(asOf)}.` : '';
}

/**
 * The states with nothing to enumerate, first match wins. `status` is
 * `undefined` while nothing has arrived, `null` when the route answered 404,
 * otherwise the body; the rows are ordered so each may assume the ones above
 * it did not match.
 */
const NOTICES = Object.freeze([
  {
    when: (status, loading) => loading && status === undefined,
    text: () => CODER_LOADING_SENTENCE,
    muted: true,
  },
  { when: (status) => status === null, text: () => CODER_ROUTE_MISSING_SENTENCE, muted: true },
  { when: (status) => !status?.configured, text: () => CODER_NOT_PROVISIONED_SENTENCE },
  {
    when: (status) => !status.reachable,
    text: (status) => `${CODER_UNREACHABLE_SENTENCE}${lastChecked(status.asOf)}`,
  },
]);

function TemplateList({ templates }) {
  if (templates.length === 0) {
    return (
      <p className={`text-sm ${MUTED}`} data-testid="coder-templates">
        No template is published yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1" data-testid="coder-templates">
      {templates.map((template) => (
        <li key={template.name} className="text-sm flex items-baseline gap-2">
          <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
            {template.name}
          </span>
          <span className={MUTED}>active version {template.activeVersion || 'unknown'}</span>
        </li>
      ))}
    </ul>
  );
}

/** The healthy state: reachable, with templates and capacity. */
function CoderFacts({ status }) {
  return (
    <>
      <p className="text-sm text-slate-900 dark:text-slate-100" data-testid="coder-status">
        Coder is reachable: {capacityWords(status.capacity)}.
      </p>
      <TemplateList templates={Array.isArray(status.templates) ? status.templates : []} />
      {status.asOf ? (
        <p className={`text-xs ${MUTED}`} data-testid="coder-as-of">
          As of {formatLocalDateTime(status.asOf)}; refreshed about once a minute.
        </p>
      ) : null}
    </>
  );
}

/**
 * @param {object} props
 * @param {object|null|undefined} props.status `undefined` while nothing has
 *   arrived, `null` when the route answered 404, otherwise the body.
 * @param {boolean} props.loading
 * @param {Error|null} props.error
 */
export default function CoderStatusCard({ status, loading, error }) {
  const notice = firstNotice(NOTICES, status, loading);
  return (
    <StatusCard
      id="coder"
      testId="coder-status-card"
      title="Coder status"
      intro="Coder runs on the lab host and is where you sign in with GitHub. This card is served by the site’s API from a read-only token, so what it shows is at most a minute old and your browser never contacts Coder until you open a workspace."
      error={error}
      errorPrefix="Coder status could not be read"
      notice={notice}
      noticeTestId="coder-status"
    >
      {notice ? null : <CoderFacts status={status} />}
    </StatusCard>
  );
}
