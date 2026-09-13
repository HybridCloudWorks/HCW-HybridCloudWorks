/**
 * The settings card must never offer a save it cannot make safely: after a
 * failed load its fields would hold defaults, and saving them would overwrite
 * the real settings.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import NewsletterSettingsCard from './NewsletterSettingsCard';

const getJSON = vi.fn();
const sendJSON = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
}));

const STORED = {
  postalAddress: 'PO Box 1',
  replyTo: 'owner@example.com',
  sendDay: 'thursday',
  sendTime: '07:30',
  timeZone: 'Europe/London',
};

beforeEach(() => {
  getJSON.mockReset();
  sendJSON.mockReset();
});

describe('NewsletterSettingsCard', () => {
  it('shows the stored settings for editing', async () => {
    getJSON.mockResolvedValue({ value: STORED });
    render(<NewsletterSettingsCard />);
    expect(await screen.findByLabelText('Reply-to address')).toHaveValue('owner@example.com');
    expect(screen.getByLabelText('Send day')).toHaveValue('thursday');
  });

  it('offers no form, and so no save, when the settings could not be loaded', async () => {
    getJSON.mockRejectedValue(new Error('Network error'));
    render(<NewsletterSettingsCard />);
    expect(await screen.findByText(/could not be loaded.*Network error/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save settings/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Postal address')).not.toBeInTheDocument();
    expect(sendJSON).not.toHaveBeenCalled();
  });

  it('loads the real values on retry, and only then shows the form', async () => {
    getJSON
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ value: STORED });
    render(<NewsletterSettingsCard />);
    fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
    expect(await screen.findByLabelText('Postal address')).toHaveValue('PO Box 1');
    expect(getJSON).toHaveBeenCalledTimes(2);
  });

  it('saves what is on the form', async () => {
    getJSON.mockResolvedValue({ value: STORED });
    sendJSON.mockResolvedValue({ value: { ...STORED, replyTo: 'new@example.com' } });
    const onSaved = vi.fn();
    render(<NewsletterSettingsCard onSaved={onSaved} />);
    fireEvent.change(await screen.findByLabelText('Reply-to address'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith('cms/platform-settings/newsletter-settings', 'PUT', {
        ...STORED,
        replyTo: 'new@example.com',
      })
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
