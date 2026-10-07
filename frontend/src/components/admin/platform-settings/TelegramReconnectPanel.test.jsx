/**
 * The Telegram reconnect panel: the bot's QR at a fixed size with alt text
 * naming the handle, the handle as a link to the bot, a full-size link to the
 * same imported asset, the three re-pairing steps, and the Test Telegram
 * button beside them inside the Reminders card (owner, 2026-10-07).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import TelegramReconnectPanel, {
  BOT_HANDLE,
  BOT_QR_ALT,
  BOT_QR_SRC,
  BOT_URL,
  KEYS_HREF,
} from './TelegramReconnectPanel';
import { RemindersCard } from './RemindersTab';
import telegramBotQr from '@/assets/admin/telegram-bot-qr.png';

vi.mock('@/lib/api', () => ({
  getJSON: vi.fn(),
  sendJSON: vi.fn(),
  postJSON: vi.fn(),
}));

const meta = { exists: true, stored: 'valid', updatedAt: null, problem: null };

describe('TelegramReconnectPanel', () => {
  it('shows the QR from the imported asset, with alt text naming the bot handle', () => {
    render(<TelegramReconnectPanel />);
    const img = screen.getByRole('img', { name: BOT_QR_ALT });
    expect(BOT_QR_ALT).toContain('@agenticarchitectbot');
    expect(BOT_QR_SRC).toBe(telegramBotQr);
    expect(img.getAttribute('src')).toBe(telegramBotQr);
    expect(img.getAttribute('src')).toMatch(/telegram-bot-qr.*\.png/);
    // The 2:3 box is reserved before the image loads, and the width is fixed.
    expect(img.getAttribute('width')).toBe('1024');
    expect(img.getAttribute('height')).toBe('1536');
    const figure = img.closest('figure');
    expect(figure.className).toContain('sm:w-[220px]');
    expect(figure.className).toContain('w-[60vw]');
  });

  it('links the handle to the bot in a new tab', () => {
    render(<TelegramReconnectPanel />);
    const link = screen.getByRole('link', { name: BOT_HANDLE });
    expect(BOT_URL).toBe('https://t.me/agenticarchitectbot');
    expect(link.getAttribute('href')).toBe(BOT_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('opens the same imported asset full size, in a new tab', () => {
    render(<TelegramReconnectPanel />);
    const link = screen.getByRole('link', { name: 'Open full size' });
    expect(link.getAttribute('href')).toBe(telegramBotQr);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('lists the three re-pairing steps: scan, Start, Test Telegram', () => {
    render(<TelegramReconnectPanel />);
    expect(screen.getByText('If the phone loses the bot')).toBeTruthy();
    const steps = within(screen.getByRole('list', { name: 'Reconnect steps' })).getAllByRole(
      'listitem'
    );
    expect(steps).toHaveLength(3);
    expect(steps[0].textContent).toMatch(/Scan the code/);
    expect(steps[1].textContent).toMatch(/press Start/);
    expect(steps[1].textContent).toMatch(/Unblock or Restart/);
    expect(steps[2].textContent).toMatch(/Press Test Telegram/);
  });

  it('names the chat id rule and links to where the id is changed', () => {
    render(<TelegramReconnectPanel />);
    expect(screen.getByText(/TELEGRAM_CHAT_ID/)).toBeTruthy();
    const keys = screen.getByRole('link', { name: 'Integrations, Keys' });
    expect(KEYS_HREF).toBe('/admin/integrations?tab=keys');
    expect(keys.getAttribute('href')).toBe(KEYS_HREF);
  });

  it('sits in the Reminders card around the one Test Telegram button', () => {
    render(<RemindersCard value={{ reminders: [] }} meta={meta} saving={false} onSave={vi.fn()} />);
    const panel = screen.getByRole('region', { name: 'If the phone loses the bot' });
    expect(within(panel).getByRole('img', { name: BOT_QR_ALT })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: /Test Telegram/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Test Telegram/ })).toHaveLength(1);
  });
});
