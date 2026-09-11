/**
 * Brand glyphs for the social networks Publer posts to (#498).
 *
 * lucide-react dropped its brand icons in v1, and the Social Hub had been
 * standing in with generic shapes ever since — a chain link for LinkedIn, an
 * @ for X, two heads for Facebook, a camera for Instagram — and nothing at
 * all for Threads, which was added to the workspace after the map was
 * written. The owner's own report from the live page: "I cannot tell which
 * account is which." With three accounts of near-identical names that is
 * exactly the job an icon exists to do.
 *
 * Inline SVG rather than an icon package, for the same reason the YouTube
 * glyph on IntegrationsPage and SocialHubPage is inline: no dependency to
 * audit, no font to load, and `currentColor` so each chip's colour token
 * applies. Paths are the networks' published simple marks at a 24-unit
 * viewbox. `aria-hidden` by default — every caller renders the account name
 * beside the glyph, so the icon is decoration and the name is the label.
 *
 * `BRAND_ICONS` is keyed by the lower-case provider string Publer returns in
 * an account's `provider` field. Unknown providers get `null`, and the chip
 * falls back to text alone rather than a wrong mark.
 */
import React from 'react';

const svg = (className, children, { title } = {}) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden={title ? undefined : 'true'}
    role={title ? 'img' : undefined}
    focusable="false"
  >
    {title ? <title>{title}</title> : null}
    {children}
  </svg>
);

export const BRAND_ICONS = Object.freeze({
  linkedin: ({ className, title }) =>
    svg(
      className,
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />,
      { title }
    ),
  twitter: ({ className, title }) =>
    svg(
      className,
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />,
      { title }
    ),
  facebook: ({ className, title }) =>
    svg(
      className,
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />,
      { title }
    ),
  instagram: ({ className, title }) =>
    svg(
      className,
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />,
      { title }
    ),
  threads: ({ className, title }) =>
    svg(
      className,
      <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z" />,
      { title }
    ),
  youtube: ({ className, title }) =>
    svg(
      className,
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />,
      { title }
    ),
});

/** Publer spells a few providers differently from the map's keys. */
const ALIASES = Object.freeze({
  x: 'twitter',
  'x-twitter': 'twitter',
  fb: 'facebook',
  ig: 'instagram',
  yt: 'youtube',
});

/**
 * The glyph component for a provider, or `null` when there is none — so a
 * caller renders text alone rather than a wrong mark.
 *
 * @param {string} provider as Publer returns it, any case
 * @returns {React.ComponentType<{className?: string, title?: string}>|null}
 */
export function brandIconFor(provider) {
  const key = String(provider || '')
    .trim()
    .toLowerCase();
  return BRAND_ICONS[ALIASES[key] || key] || null;
}

/**
 * Convenience element: `<BrandIcon provider="threads" className="h-4 w-4" />`.
 *
 * The glyph is CALLED, not rendered as a tag. Every `BRAND_ICONS` entry is a
 * plain function returning an element — no hooks, no state — so calling it is
 * equivalent and keeps `react-hooks/static-components` satisfied: that rule
 * refuses a component reference resolved during render and used as `<Icon>`,
 * because a hook-bearing component reached that way would remount on every
 * render. `AccountToggle` on the Social Hub reads its glyph from the
 * module-level `PLATFORM_META` map instead, which the rule allows.
 */
export default function BrandIcon({ provider, className, title }) {
  const glyph = brandIconFor(provider);
  return glyph ? glyph({ className, title }) : null;
}
