/**
 * The home page's "Quick Access Hubs" (#777): each is a provider's news page,
 * and Docker's joined once Docker had a news feed to read.
 *
 * Each hub's note is its feed count, and the count is checked here against
 * the server's own list (functions/src/lib/rss/feeds.js), not against the
 * frontend's copy of it: a hub that says "7 FEEDS" is making a claim about
 * what the news page reads, and only the server file can settle it.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));

// The latest-articles request has nothing to say about hubs.
vi.mock('@/lib/publicApi', () => ({
  fetchPublicContentPage: () => Promise.resolve({ items: [], total: 0 }),
}));

import { VALID_PROVIDERS } from '@/context/ProviderContext';
import { readServerFeeds } from '@/data/readServerFeeds';
import HomePage, { QUICK_ACCESS_HUBS } from './HomePage';

let fetchSpy;
beforeEach(() => {
  // The platform-health check is the page's only other request; it has no answer here.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
});
afterEach(() => fetchSpy.mockRestore());

async function renderHubs() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
  const heading = await screen.findByRole('heading', { name: 'Quick Access Hubs' });
  return within(heading.parentElement.parentElement).getAllByRole('link');
}

describe('Quick Access Hubs', () => {
  it('links each hub to its provider’s news page, Docker’s last', async () => {
    const hubs = await renderHubs();
    const hrefs = hubs.map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(QUICK_ACCESS_HUBS.map((hub) => `/${hub.provider}/rss`));
    expect(hrefs.at(-1)).toBe('/docker/rss');
    expect(hubs.at(-1)).toHaveTextContent('Docker');
  });

  it('prints, for every hub, the number of feeds the server reads for that provider', async () => {
    const server = readServerFeeds();
    const hubs = await renderHubs();
    QUICK_ACCESS_HUBS.forEach((hub, index) => {
      const count = server[hub.provider]?.length;
      expect(count, `${hub.provider} has no feeds on the server`).toBeGreaterThan(0);
      const expected = `${count} ${count === 1 ? 'FEED' : 'FEEDS'}`;
      expect(hubs[index].textContent, hub.provider).toContain(expected);
      // Nothing else that looks like a count may sit beside it.
      expect(hubs[index].textContent.match(/\d+/g), hub.provider).toEqual([String(count)]);
    });
  });

  it('carries no typed-in note, so a count cannot drift from the list again', () => {
    for (const hub of QUICK_ACCESS_HUBS) expect(hub, hub.provider).not.toHaveProperty('note');
  });

  it('has one hub per provider the site serves, each coloured by its own classes', () => {
    const providers = QUICK_ACCESS_HUBS.map((hub) => hub.provider);
    expect([...providers].sort()).toEqual([...VALID_PROVIDERS].sort());
    for (const hub of QUICK_ACCESS_HUBS) {
      // Written out in full, never built from the provider name: Tailwind only
      // generates classes it finds as whole strings in the source.
      expect(hub.hoverBorder, hub.provider).toBe(`hover:border-l-${hub.provider}`);
      expect(hub.iconTone, hub.provider).toMatch(/^dark:text-\S+ group-hover:text-\S+/);
    }
  });
});
