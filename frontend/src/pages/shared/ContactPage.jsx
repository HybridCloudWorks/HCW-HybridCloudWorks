import React from 'react';
import { Helmet } from 'react-helmet-async';
// Link imported but currently unused - reserved for future navigation features

export default function ContactPage() {
  return (
    <main className="relative max-w-[1600px] mx-auto px-4 md:px-8 py-16 md:py-24 bg-background text-foreground">
      <Helmet>
        <title>Contact &amp; Collaboration | Hybrid Cloud Works</title>
      </Helmet>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-[320px] w-[320px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,_rgba(172,183,174,0.14),_transparent_70%)] blur-2xl"></div>
        <div className="absolute bottom-0 right-10 h-[260px] w-[260px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(194,180,144,0.12),_transparent_70%)] blur-2xl"></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
        {/* Left Column */}
        <div className="lg:col-span-5 space-y-12">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-secondary/15 border border-secondary/40 w-fit">
              <span className="w-1.5 h-1.5 rounded-full bg-muted"></span>
              <span className="text-[10px] uppercase font-bold tracking-[0.28em] text-[color:var(--dark-gray)] dark:text-[color:var(--light-gray)] font-mono">
                Contact Signals
              </span>
            </div>
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold leading-[1.1] tracking-tight text-slate-900 dark:text-white font-display">
              Let&apos;s{' '}
              <span className="text-accent-foreground dark:text-[color:var(--popover-foreground)]">
                Connect
              </span>
            </h1>
            <p className="text-base sm:text-lg text-slate-700 dark:text-[color:var(--subtitle-gray)] leading-relaxed max-w-md">
              Open to speaking engagements, collaborative projects, or general technical questions.
              Let&apos;s discuss how we can build resilient systems together.
            </p>
          </div>
          <div className="space-y-8">
            <div className="glass-panel p-6 rounded-xl border-l-4 border-l-secondary flex flex-col gap-4">
              <h3 className="text-slate-900 dark:text-white font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-muted">
                  connect_without_contact
                </span>
                Digital Presence
              </h3>
              <p className="text-sm text-slate-700 dark:text-[color:var(--subtitle-gray)]">
                Reach out through any of these channels for quick inquiries or to follow my latest
                work.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <a
                className="glass-panel hover:bg-surface-dark/50 transition-all p-4 rounded-xl flex flex-col items-center justify-center gap-2 group"
                href="mailto:contact@hybridcloudworks.com"
              >
                <div className="size-10 rounded-full bg-white/80 dark:bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform ring-1 ring-secondary/60 overflow-hidden">
                  <img src="/icons/logos/mail.png" alt="Email" className="w-6 h-6 object-contain" />
                </div>
                <span className="text-xs font-medium text-slate-600 dark:text-muted-foreground group-hover:text-slate-900 dark:group-hover:text-white">
                  Email
                </span>
              </a>
              <a
                className="glass-panel hover:bg-surface-dark/50 transition-all p-4 rounded-xl flex flex-col items-center justify-center gap-2 group"
                href="https://sessionize.com/"
              >
                <div className="size-10 rounded-full bg-white/80 dark:bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform ring-1 ring-secondary/60 overflow-hidden">
                  <img
                    src="/icons/logos/sessionize.png"
                    alt="Sessionize"
                    className="w-6 h-6 object-contain"
                  />
                </div>
                <span className="text-xs font-medium text-slate-600 dark:text-muted-foreground group-hover:text-slate-900 dark:group-hover:text-white">
                  Sessionize
                </span>
              </a>
              <a
                className="glass-panel hover:bg-surface-dark/50 transition-all p-4 rounded-xl flex flex-col items-center justify-center gap-2 group"
                href="https://popl.co/"
              >
                <div className="size-10 rounded-full bg-white/80 dark:bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform ring-1 ring-secondary/60 overflow-hidden">
                  <img src="/icons/logos/popl.png" alt="Popl" className="w-6 h-6 object-contain" />
                </div>
                <span className="text-xs font-medium text-slate-600 dark:text-muted-foreground group-hover:text-slate-900 dark:group-hover:text-white">
                  Popl
                </span>
              </a>
              <a
                className="glass-panel hover:bg-surface-dark/50 transition-all p-4 rounded-xl flex flex-col items-center justify-center gap-2 group"
                href="https://www.linkedin.com/"
              >
                <div className="size-10 rounded-full bg-white/80 dark:bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform ring-1 ring-secondary/60 overflow-hidden">
                  <img
                    src="/icons/logos/linkedin.png"
                    alt="LinkedIn"
                    className="w-6 h-6 object-contain"
                  />
                </div>
                <span className="text-xs font-medium text-slate-600 dark:text-muted-foreground group-hover:text-slate-900 dark:group-hover:text-white">
                  LinkedIn
                </span>
              </a>
              <a
                className="glass-panel hover:bg-surface-dark/50 transition-all p-4 rounded-xl flex flex-col items-center justify-center gap-2 group"
                href="https://github.com/"
              >
                <div className="size-10 rounded-full bg-white/80 dark:bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform ring-1 ring-secondary/60 overflow-hidden">
                  <img
                    src="/icons/logos/github.png"
                    alt="GitHub"
                    className="w-6 h-6 object-contain"
                  />
                </div>
                <span className="text-xs font-medium text-slate-600 dark:text-muted-foreground group-hover:text-slate-900 dark:group-hover:text-white">
                  GitHub
                </span>
              </a>
              <a
                className="glass-panel hover:bg-surface-dark/50 transition-all p-4 rounded-xl flex flex-col items-center justify-center gap-2 group"
                href="https://twitter.com/"
              >
                <div className="size-10 rounded-full bg-white/80 dark:bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform ring-1 ring-secondary/60 overflow-hidden">
                  <img
                    src="/icons/logos/twitter.png"
                    alt="Twitter"
                    className="w-6 h-6 object-contain"
                  />
                </div>
                <span className="text-xs font-medium text-slate-600 dark:text-muted-foreground group-hover:text-slate-900 dark:group-hover:text-white">
                  Twitter
                </span>
              </a>
            </div>
          </div>
        </div>

        {/* Right Column - Form */}
        <div className="lg:col-span-7">
          <div className="glass-panel p-8 md:p-10 rounded-2xl relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-slate-500/10 blur-[50px] rounded-full"></div>
            <form className="space-y-6 relative z-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-slate-700 dark:text-slate-300 ml-1"
                    htmlFor="contact-full-name"
                  >
                    Full Name
                  </label>
                  <input
                    className="w-full bg-white/80 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-600/30 focus:border-slate-500 dark:focus:border-slate-400 focus:ring-4 focus:ring-slate-400/20 dark:focus:ring-slate-500/10 rounded-xl px-5 py-4 text-slate-900 dark:text-white placeholder:text-slate-500 outline-none transition-all"
                    id="contact-full-name"
                    placeholder="e.g. Alex Rivera"
                    type="text"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-slate-700 dark:text-slate-300 ml-1"
                    htmlFor="contact-email"
                  >
                    Email Address
                  </label>
                  <input
                    className="w-full bg-white/80 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-600/30 focus:border-slate-500 dark:focus:border-slate-400 focus:ring-4 focus:ring-slate-400/20 dark:focus:ring-slate-500/10 rounded-xl px-5 py-4 text-slate-900 dark:text-white placeholder:text-slate-500 outline-none transition-all"
                    id="contact-email"
                    placeholder="alex@company.com"
                    type="email"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-slate-700 dark:text-slate-300 ml-1"
                  htmlFor="contact-topic"
                >
                  Inquiry Topic
                </label>
                <select
                  className="w-full bg-white/80 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-600/30 focus:border-slate-500 dark:focus:border-slate-400 focus:ring-4 focus:ring-slate-400/20 dark:focus:ring-slate-500/10 rounded-xl px-5 py-4 text-slate-900 dark:text-white outline-none transition-all appearance-none cursor-pointer"
                  id="contact-topic"
                >
                  <option>Speaking Engagement</option>
                  <option>Collaborative Project</option>
                  <option>Technical Question</option>
                  <option>General Inquiry</option>
                </select>
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-slate-700 dark:text-slate-300 ml-1"
                  htmlFor="contact-message"
                >
                  Your Message
                </label>
                <textarea
                  className="w-full bg-white/80 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-600/30 focus:border-slate-500 dark:focus:border-slate-400 focus:ring-4 focus:ring-slate-400/20 dark:focus:ring-slate-500/10 rounded-xl px-5 py-4 text-slate-900 dark:text-white placeholder:text-slate-500 outline-none transition-all resize-none"
                  id="contact-message"
                  placeholder="How can I help you today?"
                  rows="5"
                ></textarea>
              </div>
              <button
                className="w-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-white font-bold py-4 rounded-xl shadow-xl shadow-slate-900/20 transition-all transform active:scale-[0.98] flex items-center justify-center gap-2 border border-slate-900/80 dark:border-slate-600/50"
                type="button"
              >
                <span className="material-symbols-outlined">send</span>
                Send Message
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
