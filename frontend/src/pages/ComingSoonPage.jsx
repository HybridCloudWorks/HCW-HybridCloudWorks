import React from 'react';
import { Helmet } from 'react-helmet-async';

export default function ComingSoonPage({ title = 'Coming Soon' }) {
  return (
    <>
      <Helmet>
        <title>{title} - Hybrid Cloud Works</title>
      </Helmet>
      <main className="relative z-10 max-w-[1600px] mx-auto w-full px-4 md:px-8 py-8 flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
        <span className="material-symbols-outlined text-primary" style={{ fontSize: '72px' }}>
          construction
        </span>
        <h1 className="text-4xl sm:text-5xl font-black text-foreground">Coming Soon</h1>
        <p className="text-slate-500 dark:text-slate-400 text-lg max-w-md">
          This section is under construction. Check back soon for updates.
        </p>
      </main>
    </>
  );
}
