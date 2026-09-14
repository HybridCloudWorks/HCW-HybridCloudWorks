/**
 * NewsletterSignup's owner-set wording and its preview mode (#557). The
 * preview sits on the admin Settings tab and must never be able to subscribe
 * anyone, however it is poked.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/functionsBase', () => ({ getFunctionsBase: () => 'https://api.test/api' }));

import NewsletterSignup from '@/components/shared/NewsletterSignup';
import { DEFAULT_SIGNUP_CONFIG } from '@/lib/newsletterSignup';

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NewsletterSignup', () => {
  it('shows the built-in heading and blurb when given none', () => {
    render(<NewsletterSignup />);
    expect(
      screen.getByRole('heading', { name: DEFAULT_SIGNUP_CONFIG.heading })
    ).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_SIGNUP_CONFIG.blurb)).toBeInTheDocument();
  });

  it('shows a given heading and blurb as literal text', () => {
    const { container } = render(<NewsletterSignup heading="<b>Hi</b>" blurb="<i>there</i>" />);
    expect(screen.getByRole('heading', { name: '<b>Hi</b>' })).toBeInTheDocument();
    expect(screen.getByText('<i>there</i>')).toBeInTheDocument();
    expect(container.querySelector('b, i')).toBeNull();
  });

  it('shows no blurb paragraph for a blank blurb', () => {
    render(<NewsletterSignup heading="Only a heading" blurb="" />);
    // The form follows the heading directly, with no empty paragraph between.
    expect(screen.getByRole('heading', { name: 'Only a heading' }).nextElementSibling.tagName).toBe(
      'FORM'
    );
  });

  it('still subscribes outside preview', async () => {
    render(<NewsletterSignup source="footer" />);
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'a@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  describe('preview', () => {
    it('cannot be typed into or submitted', () => {
      render(<NewsletterSignup preview heading="Preview heading" blurb="Preview blurb" />);
      expect(screen.getByRole('region', { name: 'Newsletter signup preview' })).toBeInTheDocument();
      expect(screen.getByLabelText('Email address')).toBeDisabled();
      const button = screen.getByRole('button', { name: 'Subscribe' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('type', 'button');
    });

    it('sends nothing even when its form is submitted directly', async () => {
      const { container } = render(<NewsletterSignup preview />);
      fireEvent.submit(container.querySelector('form'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
});
