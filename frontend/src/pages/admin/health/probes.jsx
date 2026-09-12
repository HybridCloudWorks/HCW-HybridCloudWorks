/**
 * What can be verified right now — checks that need someone to press a button.
 *
 * The other half of the Health page reads what the estate has already written
 * down. Nothing here exists until it is asked for: these run in the signed-in
 * admin's session, with the admin's own token, and answer questions no timer
 * can answer on its own.
 *
 * Three kinds live here, and they are the same kind underneath:
 *
 * - **Pipeline smoke tests** — fetch RSS, inspect a batch, build the digest.
 *   Moved off the old Ops Health page, where they sat among live metrics and
 *   read as status rather than as actions. They are on-demand checks that
 *   write real data, which is exactly what the rest of this file is.
 * - **Identity** — does this session's token carry the audience and the App
 *   Role the API enforces, and does the admin registry agree it is this
 *   principal? Done here instead of by copying a bearer token out of developer
 *   tools and decoding it by hand.
 * - **The Labs no-op probe** — submit one job the way the Labs console does,
 *   read it back, cancel it, with and without an Authorization header.
 *
 * These checks were built to answer two specific tickets, which they did; both
 * closed on 2026-09-07 on the evidence of their first run. The checks are
 * repeatable and the questions recur, so they stay — but a tool that outlives
 * the ticket it was built for should stop quoting the ticket, and this one no
 * longer does.
 *
 * ## What this never shows
 *
 * The token, `sub`, `oid`, `email`, `name`, `preferred_username` — any claim
 * that identifies the person. The token is acquired the same way every API
 * call acquires it (lib/entraAuth acquireApiToken), decoded in a local
 * variable, reduced to claim NAMES plus the handful of values the checks are
 * about (`aud`, `roles`, `exp`, `tid`), and dropped. Only that summary reaches
 * React state, the DOM, or the clipboard. The registry comparison — does the
 * `uid` the API names equal the token's `oid` — is a boolean computed here and
 * rendered as a boolean.
 *
 * ## What "expected" means
 *
 * The values the token is compared against come from `getAuthExpectations`,
 * which returns the audience and tenant the API's verifier is configured with
 * and the App Role value its guard looks for. Comparing against a constant
 * built into the frontend would only prove the frontend agrees with itself. If
 * that route refuses the token, the comparison is reported as unknown and the
 * refusal itself is shown — which is the audience-drift signal these checks
 * exist to catch.
 *
 * ## The Labs probe
 *
 * Submits one job exactly as the Labs console does in its default state — the
 * `shell-echo` smoke test with an empty payload — then reads the document back
 * and cancels it. Nothing sweeps `lab_jobs`, so a probe left `queued` would sit
 * until an agent claimed it; cancelling leaves it terminal, with `cancelledBy`
 * on the document as the reason. The unauthenticated probe repeats the same
 * request through a plain `fetch` with no Authorization header, so no token is
 * attached anywhere on that path.
 */

import React, { useState } from 'react';
import { authedFetch, getEndpoint, getJSON, postJSON } from '@/lib/api';
import { runJob } from '@/lib/jobs';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  FileText,
  FlaskConical,
  Info,
  Loader2,
  Play,
  ShieldCheck,
  ShieldOff,
  Workflow,
  Wrench,
} from 'lucide-react';

// ── Pure helpers (exported for the tests) ─────────────────────────────────────

/** The job the Labs console submits in its default state. */
export const LABS_PROBE_JOB = Object.freeze({ type: 'shell-echo', payload: '' });

/**
 * Job states in which the probe is demonstrably not hung: it either finished,
 * or an agent has it. `queued` is the one state that says nothing.
 */
const SETTLED_JOB_STATUSES = new Set([
  'claimed',
  'running',
  'succeeded',
  'failed',
  'timeout',
  'cancelled',
]);

/**
 * Decode a JWT payload without verifying it. Verification is the API's job;
 * this only needs to read what the browser is already holding.
 *
 * @param {string} token
 * @returns {object|null}
 */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * `exp` as a relative time. Seconds since the epoch, per RFC 7519.
 *
 * @param {number} expSeconds
 * @param {number} nowMs
 * @returns {{ label: string, expired: boolean|null }}
 */
export function relativeExpiry(expSeconds, nowMs = Date.now()) {
  if (!Number.isFinite(expSeconds)) return { label: 'no exp claim', expired: null };
  const delta = Math.round(expSeconds - nowMs / 1000);
  const abs = Math.abs(delta);
  let unit;
  if (abs < 60) unit = `${abs} s`;
  else if (abs < 3600) unit = `${Math.floor(abs / 60)} min`;
  else unit = `${(abs / 3600).toFixed(1)} h`;
  return delta >= 0
    ? { label: `in ${unit}`, expired: false }
    : { label: `${unit} ago`, expired: true };
}

