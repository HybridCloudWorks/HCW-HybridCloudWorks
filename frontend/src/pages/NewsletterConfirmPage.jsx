/**
 * NewsletterConfirmPage — /newsletter/confirm#t={token} (#504, ADR 0030).
 *
 * Where the double opt-in email lands. Two decisions shape it:
 *
 *  - **The token is in the fragment, not the query.** A fragment is never sent
 *    to a server, so the subscriber's address — which the signed token carries —
 *    does not reach Cloudflare or Static Web Apps request logs. The page reads
 *    it here and removes it from the address bar once used.
 *  - **Confirming takes a press, not a page load.** Mail security scanners
 *    fetch every link in an email before the person does. If loading this page
 *    confirmed, the scanner would subscribe people on their behalf, which is
 *    exactly the consent double opt-in exists to record. So loading shows a
 *    button, and only the button POSTs.
 *
 * Standalone like /preview: no provider chrome, never pre-rendered, noindex,
 * and disallowed in robots.txt.
 */
import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { getFunctionsBase } from '@/lib/functionsBase';

const STATE = {
  READY: 'ready',
  CONFIRMING: 'confirming',
  CONFIRMED: 'confirmed',
  INVALID: 'invalid',
  ERROR: 'error',
  MISSING: 'missing',
};

/** The token from `#t=…`, or '' when the link was opened without one. */
export function readTokenFromHash(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  return params.get('t') || '';
}

export default function NewsletterConfirmPage() {
  // Read once, on first render: after confirming, the fragment is cleared.
  const [token] = useState(() =>
    typeof window === 'undefined' ? '' : readTokenFromHash(window.location.hash)
  );
  const [state, setState] = useState(token ? STATE.READY : STATE.MISSING);
  const [message, setMessage] = useState('');

  const handleConfirm = async () => {
    if (state === STATE.CONFIRMING) return;
    setState(STATE.CONFIRMING);
    setMessage('');
    try {
      const base = getFunctionsBase();
      if (!base) throw new Error('The newsletter is not configured.');
      const res = await fetch(`${base}/public/newsletter/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok === true) {
        // The link has done its job; do not leave it in history or a bookmark.
        window.history.replaceState(null, '', window.location.pathname);
        setState(STATE.CONFIRMED);
        return;
      }
      if (data?.code === 'INVALID_OR_EXPIRED') {
        setState(STATE.INVALID);
        return;
      }
      throw new Error(data?.error || 'We could not confirm your subscription. Please try again.');
    } catch (err) {
      setState(STATE.ERROR);
      setMessage(err.message || 'We could not confirm your subscription. Please try again.');
    }
  };

  let body;
  switch (state) {
    case STATE.CONFIRMED:
      body = (
        <>
          <h1 className="text-3xl font-bold mb-4 text-slate-900 dark:text-white">
            You&apos;re subscribed
          </h1>
          <p className="text-slate-700 dark:text-slate-400" role="status">
            Thanks for confirming. The HybridCloudWorks newsletter will arrive in your inbox. Every
            issue has an unsubscribe link.
          </p>
        </>
      );
      break;
    case STATE.INVALID:
    case STATE.MISSING:
      body = (
        <>
          <h1 className="text-3xl font-bold mb-4 text-slate-900 dark:text-white">
            This link has expired
          </h1>
          <p className="text-slate-700 dark:text-slate-400" role="alert">
            Confirmation links work for 48 hours and must be opened exactly as they arrived. Sign up
            again from the form at the bottom of any page and we will send a fresh one.
          </p>
        </>
      );
      break;
    default:
      body = (
        <>
          <h1 className="text-3xl font-bold mb-4 text-slate-900 dark:text-white">
            Confirm your subscription
          </h1>
          <p className="text-slate-700 dark:text-slate-400 mb-8">
            One click and you are on the HybridCloudWorks newsletter.
          </p>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={state === STATE.CONFIRMING}
            className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {state === STATE.CONFIRMING ? 'Confirming…' : 'Confirm subscription'}
          </button>
          {state === STATE.ERROR && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {message}
            </p>
          )}
        </>
      );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-28 pb-20 text-center">
      <Helmet>
        <title>Newsletter | HybridCloudWorks</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      {body}
    </div>
  );
}
