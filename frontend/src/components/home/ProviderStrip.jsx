import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { routes } from '@/lib/routeFactory';
import { useTheme } from '@/context/ThemeContext';
import {
  PROVIDER_GUIDE,
  PROVIDER_GUIDE_DEFAULT,
  PROVIDER_GUIDE_ROWS,
  websiteLinkLabel,
} from './providerGuide';

/**
 * The home page's provider strip: nine providers in two rows, and a frame
 * below them that says what the provider you point at is and how this site
 * uses it (owner request 2026-09-28). The text is in `providerGuide.js`.
 *
 * THE FRAME NEVER CHANGES HEIGHT. Every text it can show — the default line
 * and all nine descriptions — is rendered into the same grid cell, invisible
 * and hidden from assistive technology, and the visible text sits in that
 * cell too. The cell is therefore as tall as the longest text at whatever
 * width the page has, so switching providers cannot move anything below it,
 * and no script has to measure. It is also at least four lines tall
 * (`min-h-24` over `leading-6`), which at desktop width is exactly its
 * height: `providerGuide.test.js` keeps every description inside four lines.
 * On a phone the longest description needs more lines, so the frame is
 * taller there, and still the same height for every provider.
 *
 * STICKY. The last provider pointed at stays shown; moving the pointer off it
 * does not clear the frame, so it can travel down to the frame's link. A
 * short hover intent keeps a pointer that is only passing over another
 * provider on its way there from taking the frame over.
 *
 * TOUCH. A label is a link to the provider's hub, and a tap on a link follows
 * it, so the first tap on a provider that is not already shown shows it
 * instead, and a second tap follows the link. A mouse click and the keyboard
 * always follow the link; the keyboard shows the frame on focus.
 *
 * ANNOUNCED, NOT FOCUSED. The visible text is a polite live region, mounted
 * with the page so its changes are announced. Nothing here moves focus or
 * holds it: the frame's one link sits in the normal tab order after the
 * providers.
 */

/** How long a pointer must rest on a provider before it takes the frame. */
export const HOVER_INTENT_MS = 90;

/** Every text the frame can show, for the invisible copies that size it. */
const FRAME_TEXTS = [PROVIDER_GUIDE_DEFAULT, ...PROVIDER_GUIDE.map((entry) => entry.description)];

/** Phone layout for row 2: two framework providers over three service providers. */
const ROW_TWO_SPAN = {
  framework: 'col-span-3 sm:col-span-1',
  service: 'col-span-2 sm:col-span-1',
};

