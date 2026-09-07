/**
 * Diagnostics — the two live checks that need a real admin's token (#355,
 * #356), done in the signed-in session instead of by copying a bearer token
 * out of developer tools and decoding it by hand.
 *
 * ## What this page never shows
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
 * refusal itself is shown — which is the audience-drift signal #355 describes.
 *
 * ## The Labs probe (#356)
 *
 * Submits one job exactly as the Labs console does in its default state — the
 * `shell-echo` smoke test with an empty payload — then reads the document back
 * and cancels it. Nothing sweeps `lab_jobs`, so a probe left `queued` would sit
 * until an agent claimed it; cancelling leaves it terminal, with `cancelledBy`
 * on the document as the reason. The unauthenticated probe repeats the same
 * request through a plain `fetch` with no Authorization header, so no token is
 * attached anywhere on that path.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { authedFetch, getEndpoint, getJSON, postJSON } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import {
  ClipboardCopy,
  FlaskConical,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Stethoscope,
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

  return {
    claimNames: Object.keys(payload).sort(),
    aud: audiences.length ? audiences.join(', ') : null,
    audienceMatches: expected.expectedAudience
      ? audiences.includes(expected.expectedAudience)
      : null,
    roleNames,
    hasAdminRole: expected.adminAppRole ? roleNames.includes(expected.adminAppRole) : null,
    tenantMatches: expected.tenantId ? tid === expected.tenantId : null,
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
 * The #355 verdict: the token carries the audience and the role, and the
 * registry agrees it is this principal and that they are an admin. Unknown
 * until both halves have been read.
 */
export function evaluateIdentity(token, admin) {
  if (!token || !admin) return null;
  return (
    token.audienceMatches === true &&
    token.hasAdminRole === true &&
    admin.isAdmin === true &&
    admin.uidMatchesToken === true
  );
}

/**
 * The #356 verdict for the authenticated probe.
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

/** The #356 verdict for the unauthenticated probe: a 401 or 403, nothing else. */
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

/** The #355 half of the report. */
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
  const lines = ['### #355 — token claims and admin registry', ''];
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
    lines.push(`- \`tid\` equals the API's ENTRA_TENANT_ID: ${mark(token.tenantMatches)}`);
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
  lines.push(`- Result: ${mark(evaluateIdentity(token, admin))}`, '');
  return lines;
}

/** The #356 half of the report. */
function labsReportLines({ labs, unauth }) {
  const lines = ['### #356 — Labs no-op probe', ''];
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
 * The Markdown the owner pastes on #355 and #356. Names, booleans, statuses
 * and identifiers only — the same summary the page renders, nothing more.
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

const messageOf = (err, fallback) => err?.message || fallback;

/**
 * Token, expectations, registry. The decoded payload lives only inside this
 * function; only the summaries leave it.
 */
async function collectIdentity() {
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
    result.admin = summarizeAdminStatus(await bodyOf(res), payload?.oid ?? payload?.sub ?? null);
  } catch (err) {
    result.adminError = messageOf(err, 'getCurrentAdminStatus failed');
  }
  token = null;
  return result;
}

/** Enqueue exactly as the Labs console does; read back; cancel; read again. */
async function runLabsProbeSteps() {
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
async function probeUnauthenticated() {
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
      <Row label="roles">{list(token.roleNames)}</Row>
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
        <Verdict pass={token.tenantMatches}>
          <code>tid</code> equals the API&apos;s tenant
        </Verdict>
        <Verdict pass={token.expired === null ? null : !token.expired}>Token not expired</Verdict>
      </div>
    </>
  );
}

function TokenClaimsCard({ identity }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Token claims
        </CardTitle>
        <CardDescription>
          Decoded from the access token this app sends to the API, compared against what the API
          says it enforces. Values shown: <code>aud</code>, <code>roles</code>, <code>exp</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <TokenClaimsBody identity={identity} />
        {identity?.expectationsError ? (
          <Note>
            getAuthExpectations refused the token: {identity.expectationsError}. The comparisons
            above are unknown, and the refusal itself is the audience-drift signal #355 describes.
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
          The token carries the role and the registry says no — #355 reads this as a registry
          problem, not a token problem.
        </Note>
      ) : null}
    </>
  );
}

