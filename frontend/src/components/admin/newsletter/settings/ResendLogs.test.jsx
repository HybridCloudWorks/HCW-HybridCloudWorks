/**
 * API logs on the Settings tab. What must hold: rows with their status
 * coloured by class, paging by `next_after`, and a row's redacted bodies shown
 * as text only — a body carrying markup must render literally, never as HTML.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import ResendLogs, { statusClass } from './ResendLogs';

const getJSON = vi.fn();
vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: vi.fn(),
}));

const refusal = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

const LOGS = [
  {
    id: 'l-1111',
    created_at: '2026-09-12T09:00:00.000Z',
    method: 'GET',
    endpoint: '/domains',
    response_status: 200,
  },
  {
    id: 'l-2222',
    created_at: '2026-09-12T09:01:00.000Z',
    method: 'POST',
    endpoint: '/contacts',
    response_status: 422,
  },
  {
    id: 'l-3333',
    created_at: '2026-09-12T09:02:00.000Z',
    method: 'PATCH',
    endpoint: '/domains/d-1',
    response_status: 503,
  },
];

const INJECTION = '<img src=x onerror="alert(1)">';

beforeEach(() => {
  getJSON.mockReset();
  getJSON.mockImplementation(async (route) => {
    if (route === 'cms/mailing-list/logs/l-2222') {
      return {
        ok: true,
        log: {
          ...LOGS[1],
          request_body: { email: '[redacted email]', html: INJECTION },
          response_body: { name: 'validation_error', message: INJECTION },
        },
      };
    }
    if (route.includes('after=l-3333')) {
      return {
        ok: true,
        logs: [{ ...LOGS[0], id: 'l-4444', endpoint: '/emails' }],
        has_more: false,
        next_after: null,
      };
    }
    return { ok: true, logs: LOGS, has_more: true, next_after: 'l-3333' };
  });
});

const rowFor = async (endpoint) =>
  (await screen.findByRole('button', { name: endpoint })).closest('tr');

describe('statusClass', () => {
  it('groups statuses by hundred', () => {
    expect(statusClass(204)).toBe('2xx');
    expect(statusClass(429)).toBe('4xx');
    expect(statusClass(502)).toBe('5xx');
    expect(statusClass(undefined)).toBe('other');
  });
});

describe('ResendLogs', () => {
  it('lists method, endpoint and status, coloured by class, and loads more', async () => {
    render(<ResendLogs />);
    const ok = await rowFor('/domains');
    expect(within(ok).getByText('GET')).toBeInTheDocument();
    const okStatus = within(ok).getByText('200');
    expect(okStatus).toHaveAttribute('data-status-group', '2xx');
    expect(okStatus.className).toMatch(/green/);
    const client = within(await rowFor('/contacts')).getByText('422');
    expect(client).toHaveAttribute('data-status-group', '4xx');
    expect(client.className).toMatch(/amber/);
    const server = within(await rowFor('/domains/d-1')).getByText('503');
    expect(server).toHaveAttribute('data-status-group', '5xx');
    expect(server.className).toMatch(/red/);
    expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/logs?limit=20');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('button', { name: '/emails' })).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/logs?limit=20&after=l-3333');
  });

  it('opens a row on its redacted bodies as text, never as HTML', async () => {
    const { container } = render(<ResendLogs />);
    const button = await screen.findByRole('button', { name: '/contacts' });
    fireEvent.click(button);
    await waitFor(() => expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/logs/l-2222'));
    expect(await screen.findByText('Request body')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');

    const bodies = container.querySelectorAll('pre');
    expect(bodies).toHaveLength(2);
    expect(bodies[0].textContent).toContain('"email": "[redacted email]"');
    expect(bodies[0].textContent).toContain('onerror');
    expect(bodies[1].textContent).toContain('"name": "validation_error"');
    expect(container.querySelector('img')).toBeNull();

    fireEvent.click(button);
    expect(screen.queryByText('Request body')).not.toBeInTheDocument();
  });

  it('shows the server’s message when the detail is refused', async () => {
    getJSON.mockImplementation(async (route) => {
      if (route.startsWith('cms/mailing-list/logs/')) {
        throw refusal(403, 'This action requires the publisher role');
      }
      return { ok: true, logs: LOGS, has_more: false, next_after: null };
    });
    render(<ResendLogs />);
    fireEvent.click(await screen.findByRole('button', { name: '/domains' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This action requires the publisher role'
    );
  });

  it('says Resend is not configured on a 503', async () => {
    getJSON.mockRejectedValue(refusal(503, 'Resend is not configured'));
    render(<ResendLogs />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Resend is not configured/);
  });

  it('says how long to wait on a 429', async () => {
    getJSON.mockRejectedValue(refusal(429, 'rate_limit_exceeded', { retryAfterSeconds: 12 }));
    render(<ResendLogs />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait 12 seconds, then try again.');
  });
});
