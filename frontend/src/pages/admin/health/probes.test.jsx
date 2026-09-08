/**
 * The probes' promise is negative: the token and the person are never shown.
 * So most of what is held here is absence — the raw token, `oid`, `sub` and
 * `email` never reach the summaries, the report, or the clipboard — alongside
 * the pass/fail lines each check defines.
 *
 * These are the pure halves: decode, summarise, evaluate, report. What the
 * page does with them is held in `../HealthPage.test.jsx`.
 */
import { describe, it, expect } from 'vitest';

import {
  buildReport,
  decodeJwtPayload,
  evaluateIdentity,
  evaluateLabsProbe,
  evaluateUnauthenticatedProbe,
  relativeExpiry,
  summarizeAdminStatus,
  summarizeToken,
} from './probes';

const OID = 'a1b2c3d4-oid-of-the-person';
const EMAIL = 'owner@hcw.example';
const NOW_SECONDS = 1_800_000_000;

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const CLAIMS = {
  aud: 'api://api-app-id',
  iss: 'https://login.microsoftonline.com/tenant-1/v2.0',
  tid: 'tenant-1',
  oid: OID,
  sub: 'sub-pairwise-id',
  email: EMAIL,
  preferred_username: EMAIL,
  name: 'The Owner',
  roles: ['Admin'],
  exp: NOW_SECONDS + 3600,
  iat: NOW_SECONDS,
};
const TOKEN = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(CLAIMS)}.signature-bytes`;

const EXPECTATIONS = {
  expectedAudience: 'api://api-app-id',
  tenantId: 'tenant-1',
  adminAppRole: 'Admin',
  registryContainer: 'admins',
};

const ADMIN_STATUS = {
  isAdmin: true,
  uid: OID,
  email: EMAIL,
  role: 'super_admin',
  permissions: ['read:content', 'manage:admins'],
  active: true,
};

/** Every string that must never appear on screen or in the report. */
const SECRETS = [TOKEN, OID, EMAIL, 'sub-pairwise-id', 'The Owner'];
const expectNoSecrets = (text) => {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};

// ── Helpers ───────────────────────────────────────────────────────────────────

describe('decodeJwtPayload', () => {
  it('reads a base64url payload without verifying it', () => {
    expect(decodeJwtPayload(TOKEN)).toMatchObject({ aud: 'api://api-app-id', roles: ['Admin'] });
  });

  it('returns null for anything that is not a JWT', () => {
    expect(decodeJwtPayload('')).toBeNull();
    expect(decodeJwtPayload('not.a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.!!!.c')).toBeNull();
    expect(decodeJwtPayload(undefined)).toBeNull();
  });
});

describe('relativeExpiry', () => {
  it('reads forward and backward', () => {
    const now = NOW_SECONDS * 1000;
    expect(relativeExpiry(NOW_SECONDS + 45, now)).toEqual({ label: 'in 45 s', expired: false });
    expect(relativeExpiry(NOW_SECONDS + 1800, now)).toEqual({ label: 'in 30 min', expired: false });
    expect(relativeExpiry(NOW_SECONDS + 7200, now)).toEqual({ label: 'in 2.0 h', expired: false });
    expect(relativeExpiry(NOW_SECONDS - 120, now)).toEqual({ label: '2 min ago', expired: true });
    expect(relativeExpiry(undefined, now)).toEqual({ label: 'no exp claim', expired: null });
  });
});

describe('summarizeToken', () => {
  it('keeps claim names and the four checked values, and drops the person', () => {
    const summary = summarizeToken(CLAIMS, EXPECTATIONS, NOW_SECONDS * 1000);
    expect(summary.claimNames).toEqual(Object.keys(CLAIMS).sort());
    expect(summary).toMatchObject({
      aud: 'api://api-app-id',
      audienceMatches: true,
      roleNames: ['Admin'],
      hasAdminRole: true,
      tenantMatches: true,
      expiresLabel: 'in 1.0 h',
      expired: false,
    });
    expectNoSecrets(JSON.stringify(summary));
  });

  it('compares exactly, the way the verifier does', () => {
    const drifted = summarizeToken(
      { ...CLAIMS, aud: 'api-app-id', roles: ['admin'] },
      EXPECTATIONS
    );
    expect(drifted.audienceMatches).toBe(false);
    expect(drifted.hasAdminRole).toBe(false);
  });

  it('accepts an array aud the way the verifier does — membership, not a joined string', () => {
    // RFC 7519 allows `aud` to be an array; jsonwebtoken passes when any
    // element equals the expected audience. Joining and comparing would show
    // FAIL for a token the API had just accepted.
    const multi = summarizeToken(
      { ...CLAIMS, aud: ['api://api-app-id', 'api://another-app'] },
      EXPECTATIONS
    );
    expect(multi.audienceMatches).toBe(true);
    expect(multi.aud).toBe('api://api-app-id, api://another-app');

    const absent = summarizeToken({ ...CLAIMS, aud: ['api://another-app'] }, EXPECTATIONS);
    expect(absent.audienceMatches).toBe(false);
    expect(summarizeToken({ ...CLAIMS, aud: [] }, EXPECTATIONS).aud).toBeNull();
  });

  it('reports unknown rather than guessing when the API gave no expectations', () => {
    const summary = summarizeToken(CLAIMS, null);
    expect(summary.audienceMatches).toBeNull();
    expect(summary.hasAdminRole).toBeNull();
    expect(summary.tenantMatches).toBeNull();
    expect(summary.aud).toBe('api://api-app-id'); // the value is still shown
  });

  it('is null without a payload', () => {
    expect(summarizeToken(null, EXPECTATIONS)).toBeNull();
  });
});

describe('summarizeAdminStatus', () => {
  it('compares the uid to the token and keeps only the verdict', () => {
    const summary = summarizeAdminStatus(ADMIN_STATUS, OID);
    expect(summary).toEqual({
      isAdmin: true,
      role: 'super_admin',
      active: true,
      permissions: ['read:content', 'manage:admins'],
      uidPresent: true,
      uidMatchesToken: true,
      emailPresent: true,
    });
    expectNoSecrets(JSON.stringify(summary));
  });

  it('flags a registry keyed on a different principal', () => {
    expect(
      summarizeAdminStatus({ ...ADMIN_STATUS, uid: 'someone-else' }, OID).uidMatchesToken
    ).toBe(false);
    expect(summarizeAdminStatus({ isAdmin: false }, OID).uidMatchesToken).toBeNull();
  });
});

describe('evaluateLabsProbe', () => {
  const good = {
    enqueue: { httpStatus: 200, jobId: 'job-1', type: 'shell-echo', status: 'queued' },
    read: { found: true, status: 'queued' },
    cancel: { httpStatus: 200, status: 'cancelled' },
    final: { status: 'cancelled' },
  };

  it('passes on the documented response with a settled document', () => {
    expect(evaluateLabsProbe(good)).toEqual({
      pass: true,
      reason: 'documented no-op response; document cancelled',
    });
  });

  it('also passes when an agent claimed the job before the cancel — not a hang', () => {
    expect(
      evaluateLabsProbe({
        ...good,
        cancel: { error: 'Job is no longer queued' },
        final: { status: 'running' },
      }).pass
    ).toBe(true);
  });

  it('fails on a 500, a missing document, or a job left queued', () => {
    expect(evaluateLabsProbe({ ...good, enqueue: { httpStatus: 500, error: 'boom' } }).pass).toBe(
      false
    );
    expect(evaluateLabsProbe({ ...good, read: { found: false } }).pass).toBe(false);
    expect(evaluateLabsProbe({ ...good, final: { status: 'queued' } })).toEqual({
      pass: false,
      reason: 'lab_jobs/job-1 is still "queued"',
    });
  });

  it('is unknown before it has run', () => {
    expect(evaluateLabsProbe(null).pass).toBeNull();
  });

  it('never falls back to the earlier read when the closing read returned no status', () => {
    // { status: null } without a throw — the API answered, but with nothing
    // usable. The earlier read said queued; using it would score a state that
    // was never observed at the end of the probe.
    const reason =
      'final lab_jobs/job-1 state unknown — the closing getLabJob read returned no status';
    expect(evaluateLabsProbe({ ...good, final: { status: null } })).toEqual({
      pass: false,
      reason,
    });
    expect(evaluateLabsProbe({ ...good, final: undefined })).toEqual({ pass: false, reason });
    // And it cannot pass on the earlier read either, however settled that was.
    expect(
      evaluateLabsProbe({ ...good, read: { found: true, status: 'cancelled' }, final: null }).pass
    ).toBe(false);

    const report = buildReport({ generatedAt: 'now', labs: { ...good, final: { status: null } } });
    expect(report).toContain(
      'lab_jobs/job-1 final status: unknown — the closing read returned no status'
    );
    expect(report).toContain('Authenticated no-op path: FAIL (final lab_jobs/job-1 state unknown');
    expect(report).not.toContain('still "queued"');
    expect(report).not.toContain('final status: null');
  });

  it('reports a failed final read as its own failure, not as "still queued"', () => {
    // The read-back before the cancel said queued; the read after it failed.
    // Falling back to the earlier status would assert a state nobody observed.
    const verdict = evaluateLabsProbe({
      ...good,
      final: { status: null, error: 'getLabJob timed out after 20s' },
    });
    expect(verdict).toEqual({
      pass: false,
      reason:
        'final getLabJob read failed (getLabJob timed out after 20s) — lab_jobs/job-1 state unknown',
    });

    const report = buildReport({
      generatedAt: 'now',
      labs: { ...good, final: { status: null, error: 'getLabJob timed out after 20s' } },
    });
    expect(report).toContain(
      'lab_jobs/job-1 final status: read failed (getLabJob timed out after 20s) — state unknown'
    );
    expect(report).toContain('Authenticated no-op path: FAIL (final getLabJob read failed');
    expect(report).not.toContain('still "queued"');
  });
});

describe('evaluateUnauthenticatedProbe', () => {
  it('accepts only 401 and 403', () => {
    expect(evaluateUnauthenticatedProbe({ httpStatus: 401 }).pass).toBe(true);
    expect(evaluateUnauthenticatedProbe({ httpStatus: 403 }).pass).toBe(true);
    expect(evaluateUnauthenticatedProbe({ httpStatus: 200 }).pass).toBe(false);
    expect(evaluateUnauthenticatedProbe({ httpStatus: null, error: 'network' }).pass).toBe(false);
    expect(evaluateUnauthenticatedProbe(null).pass).toBeNull();
  });
});

describe('buildReport', () => {
  it('names claims, verdicts and job ids, and nothing that identifies the person', () => {
    const report = buildReport({
      generatedAt: '2026-09-07T00:00:00.000Z',
      token: summarizeToken(CLAIMS, EXPECTATIONS, NOW_SECONDS * 1000),
      expectations: EXPECTATIONS,
      admin: summarizeAdminStatus(ADMIN_STATUS, OID),
      adminHttp: 200,
      labs: {
        enqueue: { httpStatus: 200, jobId: 'job-1', type: 'shell-echo', status: 'queued' },
        read: { found: true, status: 'queued' },
        cancel: { httpStatus: 200, status: 'cancelled' },
        final: { status: 'cancelled' },
      },
      unauth: { httpStatus: 401 },
    });
    expect(report).toContain('### Identity — token claims and admin registry');
    expect(report).toContain(
      'Claims present (names only): aud, email, exp, iat, iss, name, oid, preferred_username, roles, sub, tid'
    );
    expect(report).toContain("`aud` equals the API's ENTRA_API_AUDIENCE: PASS");
    expect(report).toContain('App Role `Admin` present in `roles`: PASS');
    expect(report).toContain('Registry uid equals token oid: PASS');
    expect(report).toContain('- Result: PASS');
    expect(report).toContain('### Labs no-op probe');
    expect(report).toContain('jobId job-1');
    expect(report).toContain('Authenticated no-op path: PASS');
    expect(report).toContain('no Authorization header: PASS (HTTP 401)');
    // Both tickets these checks were built for closed on 2026-09-07. The
    // report is a repeatable check now, so it names no ticket at all.
    expect(report).not.toMatch(/#3\d\d/);
    expectNoSecrets(report);
  });

  it('marks the identity result UNKNOWN, not FAIL, when a comparison could not be made', () => {
    // getAuthExpectations failed, getCurrentAdminStatus succeeded: the two
    // token comparisons have nothing to compare against. That is a gap to
    // name, not a failure to score — and not a pass either.
    const report = buildReport({
      generatedAt: 'now',
      token: summarizeToken(CLAIMS, null),
      expectations: null,
      expectationsError: 'Authentication required',
      admin: summarizeAdminStatus(ADMIN_STATUS, OID),
      adminHttp: 200,
    });
    expect(report).toContain(
      '- Result: UNKNOWN (could not compare: aud matches the API audience; admin App Role present in roles)'
    );
    expect(report).not.toContain('- Result: PASS');
    expect(report).not.toContain('- Result: FAIL');
    expect(report).toContain('- getAuthExpectations: Authentication required');
    expectNoSecrets(report);

    // A real failure still outranks an unknown: FAIL names what failed.
    const mixed = evaluateIdentity(
      summarizeToken(CLAIMS, null),
      summarizeAdminStatus({ ...ADMIN_STATUS, isAdmin: false }, OID)
    );
    expect(mixed).toEqual({ pass: false, reason: 'failed: registry says isAdmin' });
    // And everything present and true is a pass that says so.
    expect(
      evaluateIdentity(
        summarizeToken(CLAIMS, EXPECTATIONS),
        summarizeAdminStatus(ADMIN_STATUS, OID)
      )
    ).toEqual({ pass: true, reason: 'all four comparisons hold' });
    expect(evaluateIdentity(null, null)).toEqual({
      pass: null,
      reason: 'token or registry not read',
    });
  });

  it('marks the identity result FAIL when the registry disagrees with the token', () => {
    const report = buildReport({
      generatedAt: 'now',
      token: summarizeToken(CLAIMS, EXPECTATIONS),
      expectations: EXPECTATIONS,
      admin: summarizeAdminStatus({ isAdmin: false, uid: OID, email: EMAIL }, OID),
      adminHttp: 200,
    });
    expect(report).toContain('isAdmin false');
    expect(report).toContain('- Result: FAIL');
    expect(report).toContain(
      'Authenticated no-op path: UNKNOWN (NOT RUN — press "Run authenticated probe")'
    );
    expect(report).toContain(
      'no Authorization header: UNKNOWN (NOT RUN — press "Run unauthenticated probe")'
    );
    expectNoSecrets(report);
  });

  it('says the identity checks are still running rather than that the token failed', () => {
    // Before the first run settles, "could not be read" would be a lie about
    // work that has not happened yet — and it is what would be recorded.
    const report = buildReport({ generatedAt: 'now', identityPending: true });
    expect(report).toContain('Identity checks: STILL RUNNING — this report is not final');
    expect(report).not.toContain('could not be read');
    expect(report).not.toContain('Result:');
    expect(report).toContain('NOT RUN — press "Run authenticated probe"');
    expect(report).toContain('NOT RUN — press "Run unauthenticated probe"');
  });

  it('is honest about what could not be read', () => {
    const report = buildReport({
      generatedAt: 'now',
      tokenError: 'Not authenticated. Please sign in.',
    });
    expect(report).toContain('Token: could not be read (Not authenticated. Please sign in.)');
    expect(report).toContain('getCurrentAdminStatus: not called');
    expect(report).toContain('- Result: UNKNOWN');
  });
});
