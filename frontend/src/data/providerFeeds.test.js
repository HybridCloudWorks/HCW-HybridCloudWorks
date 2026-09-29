// @vitest-environment node
/**
 * The frontend's feed list is the server's, feed for feed (see providerFeeds.js
 * for why there are two, and readServerFeeds.js for how the server's is read).
 */
import { describe, expect, it } from 'vitest';

import { VALID_PROVIDERS } from '@/context/ProviderContext';
import { PROVIDER_FEEDS, feedCount, feedCountLabel } from './providerFeeds';
import { readServerFeeds } from './readServerFeeds';

describe('PROVIDER_FEEDS (frontend copy)', () => {
  it('finds the server list, and no provider in it is empty', () => {
    const server = readServerFeeds();
    expect(Object.keys(server).length).toBeGreaterThan(0);
    for (const feeds of Object.values(server)) expect(feeds.length).toBeGreaterThan(0);
  });

  it('is the server list: the same providers, feeds, names and addresses, in order', () => {
    expect(PROVIDER_FEEDS).toEqual(readServerFeeds());
  });

  it('has a list for every provider the site serves', () => {
    expect(Object.keys(PROVIDER_FEEDS).sort()).toEqual([...VALID_PROVIDERS].sort());
  });

  it('labels counts the way the hubs print them', () => {
    expect(feedCount('azure')).toBe(PROVIDER_FEEDS.azure.length);
    expect(feedCountLabel('docker')).toBe('1 FEED');
    expect(feedCountLabel('aws')).toBe(`${PROVIDER_FEEDS.aws.length} FEEDS`);
    expect(feedCount('nope')).toBe(0);
    expect(feedCountLabel('nope')).toBe('0 FEEDS');
  });

  it('refuses a server file it cannot read, rather than passing on nothing', () => {
    expect(() => readServerFeeds('export const OTHER = 1;')).toThrow(/no longer declares/);
    expect(() => readServerFeeds('export const PROVIDER_FEEDS = Object.freeze({')).toThrow(
      /no closing/
    );
  });
});
