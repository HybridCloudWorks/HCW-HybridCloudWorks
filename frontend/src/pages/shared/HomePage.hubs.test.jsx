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

import HomePage from './HomePage';

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
    expect(hrefs.at(-1)).toBe('/docker/rss');
    expect(hubs.at(-1)).toHaveTextContent('Docker');
    for (const href of hrefs) expect(href).toMatch(/^\/[a-z]+\/rss$/);
  });
});