/**
 * Do an `aud` value and an `azp` value name the same app registration?
 *
 * A v2 access token puts the resource's bare client-id GUID in `aud`; a v1 one
 * puts the App ID URI, `api://<guid>`. `azp` is always the bare GUID. Comparing
 * them raw would call `api://X` and `X` different apps, and report the SPA and
 * the API as separate registrations when they are in fact the one registration
 * — a false PASS on the check that exists to catch exactly that.
 */
function sameApp(audience, azp) {
  const bare = (value) =>
    String(value)
      .replace(/^api:\/\//i, '')
      .toLowerCase();
  return bare(audience) === bare(azp);
}

/**
 * Reduce a decoded token to what may be shown. Claim names, and the values of
 * `aud`, `roles`, `exp` and `tid` — nothing that identifies the person.
 *
 * Every comparison is exact equality on each value, because that is what the
 * verifier does: an `aud` that differs from ENTRA_API_AUDIENCE by so much as
 * a scheme prefix is a 401, and the App Role value is compared as a
 * case-sensitive string. `aud` may be a string or an array (RFC 7519 §4.1.3);
 * jsonwebtoken accepts an array when any element equals the expected
 * audience, so the check here is membership, not equality on a joined string.
 *
 * @param {object|null} payload
 * @param {{ expectedAudience?: string, tenantId?: string, adminAppRole?: string }|null} expectations
 * @param {number} [nowMs]
 */
export function summarizeToken(payload, expectations, nowMs = Date.now()) {
  if (!payload) return null;
  const audiences = (Array.isArray(payload.aud) ? payload.aud : [payload.aud])
    .filter((value) => value !== null && value !== undefined)
    .map(String);
  const roleNames = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
  const tid = typeof payload.tid === 'string' ? payload.tid : null;
  const expiry = relativeExpiry(Number(payload.exp), nowMs);
  const expected = expectations || {};

  const scopes =
    typeof payload.scp === 'string' ? payload.scp.split(' ').filter(Boolean).map(String) : [];
  // `azp` (v2) or `appid` (v1) — the client that ASKED for this token, as
  // distinct from `aud`, the API it is for.
  const azp =
    typeof payload.azp === 'string'
      ? payload.azp
      : typeof payload.appid === 'string'
        ? payload.appid
        : null;

  return {
    claimNames: Object.keys(payload).sort(),
    aud: audiences.length ? audiences.join(', ') : null,
    audienceMatches: expected.expectedAudience
      ? audiences.includes(expected.expectedAudience)
      : null,
    roleNames,
    hasAdminRole: expected.adminAppRole ? roleNames.includes(expected.adminAppRole) : null,
    tenantMatches: expected.tenantId ? tid === expected.tenantId : null,
    scopes,
    hasRequiredScope: expected.requiredScope ? scopes.includes(expected.requiredScope) : null,
    tokenVersion: typeof payload.ver === 'string' ? payload.ver : null,
    versionMatches: expected.requiredTokenVersion
      ? payload.ver === expected.requiredTokenVersion
      : null,
    azp,
    // THE ROW THAT PINS THE REGISTRATION TOPOLOGY (#519).
    //
    // `azp` is the client that asked; `aud` is the API it is for. One app
    // registration serving both makes them the same GUID, which is the
    // condition DECISION 3 in verify-token.js warns about and #522 exists to
    // end. After the split they differ, and if anyone ever points
    // VITE_ENTRA_CLIENT_ID back at the API's client id this goes red on a page
    // an admin already visits — instead of nothing happening at all.
    clientIsSeparateFromApi:
      azp && audiences.length ? !audiences.some((value) => sameApp(value, azp)) : null,
    expiresLabel: expiry.label,
    expired: expiry.expired,
  };
}

/**
 * Reduce the getCurrentAdminStatus body to booleans and role names. The `uid`
 * and `email` it carries are compared or counted, never kept.
 *
 * @param {object|null} body
 * @param {string|null} tokenOid the token's `oid` (or `sub`), used once, here
 */
export function summarizeAdminStatus(body, tokenOid) {
  if (!body) return null;
  const uid = typeof body.uid === 'string' && body.uid ? body.uid : null;
  return {
    isAdmin: body.isAdmin === true,
    role: body.role ?? null,
    active: body.active === true,
    permissions: Array.isArray(body.permissions) ? body.permissions.map(String) : [],
    uidPresent: uid !== null,
    uidMatchesToken: uid && tokenOid ? uid === tokenOid : null,
    emailPresent: typeof body.email === 'string' && body.email.length > 0,
  };
}

/**
 * The identity verdict: the token carries the audience and the role, and the
 * registry agrees it is this principal and that they are an admin. Unknown
 * until both halves have been read.
 */
export function evaluateIdentity(token, admin) {
  if (!token || !admin) return { pass: null, reason: 'token or registry not read' };
  const checks = [
    ['aud matches the API audience', token.audienceMatches],
    ['admin App Role present in roles', token.hasAdminRole],
    // Since #515 a token without the delegated scope is refused outright, so a
    // token that reached this page and lacks it means the SPA is requesting the
    // wrong scope — not that the caller is unauthorized.
    ['delegated scope present in scp', token.hasRequiredScope],
    ['token version matches', token.versionMatches],
    ['registry says isAdmin', admin.isAdmin],
    ['registry uid equals token oid', admin.uidMatchesToken],
  ];
  const failed = checks.filter(([, value]) => value === false).map(([name]) => name);
  if (failed.length) return { pass: false, reason: `failed: ${failed.join('; ')}` };
  // A comparison that could not be made (the API gave no expectation to
  // compare against) is not a failure, and must not be scored as one — but it
  // is not a pass either. Say which one, so the report names the gap.
  const unknown = checks.filter(([, value]) => value !== true).map(([name]) => name);
  if (unknown.length) return { pass: null, reason: `could not compare: ${unknown.join('; ')}` };
  return { pass: true, reason: 'every comparison holds' };
}

/**
 * The verdict for the authenticated Labs probe.
 *
 * The documented response of enqueueLabJob is HTTP 200 with
 * `{ jobId, type, status: 'queued' }` (lib/labs.js). The document must then
 * exist and, after the cancel, be in a state that is not `queued` — terminal,
 * or held by an agent — so nothing is left hanging.
 *
 * @param {object|null} probe
 * @returns {{ pass: boolean|null, reason: string }}
 */
export function evaluateLabsProbe(probe) {
  if (!probe) return { pass: null, reason: 'NOT RUN — press "Run authenticated probe"' };
  // The runner itself threw before any step recorded a result.
  if (probe.error) return { pass: false, reason: probe.error };
  const { enqueue, read, final } = probe;
  if (!enqueue || enqueue.httpStatus !== 200) {
    return { pass: false, reason: `enqueueLabJob answered ${enqueue?.httpStatus ?? 'no status'}` };
  }
  if (!enqueue.jobId || enqueue.status !== 'queued') {
    return { pass: false, reason: 'enqueueLabJob did not return { jobId, status: "queued" }' };
  }
  if (!read?.found) {
    return { pass: false, reason: 'lab_jobs document not found after enqueue' };
  }
  // A failed final read is not "still queued" — it is unknown, and unknown is
  // its own failure here: the probe cannot vouch for the document's state.
  if (final?.error) {
    return {
      pass: false,
      reason: `final getLabJob read failed (${final.error}) — lab_jobs/${enqueue.jobId} state unknown`,
    };
  }
  // No fallback to the earlier read: the verdict is about the state at the
  // END of the probe, and a closing read that returned nothing observed none.
  if (!final?.status) {
    return {
      pass: false,
      reason: `final lab_jobs/${enqueue.jobId} state unknown — the closing getLabJob read returned no status`,
    };
  }
  const finalStatus = final.status;
  if (!SETTLED_JOB_STATUSES.has(finalStatus)) {
    return { pass: false, reason: `lab_jobs/${enqueue.jobId} is still "${finalStatus}"` };
  }
  return { pass: true, reason: `documented no-op response; document ${finalStatus}` };
}

/** The verdict for the unauthenticated probe: a 401 or 403, nothing else. */
export function evaluateUnauthenticatedProbe(result) {
  if (!result) return { pass: null, reason: 'NOT RUN — press "Run unauthenticated probe"' };
  if (result.error) return { pass: false, reason: result.error };
  const pass = result.httpStatus === 401 || result.httpStatus === 403;
  return { pass, reason: `HTTP ${result.httpStatus}` };
}

const mark = (value) => {
  if (value === true) return 'PASS';
  if (value === false) return 'FAIL';
  return 'UNKNOWN';
};

const list = (values) => (values && values.length ? values.join(', ') : '(none)');

/** The identity half of the report. */
function identityReportLines({
  identityPending,
  token,
  tokenError,
  expectations,
  expectationsError,
  admin,
  adminHttp,
  adminError,
}) {
  const lines = ['### Identity — token claims and admin registry', ''];
  // Before the first run has settled there is nothing to report, and saying
  // "could not be read" here would be false — the check has not happened yet.
  if (identityPending) {
    lines.push('- Identity checks: STILL RUNNING — this report is not final', '');
    return lines;
  }
  if (token) {
    lines.push(`- Claims present (names only): ${list(token.claimNames)}`);
    lines.push(`- \`aud\`: ${token.aud ?? '(absent)'}`);
    lines.push(`- \`aud\` equals the API's ENTRA_API_AUDIENCE: ${mark(token.audienceMatches)}`);
    lines.push(`- \`roles\`: ${list(token.roleNames)}`);
    lines.push(
      `- App Role \`${expectations?.adminAppRole ?? 'Admin'}\` present in \`roles\`: ${mark(token.hasAdminRole)}`
    );
    lines.push(
      `- Delegated scope \`${expectations?.requiredScope ?? 'access_as_admin'}\` present in \`scp\`: ${mark(token.hasRequiredScope)}`
    );
    lines.push(`- \`tid\` equals the API's ENTRA_TENANT_ID: ${mark(token.tenantMatches)}`);
    lines.push(
      `- \`ver\` is ${expectations?.requiredTokenVersion ?? '2.0'}: ${mark(token.versionMatches)}`
    );
    // `azp` names the client that asked for the token, not the person.
    lines.push(`- \`azp\`: ${token.azp ?? '(absent)'}`);
    lines.push(
      `- \`azp\` differs from \`aud\` (SPA and API are separate registrations): ${mark(token.clientIsSeparateFromApi)}`
    );
    lines.push(`- \`exp\`: ${token.expiresLabel}`);
  } else {
    lines.push(`- Token: could not be read (${tokenError || 'no token'})`);
  }
  if (expectationsError) lines.push(`- getAuthExpectations: ${expectationsError}`);
  if (admin) {
    lines.push(`- getCurrentAdminStatus: HTTP ${adminHttp ?? '?'}, isAdmin ${admin.isAdmin}`);
    lines.push(`- Registry role: ${admin.role ?? '(none)'}; active: ${admin.active}`);
    lines.push(`- Registry permissions: ${list(admin.permissions)}`);
    lines.push(`- Registry uid equals token oid: ${mark(admin.uidMatchesToken)}`);
  } else {
    lines.push(`- getCurrentAdminStatus: ${adminError || 'not called'}`);
  }
  const verdict = evaluateIdentity(token, admin);
  lines.push(`- Result: ${mark(verdict.pass)} (${verdict.reason})`, '');
  return lines;
}

/** The Labs half of the report. */
function labsReportLines({ labs, unauth }) {
  const lines = ['### Labs no-op probe', ''];
  if (labs) {
    const e = labs.enqueue || {};
    const outcome = e.error
      ? ` — ${e.error}`
      : `, status ${e.status ?? '?'}, jobId ${e.jobId ?? '?'}`;
    lines.push(
      `- enqueueLabJob (authenticated, ${LABS_PROBE_JOB.type}): HTTP ${e.httpStatus ?? '?'}${outcome}`
    );
    if (labs.read) {
      const read = labs.read.found
        ? `found, status ${labs.read.status}`
        : labs.read.error || 'not found';
      lines.push(`- getLabJob: ${read}`);
    }
    if (labs.cancel) {
      const cancel =
        labs.cancel.error || `HTTP ${labs.cancel.httpStatus}, status ${labs.cancel.status}`;
      lines.push(`- cancelLabJob: ${cancel}`);
    }
    if (labs.final) {
      let finalState = labs.final.status;
      if (labs.final.error) finalState = `read failed (${labs.final.error}) — state unknown`;
      else if (!finalState) finalState = 'unknown — the closing read returned no status';
      lines.push(`- lab_jobs/${e.jobId ?? '?'} final status: ${finalState}`);
    }
  }
  const labsVerdict = evaluateLabsProbe(labs);
  lines.push(`- Authenticated no-op path: ${mark(labsVerdict.pass)} (${labsVerdict.reason})`);
  const unauthVerdict = evaluateUnauthenticatedProbe(unauth);
  lines.push(
    `- enqueueLabJob with no Authorization header: ${mark(unauthVerdict.pass)} (${unauthVerdict.reason})`
  );
  lines.push('');
  return lines;
}

/**
 * The Markdown the operator copies. Names, booleans, statuses and identifiers
 * only — the same summary the page renders, nothing more.
 *
 * It deliberately names no ticket. It used to head its two halves `### #355`
 * and `### #356`; both closed on 2026-09-07 by this page's first run, so the
 * headings addressed a destination that no longer exists and invited anyone
 * running it since to file evidence against finished work.
 */
export function buildReport({ generatedAt, labs, unauth, ...identity }) {
  return [
    `## Admin diagnostics — ${generatedAt}`,
    '',
    ...identityReportLines(identity),
    ...labsReportLines({ labs, unauth }),
  ].join('\n');
}

// ── The checks themselves (no React state; the page awaits these) ────────────

/** Read a Response body as JSON without throwing on a non-JSON body. */
const bodyOf = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

export const messageOf = (err, fallback) => err?.message || fallback;

/**
 * Token, expectations, registry. The decoded payload lives only inside this
 * function; only the summaries leave it.
 */
export async function collectIdentity() {
  const result = {
    token: null,
    tokenError: null,
    expectations: null,
    expectationsError: null,
    admin: null,
    adminHttp: null,
    adminError: null,
  };
  // ONE acquisition, decoded here and sent on the status call. authedFetch
  // force-refreshes for getCurrentAdminStatus so a just-granted role is
  // visible at once; decoding a separately acquired (cached) token could show
  // the role missing while the API call, on a fresh token, succeeded. So the
  // token is acquired once with that same refresh behaviour and handed to
  // authedFetch as `token`, which skips its own acquisition — so the claims
  // shown and the claims the API judged are the same bytes, and there is no
  // second (forced-refresh) round trip to Entra.
  let payload = null;
  let token = null;
  try {
    const { acquireApiToken } = await import('@/lib/entraAuth');
    token = await acquireApiToken({ forceRefresh: true });
    payload = decodeJwtPayload(token);
    if (!payload) result.tokenError = 'the access token could not be decoded';
  } catch (err) {
    result.tokenError = messageOf(err, 'could not acquire the access token');
  }
  try {
    // Same acquisition as the status call below — the whole run is one token.
    result.expectations = await getJSON('getAuthExpectations', token ? { token } : {});
  } catch (err) {
    result.expectationsError = messageOf(err, 'getAuthExpectations failed');
  }
  result.token = summarizeToken(payload, result.expectations);
  try {
    const res = await authedFetch('getCurrentAdminStatus', {
      method: 'GET',
      ...(token ? { token } : {}),
    });
    result.adminHttp = res.status;
    const body = await bodyOf(res);
    if (body === null) {
      // A 2xx with nothing parseable is not "no admin" and not a silent blank:
      // it is its own finding, and it must say so in the panel and the report.
      result.adminError = `status route answered ${res.status} with no JSON body`;
    } else {
      result.admin = summarizeAdminStatus(body, payload?.oid ?? payload?.sub ?? null);
    }
  } catch (err) {
    result.adminError = messageOf(err, 'getCurrentAdminStatus failed');
  }
  token = null;
  return result;
}

/** Enqueue exactly as the Labs console does; read back; cancel; read again. */
export async function runLabsProbeSteps() {
  const probe = { enqueue: null, read: null, cancel: null, final: null };
  try {
    const res = await authedFetch('enqueueLabJob', {
      method: 'POST',
      body: JSON.stringify(LABS_PROBE_JOB),
    });
    const body = (await bodyOf(res)) || {};
    probe.enqueue = {
      httpStatus: res.status,
      jobId: body.jobId ?? null,
      type: body.type ?? null,
      status: body.status ?? null,
    };
  } catch (err) {
    probe.enqueue = { httpStatus: null, error: messageOf(err, 'enqueueLabJob failed') };
    return probe;
  }

  const { jobId } = probe.enqueue;
  if (!jobId) return probe;

  try {
    const { job } = await postJSON('getLabJob', { jobId });
    probe.read = { found: Boolean(job), status: job?.status ?? null };
  } catch (err) {
    probe.read = { found: false, error: messageOf(err, 'getLabJob failed') };
  }
  try {
    const cancelled = await postJSON('cancelLabJob', { jobId });
    probe.cancel = { httpStatus: 200, status: cancelled?.status ?? null };
  } catch (err) {
    // 409 means an agent already claimed it — not a hang, and reported as such.
    probe.cancel = { error: messageOf(err, 'cancelLabJob failed') };
  }
  try {
    const { job } = await postJSON('getLabJob', { jobId });
    probe.final = { status: job?.status ?? null };
  } catch (err) {
    probe.final = { status: null, error: messageOf(err, 'getLabJob failed') };
  }
  return probe;
}

/** The same request through plain fetch: no token acquired, no header. */
export async function probeUnauthenticated() {
  // Outside the try on purpose: an unset VITE_AZURE_FUNCTIONS_URL throws
  // here, and that is a configuration fault to surface as one, not a probe
  // result to score as a failed request.
  const url = getEndpoint('enqueueLabJob');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LABS_PROBE_JOB),
    });
    const body = (await bodyOf(res)) || {};
    return { httpStatus: res.status, error: null, message: body.error ?? null };
  } catch (err) {
    return { httpStatus: null, error: messageOf(err, 'request failed') };
  }
}

