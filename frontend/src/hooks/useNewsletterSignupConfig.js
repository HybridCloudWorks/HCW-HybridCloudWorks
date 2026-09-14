import { useEffect, useState } from 'react';
import { fetchNewsletterSignupConfig } from '@/lib/publicApi';
import { DEFAULT_SIGNUP_CONFIG, readSignupConfig } from '@/lib/newsletterSignup';

/**
 * Where the newsletter signup box shows and what it says (#557), read once per
 * page load and shared by every mount — the footer and the end of a blog post
 * both ask, and they share one request.
 *
 * Until the answer arrives, and for good if the request fails, the box uses
 * the built-in defaults, which are the box as it was before this setting
 * existed. That is also what the pre-renderer emits: effects do not run during
 * server rendering, so the build never calls the API and the HTML it writes is
 * the default box, the same first paint hydration then produces.
 *
 * The result, success or fallback, is kept for the rest of the page load, so
 * a client-side navigation mounts the box with the answer already in hand
 * instead of flashing the defaults again.
 */

let pending = null;
let settled = null;

/** One request per page load; a failure settles on the defaults rather than retrying. */
export function loadNewsletterSignupConfig() {
  pending ??= fetchNewsletterSignupConfig()
    .then((body) => readSignupConfig(body))
    .catch((error) => {
      console.warn('Newsletter signup settings could not be loaded; using the defaults.', error);
      return { ...DEFAULT_SIGNUP_CONFIG };
    })
    .then((config) => {
      settled = config;
      return config;
    });
  return pending;
}

/** Test seam: forget the page load's answer. */
export function resetNewsletterSignupConfig() {
  pending = null;
  settled = null;
}

export default function useNewsletterSignupConfig() {
  const [config, setConfig] = useState(() => settled ?? DEFAULT_SIGNUP_CONFIG);

  useEffect(() => {
    let live = true;
    loadNewsletterSignupConfig().then((next) => {
      if (live) setConfig(next);
    });
    return () => {
      live = false;
    };
  }, []);

  return config;
}
