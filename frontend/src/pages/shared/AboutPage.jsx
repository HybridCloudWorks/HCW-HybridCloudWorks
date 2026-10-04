/**
 * /about — the composition root (#842, 2026-10-04): the hero, the speaking
 * widget, the certification registry, and the badge modal the registry
 * opens. Each section is its own module under ./about; this file only
 * arranges them and holds the one piece of state they share, the enlarged
 * badge. Until 2026-10-04 everything below lived in this one component, 70
 * return statements and a complexity of 130, which qlty flagged on every PR
 * that touched the file.
 */
import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import AboutHero from './about/AboutHero';
import SpeakingSection from './about/SpeakingSection';
import CertificationRegistry from './about/CertificationRegistry';
import CertificationModal from './about/CertificationModal';

export default function AboutPage() {
  const [selectedCertImage, setSelectedCertImage] = useState(null);
  const closeModal = () => {
    setSelectedCertImage(null);
  };

  return (
    <>
      <Helmet>
        <title>About Saul Patino | Hybrid Cloud Works</title>
      </Helmet>

      <main className="relative grow w-full max-w-400 mx-auto px-4 md:px-8 py-10 space-y-16 bg-background text-foreground">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 right-0 h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,rgba(172,183,174,0.14),transparent_70%)] blur-2xl"></div>
          <div className="absolute bottom-0 left-10 h-65 w-65 rounded-full bg-[radial-gradient(circle_at_center,rgba(194,180,144,0.12),transparent_70%)] blur-2xl"></div>
        </div>

        {/* HERO SECTION */}
        <AboutHero />

        {/* SPEAKING ENGAGEMENTS */}
        <SpeakingSection />

        {/* CERTIFICATION REGISTRY */}
        <CertificationRegistry onImageClick={setSelectedCertImage} />
      </main>

      {/* CERTIFICATION IMAGE MODAL */}
      <CertificationModal imageUrl={selectedCertImage} onClose={closeModal} />
    </>
  );
}
