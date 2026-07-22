import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-[960px] items-center justify-center px-4 py-16">
      <section className="glass-panel w-full rounded-2xl border border-border p-8 text-center shadow-sm md:p-12">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted-foreground">404</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          This page does not exist.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
          The link may be outdated, the page may have moved, or the URL might be off by a
          character.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Go Home
          </Link>
          <Link
            to="/contact"
            className="inline-flex items-center rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/40"
          >
            Contact
          </Link>
        </div>
      </section>
    </main>
  );
}
