/**
 * The Coder status card (#680 Phase 2, frontend half): templates and
 * capacity from `GET public/labs/coder-status`, which the Function App
 * answers from a read-only Coder token. The browser never calls Coder, so
 * the CSP's `connect-src` stays closed (ADR 0032 §4).
 *
 * Three honest absences, each its own sentence in a visitor's words (owner
 * direction 2026-09-28): the route is not published, Coder is not yet
 * provisioned (`configured: false`), and Coder is unreachable
 * (`reachable: false`, a cached failure). The last one is the important one —
 * the server caches the failed state on purpose so this card says
 * "unavailable" rather than showing numbers from before the outage.
 */
import React from 'react';
import { formatLocalDateTime } from '@/lib/cloudPricing';
import { capacityWords } from './labsWords';
import StatusCard, { MUTED } from './StatusCard';

export const CODER_NOT_PROVISIONED_SENTENCE = "Coder isn't available yet.";
export const CODER_UNREACHABLE_SENTENCE = 'Coder is unavailable right now.';
export const CODER_ROUTE_MISSING_SENTENCE = "Coder's status isn't available right now.";
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
        No lab template is available yet.
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

/** The card's fixed words and ids; the shell renders them around the body. */
const CARD = Object.freeze({
  id: 'coder',
  testId: 'coder-status-card',
  title: 'Coder status',
  intro:
    'Coder is where you sign in with GitHub and open a lab workspace. This card shows whether it is up and how many workspaces are running, at most a minute old; your browser does not contact Coder until you open a workspace.',
  errorText: "Coder's status couldn't be loaded. Please try again later.",
  noticeTestId: 'coder-status',
  notices: NOTICES,
});

/**
 * @param {object} props
 * @param {object|null|undefined} props.status `undefined` while nothing has
 *   arrived, `null` when the route answered 404, otherwise the body.
 * @param {boolean} props.loading
 * @param {Error|null} props.error
 */
export default function CoderStatusCard({ status, loading, error }) {
  return (
    <StatusCard {...CARD} subject={status} loading={loading} error={error}>
      {(body) => <CoderFacts status={body} />}
    </StatusCard>
  );
}
