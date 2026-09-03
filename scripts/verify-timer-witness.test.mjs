/**
 * The witness reader's pure parts, plus the one test that keeps the witness
 * table honest: it must name exactly the timers the app registers. A timer
 * added to schedulers.js without a row here is a timer with no arming gate,
 * and that must fail CI rather than be discovered during a cutover.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs, judge, WITNESSES, PROVIDERS, DEFAULT_BASE } from './verify-timer-witness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fn = (rel) => readFileSync(path.join(here, '..', 'functions', 'src', 'functions', rel), 'utf8');

describe('the witness table matches what the app registers', () => {
  it('names every timer in schedulers.js and jobs-sweeper.js, and nothing else', () => {
    const registered = new Set();
    for (const m of fn('schedulers.js').matchAll(/^timer\('([A-Za-z]+)'/gm)) registered.add(m[1]);
    for (const m of fn('jobs-sweeper.js').matchAll(/app\.timer\('([A-Za-z]+)'/g)) registered.add(m[1]);
    expect(registered.size).toBe(18);
    expect(new Set(Object.keys(WITNESSES))).toEqual(registered);
  });

  it('gives every row either a witness or a stated reason there is none', () => {
    for (const [name, entry] of Object.entries(WITNESSES)) {
      const hasWitness = Array.isArray(entry.routes) && typeof entry.extract === 'function' && !!entry.witness;
      const hasReason = typeof entry.none === 'string' && entry.none.length > 0;
      expect(hasWitness !== hasReason, `${name} must be exactly one of witnessed or explained`).toBe(true);
    }
  });

  it('queries the feed route for the same providers the ingest is configured with', () => {
    const feeds = readFileSync(path.join(here, '..', 'functions', 'src', 'lib', 'rss', 'feeds.js'), 'utf8');
    const block = feeds.slice(feeds.indexOf('PROVIDER_FEEDS = Object.freeze({'), feeds.indexOf('export const PROVIDERS'));
    const configured = [...block.matchAll(/^\s{2}([a-z]+): \[/gm)].map((m) => m[1]);
    expect(new Set(PROVIDERS)).toEqual(new Set(configured));
  });
});

describe('extractors', () => {
  it('syncRssFeeds reads refreshedAt from every cache document and drops blanks', () => {
    const body = { rssCache: [{ refreshedAt: '2026-09-03T05:00:01Z' }, { refreshedAt: '' }, {}] };
    expect(WITNESSES.syncRssFeeds.extract(body)).toEqual(['2026-09-03T05:00:01Z']);
    expect(WITNESSES.syncRssFeeds.extract({})).toEqual([]);
  });

  it('fetchPodcastFeeds reads updatedAt from items', () => {
    expect(WITNESSES.fetchPodcastFeeds.extract({ items: [{ updatedAt: 'a' }, { updatedAt: 'b' }] })).toEqual(['a', 'b']);
    expect(WITNESSES.fetchPodcastFeeds.extract({ items: [] })).toEqual([]);
  });

  it('publishScheduledContent reads publishedAt from items', () => {
    expect(WITNESSES.publishScheduledContent.extract({ items: [{ publishedAt: 'p' }] })).toEqual(['p']);
  });
});

describe('judge', () => {
  it('passes when the newest stamp is at or after --since', () => {
    const v = judge(['2026-09-03T04:00:00Z', '2026-09-03T05:00:00Z'], '2026-09-03T05:00:00Z');
    expect(v).toEqual({ count: 2, newest: '2026-09-03T05:00:00.000Z', fresh: true });
  });

  it('fails when everything is older than --since', () => {
    expect(judge(['2026-09-02T21:00:00Z'], '2026-09-03T05:00:00Z').fresh).toBe(false);
  });

  it('reports zero stamps as not fresh, with no newest', () => {
    expect(judge([], '2026-09-03T05:00:00Z')).toEqual({ count: 0, newest: null, fresh: false });
  });

  it('never lets a malformed stamp count as evidence', () => {
    expect(judge(['not a date', 'also-not'], '2026-09-03T05:00:00Z')).toEqual({ count: 0, newest: null, fresh: false });
    expect(judge(['not a date', '2026-09-02T00:00:00Z'], '2026-09-03T05:00:00Z').count).toBe(1);
  });

  it('refuses an unparseable --since rather than comparing against NaN', () => {
    expect(() => judge(['2026-09-03T05:00:00Z'], 'yesterday')).toThrow(/parseable/);
  });
});

describe('parseArgs', () => {
  it('defaults the base to the Cloudflare host and strips trailing slashes', () => {
    expect(parseArgs([]).base).toBe(DEFAULT_BASE);
    expect(parseArgs(['--base', 'https://x/api///']).base).toBe('https://x/api');
  });

  it('reads --timer and --since', () => {
    const a = parseArgs(['--timer', 'syncRssFeeds', '--since', '2026-09-03T05:00:00Z']);
    expect(a.timer).toBe('syncRssFeeds');
    expect(a.since).toBe('2026-09-03T05:00:00Z');
  });
});