function AdminRegistryCard({ identity }) {
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

function ProbeButton({ busy, icon: Icon, onClick, children }) {
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

function LabsProbeCard({ labs, labsBusy, onLabs, unauth, unauthBusy, onUnauth }) {
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

// ── The page ──────────────────────────────────────────────────────────────────

export default function DiagnosticsPage() {
  const { authReady } = useAuthReady();
  const { toast } = useToast();
  const [identity, setIdentity] = useState(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [labs, setLabs] = useState(null);
  const [labsBusy, setLabsBusy] = useState(false);
  const [unauth, setUnauth] = useState(null);
  const [unauthBusy, setUnauthBusy] = useState(false);

  // One identity run at a time. The first run and a re-run go through the
  // same gate: a click while a run is in flight is ignored rather than
  // starting a second run whose result would race the first (last to resolve
  // would win). Each run carries a sequence number, so a result from a run
  // that was superseded — or torn down by a route change — is discarded
  // instead of being applied over a newer one.
  const identitySeq = useRef(0);
  const identityInFlight = useRef(false);

  const runIdentity = useCallback(async () => {
    if (identityInFlight.current) return false;
    identityInFlight.current = true;
    identitySeq.current += 1;
    const seq = identitySeq.current;
    try {
      const result = await collectIdentity();
      if (seq === identitySeq.current) setIdentity(result);
    } finally {
      if (seq === identitySeq.current) identityInFlight.current = false;
    }
    return true;
  }, []);

  useEffect(() => {
    if (!authReady) return undefined;
    runIdentity();
    return () => {
      // Supersede whatever is in flight: its result is dropped and the gate
      // reopens for the next mount.
      identitySeq.current += 1;
      identityInFlight.current = false;
    };
  }, [authReady, runIdentity]);

  const rerunIdentity = useCallback(async () => {
    if (identityInFlight.current) return;
    setIdentityBusy(true);
    try {
      await runIdentity();
    } finally {
      setIdentityBusy(false);
    }
  }, [runIdentity]);

  // The first run has no busy flag of its own — `identity === null` is that
  // state — so the button reads both.
  const identityRunning = identityBusy || identity === null;

  const runLabs = useCallback(async () => {
    setLabsBusy(true);
    try {
      setLabs(await runLabsProbeSteps());
    } catch (err) {
      // The steps record their own failures; this is a throw from outside
      // them. Shown in the panel as a failed probe, never left as a stuck
      // spinner with every button disabled.
      setLabs({
        enqueue: null,
        read: null,
        cancel: null,
        final: null,
        error: messageOf(err, 'the probe threw before it could record a result'),
      });
    } finally {
      setLabsBusy(false);
    }
  }, []);

  const runUnauth = useCallback(async () => {
    setUnauthBusy(true);
    try {
      setUnauth(await probeUnauthenticated());
    } catch (err) {
      setUnauth({
        httpStatus: null,
        error: messageOf(err, 'the probe threw before it could record a result'),
      });
    } finally {
      setUnauthBusy(false);
    }
  }, []);

  // Nothing may be copied while a check is in flight: a report taken mid-run
  // would say a token "could not be read" or a probe was "not run" for work
  // that is merely pending, and that is what would end up on #355/#356.
  const settling = identity === null || identityBusy || labsBusy || unauthBusy;

  const report = buildReport({
    generatedAt: new Date().toISOString(),
    identityPending: identity === null,
    ...(identity || {}),
    labs,
    unauth,
  });

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      toast({
        title: 'Report copied',
        description: 'Paste it as the closing comment on #355 and #356.',
      });
    } catch (err) {
      toast({
        title: 'Clipboard unavailable',
        description: messageOf(err, 'Select the report text below and copy it by hand.'),
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Stethoscope className="h-6 w-6" /> Diagnostics
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The live checks for #355 and #356, run in this session. The token is decoded here and
            reduced to claim names; it is never displayed, and only the summary below is copied.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <ProbeButton busy={identityRunning} icon={RefreshCw} onClick={rerunIdentity}>
              Re-run identity checks
            </ProbeButton>
            <Button
              size="sm"
              onClick={copyReport}
              disabled={settling}
              title={settling ? 'Checks still running' : 'Copy the Markdown report'}
            >
              <ClipboardCopy className="mr-2 h-3.5 w-3.5" /> Copy report
            </Button>
          </div>
          {settling ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3 w-3 animate-spin" /> Checks still running — the report is not
              final
            </p>
          ) : null}
        </div>
      </div>

      <TokenClaimsCard identity={identity} />
      <AdminRegistryCard identity={identity} />
      <LabsProbeCard
        labs={labs}
        labsBusy={labsBusy}
        onLabs={runLabs}
        unauth={unauth}
        unauthBusy={unauthBusy}
        onUnauth={runUnauth}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Report</CardTitle>
          <CardDescription>
            What Copy report puts on the clipboard. Claim names, booleans, statuses and job ids
            only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre
            className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/60 p-3 font-mono text-xs"
            aria-label="Diagnostics report"
          >
            {report}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
