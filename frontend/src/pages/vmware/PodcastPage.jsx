import React from 'react';
import SharedPodcastPage from '@/pages/shared/PodcastPage';

export default function VMwarePodcastPage() {
  // Named, not guessed. Without this the shared page fell back to sniffing
  // the path, which defaulted to GitHub (#183).
  return <SharedPodcastPage provider="vmware" />;
}
