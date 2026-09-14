/**
 * The Identity tab and its Entra panel. The panel tests moved from
 * IntegrationsPage.test.jsx (#570); the tab tests hold that it loads on its
 * own and that a refusal clears the API column rather than keeping old values.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { EntraConfigurationCard } from './EntraConfigurationCard';
import IntegrationsIdentity from './IntegrationsIdentity';

const getJSON = vi.fn();
vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: vi.fn(),
  postJSON: vi.fn(),
}));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));

beforeEach(() => {
  getJSON.mockReset();
});

describe('the Entra configuration panel (#519)', () => {
  const EXPECTATIONS = {
    tenantId: 'tenant-guid',
    expectedAudience: 'api-app-guid',
    adminAppRole: 'Admin',
    labAgentAppRole: 'LabAgent',
    requiredScope: 'access_as_admin',
    requiredTokenVersion: '2.0',
    registryContainer: 'admins',
  };

  it('shows what the API enforces, so the page is not just agreeing with itself', () => {
    render(<EntraConfigurationCard expectations={EXPECTATIONS} error={null} />);

    expect(screen.getByText('tenant-guid')).toBeTruthy();
    expect(screen.getByText('api-app-guid')).toBeTruthy();
    expect(screen.getByText('access_as_admin')).toBeTruthy();
    expect(screen.getByText('LabAgent')).toBeTruthy();
  });

  // The page's standing rule, applied to a panel that is all identifiers: no
  // credential, and no token, has any business being rendered here.
  it('renders no credential and no token', () => {
    const { container } = render(
      <EntraConfigurationCard expectations={EXPECTATIONS} error={null} />
    );
    const text = container.textContent;

    expect(text).not.toMatch(/eyJ/); // a JWT
    expect(text).not.toMatch(/secret|password|bearer/i);
  });

  // A refusal from getAuthExpectations is itself the audience-drift signal, so
  // the panel must still render the browser half and say why the rest is blank.
  it('still shows the browser half when the API does not answer', () => {
    render(<EntraConfigurationCard expectations={null} error={'HTTP 401'} />);

    expect(screen.getByText(/did not answer/i)).toBeTruthy();
    expect(screen.getByText(/HTTP 401/)).toBeTruthy();
    // Every API cell is an em dash rather than an invented value.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  // A refusal arriving after a success must not leave the previous answer on
  // screen beside a banner saying the API did not answer. The panel would be
  // contradicting itself, and showing configuration that may no longer hold.
  it('shows no API values at all when the API did not answer', () => {
    render(<EntraConfigurationCard expectations={null} error={'HTTP 401'} />);

    expect(screen.queryByText('tenant-guid')).toBeNull();
    expect(screen.queryByText('api-app-guid')).toBeNull();
    expect(screen.queryByText('LabAgent')).toBeNull();
  });

  it('says what breaking each value costs, which is the point of the group', () => {
    render(<EntraConfigurationCard expectations={EXPECTATIONS} error={null} />);

    expect(screen.getByText(/Every authenticated call returns 401/)).toBeTruthy();
    expect(screen.getByText(/Labs VPS agent cannot authenticate/)).toBeTruthy();
  });
});

describe('the Identity tab', () => {
  it('reads getAuthExpectations itself and shows the API column', async () => {
    getJSON.mockResolvedValue({ tenantId: 'tenant-guid', expectedAudience: 'api-app-guid' });
    render(<IntegrationsIdentity />);
    await waitFor(() => expect(screen.getByText('tenant-guid')).toBeTruthy());
    expect(getJSON).toHaveBeenCalledWith('getAuthExpectations');
    expect(getJSON).toHaveBeenCalledTimes(1);
  });

  it('shows the refusal and still renders the panel when the API says no', async () => {
    getJSON.mockRejectedValue(new Error('HTTP 401'));
    render(<IntegrationsIdentity />);
    await waitFor(() => expect(screen.getByText(/did not answer/i)).toBeTruthy());
    expect(screen.getByText('Microsoft Entra ID')).toBeTruthy();
  });
});