// ── Pipeline smoke tests ──────────────────────────────────────────────────────

export const ACTION_CONFIG = {
  rss: {
    id: 'rss',
    title: 'RSS Fetch',
    subtitle: 'Pulls latest feed entries and creates new content candidates.',
    icon: Play,
    buttonLabel: 'Run Now',
    runningLabel: 'Fetching RSS...',
    details: 'Pulls the latest RSS feed entries and creates new content candidates for review.',
    // A platform job, not an RPC: the fetch takes minutes and Flex Consumption
    // cuts HTTP responses at 230 s (T-322). runJob enqueues and polls.
    runner: async () => {
      const job = await runJob('fetch-rss-feeds', {});
      if (job.status !== 'succeeded') {
        throw new Error(job.error || `RSS fetch ${job.status}`);
      }
      const r = job.result || {};
      const errors = r.errors?.length ? ` ${r.errors.length} feed(s) failed.` : '';
      return `RSS fetch complete: ${r.processed || 0} feeds, ${r.newContent || 0} new content drafts, ${r.duplicates || 0} duplicates skipped.${errors}`;
    },
  },
  inspect: {
    id: 'inspect',
    title: 'Batch Inspect',
    subtitle: 'Queues metadata inspection for recent ingested items.',
    icon: Wrench,
    buttonLabel: 'Run Now',
    runningLabel: 'Inspecting...',
    details:
      'Queues inspection for up to 10 ingested items so metadata is populated before review.',
    // A platform job (T-322): selects ingested documents and runs the inspector
    // on each — scrape, analyse, critique — instead of flagging them for a
    // trigger that does not exist on Azure yet (T-324).
    runner: async () => {
      const job = await runJob('batch-inspect', { limit: 10 });
      if (job.status !== 'succeeded') {
        throw new Error(job.error || `Inspection ${job.status}`);
      }
      const r = job.result || {};
      const rework = r.needsRework ? `, ${r.needsRework} need rework` : '';
      const failed = r.failed ? `, ${r.failed} failed` : '';
      return `Inspection complete: ${r.inspected || 0}/${r.total || 0} documents inspected${rework}${failed}.`;
    },
  },
  digest: {
    id: 'digest',
    title: 'Reviewer Digest',
    subtitle: 'Builds the reviewer summary from queued and recent RSS entries.',
    icon: FileText,
    buttonLabel: 'Run Now',
    runningLabel: 'Generating Digest...',
    details:
      'Generates digest metrics for reviewer operations. If the Azure backend reports a query or index configuration error, check the Cosmos DB indexing policy and Azure Function logs before retrying.',
    runner: async () => {
      const result = await postJSON('generateReviewerDigestManual', {});
      return `Reviewer digest generated: ${result.totalQueued || 0} queued items, ${result.recentRssCount || 0} recent RSS entries.`;
    },
  },
};

