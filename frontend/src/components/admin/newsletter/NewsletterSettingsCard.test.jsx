/**
 * The settings card must never offer a save it cannot make safely: after a
 * failed load its fields would hold defaults, and saving them would overwrite
 * the real settings.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

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
  sections: [
    { id: 'articles', enabled: true, maxItems: 12 },
    { id: 'certification-news', enabled: true, maxItems: 12 },
    { id: 'episodes', enabled: false, maxItems: 4 },
  ],
  windowDays: 7,
  introEnabled: true,
  introTone: 'professional',
};

const OPTIONS = {
  sections: [
    { id: 'articles', title: 'New on HybridCloudWorks' },
    { id: 'certification-news', title: 'Certification news' },
    { id: 'episodes', title: 'Listen & learn' },
  ],
  introTones: ['professional', 'friendly', 'concise', 'enthusiastic'],
  windowDays: { min: 1, max: 31 },
  maxItems: { min: 1, max: 20 },
};

const ROUTE = 'cms/platform-settings/newsletter-settings';

/** Section titles in the order the list shows them. */
const sectionOrder = () =>
  within(screen.getByRole('list', { name: 'Sections' }))
    .getAllByRole('checkbox')
    .map((box) => box.labels[0].textContent);

async function renderLoaded(value = STORED) {
  getJSON.mockResolvedValue({ value, options: OPTIONS });
  const utils = render(<NewsletterSettingsCard />);
  await screen.findByRole('list', { name: 'Sections' });
  return utils;
}

const save = () => fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

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
    expect(screen.queryByLabelText('Days back')).not.toBeInTheDocument();
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
    save();
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith(ROUTE, 'PUT', {
        ...STORED,
        replyTo: 'new@example.com',
      })
    );
    expect(onSaved).toHaveBeenCalled();
  });

  describe('Content', () => {
    it('shows the saved sections in order, with their switches, counts, window and intro', async () => {
      await renderLoaded({
        ...STORED,
        sections: [STORED.sections[2], STORED.sections[0], STORED.sections[1]],
        windowDays: 14,
        introTone: 'friendly',
      });
      expect(sectionOrder()).toEqual([
        'Listen & learn',
        'New on HybridCloudWorks',
        'Certification news',
      ]);
      expect(screen.getByLabelText('Listen & learn')).not.toBeChecked();
      expect(screen.getByLabelText('New on HybridCloudWorks')).toBeChecked();
      expect(screen.getByLabelText('Most items in Listen & learn')).toHaveValue(4);
      expect(screen.getByLabelText('Days back')).toHaveValue(14);
      expect(screen.getByRole('switch', { name: 'AI intro' })).toBeChecked();
      expect(screen.getByLabelText('Intro tone')).toHaveValue('friendly');
    });

    it('saves toggled sections, a new order and new counts, then shows what the server stored', async () => {
      await renderLoaded();
      fireEvent.click(screen.getByLabelText('Listen & learn'));
      fireEvent.click(screen.getByLabelText('Certification news'));
      fireEvent.click(screen.getByRole('button', { name: 'Move Listen & learn up' }));
      fireEvent.change(screen.getByLabelText('Most items in New on HybridCloudWorks'), {
        target: { value: '5' },
      });
      fireEvent.change(screen.getByLabelText('Days back'), { target: { value: '10' } });
      const sections = [
        { id: 'articles', enabled: true, maxItems: 5 },
        { id: 'episodes', enabled: true, maxItems: 4 },
        { id: 'certification-news', enabled: false, maxItems: 12 },
      ];
      // A stored value unlike the one sent, so the test can tell which one the form shows.
      sendJSON.mockResolvedValue({
        value: { ...STORED, sections, windowDays: 12 },
        options: OPTIONS,
      });
      save();
      await waitFor(() => expect(sendJSON).toHaveBeenCalledTimes(1));
      expect(sendJSON).toHaveBeenCalledWith(ROUTE, 'PUT', { ...STORED, sections, windowDays: 10 });
      expect(await screen.findByText('Newsletter settings saved.')).toBeInTheDocument();
      expect(screen.getByLabelText('Days back')).toHaveValue(12);
      expect(sectionOrder()).toEqual([
        'New on HybridCloudWorks',
        'Listen & learn',
        'Certification news',
      ]);
    });

    it('saves the intro switched off and the chosen tone', async () => {
      await renderLoaded();
      fireEvent.change(screen.getByLabelText('Intro tone'), { target: { value: 'concise' } });
      fireEvent.click(screen.getByRole('switch', { name: 'AI intro' }));
      sendJSON.mockResolvedValue({
        value: { ...STORED, introEnabled: false, introTone: 'concise' },
      });
      save();
      await waitFor(() =>
        expect(sendJSON).toHaveBeenCalledWith(ROUTE, 'PUT', {
          ...STORED,
          introEnabled: false,
          introTone: 'concise',
        })
      );
      expect(await screen.findByText('Newsletter settings saved.')).toBeInTheDocument();
      expect(screen.getByLabelText('Intro tone')).toBeDisabled();
    });

    it('does not move the first section up or the last one down', async () => {
      await renderLoaded();
      expect(
        screen.getByRole('button', { name: 'Move New on HybridCloudWorks up' })
      ).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move Listen & learn down' })).toBeDisabled();
    });

    it('refuses to save with every section off or a count left blank, and says why', async () => {
      await renderLoaded();
      fireEvent.click(screen.getByLabelText('New on HybridCloudWorks'));
      fireEvent.click(screen.getByLabelText('Certification news'));
      save();
      expect(await screen.findByText('Turn on at least one section.')).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText('Certification news'));
      fireEvent.change(screen.getByLabelText('Most items in Certification news'), {
        target: { value: '' },
      });
      save();
      expect(
        await screen.findByText('Enter how many items each section may show.')
      ).toBeInTheDocument();
      expect(sendJSON).not.toHaveBeenCalled();
    });

    it('sends one save for a double click', async () => {
      await renderLoaded();
      let finish;
      sendJSON.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const form = screen.getByRole('button', { name: /save settings/i }).closest('form');
      fireEvent.submit(form);
      fireEvent.submit(form);
      expect(sendJSON).toHaveBeenCalledTimes(1);
      finish({ value: STORED });
      expect(await screen.findByText('Newsletter settings saved.')).toBeInTheDocument();
    });

    it('never lets an earlier load overwrite a later one', async () => {
      let resolveFirst;
      getJSON
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            })
        )
        .mockResolvedValueOnce({ value: { ...STORED, windowDays: 21 }, options: OPTIONS });
      const { unmount } = render(<NewsletterSettingsCard />);
      unmount();
      render(<NewsletterSettingsCard />);
      expect(await screen.findByLabelText('Days back')).toHaveValue(21);
      resolveFirst({ value: { ...STORED, windowDays: 3 }, options: OPTIONS });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.getByLabelText('Days back')).toHaveValue(21);
    });
  });
});
