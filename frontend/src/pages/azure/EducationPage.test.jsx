/**
 * The Azure education landing page renders status from the dates, not from
 * the stored field, and says when its catalogue was last checked instead of
 * claiming a weekly refresh it never had (#461 item 1). Its timeline merges
 * the Friday scraper's events over the static entries and keeps the static
 * ones when the API has nothing or is unreachable (#461 item 4).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import AzureEducationPage from './EducationPage';
import { DATA_AS_OF, certifications, timelineEvents } from '@/data/azure/certifications';
import { deriveStatus, todayIso } from '@/lib/certStatus';
import { clearPublicGetCache } from '@/lib/publicApi';

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));

// The public API base the page's fetch resolves; the fetch itself is stubbed
// below, empty by default so every test sees the static timeline unless it
// says otherwise.
vi.mock('@/lib/functionsBase', () => ({
  getFunctionsBase: () => 'https://api.test/api',
  requireFunctionsBase: () => 'https://api.test/api',
  resolveMediaUrl: (url) => url,
}));

const fetchMock = vi.fn();
const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock);
});

beforeEach(() => {
  clearPublicGetCache();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({ success: true, items: [], total: 0 }));
});

// `today` as the page sees it, settable per test; everything else is real.
const mockToday = vi.fn();
vi.mock('@/lib/certStatus', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useToday: (fallback) => mockToday() ?? actual.useToday(fallback) };
});

// jsdom has no matchMedia; the page reads it for the applied-skills column count.
beforeAll(() => {
  window.matchMedia = vi.fn((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/azure/education']}>
      <AzureEducationPage />
    </MemoryRouter>
  );
}

const visibleCards = () => Array.from(document.querySelectorAll('article[data-status]'));

/**
 * The carousel's own "next" control, by its label — the timeline has a
 * chevron_right icon of its own ("Scroll right"), so the icon text is not a
 * unique handle. Null when the filter fits on one page (no paginator).
 */
const nextPageButton = () => screen.queryByRole('button', { name: 'Next page' });

/**
 * The carousel shows four cards a page, so a card's position depends on how
 * many certifications share its status. Page forward until the card for
 * `code` is on screen; the button is disabled on the last page, which ends
 * the walk.
 */
function pageToCard(code) {
  for (;;) {
    const card = visibleCards().find((el) => el.textContent.includes(code));
    if (card) return card;
    const next = nextPageButton();
    if (!next || next.disabled) return undefined;
    fireEvent.click(next);
  }
}

/** Every card the current filter yields, across all carousel pages. */
function allFilteredCards() {
  const seen = new Map();
  for (;;) {
    for (const card of visibleCards()) seen.set(card.textContent, card);
    const next = nextPageButton();
    if (!next || next.disabled) return Array.from(seen.values());
    fireEvent.click(next);
  }
}

