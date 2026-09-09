/**
 * The Azure education landing page renders status from the dates, not from
 * the stored field, and says when its catalogue was last checked instead of
 * claiming a weekly refresh it never had (#461 item 1).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import AzureEducationPage from './EducationPage';
import { DATA_AS_OF, certifications } from '@/data/azure/certifications';
import { deriveStatus, todayIso } from '@/lib/certStatus';

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));

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

  it('links every certification to its detail page', () => {
    renderPage();
    const hrefs = new Set(screen.getAllByRole('link').map((a) => a.getAttribute('href')));
    for (const cert of certifications) {
      expect(hrefs.has(`/azure/education/${cert.slug}`), cert.slug).toBe(true);
    }
  });
});
