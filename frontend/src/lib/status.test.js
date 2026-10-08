import { describe, it, expect } from 'vitest';
import {
  CONTENT_STATUS,
  FRESHNESS_MS,
  LEGACY_SYSTEM_IDS,
  PULSE_LATE_AFTER_MS,
  SYSTEM_STATUS,
  applyFreshness,
  classifyFailure,
  contentStatusInfo,
  describeAge,
  freshnessWindow,
  hubStatus,
  pulseStatus,
  toSystemStatus,
  worstStatus,
} from './status';

const NOW = Date.parse('2026-10-08T12:00:00.000Z');
const minutesAgo = (n) => new Date(NOW - n * 60 * 1000).toISOString();

describe('toSystemStatus', () => {
  it('has exactly the five states, in the words the owner asked for (#1010)', () => {
    expect(Object.values(SYSTEM_STATUS).map((state) => state.label)).toEqual([
      'Healthy',
      'Degraded',
      'Critical',
      'Offline',
      'Unknown',
    ]);
  });

  it('maps the words older surfaces used onto the five shared states', () => {
    for (const word of ['PASS', 'ok', 'connected', 'Working', 'OPERATIONAL', 'live'])
      expect(toSystemStatus(word)).toBe(SYSTEM_STATUS.healthy);
    for (const word of ['degraded', 'REGIONAL', 'Going live', 'pending'])
      expect(toSystemStatus(word)).toBe(SYSTEM_STATUS.degraded);
    // Answered, but said no.
    for (const word of ['Not configured', 'never', 'FAIL', 'error', 'Broken', 'failing'])
      expect(toSystemStatus(word)).toBe(SYSTEM_STATUS.critical);
    // Did not answer at all.
    for (const word of ['offline', 'down', 'unreachable', 'disconnected'])
      expect(toSystemStatus(word)).toBe(SYSTEM_STATUS.offline);
    for (const word of ['', null, undefined, 'untested', 'stale', 'something-else'])
      expect(toSystemStatus(word)).toBe(SYSTEM_STATUS.unknown);
  });

  it('still reads the two ids used until 2026-10-08, as the states they became', () => {
    // A result stored, cached or passed by an older caller keeps working.
    expect(LEGACY_SYSTEM_IDS).toEqual({ misconfigured: 'critical', unavailable: 'offline' });
    expect(toSystemStatus('misconfigured')).toBe(SYSTEM_STATUS.critical);
    expect(toSystemStatus('unavailable')).toBe(SYSTEM_STATUS.offline);
    expect(SYSTEM_STATUS.misconfigured).toBeUndefined();
    expect(SYSTEM_STATUS.unavailable).toBeUndefined();
  });

  it('gives every state a tone, a label and a help sentence, and Offline a look of its own', () => {
    for (const state of Object.values(SYSTEM_STATUS)) {
      expect(['ok', 'warn', 'bad', 'down', 'muted']).toContain(state.tone);
      expect(state.help).toMatch(/\w+/);
      expect(state.label).toMatch(/^[A-Z]/);
    }
    expect(SYSTEM_STATUS.offline.tone).not.toBe(SYSTEM_STATUS.critical.tone);
  });
});

