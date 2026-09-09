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

describe('AzureEducationPage', () => {
  it('renders the retired exams as retired, never as expiring or beta', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retired' }));

    const today = todayIso();
    const retired = certifications.filter((c) => deriveStatus(c, today) === 'retired');
    expect(retired.length).toBeGreaterThan(0);

    // The carousel shows four cards a page; the first page is enough to prove
    // the badge, and the side list carries every certification at once.
    const cards = document.querySelectorAll('article[data-status]');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.dataset.status).toBe('retired');
      expect(card.textContent).toMatch(/Retired/);
      expect(card.textContent).not.toMatch(/Expiring Soon|BETA/);
    }
    expect(screen.getAllByText('RETIRED').length).toBe(retired.length);
  });

  it('shows the replacement on a retired card (AI-102 → AI-103)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retired' }));
    const ai102 = Array.from(document.querySelectorAll('article[data-status]')).find((card) =>
      card.textContent.includes('AI-102')
    );
    expect(ai102).toBeDefined();
    expect(ai102.textContent).toMatch(/now AI-103/);
  });

  it('shows the replacement on an expiring card (AZ-800 → AZ-802)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Expiring' }));
    const az800 = Array.from(document.querySelectorAll('article[data-status]')).find((card) =>
      card.textContent.includes('AZ-800')
    );
    expect(az800).toBeDefined();
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

  it('links every certification to its detail page', () => {
    renderPage();
    const hrefs = new Set(screen.getAllByRole('link').map((a) => a.getAttribute('href')));
    for (const cert of certifications) {
      expect(hrefs.has(`/azure/education/${cert.slug}`), cert.slug).toBe(true);
    }
  });
});
