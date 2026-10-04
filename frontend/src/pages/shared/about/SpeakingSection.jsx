/**
 * The About page's Speaking Engagements section (#842). Moved out of
 * AboutPage.jsx on 2026-10-04 unchanged; the widget is the page's own.
 */
import React from 'react';
import CustomSessionizeWidget from '@/components/widgets/CustomSessionizeWidget';

export default function SpeakingSection() {
  return (
    <section className="space-y-6">
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-secondary/15 border border-secondary/40 mb-4">
          <h3
            className="text-2xl text-slate-900 dark:text-white flex items-center gap-2"
            style={{ fontFamily: 'Mona Sans, Inter, sans-serif' }}
          >
            <span className="material-symbols-outlined text-(--subtitle-gray)">campaign</span>
            Speaking Engagements
          </h3>
        </div>
      </div>
      <CustomSessionizeWidget />
    </section>
  );
}
