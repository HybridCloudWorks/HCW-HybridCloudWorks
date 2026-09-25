/**
 * "The Hybrid Lab right now" (#664 Phase 4, frontend half): the public view
 * of the Arc-enrolled lab host, from `GET public/labs/estate`.
 *
 * EVERY STATE IS A SENTENCE. Loading, a failed read, a route that is not
 * published yet, a host that is not provisioned yet, and a live host are five
 * different facts and each gets its own words; nothing is inferred from an
 * absence. In particular `{ configured: false }` renders the exact sentence
 * "The lab host is not provisioned yet." and no field — a card that showed
 * "Unknown" for a status and "—" for a version would be describing a host
 * that does not exist.
 *
 * NOTHING HERE IS PRE-RENDERED WITH DATA. The estate arrives through
 * `usePublicData` in an effect, so the build and the first client render both
 * show the loading sentence. The heartbeat age is measured against the
 * server's `asOf` rather than the viewer's clock, so the render is pure and
 * two viewers reading the same snapshot see the same words.
 */
import React from 'react';
import { formatLocalDateTime } from '@/lib/cloudPricing';
import {
  agentWords,
  arcStatusWord,
  capacityWords,
  heartbeatAgeWords,
  policyWords,
} from './labsWords';

export const NOT_PROVISIONED_SENTENCE = 'The lab host is not provisioned yet.';
export const ESTATE_ROUTE_MISSING_SENTENCE = 'The lab estate endpoint is not published yet.';
export const ESTATE_LOADING_SENTENCE = 'Reading the lab host status…';

const MUTED = 'text-slate-600 dark:text-slate-400';

function Row({ label, value, testId }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className={`text-xs uppercase tracking-wider sm:w-44 sm:shrink-0 ${MUTED}`}>{label}</dt>
      <dd className="text-sm text-slate-900 dark:text-slate-100" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function coderWords(coder) {
  if (!coder || typeof coder.reachable !== 'boolean') return 'not configured';
  if (!coder.reachable) return 'unreachable';
  return `reachable, ${capacityWords(coder)}`;
}

export function EstateBody({ estate, loading, error }) {
  if (error) {
    return (
      <p role="alert" className="text-sm">
        The lab host status could not be read: {error.message}
      </p>
    );
  }
  if (loading && estate === undefined) {
    return (
      <p className={`text-sm ${MUTED}`} data-testid="estate-status">
        {ESTATE_LOADING_SENTENCE}
      </p>
    );
  }
  if (estate === null) {
    return (
      <p className={`text-sm ${MUTED}`} data-testid="estate-status">
        {ESTATE_ROUTE_MISSING_SENTENCE}
      </p>
    );
  }
  if (!estate?.configured) {
    return (
      <p className="text-sm text-slate-900 dark:text-slate-100" data-testid="estate-status">
        {NOT_PROVISIONED_SENTENCE}
      </p>
    );
  }

  const arc = estate.arc ?? {};
  // The heartbeat age is measured from the server's snapshot time, `asOf`,
  // which is data, not a clock: a render that read `Date.now()` would be
  // impure, and the snapshot is what the card is describing anyway — the
  // sentence under the list says when it was taken, and it is at most a
  // minute old. An unparseable `asOf` lets the helper fall back to now.
  const snapshotMs = Date.parse(estate.asOf);
  return (
    <>
      <dl className="flex flex-col gap-2" data-testid="estate-facts">
        <Row label="Azure Arc" value={arcStatusWord(arc.status)} testId="estate-arc-status" />
        <Row
          label="Last heartbeat"
          value={heartbeatAgeWords(arc.lastHeartbeatAt, snapshotMs)}
          testId="estate-heartbeat"
        />
        <Row label="Arc agent" value={arc.agentVersion || 'version unknown'} />
        <Row label="Operating system" value={arc.osName || 'unknown'} />
        <Row label="Policy" value={policyWords(estate.policy)} testId="estate-policy" />
        <Row label="Job runner" value={agentWords(estate.agent)} testId="estate-agent" />
        <Row label="Coder" value={coderWords(estate.coder)} testId="estate-coder" />
      </dl>
      {estate.asOf ? (
        <p className={`mt-3 text-xs ${MUTED}`} data-testid="estate-as-of">
          Read from Azure Resource Graph {formatLocalDateTime(estate.asOf)}; the heartbeat age is
          measured from that moment, and the reading is refreshed about once a minute.
        </p>
      ) : null}
    </>
  );
}

/**
 * @param {object} props
 * @param {object|null|undefined} props.estate `undefined` while nothing has
 *   arrived, `null` when the route answered 404, otherwise the body.
 * @param {boolean} props.loading
 * @param {Error|null} props.error
 */
export default function LabsEstateCard({ estate, loading, error }) {
  return (
    <section
      aria-labelledby="estate-heading"
      className="glass rounded-xl p-6 flex flex-col gap-3"
      data-testid="labs-estate-card"
    >
      <h2 id="estate-heading" className="text-xl font-bold text-slate-950 dark:text-white">
        The Hybrid Lab right now
      </h2>
      <p className={`text-sm ${MUTED}`}>
        The lab host is a Hostinger VPS onboarded to Azure Arc, so it appears in the same tenant as
        the production estate. The Function App reads its Arc row and policy compliance from Azure
        Resource Graph with its managed identity; the browser never talks to Azure.
      </p>
      <EstateBody estate={estate} loading={loading} error={error} />
    </section>
  );
}
