/**
 * The page an MCP vendor's sign-in returns to (2026-10-08). It succeeds by
 * leaving: so each case renders it under a real router at the callback URL
 * and asserts where it went and what it carried — the MCP Servers tab, with
 * the result for the banner, the code-bearing address replaced.
 */
import React, { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const completeMcpOAuth = vi.fn();
vi.mock('@/lib/aiEngine', () => ({
  aiEngine: { completeMcpOAuth: (...a) => completeMcpOAuth(...a) },
}));

const {
  default: McpOAuthCallbackPage,
  connectedResult,
  providerErrorMessage,
} = await import('./McpOAuthCallbackPage.jsx');

function McpTabProbe() {
  const location = useLocation();
  return (
    <div>
      <span data-testid="where">{`${location.pathname}${location.search}`}</span>
      <span data-testid="tone">{location.state?.mcpOAuth?.tone}</span>
      <span data-testid="message">{location.state?.mcpOAuth?.message}</span>
    </div>
  );
}

function renderCallback(search, { strict = false } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[`/admin/ai-engine/oauth/callback${search}`]}>
      <Routes>
        <Route path="/admin/ai-engine/oauth/callback" element={<McpOAuthCallbackPage />} />
        <Route path="/admin/ai-engine" element={<McpTabProbe />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

beforeEach(() => {
  completeMcpOAuth.mockReset();
});

describe('McpOAuthCallbackPage', () => {
  it('completes with the code and state, then shows the result on the MCP Servers tab', async () => {
    completeMcpOAuth.mockResolvedValue({
      connected: true,
      serverId: 'hostinger-mcp',
      serverName: 'Hostinger MCP',
      toolCount: 12,
    });
    renderCallback('?code=the-code&state=the-state');
    expect(screen.getByText('Finishing sign-in…')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/admin/ai-engine?tab=mcp')
    );
    expect(completeMcpOAuth).toHaveBeenCalledWith({ state: 'the-state', code: 'the-code' });
    expect(screen.getByTestId('tone').textContent).toBe('success');
    expect(screen.getByTestId('message').textContent).toBe(
      'Hostinger MCP is connected. 12 tools synced.'
    );
  });

  it('forwards the issuer the provider named (RFC 9207) for the API to check', async () => {
    completeMcpOAuth.mockResolvedValue({ serverName: 'Hostinger MCP', toolCount: 3 });
    renderCallback('?code=c&state=s&iss=https%3A%2F%2Fauth.hostinger.com');
    await waitFor(() => expect(completeMcpOAuth).toHaveBeenCalled());
    expect(completeMcpOAuth.mock.calls[0][0]).toEqual({
      state: 's',
      code: 'c',
      iss: 'https://auth.hostinger.com',
    });
  });

  it('shows the provider’s own message when the sign-in came back with an error', async () => {
    renderCallback('?error=access_denied&error_description=The+user+denied+access&state=s');
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/admin/ai-engine?tab=mcp')
    );
    expect(completeMcpOAuth).not.toHaveBeenCalled();
    expect(screen.getByTestId('tone').textContent).toBe('error');
    expect(screen.getByTestId('message').textContent).toBe(
      'The sign-in was not completed. The provider said: The user denied access'
    );
  });

  it('says so when the provider sent no code', async () => {
    renderCallback('?state=only-state');
    await waitFor(() =>
      expect(screen.getByTestId('message').textContent).toMatch(/without a code/)
    );
    expect(completeMcpOAuth).not.toHaveBeenCalled();
  });

  it('shows the API’s sentence when it refuses the completion', async () => {
    completeMcpOAuth.mockRejectedValue(
      new Error(
        'The sign-in for Hostinger MCP took longer than 10 minutes, so it was not accepted.'
      )
    );
    renderCallback('?code=c&state=s');
    await waitFor(() => expect(screen.getByTestId('tone').textContent).toBe('error'));
    expect(screen.getByTestId('message').textContent).toMatch(/longer than 10 minutes/);
  });

  it('completes once, even when React runs the effect twice', async () => {
    completeMcpOAuth.mockResolvedValue({ serverName: 'Replicate MCP', toolCount: 1 });
    renderCallback('?code=c&state=s', { strict: true });
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/admin/ai-engine?tab=mcp')
    );
    expect(completeMcpOAuth).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('message').textContent).toBe(
      'Replicate MCP is connected. 1 tool synced.'
    );
  });
});

describe('the result sentences', () => {
  it('say when the connection worked but the tool sync did not', () => {
    expect(
      connectedResult({
        serverName: 'Replicate MCP',
        toolCount: 0,
        syncError: 'SSE MCP request timed out',
      })
    ).toEqual({
      tone: 'warning',
      message:
        'Replicate MCP is connected, but its tool sync failed: SSE MCP request timed out Press Sync Tools on its card to try again.',
    });
  });

  it('name a declined sign-in plainly, and clip what a provider says', () => {
    expect(providerErrorMessage('access_denied')).toBe(
      'The sign-in was declined at the provider, so nothing was connected.'
    );
    expect(providerErrorMessage('server_error', 'x'.repeat(400))).toHaveLength(
      'The sign-in was not completed. The provider said: '.length + 301
    );
  });
});
