/**
 * The About page's hero: portrait, name and role on the left, the
 * experience panel on the right (#842). Moved out of AboutPage.jsx on
 * 2026-10-04 unchanged.
 */
import React from 'react';

export default function AboutHero() {
  return (
    <section className="relative animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-16 items-start">
        {/* Left: Profile Section - centered within left column */}
        <div className="flex flex-col items-center gap-8">
          <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-secondary/15 border border-secondary/40">
            <span className="w-1.5 h-1.5 rounded-full bg-muted"></span>
            <span className="text-xs uppercase font-bold tracking-[0.28em] text-(--dark-gray) dark:text-(--light-gray) font-mono">
              About the Architect
            </span>
          </div>
          <div className="relative group">
            <div className="absolute -inset-1 bg-linear-to-r from-slate-400 to-slate-300 dark:from-slate-600 dark:to-slate-400 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
            <div className="relative w-48 h-48 md:w-60 md:h-60 rounded-full overflow-hidden border-2 border-slate-300/70 dark:border-slate-700/50 shadow-glow">
              <img
                alt="Professional headshot of Saul Patino"
                width="1000"
                height="1000"
                fetchPriority="high"
                decoding="async"
                className="w-full h-full object-cover"
                src="/icons/hcw/portrait_1000x1000.png"
              />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-black text-slate-900 dark:text-white tracking-tight font-display">
              <span className="text-muted-foreground">Saul Patino</span>
            </h1>
            <p className="text-slate-700 dark:text-muted-foreground font-medium text-lg">
              MultiCloud Architect
            </p>
          </div>
        </div>

        {/* Right: Experience Section */}
        <div className="glass-panel p-6 md:p-8 rounded-2xl space-y-4 lg:col-span-2">
          <div className="text-slate-700 dark:text-slate-300 leading-relaxed space-y-4">
            <p>
              With many years of experience spanning key areas of cloud computing, I have built a
              deep understanding of what drives successful digital transformation. My career has
              been dedicated to mastering the complexities of infrastructure, security, and
              scalability, allowing me to deliver solutions that are not just effective, but
              foundational to business growth.
            </p>
            <p>
              In recent years, I have focused on strengthening my position as a{' '}
              <strong>Well-Architected Architect</strong>. By dialing in on the core pillars of
              cloud architecture, I strive to go beyond simply discussing Well-Architected
              principles—I aim to excel in their implementation. My goal is to dive deeper into
              these frameworks to ensure every solution is secure, reliable, efficient, and
              cost-effective.
            </p>
            <p>
              Beyond technical architecture, I am passionate about using my skills to give back. I
              actively engage with local communities and the Education field, mentoring the next
              generation of cloud professionals and sharing knowledge to foster growth and
              innovation.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
