/**
 * The newsletter signup box's built-in wording and placement (#557).
 *
 * What the site shows before GET public/newsletter/signup-config answers, when
 * it fails, and in the pre-rendered HTML, which is built without calling the
 * API at all. These are the values the box carried hardcoded before the owner
 * could change them, so a page that never hears from the API is today's page.
 *
 * The server's defaults live in functions/src/lib/newsletter/settings.js, and
 * functions/src/lib/newsletter/signup-config.test.js fails if the two copies
 * drift apart.
 */

export const SIGNUP_PLACEMENTS = Object.freeze(['footer', 'blogEnd', 'both', 'none']);

/** Labels for the Settings tab's placement select, in the order it offers them. */
export const SIGNUP_PLACEMENT_LABELS = Object.freeze({
  footer: 'Footer on every page',
  blogEnd: 'End of blog posts',
  both: 'Both',
  none: 'Nowhere (hide the form)',
});

export const MAX_SIGNUP_HEADING_LENGTH = 80;
export const MAX_SIGNUP_BLURB_LENGTH = 240;

export const DEFAULT_SIGNUP_CONFIG = Object.freeze({
  placement: 'both',
  heading: 'Stay ahead of the cloud curve.',
  blurb:
    'Practical hybrid & multi-cloud insights, straight to your inbox. No spam — unsubscribe anytime.',
});

/** Whether a placement puts the box in the footer. */
export const showsInFooter = (placement) => placement === 'footer' || placement === 'both';

/** Whether a placement puts the box at the end of a blog post. */
export const showsAtBlogEnd = (placement) => placement === 'blogEnd' || placement === 'both';

/**
 * A response body read defensively: each field is taken only when it has the
 * shape the box can use, and the default otherwise, so a malformed answer can
 * change nothing the server did not clearly mean.
 */
export function readSignupConfig(body) {
  const source = body && typeof body === 'object' ? body : {};
  const placement = SIGNUP_PLACEMENTS.includes(source.placement)
    ? source.placement
    : DEFAULT_SIGNUP_CONFIG.placement;
  // Trimmed as the server normalizes them: surrounding spaces never render,
  // and a whitespace-only blurb is empty, which hides the paragraph.
  const trimmedHeading = typeof source.heading === 'string' ? source.heading.trim() : '';
  const heading = trimmedHeading || DEFAULT_SIGNUP_CONFIG.heading;
  const blurb =
    typeof source.blurb === 'string' ? source.blurb.trim() : DEFAULT_SIGNUP_CONFIG.blurb;
  return { placement, heading, blurb };
}
