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

export const CODER_NOT_PROVISIONED_SENTENCE = 'Coder is not yet provisioned.';
export const CODER_UNREACHABLE_SENTENCE = 'Coder is unreachable right now.';
export const CODER_ROUTE_MISSING_SENTENCE = 'The Coder status endpoint is not published yet.';
export const CODER_LOADING_SENTENCE = 'Reading Coder status…';

const MUTED = 'text-slate-600 dark:text-slate-400';

export function CoderStatusBody({ status, loading, error }) {
  if (error) {
    return (
      <p role="alert" className="text-sm">
        Coder status could not be read: {error.message}
      </p>
    );
  }
  if (loading && status === undefined) {
    return (
      <p className={`text-sm ${MUTED}`} data-testid="coder-status">
        {CODER_LOADING_SENTENCE}
      </p>
    );
  }
  if (status === null) {
    return (
      <p className={`text-sm ${MUTED}`} data-testid="coder-status">
        {CODER_ROUTE_MISSING_SENTENCE}
      </p>
    );
  }
  if (!status?.configured) {
    return (
      <p className="text-sm text-slate-900 dark:text-slate-100" data-testid="coder-status">
        {CODER_NOT_PROVISIONED_SENTENCE}
      </p>
    );
  }
  if (!status.reachable) {
    return (
      <p className="text-sm text-slate-900 dark:text-slate-100" data-testid="coder-status">
        {CODER_UNREACHABLE_SENTENCE}
        {status.asOf ? ` Last checked ${formatLocalDateTime(status.asOf)}.` : ''}
      </p>
    );
  }

  const templates = Array.isArray(status.templates) ? status.templates : [];
  return (
    <>
      <p className="text-sm text-slate-900 dark:text-slate-100" data-testid="coder-status">
        Coder is reachable: {capacityWords(status.capacity)}.
      </p>
      {templates.length > 0 ? (
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
      ) : (
        <p className={`text-sm ${MUTED}`} data-testid="coder-templates">
          No template is published yet.
        </p>
      )}
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
  return (
    <section
      aria-labelledby="coder-heading"
      className="glass rounded-xl p-6 flex flex-col gap-3"
      data-testid="coder-status-card"
    >
      <h2 id="coder-heading" className="text-xl font-bold text-slate-950 dark:text-white">
        Coder status
      </h2>
      <p className={`text-sm ${MUTED}`}>
        Coder runs on the lab host and is where you sign in with GitHub. This card is served by the
        site&rsquo;s API from a read-only token, so what it shows is at most a minute old and your
        browser never contacts Coder until you open a workspace.
      </p>
      <CoderStatusBody status={status} loading={loading} error={error} />
    </section>
  );
}
