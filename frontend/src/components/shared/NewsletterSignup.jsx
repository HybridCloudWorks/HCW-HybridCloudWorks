/**
 * NewsletterSignup — public email-capture card (Hyoga design language).
 *
 * POSTs `{ email, source, website }` to `public/newsletter/subscribe` (#504,
 * ADR 0030), which emails a double opt-in link and adds nobody to the list
 * until that link is confirmed — so success here means "check your inbox", and
 * says so. `website` is a honeypot field. A non-2xx answer, including the 429
 * for too many attempts, is shown as the server's own sentence.
 *
 * Mounted in Footer.jsx (every page) and BlogDetailTemplate.jsx (every post).
 *
 * @param {string} [source] - Where on the site the signup happened.
 * @param {string} [className]
 */

import React, { useId, useState } from 'react';
import Eyebrow from '@/components/shared/Eyebrow';
import { getFunctionsBase } from '@/lib/functionsBase';

const STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
};

export default function NewsletterSignup({ source = 'website', className = '' }) {
  // Unique per mount — the component appears in both Footer and blog posts,
  // so a hardcoded id would duplicate on article pages.
  const inputId = useId();
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState(STATUS.IDLE);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (status === STATUS.LOADING) return;
    setStatus(STATUS.LOADING);
    setErrorMessage('');
    try {
      const base = getFunctionsBase();
      if (!base) throw new Error('Newsletter is not configured.');
      const res = await fetch(`${base}/public/newsletter/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source, website: honeypot }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Subscription failed. Please try again.');
      }
      setStatus(STATUS.SUCCESS);
      setEmail('');
    } catch (err) {
      setStatus(STATUS.ERROR);
      setErrorMessage(err.message || 'Subscription failed. Please try again.');
    }
  };

  return (
    <section className={`glass rounded-2xl p-6 sm:p-8 ${className}`} aria-label="Newsletter signup">
      <Eyebrow>Newsletter</Eyebrow>
      <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
        Stay ahead of the cloud curve.
      </h2>
      <p className="mt-2 text-sm text-muted-foreground max-w-md">
        Practical hybrid &amp; multi-cloud insights, straight to your inbox. No spam — unsubscribe
        anytime.
      </p>

      {status === STATUS.SUCCESS ? (
        <p
          className="mt-5 text-sm font-medium text-emerald-600 dark:text-emerald-400"
          role="status"
        >
          Almost there — check your inbox and confirm your subscription within 48 hours.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-5">
          {/* Honeypot — visually hidden; bots fill it, humans never see it. */}
          <input
            type="text"
            name="website"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[9999px] h-px w-px opacity-0"
          />

          <div className="flex w-full max-w-md items-center gap-2 rounded-full border border-border bg-background/70 p-1.5 backdrop-blur">
            <label htmlFor={inputId} className="sr-only">
              Email address
            </label>
            <input
              id={inputId}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={status === STATUS.LOADING}
              className="min-w-0 flex-1 bg-transparent px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="submit"
              disabled={status === STATUS.LOADING}
              className="shrink-0 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {status === STATUS.LOADING ? 'Subscribing…' : 'Subscribe'}
            </button>
          </div>

          {status === STATUS.ERROR && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
