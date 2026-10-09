/**
 * Age, expiry and state, against a fixed clock (#1026). Every date here is
 * chosen relative to NOW so the boundaries read off the page.
 */
import { describe, it, expect } from 'vitest';

import { findCredential } from './register.js';
import {
  CREDENTIAL_STATES,
  DUE_SOON_DAYS,
  SHORT_DUE_SOON_DAYS,
  buildRegisterView,
  computeCredentialStatus,
  countStates,
  dueSoonDays,
  presentCredential,
  resolveLive,
} from './status.js';

const NOW = Date.parse('2026-10-09T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();
const daysAhead = (n) => new Date(NOW + n * DAY).toISOString();

const anthropic = findCredential('kv-anthropic-api-key'); // hand, 365
const swa = findCredential('azure-swa-deployment-token'); // hand, 90
const openai = findCredential('kv-openai-api-key'); // hand, no rule
const coderStatus = findCredential('kv-coder-status-token'); // automation, 90, live
const rotation = findCredential('lab-coder-rotation-credential'); // automation, 365, live
const chatId = findCredential('kv-telegram-chat-id'); // none
const oidc = findCredential('gh-oidc-production'); // self

const status = (entry, sources) => computeCredentialStatus(entry, resolveLive(entry, sources), NOW);

describe('dueSoonDays', () => {
  it('is a month, and two weeks for a rule shorter than half a year', () => {
    expect(dueSoonDays(anthropic)).toBe(DUE_SOON_DAYS);
    expect(dueSoonDays(swa)).toBe(SHORT_DUE_SOON_DAYS);
    expect(dueSoonDays(openai)).toBe(DUE_SOON_DAYS);
  });
});

describe('resolveLive', () => {
  it('takes the Keys tab’s last write for a Key Vault secret', () => {
    const live = resolveLive(anthropic, { secrets: { 'ANTHROPIC-API-KEY': { lastWriteAt: daysAgo(10) } } });
    expect(live).toMatchObject({ lastRotatedAt: daysAgo(10), lastRotatedSource: 'key-vault', expiresAt: null });
  });

  it('takes the later of the Keys tab’s write and the owner’s record', () => {
    const sources = {
      secrets: { 'ANTHROPIC-API-KEY': { lastWriteAt: '2026-01-02T10:00:00.000Z' } },
      records: { 'kv-anthropic-api-key': { rotatedOn: '2026-03-01' } },
    };
    expect(resolveLive(anthropic, sources)).toMatchObject({
      lastRotatedAt: '2026-03-01T00:00:00.000Z',
      lastRotatedSource: 'owner',
      recordedOn: '2026-03-01',
    });
    sources.secrets['ANTHROPIC-API-KEY'].lastWriteAt = '2026-04-01T10:00:00.000Z';
    expect(resolveLive(anthropic, sources).lastRotatedSource).toBe('key-vault');
  });

  it('ignores a recorded date for a credential that takes none, and a date that is not one', () => {
    expect(resolveLive(coderStatus, { records: { 'kv-coder-status-token': { rotatedOn: '2026-10-01' } } }))
      .toMatchObject({ lastRotatedAt: null, recordedOn: null });
    expect(resolveLive(anthropic, { records: { 'kv-anthropic-api-key': { rotatedOn: '2026-02-30' } } }))
      .toMatchObject({ lastRotatedAt: null, recordedOn: null });
  });

  it('reads the lab host’s report for the Coder tokens', () => {
    const coder = {
      statusTokenRotatedAt: daysAgo(3),
      statusTokenExpiresAt: daysAhead(87),
      rotationTokenExpiresAt: daysAhead(200),
    };
    expect(resolveLive(coderStatus, { coder })).toMatchObject({
      lastRotatedAt: daysAgo(3),
      lastRotatedSource: 'lab-host',
      expiresAt: daysAhead(87),
    });
    expect(resolveLive(rotation, { coder })).toMatchObject({ lastRotatedAt: null, expiresAt: daysAhead(200) });
  });

  it('reads an OAuth Connect server’s connection and refresh time, never its token', () => {
    const doc = {
      oauthToken: 'TOKEN-MUST-NOT-TRAVEL',
      oauth: { status: 'connected', connectedAt: daysAgo(5), refreshedAt: daysAgo(1), expiresAt: daysAhead(0.04) },
    };
    const live = resolveLive(findCredential('mcp-replicate'), { mcp: { 'replicate-mcp': doc } });
    expect(live).toEqual({
      lastRotatedAt: daysAgo(1),
      lastRotatedSource: 'oauth',
      recordedOn: null,
      expiresAt: null,
      connection: 'connected',
    });
    expect(JSON.stringify(live)).not.toContain('TOKEN-MUST-NOT-TRAVEL');
  });

  it('tells a failed read (unknown) from an absent document (not connected)', () => {
    const replicate = findCredential('mcp-replicate');
    expect(resolveLive(replicate, { mcp: {} }).connection).toBeNull();
    expect(resolveLive(replicate, { mcp: { 'replicate-mcp': null } }).connection).toBe('not_connected');
    expect(
      resolveLive(replicate, { mcp: { 'replicate-mcp': { oauth: { status: 'disconnected' } } } }).connection
    ).toBe('expired');
  });

  it('reads Plaud’s pasted token by its own fields', () => {
    const plaud = findCredential('mcp-plaud');
    const connected = { oauthToken: 'x', status: 'connected', lastTokenRefresh: daysAgo(0.5) };
    expect(resolveLive(plaud, { mcp: { plaud: connected } })).toMatchObject({
      connection: 'connected',
      lastRotatedAt: daysAgo(0.5),
    });
    expect(resolveLive(plaud, { mcp: { plaud: { oauthToken: 'x', status: 'disconnected' } } }).connection).toBe(
      'expired'
    );
    expect(resolveLive(plaud, { mcp: { plaud: { status: 'untested' } } }).connection).toBe('not_connected');
  });
});

describe('computeCredentialStatus', () => {
  it('estimates a hand credential’s next rotation from its rule and last rotation', () => {
    const result = status(anthropic, { secrets: { 'ANTHROPIC-API-KEY': { lastWriteAt: daysAgo(100) } } });
    expect(result).toMatchObject({
      ageDays: 100,
      expiresAt: daysAhead(265),
      expiryEstimated: true,
      daysLeft: 265,
      state: 'ok',
    });
    expect(result.reason).toBe(`Next rotation due on ${daysAhead(265).slice(0, 10)}.`);
  });

  it('turns due-soon inside the window and overdue past the date', () => {
    const at = (age) => status(anthropic, { secrets: { 'ANTHROPIC-API-KEY': { lastWriteAt: daysAgo(age) } } });
    expect(at(365 - 31).state).toBe('ok');
    expect(at(365 - 30)).toMatchObject({ state: 'due-soon', daysLeft: 30 });
    expect(at(365 - 30).reason).toMatch(/^Rotation due in 30 days, on \d{4}-\d{2}-\d{2}\.$/);
    expect(at(365)).toMatchObject({ state: 'overdue', daysLeft: 0 });
    expect(at(400)).toMatchObject({ state: 'overdue', daysLeft: -35 });
    expect(at(400).reason).toMatch(/^Rotation was due on /);
  });

  it('uses the short window for the 90-day reset', () => {
    const at = (age) => status(swa, { records: { 'azure-swa-deployment-token': { rotatedOn: daysAgo(age).slice(0, 10) } } });
    expect(at(90 - 16).state).toBe('ok');
    expect(at(90 - 14).state).toBe('due-soon');
  });

  it('is unknown for a hand credential with a rule and no date, and says what to do', () => {
    expect(status(anthropic, {})).toMatchObject({
      state: 'unknown',
      ageDays: null,
      expiresAt: null,
      reason: 'No rotation date is known: record when it was last rotated.',
    });
  });

  it('is ok for a hand credential with no rule, whatever its age', () => {
    expect(status(openai, { secrets: { 'OPENAI-API-KEY': { lastWriteAt: daysAgo(900) } } })).toMatchObject({
      state: 'ok',
      ageDays: 900,
      expiresAt: null,
    });
  });

  it('judges an automation credential by its report, and never estimates one', () => {
    // The hand-minted year-long token, written 200 days ago with no report:
    // an estimate from 90 days would call it overdue. It is unknown.
    const unreported = status(coderStatus, {
      secrets: { 'CODER-STATUS-TOKEN': { lastWriteAt: daysAgo(200) } },
    });
    expect(unreported).toMatchObject({ state: 'unknown', ageDays: 200, expiresAt: null });
    const reported = status(coderStatus, {
      coder: { statusTokenRotatedAt: daysAgo(1), statusTokenExpiresAt: daysAhead(10) },
    });
    expect(reported).toMatchObject({ state: 'due-soon', expiryEstimated: false, daysLeft: 10 });
    expect(reported.reason).toMatch(/^Expires in 10 days, on /);
    expect(status(rotation, { coder: { rotationTokenExpiresAt: daysAgo(1) } })).toMatchObject({
      state: 'overdue',
      reason: `Expired on ${daysAgo(1).slice(0, 10)}.`,
    });
  });

  it('is overdue for a signed-out connection and unknown for one never made', () => {
    const replicate = findCredential('mcp-replicate');
    expect(status(replicate, { mcp: { 'replicate-mcp': { oauth: { status: 'disconnected' } } } }).state).toBe(
      'overdue'
    );
    expect(status(replicate, { mcp: { 'replicate-mcp': null } }).state).toBe('unknown');
    expect(status(replicate, { mcp: {} })).toMatchObject({
      state: 'unknown',
      reason: 'Its connection could not be read.',
    });
    expect(
      status(replicate, { mcp: { 'replicate-mcp': { oauthToken: 't', oauth: { status: 'connected' } } } }).state
    ).toBe('ok');
  });

  it('never flags an identifier or a self-renewing identity', () => {
    expect(status(chatId, {}).state).toBe('ok');
    expect(status(oidc, {}).state).toBe('ok');
  });
});

describe('presentCredential and the view', () => {
  it('names every field and carries nothing a source adds', () => {
    const row = presentCredential(
      anthropic,
      { secrets: { 'ANTHROPIC-API-KEY': { lastWriteAt: daysAgo(1), value: 'LEAK', lastWriteVersion: 'v9' } } },
      NOW
    );
    expect(Object.keys(row).sort()).toEqual(
      [
        'ageDays',
        'connection',
        'consumer',
        'daysLeft',
        'dueSoonDays',
        'expiresAt',
        'expiryEstimated',
        'id',
        'issuer',
        'lastRotatedAt',
        'lastRotatedSource',
        'lifetimeDays',
        'name',
        'reason',
        'recordable',
        'recordedOn',
        'renewal',
        'rotate',
        'state',
        'store',
      ].sort()
    );
    expect(JSON.stringify(row)).not.toContain('LEAK');
  });

  it('presents the whole register and counts its states', () => {
    const view = buildRegisterView({}, NOW);
    expect(view.credentials.length).toBeGreaterThan(50);
    const counts = countStates(view.credentials);
    expect(Object.keys(counts)).toEqual(CREDENTIAL_STATES);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(view.credentials.length);
    expect(view.counts).toEqual(counts);
  });
});
