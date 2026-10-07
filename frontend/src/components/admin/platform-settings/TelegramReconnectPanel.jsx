/**
 * TelegramReconnectPanel — the bot's QR code, for pairing a phone with the
 * bot again (owner, 2026-10-07).
 *
 * Owner request: the bot's QR image in the admin, "displayed properly, not
 * too big nor small", so a phone that loses the bot can be pointed back at it
 * without hunting for the handle.
 *
 * WHERE. Inside the Reminders card, wrapped around the Test Telegram button
 * that already sits at the top of it (#917). A card of its own would have
 * needed either a second Test Telegram button on the same tab or the proof
 * step pointing at a button somewhere else; wrapped this way the scan, the
 * Start and the proof are one block, and the button keeps its place at the
 * top of the card.
 *
 * SIZE. The artwork is 1024 x 1536. It is shown at a fixed 220 px wide on a
 * laptop, which a phone camera reads across a desk, and at 60 % of the
 * viewport on a phone, where it is there to be opened full size and shown to
 * another phone rather than scanned from itself. The width and height
 * attributes reserve the 2:3 box before the image arrives, so nothing below
 * it jumps. The panel behind it is white in both themes: the artwork is dark
 * and its edges vanish into a dark card otherwise.
 *
 * THE ASSET is imported, not placed under public/, so Vite fingerprints it
 * into /assets and the immutable cache rule in staticwebapp.config.json
 * applies. It is copied byte for byte from the owner's file, artwork
 * untouched; at 1.9 MB it is under every limit the build and the deploy
 * set, and it is fetched only when this tab is open. What it encodes is the
 * owner's statement, not a decoded fact: the bot's public link, no token
 * and no chat id. The modules are embossed into the background rather than
 * printed on it, and jsQR could not read them (2026-10-07), so the first
 * real proof is a phone scanning it; the handle link beside it works either
 * way. The PNG carries a C2PA provenance manifest naming the image
 * generator and nothing personal. Showing the bot costs nothing: it answers
 * only the chat id stored in TELEGRAM_CHAT_ID (lib/telegram/bot.js) and
 * ignores every other chat silently.
 *
 * WHY THE STEPS SAY WHAT THEY SAY. A private chat's id is the Telegram
 * user's id, so a new phone signed in to the same Telegram account needs
 * nothing changed on the server: scan, Start, test. A different account is a
 * different chat id, which the bot ignores; the stored id then has to change
 * on Integrations, Keys, which is why that link is here and not a sentence
 * telling the owner to find it.
 */

import React from 'react';
import { ExternalLink, Maximize2, QrCode } from 'lucide-react';
import telegramBotQr from '@/assets/admin/telegram-bot-qr.png';
import { tabHref as integrationsTabHref } from '@/components/admin/integrations/tabs';

export const BOT_HANDLE = '@agenticarchitectbot';
export const BOT_URL = 'https://t.me/agenticarchitectbot';
export const BOT_QR_SRC = telegramBotQr;
export const BOT_QR_ALT = `QR code that opens the Telegram bot ${BOT_HANDLE}`;
export const KEYS_HREF = integrationsTabHref('keys');

const linkClass = 'inline-flex items-center gap-1 underline underline-offset-2';

/** The QR, the handle and the steps, with the Test Telegram button passed in as children. */
export default function TelegramReconnectPanel({ children = null }) {
  return (
    <section
      aria-labelledby="telegram-reconnect-heading"
      className="grid gap-4 rounded-md border border-border p-3 sm:grid-cols-[auto_minmax(0,1fr)]"
    >
      <figure className="mx-auto w-[60vw] max-w-full sm:mx-0 sm:w-[220px]">
        <div className="rounded-md border border-border bg-white p-2 shadow-sm">
          <img
            src={BOT_QR_SRC}
            alt={BOT_QR_ALT}
            width={1024}
            height={1536}
            loading="lazy"
            decoding="async"
            className="block h-auto w-full rounded"
          />
        </div>
        <figcaption className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
          <a
            href={BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${linkClass} font-medium text-foreground`}
          >
            {BOT_HANDLE} <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
          <a
            href={BOT_QR_SRC}
            target="_blank"
            rel="noopener noreferrer"
            className={`${linkClass} text-muted-foreground`}
          >
            Open full size <Maximize2 className="h-3 w-3" aria-hidden="true" />
          </a>
        </figcaption>
      </figure>

      <div className="min-w-0 space-y-3">
        <p
          id="telegram-reconnect-heading"
          className="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <QrCode className="h-4 w-4" aria-hidden="true" /> If the phone loses the bot
        </p>
        <ol aria-label="Reconnect steps" className="list-decimal space-y-1.5 pl-5 text-sm">
          <li>
            Scan the code with the phone&apos;s camera, or open{' '}
            <span className="font-medium text-foreground">{BOT_HANDLE}</span> by searching for it in
            Telegram. On a laptop, Open full size makes the code easier to scan.
          </li>
          <li>
            In the bot&apos;s chat, press <span className="font-medium text-foreground">Start</span>
            . If the chat was blocked, press Unblock or Restart instead.
          </li>
          <li>
            Press <span className="font-medium text-foreground">Test Telegram</span> below. Sent
            means the phone is paired again.
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          The bot only talks to the chat id stored as TELEGRAM_CHAT_ID and ignores every other chat.
          The same Telegram account on a new phone keeps the same id, so nothing changes here. If
          the test says Sent and nothing arrives on this phone, the phone is on a different Telegram
          account, which has a different id: change it on{' '}
          <a href={KEYS_HREF} className={linkClass}>
            Integrations, Keys
          </a>
          .
        </p>
        {children}
      </div>
    </section>
  );
}
