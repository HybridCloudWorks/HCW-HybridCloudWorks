/**
 * The carousel state the GCP, GitHub and Terraform hubs share (PR #841):
 * which certifications a filter selects, how they page, and that a filter
 * change returns to the first page.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/lib/certStatus', () => ({
  useToday: (fallback) => fallback,
  deriveStatus: (cert) => cert.__status,
}));

const { filterCertifications, useCertificationCarousel } =
  await import('./useCertificationCarousel.js');

const cert = (id, level, status = 'active') => ({ id, level, __status: status });
const CERTS = [
  cert('a1', 'Associate'),
  cert('a2', 'Associate', 'retired'),
  cert('p1', 'Professional'),
  cert('p2', 'Professional'),
  cert('p3', 'Professional'),
  cert('f1', 'Foundational'),
];

describe('filterCertifications', () => {
  it('keeps everything on All / All', () => {
    const out = filterCertifications(CERTS, {
      levelFilter: 'All',
      statusFilter: 'All',
      today: '2026-10-03',
    });
    expect(out).toHaveLength(CERTS.length);
  });

  it('narrows by level and by status label, case-insensitively', () => {
    const associates = filterCertifications(CERTS, {
      levelFilter: 'Associate',
      statusFilter: 'All',
      today: '2026-10-03',
    });
    expect(associates.map((c) => c.id)).toEqual(['a1', 'a2']);

    const activeAssociates = filterCertifications(CERTS, {
      levelFilter: 'Associate',
      statusFilter: 'Active',
      today: '2026-10-03',
    });
    expect(activeAssociates.map((c) => c.id)).toEqual(['a1']);
  });
});

describe('useCertificationCarousel', () => {
  const setup = () =>
    renderHook(() => useCertificationCarousel(CERTS, { visibleCount: 4, asOf: '2026-10-03' }));

  it('pages the filtered list by visibleCount and reports the page count', () => {
    const { result } = setup();
    expect(result.current.totalPages).toBe(2);
    expect(result.current.visibleCerts.map((c) => c.id)).toEqual(['a1', 'a2', 'p1', 'p2']);
    expect(result.current.today).toBe('2026-10-03');

    act(() => result.current.setCarouselPage(1));
    expect(result.current.visibleCerts.map((c) => c.id)).toEqual(['p3', 'f1']);
  });

  it('returns to the first page when a filter changes', () => {
    const { result } = setup();
    act(() => result.current.setCarouselPage(1));
    expect(result.current.carouselPage).toBe(1);

    act(() => result.current.handleLevelFilter('Professional'));
    expect(result.current.carouselPage).toBe(0);
    expect(result.current.levelFilter).toBe('Professional');
    expect(result.current.visibleCerts.map((c) => c.id)).toEqual(['p1', 'p2', 'p3']);
    expect(result.current.totalPages).toBe(1);

    act(() => result.current.setCarouselPage(0));
    act(() => result.current.handleStatusFilter('Active'));
    expect(result.current.statusFilter).toBe('Active');
    expect(result.current.carouselPage).toBe(0);
    expect(result.current.filteredCerts).toHaveLength(3);
  });
});