/**
 * A digest failure that is really a Cosmos indexing failure, said plainly.
 *
 * The retry sentence used to end "then retry S3.3" — a migration stage that no
 * longer names anything an operator can act on. What to retry is the button
 * they just pressed.
 */
export function normalizeDigestError(message) {
  if (message.includes('FAILED_PRECONDITION') && message.toLowerCase().includes('index')) {
    return 'Reviewer digest query or index configuration is not ready in the Azure backend. Check the Cosmos DB indexing policy and Azure Function logs, then run this action again.';
  }
  return message;
}

function ActionTile({ config, runningAction, actionInfoOpen, onRun, onToggleInfo }) {
  const Icon = config.icon;
  return (
    <div className="h-full rounded-lg border p-3 flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold">{config.title}</p>
        <p className="text-xs text-muted-foreground mt-1">{config.subtitle}</p>
      </div>
      {actionInfoOpen[config.id] && (
        <div className="rounded-md border border-slate-300/60 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
          {config.details}
        </div>
      )}
      <div className="mt-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-1"
          onClick={() => onRun(config.id)}
          disabled={runningAction !== ''}
        >
          <Icon className="h-4 w-4" />
          {runningAction === config.id ? config.runningLabel : config.buttonLabel}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => onToggleInfo(config.id)}
          title="What this action does"
          aria-label={`Toggle ${config.title} explanation`}
        >
          <Info className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function SmokeActionsCard({
  runningAction,
  actionInfoOpen,
  actionMessage,
  actionError,
  onRunAction,
  onToggleActionInfo,
}) {
  const actionList = [ACTION_CONFIG.rss, ACTION_CONFIG.inspect, ACTION_CONFIG.digest];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Workflow className="h-4 w-4 text-sky-500" /> Pipeline Smoke Tests
        </CardTitle>
        <CardDescription>
          Each of these does real work — fetches feeds, inspects documents, writes a digest. They
          are checks, not simulations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {actionList.map((config) => (
            <ActionTile
              key={config.id}
              config={config}
              runningAction={runningAction}
              actionInfoOpen={actionInfoOpen}
              onRun={onRunAction}
              onToggleInfo={onToggleActionInfo}
            />
          ))}
        </div>
        {actionMessage && <p className="text-xs text-emerald-600">{actionMessage}</p>}
        {actionError && <p className="text-xs text-red-600">{actionError}</p>}
      </CardContent>
    </Card>
  );
}