describe('the transition rules', () => {
  it('calls a refusal or a missing setting critical, and an unreachable dependency offline', () => {
    for (const failure of [
      'Resend is not configured: RESEND_API_KEY is not set',
      'Publer answered 403 - Forbidden',
      'getAiProvider failed with HTTP 500. Try again or check the logs.',
      'Stale: last refreshed 2 d ago. The daily refresh has missed.',
      { message: 'Unauthorized', status: 401 },
      '',
      undefined,
    ]) {
      expect(classifyFailure(failure), String(failure?.message ?? failure)).toBe('critical');
    }
    for (const failure of [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'getOpsHealthSnapshot timed out after 30s (https://x).',
      'Coder is configured but did not answer within 5 s.',
      'Snapshot refused: HTTP 503',
      'timeout after 45000 ms',
      { message: 'Bad gateway', status: 502 },
    ]) {
      expect(classifyFailure(failure), String(failure?.message ?? failure)).toBe('offline');
    }
  });

  it('gives each kind of result its window, the pulse’s its own, and a probe its override', () => {
    expect(PULSE_LATE_AFTER_MS).toBe(15 * 60 * 1000);
    expect(freshnessWindow({ kind: 'snapshot' }, {})).toBe(FRESHNESS_MS.snapshot);
    expect(freshnessWindow({ kind: 'live' }, {})).toBe(24 * 60 * 60 * 1000);
    expect(freshnessWindow({ kind: 'live' }, { checkedBy: 'pulse' })).toBe(FRESHNESS_MS.pulse);
    expect(freshnessWindow({ kind: 'session', freshForMs: 90 * 60 * 1000 }, {})).toBe(5400000);
  });

  it('shows a result past its window as unknown, keeping its last value', () => {
    const fresh = { status: 'healthy', checkedAt: minutesAgo(10) };
    expect(applyFreshness(fresh, FRESHNESS_MS.snapshot, NOW)).toMatchObject({
      status: 'healthy',
      stale: false,
    });
    const old = { status: 'critical', checkedAt: minutesAgo(16), summary: 'Refused.' };
    expect(applyFreshness(old, FRESHNESS_MS.snapshot, NOW)).toMatchObject({
      status: 'unknown',
      stale: true,
      lastStatus: 'critical',
      checkedAt: old.checkedAt,
      summary: 'Refused.',
    });
    // Never checked: no time, nothing to age.
    expect(applyFreshness({ status: 'unknown', checkedAt: null }, 1, NOW)).toMatchObject({
      stale: false,
    });
    // A stored old word is read as its new state on the way through.
    expect(
      applyFreshness({ status: 'unavailable', checkedAt: minutesAgo(1) }, 60000 * 5, NOW)
    ).toMatchObject({ status: 'offline' });
  });

  it('says ages the way the cards do', () => {
    expect(describeAge(minutesAgo(0), NOW)).toBe('just now');
    expect(describeAge(minutesAgo(12), NOW)).toBe('12 min ago');
    expect(describeAge(minutesAgo(180), NOW)).toBe('3 h ago');
    expect(describeAge(minutesAgo(3 * 24 * 60), NOW)).toBe('3 d ago');
    expect(describeAge('not a time', NOW)).toBeNull();
  });

  it('takes the worst known status, and unknown only when nothing is known', () => {
    expect(worstStatus(['healthy', 'degraded', 'unknown'])).toBe('degraded');
    expect(worstStatus(['critical', 'offline'])).toBe('offline');
    expect(worstStatus(['healthy', 'unknown'])).toBe('healthy');
    expect(worstStatus(['unknown', 'unavailable'])).toBe('offline');
    expect(worstStatus([])).toBe('unknown');
  });

  it('calls the pulse late after three missed beats, and the hub with it', () => {
    expect(pulseStatus(null, NOW)).toBe('unknown');
    expect(pulseStatus({ lastBeatAt: minutesAgo(4) }, NOW)).toBe('healthy');
    expect(pulseStatus({ lastBeatAt: minutesAgo(16) }, NOW)).toBe('offline');
    expect(hubStatus({ lastBeatAt: minutesAgo(4) }, ['healthy', 'degraded'], NOW)).toBe('degraded');
    // Late: offline whatever the last results said.
    expect(hubStatus({ lastBeatAt: minutesAgo(16) }, ['healthy'], NOW)).toBe('offline');
    // Never beaten: unknown.
    expect(hubStatus(null, ['healthy'], NOW)).toBe('unknown');
  });
});

describe('contentStatusInfo', () => {
  it('knows every stored status and reads the legacy spellings', () => {
    for (const id of Object.keys(CONTENT_STATUS)) expect(contentStatusInfo(id).id).toBe(id);
    expect(contentStatusInfo('approved_blog').id).toBe('approved');
    expect(contentStatusInfo('published_blog').id).toBe('published');
    expect(contentStatusInfo('approved_news').label).toBe('Approved');
  });

  it('calls an item Live when its Live flag is set, whatever the status says', () => {
    expect(contentStatusInfo({ contentStatus: 'published', Live: true }).label).toBe('Live');
    expect(contentStatusInfo({ contentStatus: 'editing', Live: true }).id).toBe('live');
    expect(contentStatusInfo({ contentStatus: 'rejected', Live: true }).id).toBe('rejected');
  });

  it('shows an unknown status as words rather than throwing', () => {
    expect(contentStatusInfo('some_new_state').label).toBe('some new state');
    expect(contentStatusInfo({}).id).toBe('ingested');
  });
});
