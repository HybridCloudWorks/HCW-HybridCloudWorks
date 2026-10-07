/**
 * The Telegram reconnect panel: the bot's QR at a fixed size with alt text
 * naming the handle, the handle as a link to the bot, a full-size icon on the
 * code's corner linking the same imported asset, the three re-pairing steps,
 * and the Test Telegram button beside them inside the Reminders card (owner,
 * 2026-10-07; the second, plain code removed the same day).
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

  it('shows one code only, with the handle as the one line beneath it', () => {
    render(<TelegramReconnectPanel />);
    const images = screen.getAllByRole('img');
    expect(images.map((node) => node.getAttribute('alt'))).toEqual([BOT_QR_ALT]);
    const caption = images[0].closest('figure').querySelector('figcaption');
    expect(caption.textContent.trim()).toBe(BOT_HANDLE);
    expect(screen.queryByText(/does not scan, this code/)).toBeNull();
  });

  it('puts Open full size as an icon on the artwork corner, not a text line', () => {
    render(<TelegramReconnectPanel />);
    const link = screen.getByRole('link', { name: 'Open full size' });
    expect(link.textContent).toBe('');
    expect(link.getAttribute('title')).toBe('Open full size');
    expect(link.className).toMatch(/\babsolute\b/);
    expect(link.className).toMatch(/\bright-3\b/);
    expect(link.className).toMatch(/\btop-3\b/);
    const frame = screen.getByRole('img', { name: BOT_QR_ALT }).parentElement;
    expect(frame.className).toMatch(/\brelative\b/);
    expect(link.parentElement).toBe(frame);
  });

  it('pushes the passed-in children to the bottom of the column beside the artwork', () => {
    render(
      <TelegramReconnectPanel>
        <button type="button">child</button>
      </TelegramReconnectPanel>
    );
    const wrapper = screen.getByRole('button', { name: 'child' }).parentElement;
    expect(wrapper.className).toContain('sm:mt-auto');
    expect(wrapper.parentElement.className).toMatch(/\bflex-col\b/);
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
    expect(steps[0].textContent).toMatch(/full-size button on the code's corner/);
    expect(steps[0].textContent).not.toMatch(/small one/);
    expect(steps[1].textContent).toMatch(/press Start/);
    expect(steps[1].textContent).toMatch(/Unblock or Restart/);
    expect(steps[2].textContent).toMatch(/Press Test Telegram/);
    expect(steps[2].textContent).toMatch(/the message arriving there is the proof/);
    expect(steps[2].textContent).not.toMatch(/Sent means/);
  });

  it('says what Sent proves, account first, and links to where the id is changed', () => {
    render(<TelegramReconnectPanel />);
    const note = screen.getByText(/TELEGRAM_CHAT_ID/);
    expect(note.textContent).toMatch(
      /Test Telegram proves the bot can reach the chat id stored as TELEGRAM_CHAT_ID/
    );
    expect(note.textContent).toMatch(/does not check which phone that chat is on/);
    expect(note.textContent).toMatch(
      /first check which Telegram account the phone is signed in to/
    );
    expect(note.textContent).toMatch(/same account keeps the same chat id on any phone/);
    expect(note.textContent).toMatch(/Only if the account itself has changed/);
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
