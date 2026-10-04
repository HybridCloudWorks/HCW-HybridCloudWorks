/**
 * The About page's Certification Registry (#842): heading, then one of four
 * bodies — loading, error, empty, or the issuer groups. Moved out of
 * AboutPage.jsx on 2026-10-04 unchanged; the data is useCertifications.js.
 */
import React from 'react';
import IssuerSection from './IssuerSection';
import { useCertifications } from './useCertifications';

function Loading() {
  return (
    <div className="flex justify-center items-center py-20">
      <span className="material-symbols-outlined animate-spin text-[32px] text-slate-400 dark:text-slate-600">
        hourglass_bottom
      </span>
    </div>
  );
}

function LoadError({ error }) {
  return (
    <div className="text-center p-10 border-2 border-dashed rounded-lg bg-red-50/80 dark:bg-red-950/20 text-red-700 dark:text-red-400">
      <span className="material-symbols-outlined text-[48px] block mb-4 mx-auto">
        error_outline
      </span>
      <h3 className="text-xl font-semibold">Error Loading Certifications</h3>
      <p className="mt-2 text-sm">{error}</p>
    </div>
  );
}

function Empty() {
  return (
    <div className="text-center p-10 border-2 border-dashed rounded-lg bg-slate-50/80 dark:bg-slate-900/20">
      <span className="material-symbols-outlined text-[48px] block mb-4 mx-auto text-slate-400">
        verified
      </span>
      <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
        No Certifications Found
      </h3>
      <p className="text-slate-600 dark:text-slate-400 mt-2 text-sm">
        Certifications data is currently being updated. Please check back soon!
      </p>
    </div>
  );
}

function RegistryBody({ registry, onImageClick }) {
  const { loading, error, issuerOrder, certificationsByIssuer, expandedSections, toggleSection } =
    registry;
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} />;
  if (issuerOrder.length === 0) return <Empty />;
  return (
    <div className="space-y-8">
      {issuerOrder.map((issuer) => (
        <IssuerSection
          key={issuer}
          issuer={issuer}
          certs={certificationsByIssuer[issuer] || []}
          isExpanded={expandedSections[issuer] !== false}
          onToggle={toggleSection}
          onImageClick={onImageClick}
        />
      ))}
    </div>
  );
}

export default function CertificationRegistry({ onImageClick }) {
  const { sectionRef, ...registry } = useCertifications();
  return (
    <section ref={sectionRef} className="space-y-6 mt-16">
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-secondary/15 border border-secondary/40 mb-4">
          <h3
            className="text-2xl text-slate-900 dark:text-white flex items-center gap-2"
            style={{ fontFamily: 'Mona Sans, Inter, sans-serif' }}
          >
            <span className="material-symbols-outlined text-accent-blue">verified</span>
            Certification Registry
          </h3>
        </div>
      </div>

      <RegistryBody registry={registry} onImageClick={onImageClick} />
    </section>
  );
}