export default function ProviderStrip() {
  const { theme } = useTheme();
  const [selected, setSelected] = useState(null);
  const hoverTimer = useRef(null);
  // The provider whose next click a touch or pen press has claimed, so the
  // tap shows the frame rather than leaving the page.
  const heldClick = useRef(null);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const active = PROVIDER_GUIDE.find((entry) => entry.provider === selected) ?? null;

  const handlersFor = (provider) => ({
    onMouseEnter: () => {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => setSelected(provider), HOVER_INTENT_MS);
    },
    onMouseLeave: () => clearTimeout(hoverTimer.current),
    onFocus: () => {
      clearTimeout(hoverTimer.current);
      setSelected(provider);
    },
    onPointerDown: (event) => {
      heldClick.current =
        event.pointerType && event.pointerType !== 'mouse' && selected !== provider
          ? provider
          : null;
    },
    onClick: (event) => {
      if (heldClick.current === provider) {
        event.preventDefault();
        clearTimeout(hoverTimer.current);
        setSelected(provider);
      }
      heldClick.current = null;
    },
  });

  return (
    <section aria-label="Provider hubs" className="relative">
      <div className="border-y border-glass-border px-2 py-6">
        {PROVIDER_GUIDE_ROWS.map((row, rowIndex) => (
          <ul
            key={row[0].provider}
            data-testid={`provider-row-${rowIndex + 1}`}
            className={cn(
              'grid items-start gap-y-5',
              rowIndex === 0 ? 'grid-cols-4' : 'mt-5 grid-cols-6 sm:grid-cols-5'
            )}
          >
            {row.map((entry, index) => {
              const isSelected = entry.provider === selected;
              // The pipe between the framework and service providers. On a
              // phone row 2 wraps into those two groups, which says the same
              // thing, so the pipe is only drawn from sm up.
              const startsGroup = index > 0 && row[index - 1].type !== entry.type;
              return (
                <li
                  key={entry.provider}
                  data-starts-group={startsGroup || undefined}
                  className={cn(
                    'relative flex justify-center',
                    rowIndex === 1 && ROW_TWO_SPAN[entry.type],
                    startsGroup &&
                      "sm:before:absolute sm:before:left-0 sm:before:top-1/2 sm:before:h-9 sm:before:w-px sm:before:-translate-y-1/2 sm:before:bg-slate-400 sm:before:content-[''] dark:sm:before:bg-slate-500"
                  )}
                >
                  <Link
                    to={routes.landing(entry.provider)}
                    aria-label={`${entry.label} hub`}
                    data-selected={isSelected || undefined}
                    className="group/provider flex flex-col items-center gap-2 rounded-lg px-2 py-1 lg:flex-row focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                    {...handlersFor(entry.provider)}
                  >
                    <img
                      src={theme === 'dark' && entry.logoDark ? entry.logoDark : entry.logo}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className={cn(
                        'h-7 w-auto object-contain transition-all',
                        isSelected
                          ? 'opacity-100 grayscale-0'
                          : 'opacity-60 grayscale group-hover/provider:opacity-100 group-hover/provider:grayscale-0 group-focus-visible/provider:opacity-100 group-focus-visible/provider:grayscale-0'
                      )}
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                    <span
                      className={cn(
                        'eyebrow-label whitespace-nowrap transition-colors',
                        isSelected
                          ? 'text-slate-900 dark:text-white'
                          : 'text-slate-600 dark:text-slate-400 group-hover/provider:text-slate-900 dark:group-hover/provider:text-white'
                      )}
                    >
                      {entry.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}

        <ProviderGuideFrame active={active} />
      </div>
    </section>
  );
}

function ProviderGuideFrame({ active }) {
  const label = active ? websiteLinkLabel(active) : null;
  return (
    // max-w-[42rem], not max-w-2xl: this theme redefines --container-2xl as
    // 1400px. The paragraphs carry !m-0 and !leading-6 because index.css
    // styles every `p` outside a layer, which beats a plain utility.
    <div
      data-testid="provider-guide"
      className="glass-panel mx-auto mt-6 flex w-full max-w-[42rem] items-end gap-4 rounded-xl px-5 py-4"
    >
      <div className="grid min-h-24 flex-1 text-sm leading-6">
        {FRAME_TEXTS.map((text) => (
          <p key={text} aria-hidden="true" className="invisible !m-0 !leading-6 [grid-area:1/1]">
            {text}
          </p>
        ))}
        <p
          data-testid="provider-guide-text"
          aria-live="polite"
          aria-atomic="true"
          className={cn(
            '!m-0 !leading-6 [grid-area:1/1]',
            active ? 'text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'
          )}
        >
          {active ? active.description : PROVIDER_GUIDE_DEFAULT}
        </p>
      </div>
      {/* Always the same box, so the text beside it keeps one width. */}
      <div className="size-10 shrink-0">
        {active && (
          <a
            href={active.website}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            className="flex size-10 items-center justify-center rounded-full border border-slate-300 text-slate-700 transition-colors hover:border-slate-500 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 dark:border-slate-600 dark:text-slate-200 dark:hover:border-slate-400 dark:hover:text-white"
          >
            <span className="material-symbols-outlined text-lg" aria-hidden="true">
              open_in_new
            </span>
          </a>
        )}
      </div>
    </div>
  );
}
