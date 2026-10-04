/**
 * The certification registry's data (#842): loaded once the section scrolls
 * near the viewport, normalised, grouped by issuer in each issuer's order,
 * with the expanded flag of each group. Moved out of AboutPage.jsx on
 * 2026-10-04 unchanged; the rules it applies are in certificationSorting.js.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPublicSnapshot } from '@/lib/publicApi';
import { newerSnapshot } from '@/lib/speakingEvents';
import { normalizeCertification } from './certifications';
import { classifyMicrosoft, featuredFirst, groupByIssuer } from './certificationSorting';

/**
 * The build-time copy of the snapshot, whole — rows AND the stamp — so it can
 * be compared with the live publish. Null when the file is absent or not JSON.
 */
async function loadStaticSnapshot(path) {
  try {
    const response = await fetch(path, {
      headers: { Accept: 'application/json' },
      cache: 'default',
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.toLowerCase().includes('application/json')) return null;
    const payload = await response.json();
    return Array.isArray(payload?.items) ? payload : null;
  } catch {
    return null;
  }
}

/** The rows the page shows, featured first. */
async function loadCertifications() {
  // The newer of the deploy-time JSON and the live published snapshot,
  // so Publish snapshot has an effect before the next deploy (ADR 0033
  // §1). Either read failing leaves the other.
  const [staticDoc, liveDoc] = await Promise.all([
    loadStaticSnapshot('/data/certifications.json'),
    fetchPublicSnapshot('certifications').catch(() => null),
  ]);
  let rawItems = newerSnapshot(staticDoc, liveDoc)?.items || [];

  try {
    rawItems = rawItems.filter((item) => item && typeof item === 'object');
  } catch {
    rawItems = [];
  }

  const certItems = rawItems
    .map((d) => normalizeCertification(d))
    .filter((cert) => cert.display === true)
    .map(classifyMicrosoft);
  certItems.sort(featuredFirst);
  return certItems;
}

/**
 * `sectionRef` goes on the registry section: nothing is fetched until it is
 * within 200px of the viewport.
 */
export function useCertifications() {
  const [certifications, setCertifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedSections, setExpandedSections] = useState({});
  const [inView, setInView] = useState(false);
  const sectionRef = useRef(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const certItems = await loadCertifications();
        setCertifications(certItems);
        setExpandedSections(Object.fromEntries(certItems.map((cert) => [cert.issuer, false])));
      } catch (e) {
        console.error('Error loading certifications:', e);
        setError('Failed to load certifications');
        setCertifications([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [inView]);

  const certificationsByIssuer = useMemo(() => groupByIssuer(certifications), [certifications]);
  const issuerOrder = useMemo(
    () => Object.keys(certificationsByIssuer).sort((a, b) => a.localeCompare(b)),
    [certificationsByIssuer]
  );

  const toggleSection = (issuer) => {
    setExpandedSections((prev) => ({
      ...prev,
      [issuer]: !prev[issuer],
    }));
  };

  return {
    sectionRef,
    loading,
    error,
    certificationsByIssuer,
    issuerOrder,
    expandedSections,
    toggleSection,
  };
}
