/**
 * The home page's "Quick Access Hubs" (#777): each is a provider's news page,
 * and Docker's joined once Docker had a news feed to read.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));

import { VALID_PROVIDERS } from '@/context/ProviderContext';
import HomePage, { QUICK_ACCESS_HUBS } from './HomePage';

let fetchSpy;
beforeEach(() => {
  // The platform-health check is the page's only request; it has no answer here.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
});
afterEach(() => fetchSpy.mockRestore());

describe('Quick Access Hubs', () => {
  it('links each hub to its provider’s news page, Docker’s last', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );
    const heading = await screen.findByRole('heading', { name: 'Quick Access Hubs' });
    const hubs = within(heading.parentElement.parentElement).getAllByRole('link');
    const hrefs = hubs.map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(QUICK_ACCESS_HUBS.map((hub) => `/${hub.provider}/rss`));
    expect(hrefs.at(-1)).toBe('/docker/rss');
    expect(hubs.at(-1)).toHaveTextContent('Docker');
    expect(hubs.at(-1)).toHaveTextContent('NEW HUB');
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