describe('AzureEducationPage', () => {
  it('renders the retired exams as retired, never as expiring or beta', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retired' }));

    const today = todayIso();
    const retired = certifications.filter((c) => deriveStatus(c, today) === 'retired');
    expect(retired.length).toBeGreaterThan(0);

    // Every page of the filtered carousel, not just the first.
    const cards = allFilteredCards();
    expect(cards.length).toBe(retired.length);
    for (const card of cards) {
      expect(card.dataset.status).toBe('retired');
      expect(card.textContent).toMatch(/Retired/);
      expect(card.textContent).not.toMatch(/Expiring Soon|BETA/);
    }
    // The side list carries every certification at once, one RETIRED chip each.
    expect(screen.getAllByText('RETIRED').length).toBe(retired.length);
  });

  it('shows the replacement on a retired card (AI-102 → AI-103)', () => {
    // The data says what the card must say; the page is paged until it shows.
    expect(
      deriveStatus(
        certifications.find((c) => c.code === 'AI-102'),
        todayIso()
      )
    ).toBe('retired');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retired' }));
    const ai102 = pageToCard('AI-102');
    expect(ai102).toBeDefined();
    expect(ai102.dataset.status).toBe('retired');
    expect(ai102.textContent).toMatch(/now AI-103/);
  });

  it('shows the replacement on an expiring card (AZ-800 → AZ-802)', () => {
    expect(
      deriveStatus(
        certifications.find((c) => c.code === 'AZ-800'),
        todayIso()
      )
    ).toBe('expiring');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Expiring' }));
    const az800 = pageToCard('AZ-800');
    expect(az800).toBeDefined();
    expect(az800.dataset.status).toBe('expiring');
    expect(az800.textContent).toMatch(/Expiring Soon/);
    expect(az800.textContent).toMatch(/then AZ-802/);
  });

  it('never prints a beta end date or an expiry that has already passed', () => {
    const { container } = renderPage();
    const today = todayIso();
    const html = container.textContent;
    for (const cert of certifications) {
      if (cert.betaEndDate && cert.betaEndDate < today) {
        expect(html, `${cert.code} beta end`).not.toContain(
          `ends ${new Date(`${cert.betaEndDate}T00:00:00`).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}`
        );
      }
    }
    expect(html).not.toMatch(/ends Jun 30, 2026/);
  });

  it('states the catalogue date instead of a refresh cadence it does not have', () => {
    const { container } = renderPage();
    expect(screen.getByTestId('data-as-of')).toHaveAttribute('dateTime', DATA_AS_OF);
    expect(container.textContent).not.toMatch(/weekly|Updated Monthly|each month/i);
  });

  it('decides "past" on the timeline by calendar day, not by the viewer offset', () => {
    // AZ-800 and AZ-801 retire on 2026-09-30. With today set to that very day
    // the event is not past; the old `new Date(ev.date) < localMidnight`
    // comparison said it was for any viewer west of Greenwich. The next day
    // it is past everywhere.
    mockToday.mockReturnValue('2026-09-30');
    const first = renderPage();
    const onTheDay = first.container.querySelector('[data-event-id="az-800-az-801-retire"]');
    expect(onTheDay).not.toBeNull();
    expect(onTheDay.dataset.past).toBe('false');
    first.unmount();

    mockToday.mockReturnValue('2026-10-01');
    const { container } = renderPage();
    expect(container.querySelector('[data-event-id="az-800-az-801-retire"]').dataset.past).toBe(
      'true'
    );
    mockToday.mockReset();
  });

  it('asks the public API for the azure scraper events, once, and keeps the static timeline when it is empty', async () => {
    const { container } = renderPage();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.test/api/public/cert-events?platform=azure',
        expect.objectContaining({ headers: { Accept: 'application/json' } })
      )
    );
    for (const ev of timelineEvents) {
      expect(container.querySelector(`[data-event-id="${ev.id}"]`), ev.id).not.toBeNull();
    }
    expect(container.textContent).not.toMatch(/Skills Hub blog/);
  });

  it('merges the scraper events over the static timeline by id, static first', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        total: 2,
        items: [
          {
            id: 'live-az-305',
            type: 'retirement',
            certCodes: ['AZ-305'],
            title: 'AZ-305 retires next year',
            summary: 'Announced on the Skills Hub blog.',
            link: 'https://techcommunity.microsoft.com/skills-hub/az-305',
            pubDate: '2026-09-11T09:00:00.000Z',
            mentionedDates: ['June 30, 2027'],
            source: 'skills-hub-rss',
          },
          {
            // Same id as a static entry: the live row wins.
            id: 'ms-102-retire',
            type: 'retirement',
            certCodes: ['MS-102'],
            title: 'MS-102 retirement moved',
            summary: 'Now December.',
            link: 'https://techcommunity.microsoft.com/skills-hub/ms-102',
            pubDate: '2026-09-11T09:00:00.000Z',
            mentionedDates: ['December 31, 2026'],
            source: 'skills-hub-rss',
          },
        ],
      })
    );
    const { container } = renderPage();
    // Before the fetch resolves the static entries are what is on screen.
    expect(container.querySelector('[data-event-id="ms-102-retire"]')).not.toBeNull();
    expect(container.querySelector('[data-event-id="live-az-305"]')).toBeNull();

    await waitFor(() =>
      expect(container.querySelector('[data-event-id="live-az-305"]')).not.toBeNull()
    );
    expect(container.querySelectorAll('[data-event-id="ms-102-retire"]')).toHaveLength(1);
    // The track label is truncated at 17 characters; the live title replaced
    // the static "MS-102 Retires".
    expect(container.textContent).toMatch(/MS-102 retirement/);
    expect(container.textContent).not.toMatch(/MS-102 Retires/);
    expect(container.textContent).toMatch(/Plus 2 from the/);
    expect(container.textContent).toMatch(/Microsoft Skills Hub blog/);
    // The other static entries are untouched.
    expect(container.querySelector('[data-event-id="az-800-az-801-retire"]')).not.toBeNull();
  });

  it('keeps the static timeline when the API is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = renderPage();
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    for (const ev of timelineEvents) {
      expect(container.querySelector(`[data-event-id="${ev.id}"]`), ev.id).not.toBeNull();
    }
    expect(container.textContent).not.toMatch(/Skills Hub blog/);
    errorSpy.mockRestore();
  });

  it('links every certification to its detail page', () => {
    renderPage();
    const hrefs = new Set(screen.getAllByRole('link').map((a) => a.getAttribute('href')));
    for (const cert of certifications) {
      expect(hrefs.has(`/azure/education/${cert.slug}`), cert.slug).toBe(true);
    }
  });
});