// ── Presentation ──────────────────────────────────────────────────────────────

const VERDICT_STYLES = {
  PASS: 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400',
  FAIL: 'border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-400',
  UNKNOWN: 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400',
};

export function Verdict({ pass, children }) {
  const label = mark(pass);
  return (
    <div className="flex items-start gap-2 text-sm">
      <Badge variant="outline" className={`mt-0.5 shrink-0 text-[10px] ${VERDICT_STYLES[label]}`}>
        {label}
      </Badge>
      <span>{children}</span>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm sm:flex-row sm:gap-3">
      <span className="w-48 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words font-mono text-xs leading-5">{children}</span>
    </div>
  );
}

function Note({ children }) {
  return (
    <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
      {children}
    </p>
  );
}

function Pending({ children }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {children}
    </p>
  );
}

function TokenClaimsBody({ identity }) {
  if (!identity) return <Pending>Reading the session…</Pending>;
  const { token, expectations } = identity;
  if (!token) return <p className="text-sm text-destructive">{identity.tokenError}</p>;
  return (
    <>
      <Row label="Claims present">{token.claimNames.join(', ')}</Row>
      <Row label="aud">{token.aud ?? '(absent)'}</Row>
      <Row label="azp">{token.azp ?? '(absent)'}</Row>
      <Row label="roles">{list(token.roleNames)}</Row>
      <Row label="scp">{list(token.scopes)}</Row>
      <Row label="ver">{token.tokenVersion ?? '(absent)'}</Row>
      <Row label="exp">{token.expiresLabel}</Row>
      <div className="space-y-1 pt-2">
        <Verdict pass={token.audienceMatches}>
          <code>aud</code> equals the API&apos;s configured audience
          {expectations?.expectedAudience ? ` (${expectations.expectedAudience})` : ''}
        </Verdict>
        <Verdict pass={token.hasAdminRole}>
          App Role <code>{expectations?.adminAppRole ?? 'Admin'}</code> present in{' '}
          <code>roles</code>
        </Verdict>
        <Verdict pass={token.hasRequiredScope}>
          Delegated scope <code>{expectations?.requiredScope ?? 'access_as_admin'}</code> present in{' '}
          <code>scp</code>
        </Verdict>
        <Verdict pass={token.tenantMatches}>
          <code>tid</code> equals the API&apos;s tenant
        </Verdict>
        <Verdict pass={token.versionMatches}>
          <code>ver</code> is {expectations?.requiredTokenVersion ?? '2.0'}
        </Verdict>
        <Verdict pass={token.clientIsSeparateFromApi}>
          <code>azp</code> differs from <code>aud</code> — the SPA and the API are separate
          registrations
        </Verdict>
        <Verdict pass={token.expired === null ? null : !token.expired}>Token not expired</Verdict>
      </div>
      {token.clientIsSeparateFromApi === false ? (
        <Note>
          One app registration is serving both the SPA and the API, which is what DECISION 3 in
          verify-token.js warns about and issue #522 exists to end. The delegated-scope check above
          is what makes it safe meanwhile: an ID token carries this <code>aud</code> and these{' '}
          <code>roles</code>, but never <code>scp</code>.
        </Note>
      ) : null}
    </>
  );
}

