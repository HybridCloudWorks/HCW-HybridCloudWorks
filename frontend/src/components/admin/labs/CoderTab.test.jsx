/**
 * The Coder tab: Coder's dashboard framed on the site, with the runbooks'
 * pages one click away, a Reload that reloads the frame, and the same
 * sign-in link as the lab pane (owner, 2026-10-07).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CoderTab, { CODER_PAGES, DEFAULT_CODER_PAGE, coderPageUrl } from './CoderTab';
import { CODER_ORIGIN, coderSignInUrl } from '@/data/labs/catalogue';
import { PANE_SANDBOX } from '@/pages/shared/LabPanePage';

describe('the pages', () => {
  it('are on Coder’s own origin, start with Workspaces, and include Your tokens for the status-token renewal', () => {
    expect(DEFAULT_CODER_PAGE).toBe('workspaces');
    for (const page of CODER_PAGES) {
      expect(coderPageUrl(page.id)).toBe(`${CODER_ORIGIN}${page.path}`);
      expect(page.path.startsWith('/')).toBe(true);
    }
    expect(CODER_PAGES.map((page) => page.id)).toContain('tokens');
    expect(coderPageUrl('tokens')).toBe(`${CODER_ORIGIN}/settings/tokens`);
    expect(coderPageUrl('nonsense')).toBe(coderPageUrl(DEFAULT_CODER_PAGE));
  });
});

describe('the tab', () => {
  it('frames Workspaces first, with the lab pane’s sandbox, and switches pages on a click', () => {
    render(<CoderTab />);
    const frame = screen.getByTitle('Coder: Workspaces');
    expect(frame.getAttribute('src')).toBe(`${CODER_ORIGIN}/workspaces`);
    expect(frame.getAttribute('sandbox')).toBe(PANE_SANDBOX);
    expect(screen.getByRole('button', { name: 'Workspaces' }).getAttribute('aria-pressed')).toBe(
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Your tokens' }));
    const tokens = screen.getByTitle('Coder: Your tokens');
    expect(tokens.getAttribute('src')).toBe(`${CODER_ORIGIN}/settings/tokens`);
    expect(screen.getByText(/Where the status-token renewal starts/)).toBeTruthy();
    expect(screen.queryByTitle('Coder: Workspaces')).toBeNull();
  });

  it('reloads by remounting the frame at the same address', () => {
    render(<CoderTab />);
    const before = screen.getByTitle('Coder: Workspaces');
    fireEvent.click(screen.getByRole('button', { name: /Reload/ }));
    const after = screen.getByTitle('Coder: Workspaces');
    expect(after).not.toBe(before);
    expect(after.getAttribute('src')).toBe(before.getAttribute('src'));
  });

  it('offers the lab pane’s GitHub sign-in in a new tab', () => {
    render(<CoderTab />);
    const link = screen.getByRole('link', { name: /Sign in with GitHub/ });
    expect(link.getAttribute('href')).toBe(coderSignInUrl());
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
