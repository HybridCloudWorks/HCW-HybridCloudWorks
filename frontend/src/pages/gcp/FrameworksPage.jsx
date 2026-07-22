import React from 'react';
import FrameworksPage from '@/pages/shared/FrameworksPage';
import ComingSoonPage from '@/pages/ComingSoonPage'; // TODO: remove to re-enable

export default function GCPFrameworksPage() {
  return <ComingSoonPage />; // TODO: remove to re-enable
  return <FrameworksPage provider="gcp" />;
}
