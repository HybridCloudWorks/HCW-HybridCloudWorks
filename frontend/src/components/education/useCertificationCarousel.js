/**
 * The state of a certification hub's "Browse Certifications" carousel: the
 * level and status filters, the page, and what they select from the
 * catalogue. The GCP, GitHub and Terraform hubs each kept this in their own
 * body (PR #841); CertificationCarouselSection renders what it returns.
 *
 * A filter change returns to the first page, because the page index was
 * counted against the previous filter's result and may not exist in the new
 * one.
 */
import { useState } from 'react';
import { deriveStatus, useToday } from '@/lib/certStatus';

/** The certifications matching a level ('All' or a level name) and a status ('All' or a status label). */
export function filterCertifications(certifications, { levelFilter, statusFilter, today }) {
  return certifications.filter((c) => {
    const levelOk = levelFilter === 'All' || c.level === levelFilter;
    const statusOk =
      statusFilter === 'All' || deriveStatus(c, today) === statusFilter.toLowerCase();
    return levelOk && statusOk;
  });
}

export function useCertificationCarousel(certifications, { visibleCount, asOf }) {
  const [levelFilter, setLevelFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [carouselPage, setCarouselPage] = useState(0);
  const today = useToday(asOf);

  const filteredCerts = filterCertifications(certifications, { levelFilter, statusFilter, today });
  const totalPages = Math.ceil(filteredCerts.length / visibleCount);
  const visibleCerts = filteredCerts.slice(
    carouselPage * visibleCount,
    carouselPage * visibleCount + visibleCount
  );

  const handleLevelFilter = (l) => {
    setLevelFilter(l);
    setCarouselPage(0);
  };
  const handleStatusFilter = (s) => {
    setStatusFilter(s);
    setCarouselPage(0);
  };

  return {
    levelFilter,
    statusFilter,
    carouselPage,
    setCarouselPage,
    today,
    filteredCerts,
    visibleCerts,
    totalPages,
    visibleCount,
    handleLevelFilter,
    handleStatusFilter,
  };
}
