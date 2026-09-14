/**
 * PlacedNewsletterSignup — the public signup box, where the owner put it
 * (#557). One of these sits in the footer and one at the end of each blog
 * post; each renders the box, with the owner's heading and blurb, only when
 * the placement setting includes its spot, and renders nothing otherwise.
 *
 * Both read the setting through useNewsletterSignupConfig, which makes one
 * request per page load however many are mounted, and which answers the
 * built-in defaults (both spots, the original wording) while loading, on
 * failure and in the pre-rendered HTML.
 *
 * @param {'footer'|'blogEnd'} where - Which spot this mount is.
 * @param {string} source - Passed to the subscribe request as the signup source.
 * @param {string} [className] - Wrapper classes, applied only when the box shows.
 */
import React from 'react';
import NewsletterSignup from '@/components/shared/NewsletterSignup';
import useNewsletterSignupConfig from '@/hooks/useNewsletterSignupConfig';
import { showsAtBlogEnd, showsInFooter } from '@/lib/newsletterSignup';

const SHOWS = { footer: showsInFooter, blogEnd: showsAtBlogEnd };

export default function PlacedNewsletterSignup({ where, source, className = '' }) {
  const { placement, heading, blurb } = useNewsletterSignupConfig();
  const shows = SHOWS[where];
  if (!shows || !shows(placement)) return null;
  return (
    <div className={className}>
      <NewsletterSignup source={source} heading={heading} blurb={blurb} />
    </div>
  );
}