export function TokenClaimsCard({ identity }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Token claims
        </CardTitle>
        <CardDescription>
          Decoded from the access token this app sends to the API, compared against what the API
          says it enforces. Values shown are configuration, not identity: <code>aud</code>,{' '}
          <code>azp</code>, <code>roles</code>, <code>scp</code>, <code>ver</code>, <code>exp</code>
          . Never <code>oid</code>, <code>email</code> or the token itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <TokenClaimsBody identity={identity} />
        {identity?.expectationsError ? (
          <Note>
            getAuthExpectations refused the token: {identity.expectationsError}. The comparisons
            above are unknown, and the refusal itself is the audience-drift signal this check exists
            to catch.
          </Note>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AdminRegistryBody({ identity }) {
  if (!identity) return null;
  const { admin, token } = identity;
  if (!admin) return <p className="text-sm text-destructive">{identity.adminError}</p>;
  return (
    <>
      <Row label="HTTP">{identity.adminHttp}</Row>
      <Row label="isAdmin">{String(admin.isAdmin)}</Row>
      <Row label="role">{admin.role ?? '(none)'}</Row>
      <Row label="active">{String(admin.active)}</Row>
      <Row label="permissions">{list(admin.permissions)}</Row>
      <div className="space-y-1 pt-2">
        <Verdict pass={admin.isAdmin}>Caller is an admin per the registry</Verdict>
        <Verdict pass={admin.uidMatchesToken}>
          Registry <code>uid</code> equals the token&apos;s <code>oid</code>
        </Verdict>
      </div>
      {token?.hasAdminRole && !admin.isAdmin ? (
        <Note>
          The token carries the role and the registry says no — that is a registry problem, not a
          token problem.
        </Note>
      ) : null}
    </>
  );
}

export function AdminRegistryCard({ identity }) {
  const container = identity?.expectations?.registryContainer ?? 'admins';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Admin registry</CardTitle>
        <CardDescription>
          <code>getCurrentAdminStatus</code>, answered from{' '}
          <code>
            {container}/{'{oid}'}
          </code>
          . Identifiers are compared, not shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <AdminRegistryBody identity={identity} />
      </CardContent>
    </Card>
  );
}

function LabsProbeResult({ labs }) {
  if (!labs) return null;
  const e = labs.enqueue || {};
  const verdict = evaluateLabsProbe(labs);
  if (labs.error) {
    return (
      <div className="space-y-1">
        <Row label="probe">{labs.error}</Row>
        <div className="pt-2">
          <Verdict pass={verdict.pass}>Authenticated no-op path — {verdict.reason}</Verdict>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Row label="enqueueLabJob">
        {e.error || `HTTP ${e.httpStatus} · ${e.type} · ${e.status} · ${e.jobId}`}
      </Row>
      {labs.read ? (
        <Row label="getLabJob">
          {labs.read.found ? `found · ${labs.read.status}` : labs.read.error || 'not found'}
        </Row>
      ) : null}
      {labs.cancel ? (
        <Row label="cancelLabJob">
          {labs.cancel.error || `HTTP ${labs.cancel.httpStatus} · ${labs.cancel.status}`}
        </Row>
      ) : null}
      {labs.final ? (
        <Row label="final status">
          {labs.final.error
            ? `read failed (${labs.final.error}) — state unknown`
            : labs.final.status || 'unknown — the closing read returned no status'}
        </Row>
      ) : null}
      <div className="pt-2">
        <Verdict pass={verdict.pass}>Authenticated no-op path — {verdict.reason}</Verdict>
      </div>
    </div>
  );
}

function UnauthenticatedResult({ unauth }) {
  if (!unauth) return null;
  const verdict = evaluateUnauthenticatedProbe(unauth);
  const detail = unauth.message ? ` · ${unauth.message}` : '';
  return (
    <div className="space-y-1">
      <Row label="no Authorization header">
        {unauth.error || `HTTP ${unauth.httpStatus}${detail}`}
      </Row>
      <div className="pt-2">
        <Verdict pass={verdict.pass}>Unauthenticated request refused — {verdict.reason}</Verdict>
      </div>
    </div>
  );
}

export function ProbeButton({ busy, icon: Icon, onClick, children }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={busy}>
      {busy ? (
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="mr-2 h-3.5 w-3.5" />
      )}
      {children}
    </Button>
  );
}

export function LabsProbeCard({ labs, labsBusy, onLabs, unauth, unauthBusy, onUnauth }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FlaskConical className="h-4 w-4 text-muted-foreground" /> Labs no-op probe
        </CardTitle>
        <CardDescription>
          Submits one <code>{LABS_PROBE_JOB.type}</code> job exactly as the Labs console does, reads
          the document back, then cancels it so nothing is left queued. The expected response is
          HTTP 200 with <code>{'{ jobId, type, status: "queued" }'}</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <ProbeButton busy={labsBusy} icon={FlaskConical} onClick={onLabs}>
            Run authenticated probe
          </ProbeButton>
          <ProbeButton busy={unauthBusy} icon={ShieldOff} onClick={onUnauth}>
            Run unauthenticated probe
          </ProbeButton>
        </div>
        <LabsProbeResult labs={labs} />
        <UnauthenticatedResult unauth={unauth} />
      </CardContent>
    </Card>
  );
}

/** Local state for the three smoke actions, kept out of the page component. */
export function useSmokeActions(onAfterRun) {
  const [runningAction, setRunningAction] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionInfoOpen, setActionInfoOpen] = useState({
    rss: false,
    inspect: false,
    digest: false,
  });

  const runAction = async (actionId) => {
    const config = ACTION_CONFIG[actionId];
    if (!config) return;
    setActionError('');
    setActionMessage('');
    setRunningAction(actionId);
    try {
      const nextMessage = await config.runner();
      await onAfterRun?.();
      setActionMessage(nextMessage);
    } catch (error) {
      const rawMessage = error.message || `Failed to run ${config.title}.`;
      setActionError(actionId === 'digest' ? normalizeDigestError(rawMessage) : rawMessage);
    } finally {
      setRunningAction('');
    }
  };

  const toggleActionInfo = (key) => {
    setActionInfoOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return {
    runningAction,
    actionMessage,
    actionError,
    actionInfoOpen,
    runAction,
    toggleActionInfo,
    setActionMessage,
    setActionError,
  };
}
