/**
 * The double opt-in landing page. The two properties that matter are the ones a
 * shortcut would break: loading the page must confirm nothing (mail scanners
 * pre-fetch links), and the token must come from the fragment and leave the
 * address bar once used.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';

import NewsletterConfirmPage, { readTokenFromHash } from './NewsletterConfirmPage';

vi.mock('@/lib/functionsBase', () => ({ getFunctionsBase: () => 'https://api.example.test/api' }));

const TOKEN = 'eyJ2IjoxfQ.c2lnbmF0dXJl';

const renderPage = () =>
  render(
    <HelmetProvider>
      <NewsletterConfirmPage />
    </HelmetProvider>
  );

const respond = (status, body) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

beforeEach(() => {
  window.history.replaceState(null, '', `/newsletter/confirm#t=${TOKEN}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readTokenFromHash', () => {
  it('reads t from the fragment, and nothing else', () => {
    expect(readTokenFromHash(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(readTokenFromHash('#x=1&t=abc')).toBe('abc');
    expect(readTokenFromHash('')).toBe('');
    expect(readTokenFromHash('#')).toBe('');
  });
});

describe('the confirm page', () => {
  it('confirms NOTHING on load, because mail scanners open every link first', async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(screen.getByRole('button', { name: /confirm subscription/i })).toBeInTheDocument();
    // Give any effect the chance to misbehave.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the fragment token on the press, then clears it from the address bar', async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /confirm subscription/i }));

    await waitFor(() => expect(screen.getByText(/You're subscribed/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/public/newsletter/confirm',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: TOKEN }) })
    );
    expect(window.location.hash).toBe('');
  });

  it('says the link has expired, and how to get a new one, for an invalid token', async () => {
    vi.stubGlobal(
      'fetch',
      respond(400, { ok: false, code: 'INVALID_OR_EXPIRED', error: 'expired' })
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /confirm subscription/i }));

    await waitFor(() => expect(screen.getByText(/This link has expired/)).toBeInTheDocument());
    expect(screen.getByText(/Sign up again/)).toBeInTheDocument();
  });

  it("shows the server's sentence and keeps the button for a failure worth retrying", async () => {
    vi.stubGlobal(
      'fetch',
      respond(502, { ok: false, error: 'We could not confirm your subscription right now.' })
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /confirm subscription/i }));

    await waitFor(() =>
      expect(
        screen.getByText('We could not confirm your subscription right now.')
      ).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: /confirm subscription/i })).not.toBeDisabled();
    // Not cleared: the person needs the token to try again.
    expect(window.location.hash).toBe(`#t=${TOKEN}`);
  });

  it('does not report success for a 2xx whose body does not say ok', async () => {
    vi.stubGlobal('fetch', respond(200, {}));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /confirm subscription/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(/You're subscribed/)).not.toBeInTheDocument();
  });

  it('opened without a token, it offers no button that could only fail', () => {
    window.history.replaceState(null, '', '/newsletter/confirm');
    vi.stubGlobal('fetch', respond(200, { ok: true }));
    renderPage();

    expect(screen.queryByRole('button', { name: /confirm subscription/i })).not.toBeInTheDocument();
    expect(screen.getByText(/This link has expired/)).toBeInTheDocument();
  });
});
