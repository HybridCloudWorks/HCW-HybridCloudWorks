import { describe, it, expect } from 'vitest';
import {
  agentWords,
  arcStatusWord,
  capacityWords,
  heartbeatAgeWords,
  plural,
  policyWords,
} from './labsWords';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

describe('heartbeatAgeWords', () => {
  it.each([
    [ago(10_000), 'just now'],
    [ago(50_000), '50 seconds ago'],
    [ago(60_000), '1 minute ago'],
    [ago(4 * 60_000), '4 minutes ago'],
    [ago(59 * 60_000), '59 minutes ago'],
    [ago(60 * 60_000), '1 hour ago'],
    [ago(5 * 3_600_000), '5 hours ago'],
    [ago(26 * 3_600_000), '1 day ago'],
    [ago(3 * 86_400_000), '3 days ago'],
  ])('%s -> %s', (iso, words) => {
    expect(heartbeatAgeWords(iso, NOW)).toBe(words);
  });

  it('says so when there is no heartbeat, and does not guess at garbage', () => {
    expect(heartbeatAgeWords(null, NOW)).toBe('no heartbeat recorded');
    expect(heartbeatAgeWords(undefined, NOW)).toBe('no heartbeat recorded');
    expect(heartbeatAgeWords('yesterday-ish', NOW)).toBe('unknown');
  });

  it('treats a future timestamp as just now rather than a negative age', () => {
    expect(heartbeatAgeWords(new Date(NOW + 30_000).toISOString(), NOW)).toBe('just now');
  });

  it('falls back to the real clock when the reference is missing or unparseable', () => {
    // An estate whose `asOf` did not parse still gets an age, from now.
    expect(heartbeatAgeWords(new Date(Date.now() - 3 * 86_400_000).toISOString(), NaN)).toBe(
      '3 days ago'
    );
    expect(heartbeatAgeWords(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe(
      '3 days ago'
    );
  });
});

describe('the other words', () => {
  it('maps the four Arc statuses and nothing else', () => {
    expect(arcStatusWord('Connected')).toBe('connected');
    expect(arcStatusWord('Disconnected')).toBe('disconnected');
    expect(arcStatusWord('Expired')).toBe('expired');
    expect(arcStatusWord('Unknown')).toBe('unknown');
    expect(arcStatusWord('<script>')).toBe('unknown');
    expect(arcStatusWord(undefined)).toBe('unknown');
  });

  it('pluralises', () => {
    expect(plural(1, 'job')).toBe('1 job');
    expect(plural(0, 'job')).toBe('0 jobs');
  });

  it('describes capacity, policy and the agent in words', () => {
    expect(capacityWords({ running: 1, max: 5 })).toBe('1 of 5 workspaces running');
    expect(capacityWords({ running: 0, max: 1 })).toBe('0 of 1 workspace running');
    expect(capacityWords(null)).toBe('capacity unknown');
    expect(policyWords({ compliant: 12, nonCompliant: 1 })).toBe('12 compliant, 1 non-compliant');
    expect(policyWords(null)).toBe('not evaluated');
    expect(agentWords({ online: true, queued: 2 })).toBe('online, 2 jobs queued');
    expect(agentWords({ online: false, queued: 0 })).toBe('offline, 0 jobs queued');
    expect(agentWords(null)).toBe('not registered');
  });
});
